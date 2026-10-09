import type { Me } from "../api";
import { el, formatDay, formatNumber } from "../dom";

function macroRow(label: string, grams: number | null) {
  return el("div", { className: "row" }, el("span", { textContent: label }), el("span", { className: grams === null ? "muted" : "", textContent: grams === null ? "No goal" : `${formatNumber(grams)} g` }));
}

export function homeView(me: Me, go: (path: string) => void) {
  const settings = el("button", { type: "button", className: "icon-button", textContent: "⚙", attrs: { "aria-label": "Settings" } });
  settings.addEventListener("click", () => go("/settings"));

  const g = me.goals;
  const goalsCard = g
    ? el(
        "section",
        { className: "card stack" },
        el("p", { className: "label", textContent: "Daily goal" }),
        el("p", { className: "big-number" }, formatNumber(g.calories), el("span", { className: "unit", textContent: " cal" })),
        el("div", { className: "rows" }, macroRow("Protein", g.proteinG), macroRow("Carbs", g.carbsG), macroRow("Fat", g.fatG)),
      )
    : el("section", { className: "card" }, el("p", { textContent: "No goals yet. Add them in Settings." }));

  const weightCard =
    me.trackWeight &&
    el(
      "section",
      { className: "card rows" },
      el(
        "div",
        { className: "row" },
        el("span", { textContent: "Last weigh-in" }),
        el("span", {
          className: me.latestWeight ? "" : "muted",
          textContent: me.latestWeight ? `${me.latestWeight.weightLb} lb, ${formatDay(me.latestWeight.date, { month: "short", day: "numeric" })}` : "None yet",
        }),
      ),
      g?.goalWeightLb != null && el("div", { className: "row" }, el("span", { textContent: "Goal weight" }), el("span", { textContent: `${g.goalWeightLb} lb` })),
    );

  return [
    el("header", { className: "topbar" }, el("div", {}, el("h1", { textContent: `Hi, ${me.displayName}` }), el("p", { className: "muted", textContent: formatDay(me.today) })), settings),
    goalsCard,
    weightCard,
    el("section", { className: "card soon" }, el("p", { textContent: "Food logging comes in the next update. For now, check that your goals look right." })),
  ].filter(Boolean) as Node[];
}
