import { api, ApiError, type Me } from "../api";
import { ACTIVITY_LEVELS, caloriesBurned, type Activity, type Sex } from "../../../src/burn";
import { el, segmented } from "../dom";
import { whole } from "../food";
import { US_TIME_ZONES, usZoneFor } from "../timezones";

const LOW_CALORIE_NOTE =
  "That's lower than most adults need. It's worth checking with a doctor or dietitian. You can still save it.";

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

/**
 * The seven US zones. A zone that keeps the same clock as one of them (a phone in Detroit or Boise) shows as
 * that one; a saved zone outside the US stays at the top so saving doesn't move anyone's day.
 */
function timeZoneOptions(current: string) {
  const selected = usZoneFor(current) ?? current;
  const option = (zone: string, label: string) => el("option", { value: zone, textContent: label, selected: zone === selected });
  const options = US_TIME_ZONES.map((z) => option(z.zone, z.label));
  if (!US_TIME_ZONES.some((z) => z.zone === selected)) options.unshift(option(selected, selected.replace(/_/g, " ").replace(/\//g, " / ")));
  return options;
}

interface FieldOpts {
  label: string;
  name: string;
  value?: string | number | null;
  hint?: string;
  inputmode?: "numeric" | "decimal" | "text";
  suffix?: string;
  autocomplete?: string;
}

function field(opts: FieldOpts) {
  const id = `f-${opts.name.replace(/\W/g, "-")}`;
  const input = el("input", {
    id,
    name: opts.name,
    type: "text",
    value: opts.value === null || opts.value === undefined ? "" : String(opts.value),
    attrs: {
      inputmode: opts.inputmode ?? "text",
      autocomplete: opts.autocomplete ?? "off",
      "aria-describedby": `${id}-msg`,
    },
  });
  const wrap = el(
    "div",
    { className: "field" },
    el("label", { htmlFor: id, textContent: opts.label }),
    opts.suffix ? el("div", { className: "with-suffix" }, input, el("span", { className: "suffix", textContent: opts.suffix })) : input,
    opts.hint ? el("p", { className: "hint", textContent: opts.hint }) : null,
    el("p", { id: `${id}-msg`, className: "field-msg", attrs: { "aria-live": "polite" } }),
  );
  return { wrap, input, msg: wrap.querySelector<HTMLElement>(".field-msg")! };
}

/**
 * The profile and goals form. "setup" creates the profile on first run;
 * "settings" edits it. Saving goals that changed adds a new goals row
 * effective today on the server, keeping the old ones as history.
 */
export function profileForm(mode: "setup" | "settings", me: Me | null, onSaved: (me: Me) => void) {
  const goals = me?.goals;
  const name = field({ label: "Your name", name: "displayName", value: me?.displayName, autocomplete: "given-name" });

  const tzId = "f-timezone";
  const tz = el("select", { id: tzId, name: "timezone" }, ...timeZoneOptions(me?.timezone ?? (usZoneFor(browserTimeZone()) ?? "America/Chicago")));
  const tzWrap = el(
    "div",
    { className: "field" },
    el("label", { htmlFor: tzId, textContent: "Time zone" }),
    tz,
    el("p", { className: "hint", textContent: "Sets when your day starts and ends." }),
    el("p", { id: `${tzId}-msg`, className: "field-msg" }),
  );

  const calories = field({ label: "Daily calorie goal", name: "goals.calories", value: goals?.calories, inputmode: "numeric", suffix: "cal" });
  const calNote = el("p", { className: "note", hidden: true, textContent: LOW_CALORIE_NOTE });
  calories.wrap.append(calNote);
  const updateCalNote = () => {
    const n = Number(calories.input.value.trim());
    calNote.hidden = !(calories.input.value.trim() !== "" && Number.isFinite(n) && n > 0 && n < 1200);
  };
  calories.input.addEventListener("input", updateCalNote);
  updateCalNote();

  const protein = field({ label: "Protein", name: "goals.proteinG", value: goals?.proteinG, inputmode: "numeric", suffix: "g" });
  const carbs = field({ label: "Carbs", name: "goals.carbsG", value: goals?.carbsG, inputmode: "numeric", suffix: "g" });
  const fat = field({ label: "Fat", name: "goals.fatG", value: goals?.fatG, inputmode: "numeric", suffix: "g" });

  const trackId = "f-trackWeight";
  const track = el("input", { id: trackId, type: "checkbox", checked: me?.trackWeight ?? false, attrs: { role: "switch" } });
  const currentWeight = field({
    label: mode === "setup" ? "Current weight" : "Today's weight",
    name: "currentWeightLb",
    inputmode: "decimal",
    suffix: "lb",
    hint: mode === "setup" ? "Optional. Helps show your trend later." : "Optional. Leave blank to skip.",
  });
  const goalWeight = field({ label: "Goal weight", name: "goals.goalWeightLb", value: goals?.goalWeightLb, inputmode: "decimal", suffix: "lb", hint: "Optional." });
  const weightFields = el("div", { className: "stack" }, currentWeight.wrap, goalWeight.wrap);
  // ---- the calories you burn a day, worked out (see src/burn.ts)
  let saved = me?.burn;
  let sex: Sex | null = saved?.sex ?? null;
  const sexPicker = segmented<Sex>({
    label: "Sex",
    options: [
      { value: "female", label: "Female" },
      { value: "male", label: "Male" },
    ],
    value: sex,
    onChange: (v) => {
      sex = v;
      fields.sex.msg.textContent = "";
      showBurn();
    },
  });
  sexPicker.classList.add("two-up");
  const sexWrap = el("div", { className: "field" }, el("p", { className: "field-label", textContent: "Sex" }), sexPicker, el("p", { className: "field-msg", attrs: { "aria-live": "polite" } }));
  const age = field({ label: "Age", name: "age", value: saved?.age, inputmode: "numeric", suffix: "yrs" });
  const feet = field({ label: "Height", name: "heightFt", value: saved?.heightIn ? Math.floor(saved.heightIn / 12) : null, inputmode: "numeric", suffix: "ft" });
  const inches = field({ label: "\u00a0", name: "heightInches", value: saved?.heightIn ? Math.round((saved.heightIn % 12) * 10) / 10 : null, inputmode: "decimal", suffix: "in" });
  const heightNote = el("p", { className: "hint", textContent: "Optional. Makes the estimate a little closer." });
  const activityId = "f-activity";
  const activity = el(
    "select",
    { id: activityId, name: "activity" },
    el("option", { value: "", textContent: "Pick one", selected: !saved?.activity }),
    ...ACTIVITY_LEVELS.map((a) => el("option", { value: a.value, textContent: a.label, selected: a.value === saved?.activity })),
  );
  const activityWrap = el(
    "div",
    { className: "field" },
    el("label", { htmlFor: activityId, textContent: "How active are you?" }),
    activity,
    el("p", { id: `${activityId}-msg`, className: "field-msg" }),
  );
  // With weight tracking on, the estimate follows the weigh-ins; with it off, a weight just for this.
  const burnWeight = field({ label: "Your weight", name: "burnWeightLb", value: saved?.weightLb, inputmode: "decimal", suffix: "lb" });
  const weightNote = el("p", { className: "hint" });
  const estimate = el("p", { className: "burn-estimate", attrs: { "aria-live": "polite" } });

  const heightIn = () => {
    const ft = feet.input.value.trim();
    const inch = inches.input.value.trim();
    if (!ft && !inch) return null;
    const total = Number(ft || 0) * 12 + Number(inch || 0);
    return Number.isFinite(total) && total > 0 ? total : null;
  };
  const weightForBurn = () => {
    const typed = (track.checked ? currentWeight : burnWeight).input.value.trim();
    const n = typed ? Number(typed) : saved?.weightLb ?? null;
    return n !== null && Number.isFinite(n) && n > 0 ? n : null;
  };
  const showBurn = () => {
    burnWeight.wrap.hidden = track.checked;
    weightNote.hidden = !track.checked;
    weightNote.textContent = saved?.weightLb
      ? `Uses your weight trend (${saved.weightLb} lb now).`
      : "Uses your weight once you log it below.";
    const ageN = Number(age.input.value.trim());
    const today = me?.today ?? new Date().toISOString().slice(0, 10);
    const burned = caloriesBurned(
      {
        sex,
        birthYear: age.input.value.trim() && Number.isInteger(ageN) ? Number(today.slice(0, 4)) - ageN : null,
        heightIn: heightIn(),
        activity: (activity.value || null) as Activity | null,
      },
      weightForBurn(),
      today,
    );
    estimate.replaceChildren(
      ...(burned === null
        ? [el("span", { className: "muted", textContent: "Fill in sex, age, activity and weight to see it." })]
        : ["You burn about ", el("strong", { textContent: `${whole(burned)} cal` }), " a day"]),
    );
  };
  for (const input of [age.input, feet.input, inches.input, activity, burnWeight.input, currentWeight.input]) {
    input.addEventListener("input", showBurn);
    input.addEventListener("change", showBurn);
  }

  const syncWeight = () => {
    weightFields.hidden = !track.checked;
    showBurn();
  };
  track.addEventListener("change", syncWeight);
  syncWeight();

  const fields: Record<string, { msg: HTMLElement; input: HTMLElement }> = {
    displayName: name,
    timezone: { msg: tzWrap.querySelector(".field-msg")!, input: tz },
    "goals.calories": calories,
    "goals.proteinG": protein,
    "goals.carbsG": carbs,
    "goals.fatG": fat,
    "goals.goalWeightLb": goalWeight,
    currentWeightLb: currentWeight,
    sex: { msg: sexWrap.querySelector(".field-msg")!, input: sexPicker },
    age,
    heightIn: { msg: inches.msg, input: feet.input },
    activity: { msg: activityWrap.querySelector(".field-msg")!, input: activity },
  };

  const formMsg = el("p", { className: "form-msg", attrs: { role: "alert" } });
  // On the Goals tab the form stays put after saving, so say it worked.
  const savedMsg = el("p", { className: "saved-msg", attrs: { role: "status" } });
  const submit = el("button", { type: "submit", className: "button wide", textContent: mode === "setup" ? "Save and start" : "Save changes" });

  const about = el("section", { className: "card stack" }, el("h2", { textContent: "About you" }), name.wrap, tzWrap);
  const daily = el(
    "section",
    { className: "card stack" },
    el("h2", { textContent: "Daily goals" }),
    calories.wrap,
    el("p", { className: "subhead", textContent: "Macro goals (optional)" }),
    el("div", { className: "grid3" }, protein.wrap, carbs.wrap, fat.wrap),
  );
  const burn = el(
    "section",
    { className: "card stack" },
    el("h2", { textContent: "Calories you burn a day" }),
    el("p", { className: "hint", textContent: "Worked out for you. The chart shows it as a dashed line next to your goal, so you can see when a day goes over it." }),
    sexWrap,
    age.wrap,
    el("div", { className: "height-row" }, feet.wrap, inches.wrap),
    heightNote,
    activityWrap,
    burnWeight.wrap,
    weightNote,
    estimate,
  );
  const weight = el(
    "section",
    { className: "card stack" },
    el(
      "label",
      { className: "switch-row", htmlFor: trackId },
      el("span", {}, el("strong", { textContent: "Track my weight" }), el("span", { className: "hint", textContent: "Optional. Turn it on or off any time." })),
      track,
    ),
    weightFields,
  );
  const form = el(
    "form",
    { className: "stack", noValidate: true },
    // First run starts with who you are; the Goals tab leads with the goals.
    ...(mode === "setup" ? [about, daily, weight, burn] : [daily, burn, weight, about]),
    formMsg,
    savedMsg,
    submit,
  );

  // Clear a field's message as soon as it's edited, so fixed fields don't look broken.
  form.addEventListener("input", (event) => {
    for (const f of Object.values(fields)) {
      if (f.input !== event.target) continue;
      f.msg.textContent = "";
      f.input.removeAttribute("aria-invalid");
    }
    if (!Object.values(fields).some((f) => f.msg.textContent)) formMsg.textContent = "";
    savedMsg.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    for (const f of Object.values(fields)) {
      f.msg.textContent = "";
      f.input.removeAttribute("aria-invalid");
    }
    formMsg.textContent = "";
    savedMsg.textContent = "";

    const body = {
      displayName: name.input.value,
      timezone: tz.value,
      trackWeight: track.checked,
      goals: {
        calories: calories.input.value,
        proteinG: protein.input.value,
        carbsG: carbs.input.value,
        fatG: fat.input.value,
        goalWeightLb: goalWeight.input.value,
      },
      sex: sex ?? "",
      age: age.input.value,
      // Something typed that isn't a height goes as is, so the server says what's wrong with it.
      heightIn: heightIn() ?? (feet.input.value.trim() || inches.input.value.trim() ? `${feet.input.value} ${inches.input.value}` : ""),
      activity: activity.value,
      // Today's weight from the weight card, or (tracking off) the weight for the estimate when it was changed.
      currentWeightLb: track.checked
        ? currentWeight.input.value
        : burnWeight.input.value.trim() !== String(saved?.weightLb ?? "")
          ? burnWeight.input.value
          : "",
    };
    fields.currentWeightLb = track.checked ? currentWeight : burnWeight;

    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      const next = await api<Me>("POST", "/api/me", body);
      if (mode === "settings") {
        // Today's weight was logged; leaving it in the box would log it again on the next save.
        currentWeight.input.value = "";
        saved = next.burn;
        showBurn();
        savedMsg.textContent = "Saved.";
      }
      onSaved(next);
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, "Something went wrong. Please try again.", "error");
      let first: HTMLElement | null = null;
      for (const [key, message] of Object.entries(e.fields)) {
        const f = fields[key];
        if (!f) continue;
        f.msg.textContent = message;
        f.input.setAttribute("aria-invalid", "true");
        first ??= f.input;
      }
      // A weight error with tracking switched off can't be seen, so show it up top too.
      formMsg.textContent = e.message;
      first?.focus();
    } finally {
      submit.disabled = false;
      submit.textContent = mode === "setup" ? "Save and start" : "Save changes";
    }
  });

  return form;
}
