import { api, ApiError, type Me } from "../api";
import { el } from "../dom";

const LOW_CALORIE_NOTE =
  "That's lower than most adults need. It's worth checking with a doctor or dietitian. You can still save it.";

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

function timeZoneOptions(selected: string) {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
  }
  if (!zones.includes(selected)) zones = [selected, ...zones];
  return zones.map((tz) => el("option", { value: tz, textContent: tz.replace(/_/g, " ").replace(/\//g, " / "), selected: tz === selected }));
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
  const tz = el("select", { id: tzId, name: "timezone" }, ...timeZoneOptions(me?.timezone ?? browserTimeZone()));
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
  const syncWeight = () => (weightFields.hidden = !track.checked);
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
  };

  const formMsg = el("p", { className: "form-msg", attrs: { role: "alert" } });
  const submit = el("button", { type: "submit", className: "button wide", textContent: mode === "setup" ? "Save and start" : "Save changes" });

  const form = el(
    "form",
    { className: "stack", noValidate: true },
    el("section", { className: "card stack" }, el("h2", { textContent: "About you" }), name.wrap, tzWrap),
    el(
      "section",
      { className: "card stack" },
      el("h2", { textContent: "Daily goals" }),
      calories.wrap,
      el("p", { className: "subhead", textContent: "Macro goals (optional)" }),
      el("div", { className: "grid3" }, protein.wrap, carbs.wrap, fat.wrap),
    ),
    el(
      "section",
      { className: "card stack" },
      el(
        "label",
        { className: "switch-row", htmlFor: trackId },
        el("span", {}, el("strong", { textContent: "Track my weight" }), el("span", { className: "hint", textContent: "Optional. Turn it on or off any time." })),
        track,
      ),
      weightFields,
    ),
    formMsg,
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
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    for (const f of Object.values(fields)) {
      f.msg.textContent = "";
      f.input.removeAttribute("aria-invalid");
    }
    formMsg.textContent = "";

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
      currentWeightLb: track.checked ? currentWeight.input.value : "",
    };

    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      onSaved(await api<Me>("POST", "/api/me", body));
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
