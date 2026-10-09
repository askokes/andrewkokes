import type { DayView, EntryView, Meal, ParseResponse } from "../../../src/food/types";
import { api, ApiError, type Me } from "../api";
import { el, icon } from "../dom";
import { addDays, amountText, dayPath, dayTitle, fullDate, MEAL_LABELS, MEAL_ORDER, todayIn, whole } from "../food";
import { openEditSheet } from "./editEntry";

// Days already seen this session, so going back to one paints instantly while it refreshes.
const days = new Map<string, DayView>();
// What's typed in the food box survives a trip to the confirm screen and back.
let draft = "";

export function rememberDay(day: DayView) {
  days.set(day.date, day);
}

export function clearDraft() {
  draft = "";
}

interface TodayOpts {
  me: Me;
  date: string;
  go: (path: string, opts?: { replace?: boolean }) => void;
  openConfirm: (parsed: ParseResponse, text: string, date: string, today: string) => void;
}

/** A progress bar. Past the goal it fills completely in a calm neutral color, never red. */
function bar(value: number, goal: number, label: string, thin = false) {
  const fill = el("span", { className: "bar-fill" });
  fill.style.width = `${goal > 0 ? Math.min(100, (value / goal) * 100) : 100}%`;
  return el(
    "div",
    {
      className: `bar${thin ? " thin" : ""}${value > goal ? " over" : ""}`,
      attrs: {
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": "0",
        "aria-valuemax": String(goal),
        "aria-valuenow": String(Math.min(value, goal)),
        "aria-valuetext": `${whole(value)} of ${whole(goal)}`,
      },
    },
    fill,
  );
}

function macroRow(label: string, eaten: number, goal: number | null) {
  const grams = Math.round(eaten);
  if (goal === null) {
    return el("div", { className: "macro" }, el("div", { className: "macro-line" }, el("span", { className: "macro-name", textContent: label }), el("span", { textContent: `${whole(grams)} g` })));
  }
  const left = goal - grams;
  return el(
    "div",
    { className: "macro" },
    el(
      "div",
      { className: "macro-line" },
      el("span", {}, el("span", { className: "macro-name", textContent: label }), el("span", { className: "muted", textContent: ` ${whole(grams)} / ${whole(goal)} g` })),
      el("span", { className: left < 0 ? "over-text" : "muted", textContent: left < 0 ? `${whole(-left)} g over` : `${whole(left)} g left` }),
    ),
    bar(grams, goal, label, true),
  );
}

function summaryContent(day: DayView): Node[] {
  const g = day.goals;
  const eaten = Math.round(day.totals.calories);
  const macros = el(
    "div",
    { className: "macros-list" },
    macroRow("Protein", day.totals.proteinG, g?.proteinG ?? null),
    macroRow("Carbs", day.totals.carbsG, g?.carbsG ?? null),
    macroRow("Fat", day.totals.fatG, g?.fatG ?? null),
  );
  const eatenBlock = el(
    "div",
    {},
    el("p", { className: "big-number", textContent: whole(eaten) }),
    el("p", { className: "muted", textContent: g ? `of ${whole(g.calories)} cal` : "calories" }),
  );
  if (!g) {
    return [eatenBlock, el("p", { className: "hint", textContent: "Add a daily goal in Settings to see what's left." }), macros];
  }
  const left = g.calories - eaten;
  return [
    el(
      "div",
      { className: "cal-head" },
      eatenBlock,
      el(
        "div",
        { className: `cal-left${left < 0 ? " over-text" : ""}` },
        el("p", { className: "mid-number", textContent: whole(Math.abs(left)) }),
        el("p", { className: left < 0 ? "" : "muted", textContent: left < 0 ? "over" : "left" }),
      ),
    ),
    bar(eaten, g.calories, "Calories"),
    macros,
  ];
}

function entryRow(entry: EntryView, onTap: (entry: EntryView) => void) {
  const button = el(
    "button",
    { type: "button", className: "entry" },
    el(
      "span",
      { className: "entry-main" },
      el("span", { className: "entry-name", textContent: entry.foodName }),
      el("span", { className: "entry-amount", textContent: amountText(entry.quantity, entry.unitLabel) }),
    ),
    el("span", { className: "entry-cal" }, whole(entry.nutrition.calories), el("span", { className: "unit", textContent: " cal" })),
    icon("chevron"),
  );
  button.addEventListener("click", () => onTap(entry));
  return el("li", {}, button);
}

