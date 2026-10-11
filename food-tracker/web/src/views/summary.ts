import type { DayView } from "../../../src/food/types";
import { el } from "../dom";
import { whole } from "../food";

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

/** Calories against the goal, then a bar per macro: the Overview's Today card. */
export function summaryContent(day: DayView): Node[] {
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
    return [eatenBlock, el("p", { className: "hint", textContent: "Add a daily goal on the Goals tab to see what's left." }), macros];
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

/** One line and a bar for the Diary: where the day stands while logging. */
export function compactTotals(day: DayView): Node[] {
  const g = day.goals;
  const eaten = Math.round(day.totals.calories);
  const left = g ? g.calories - eaten : null;
  const macro = (label: string, grams: number) => el("span", {}, el("strong", { textContent: whole(Math.round(grams)) }), ` g ${label}`);
  const parts: (Node | null)[] = [
    el(
      "div",
      { className: "compact-head" },
      el("p", {}, el("strong", { className: "compact-cal", textContent: whole(eaten) }), g ? ` of ${whole(g.calories)} cal` : " cal"),
      left === null
        ? null
        : el("p", { className: left < 0 ? "over-text" : "muted", textContent: `${whole(Math.abs(left))} ${left < 0 ? "over" : "left"}` }),
    ),
    g ? bar(eaten, g.calories, "Calories") : null,
    el("p", { className: "compact-macros muted" }, macro("protein", day.totals.proteinG), macro("carbs", day.totals.carbsG), macro("fat", day.totals.fatG)),
  ];
  return parts.filter((n): n is Node => n !== null);
}

/** "2,090 of 2,000 calories, 90 over." for the screen reader announcement after a change. */
export function totalsText(day: DayView) {
  const eaten = Math.round(day.totals.calories);
  if (!day.goals) return `${whole(eaten)} calories.`;
  const left = day.goals.calories - eaten;
  return `${whole(eaten)} of ${whole(day.goals.calories)} calories, ${whole(Math.abs(left))} ${left < 0 ? "over" : "left"}.`;
}
