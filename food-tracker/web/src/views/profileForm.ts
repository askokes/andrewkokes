import { api, ApiError, type Me } from "../api";
import { ACTIVITY_LEVELS, caloriesBurned, type Activity, type Sex } from "../../../src/burn";
import { lbText, weightPlan, type PlanGoal, type PlanPer } from "../../../src/plan";
import { el, formatDay, segmented } from "../dom";
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
  // The estimate, for the weight plan below; the plan card redraws whenever it changes.
  let burnedNow: number | null = null;
  let showPlan = () => {};

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
    burnedNow = burned;
    showPlan();
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

  // ---- the weight plan (see src/plan.ts): daily goals from what you burn and a pace
  let planGoal: PlanGoal | null = me?.plan?.goal ?? null;
  let planPer: PlanPer = me?.plan?.per ?? "week";
  const goalPicker = segmented<PlanGoal>({
    label: "I want to",
    options: [
      { value: "lose", label: "Lose" },
      { value: "keep", label: "Keep" },
      { value: "gain", label: "Gain" },
    ],
    value: planGoal,
    onChange: (v) => {
      planGoal = v;
      showPlan();
    },
  });
  goalPicker.classList.add("three-up");
  const planLb = field({ label: "Pounds", name: "plan.lb", value: me?.plan?.lb, inputmode: "decimal", suffix: "lb" });
  const perPicker = segmented<PlanPer>({
    label: "Per",
    options: [
      { value: "week", label: "a week" },
      { value: "month", label: "a month" },
    ],
    value: planPer,
    onChange: (v) => {
      planPer = v;
      showPlan();
    },
  });
  perPicker.classList.add("two-up");
  const pace = el("div", { className: "plan-pace" }, planLb.wrap, el("div", { className: "field" }, el("p", { className: "field-label", textContent: "\u00a0" }), perPicker));
  const planOut = el("div", { className: "plan-result", attrs: { "aria-live": "polite" } });
  const useIt = el("button", { type: "button", className: "button wide", textContent: "Use these as my daily goals" });
  const planMsg = el("p", { className: "field-msg", attrs: { "aria-live": "polite" } });
  let planned: ReturnType<typeof weightPlan> | null = null;

  const numberIn = (input: HTMLInputElement) => {
    const v = input.value.trim();
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  showPlan = () => {
    pace.hidden = planGoal === null || planGoal === "keep";
    planned = null;
    useIt.hidden = true;
    const say = (text: string) => planOut.replaceChildren(el("p", { className: "muted", textContent: text }));
    if (planGoal === null) return say("Pick lose, keep or gain to see your daily target.");
    const weightLb = weightForBurn();
    const ageN = Number(age.input.value.trim());
    if (burnedNow === null || weightLb === null || !sex) return say("Fill in the calories you burn above to see it.");
    planned = weightPlan({
      goal: planGoal,
      lb: numberIn(planLb.input),
      per: planPer,
      burned: burnedNow,
      weightLb,
      goalWeightLb: numberIn(goalWeight.input),
      sex,
      age: ageN,
      today: me?.today ?? new Date().toISOString().slice(0, 10),
    });
    if (!planned.ok) return say(planned.reason);
    const p = planned.plan;
    const pounds = lbText(Math.abs(p.weeklyLb));
    const change =
      p.dailyChange === 0
        ? `That's what you burn, so your weight stays steady.`
        : `That's ${whole(Math.abs(p.dailyChange))} ${p.dailyChange < 0 ? "under" : "over"} the ${whole(burnedNow)} you burn, for about ${pounds} lb a week.`;
    const today = me?.today ?? "";
    const goalLb = numberIn(goalWeight.input);
    const lines: (HTMLElement | null)[] = [
      el("p", { className: "plan-target" }, "Eat about ", el("strong", { textContent: whole(p.calories) }), " cal a day"),
      el("p", { textContent: change }),
      el("p", { className: "plan-macros" }, ...[["Protein", p.proteinG], ["Carbs", p.carbsG], ["Fat", p.fatG]].map(([label, g]) => el("span", {}, `${label} `, el("strong", { textContent: `${g} g` })))),
      p.reachBy && goalLb
        ? el("p", {
            textContent: `At this pace you'd reach ${lbText(goalLb)} lb around ${formatDay(p.reachBy, { month: "long", day: "numeric", ...(p.reachBy.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }) })}.`,
          })
        : null,
      ...p.notes.map((n) => el("p", { className: "note", textContent: n })),
    ];
    planOut.replaceChildren(...lines.filter((n): n is HTMLElement => n !== null));
    useIt.hidden = false;
  };
  for (const input of [planLb.input, goalWeight.input]) input.addEventListener("input", showPlan);

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
    "plan.goal": { msg: planMsg, input: goalPicker },
    "plan.lb": planLb,
    "plan.per": { msg: planMsg, input: perPicker },
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
  const planCard = el(
    "section",
    { className: "card stack" },
    el("h2", { textContent: "Your weight plan" }),
    el("p", { className: "hint", textContent: "Works out your daily goals from what you burn and how fast you want to go. A pound is about 3,500 calories." }),
    el("div", { className: "field" }, el("p", { className: "field-label", textContent: "I want to" }), goalPicker),
    pace,
    planOut,
    useIt,
    planMsg,
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
    ...(mode === "setup" ? [about, daily, weight, burn] : [daily, burn, planCard, weight, about]),
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

  // "Use these as my daily goals": the plan's numbers go into the daily goals and the form saves.
  let applying = false;
  useIt.addEventListener("click", () => {
    if (!planned?.ok || submit.disabled) return;
    const p = planned.plan;
    calories.input.value = String(p.calories);
    protein.input.value = String(p.proteinG);
    carbs.input.value = String(p.carbsG);
    fat.input.value = String(p.fatG);
    updateCalNote();
    planMsg.textContent = "";
    applying = true;
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
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
      // The weight plan's choices, so the calculator opens on them next time.
      ...(mode === "settings" && planGoal ? { plan: { goal: planGoal, lb: planGoal === "keep" ? "" : planLb.input.value, per: planPer } } : {}),
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
        if (applying) {
          // Show where the plan's numbers went.
          planMsg.textContent = "Saved as your daily goals.";
          daily.classList.remove("flash");
          void daily.offsetWidth;
          daily.classList.add("flash");
          daily.scrollIntoView({ behavior: "smooth", block: "start" });
        }
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
      if (applying) planMsg.textContent = `Not saved yet: ${e.message}`;
      first?.focus();
    } finally {
      applying = false;
      submit.disabled = false;
      submit.textContent = mode === "setup" ? "Save and start" : "Save changes";
    }
  });

  return form;
}