function entryGroups(day: DayView, onTap: (entry: EntryView) => void): Node[] {
  if (day.entries.length === 0) {
    return [
      el(
        "div",
        { className: "card empty" },
        el("p", { textContent: day.date === day.today ? "Nothing logged yet today." : "Nothing logged on this day." }),
        el("p", { className: "muted", textContent: "Type what you ate above, like “a banana” or “two eggs and toast”." }),
      ),
    ];
  }
  const groups: [Meal | null, string][] = [...MEAL_ORDER.map((m): [Meal, string] => [m, MEAL_LABELS[m]]), [null, "Other"]];
  return groups.flatMap(([meal, label]) => {
    const entries = day.entries.filter((e) => e.meal === meal);
    if (entries.length === 0) return [];
    const calories = entries.reduce((sum, e) => sum + e.nutrition.calories, 0);
    return [
      el(
        "section",
        { className: "meal-group" },
        el("div", { className: "meal-head" }, el("h2", { textContent: label }), el("span", { className: "muted", textContent: `${whole(calories)} cal` })),
        el("ul", { className: "card entry-list" }, ...entries.map((e) => entryRow(e, onTap))),
      ),
    ];
  });
}

export function todayView({ me, date, go, openConfirm }: TodayOpts): Node[] {
  let today = days.get(date)?.today ?? todayIn(me.timezone);

  const prev = el("button", { type: "button", className: "icon-button", attrs: { "aria-label": "Previous day" } }, icon("back"));
  const next = el("button", { type: "button", className: "icon-button", attrs: { "aria-label": "Next day" } }, icon("forward"));
  const settings = el("button", { type: "button", className: "icon-button", textContent: "⚙", attrs: { "aria-label": "Settings" } });
  const title = el("h1");
  const subtitle = el("p", { className: "muted" });
  // Day changes replace the history entry, so the back gesture doesn't walk through every day viewed.
  prev.addEventListener("click", () => go(dayPath(addDays(date, -1), today), { replace: true }));
  next.addEventListener("click", () => {
    if (date < today) go(dayPath(addDays(date, 1), today), { replace: true });
  });
  settings.addEventListener("click", () => go("/settings"));

  const paintHeader = () => {
    title.textContent = dayTitle(date, today);
    subtitle.textContent = fullDate(date, today);
    next.disabled = date >= today;
  };
  paintHeader();

  // ---- what did you eat?
  const input = el("input", {
    id: "food-text",
    type: "text",
    className: "control",
    value: draft,
    placeholder: "two eggs and toast",
    attrs: { enterkeyhint: "send", autocomplete: "off", "aria-describedby": "food-text-msg" },
  });
  const add = el("button", { type: "submit", className: "button", textContent: "Add" });
  const formMsg = el("p", { id: "food-text-msg", className: "form-msg", attrs: { "aria-live": "polite" } });
  const working = el("p", { className: "hint", hidden: true, textContent: "Looking that up…" });
  const form = el(
    "form",
    { className: "card add-form", noValidate: true },
    el("label", { htmlFor: "food-text", className: "add-label", textContent: "What did you eat?" }),
    el(
      "div",
      { className: "input-row" },
      input,
      // Phase 4: the mic button goes here, between the text box and Add.
      add,
    ),
    working,
    formMsg,
  );
  input.addEventListener("input", () => {
    draft = input.value;
    formMsg.textContent = "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      formMsg.textContent = "Type what you ate first, like “a banana”.";
      input.focus();
      return;
    }
    formMsg.textContent = "";
    add.disabled = true;
    input.readOnly = true;
    working.hidden = false;
    try {
      const parsed = await api<ParseResponse>("POST", "/api/parse", { text });
      if (parsed.items.length === 0) {
        formMsg.textContent = "We couldn't spot a food in that. Try something like “two eggs and toast”.";
        return;
      }
      input.blur();
      openConfirm(parsed, text, date, today);
    } catch (err) {
      formMsg.textContent = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
    } finally {
      add.disabled = false;
      input.readOnly = false;
      working.hidden = true;
    }
  });

  // ---- the day
  const summary = el("section", { className: "card summary", attrs: { "aria-label": "Totals" } });
  const list = el("div", { className: "entries" });
  const page = el("div", { className: "stack" }, summary, form, list);

  const paint = (day: DayView) => {
    today = day.today;
    paintHeader();
    summary.replaceChildren(...summaryContent(day));
    list.replaceChildren(...entryGroups(day, edit));
  };
  const saved = (day: DayView) => {
    rememberDay(day);
    paint(day);
  };
  // The sheet lives inside this view, so leaving the view also closes it.
  const edit = (entry: EntryView) => openEditSheet(page, entry, saved);

  const load = async () => {
    const cached = days.get(date);
    if (cached) paint(cached);
    else summary.replaceChildren(el("p", { className: "muted", textContent: "Loading…" }));
    try {
      saved(await api<DayView>("GET", `/api/entries?date=${encodeURIComponent(date)}`));
    } catch (err) {
      if (cached) return;
      const retry = el("button", { type: "button", className: "button secondary", textContent: "Try again" });
      retry.addEventListener("click", load);
      summary.replaceChildren(
        el("p", { textContent: "Hmm, that didn't load." }),
        el("p", { className: "muted", textContent: err instanceof ApiError ? err.message : "Something went wrong. Please try again." }),
        retry,
      );
    }
  };
  load();

  return [el("header", { className: "daybar" }, el("div", { className: "daytitle" }, title, subtitle), el("div", { className: "daynav" }, prev, next), settings), page];
}
