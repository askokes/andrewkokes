import type { DayView, Meal } from "../../../src/food/types";
import { balanceSentence, BANDS, dayBalance } from "../balance";
import { el, icon } from "../dom";
import { MEAL_EMOJI } from "../emoji";
import { friendlyName, MEAL_LABELS, MEAL_ORDER, pickMeal, whole } from "../food";
import type { Go } from "../nav";

/**
 * "Your meals today" on Overview: each meal with what's in it, or a one-tap way to log it. The Diary
 * opens on that meal with the food box ready.
 */
export function mealsCard(go: Go) {
  const list = el("ul", { className: "meal-list" });
  const node = el("section", { className: "card meals-card", attrs: { "aria-labelledby": "meals-title" } }, el("h2", { id: "meals-title", textContent: "Your meals today" }), list);

  const open = (meal: Meal) => {
    pickMeal(meal);
    go("/diary", { focus: "#food-text" });
  };

  return {
    node,
    paint(day: DayView) {
      list.replaceChildren(
        ...MEAL_ORDER.map((meal) => {
          const foods = day.entries.filter((e) => e.meal === meal);
          const cal = foods.reduce((sum, e) => sum + e.nutrition.calories, 0);
          const logged = foods.length > 0;
          const names = foods.map((e) => friendlyName(e.foodName));
          const what = logged ? (names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ")) : "Nothing yet";
          const button = el(
            "button",
            { type: "button", className: `meal-row${logged ? " logged" : ""}`, attrs: { "aria-label": `${MEAL_LABELS[meal]}: ${logged ? `${what}, ${whole(cal)} calories. Add more` : "nothing yet. Add food"}` } },
            el("span", { className: "meal-row-emoji", textContent: MEAL_EMOJI[meal], attrs: { "aria-hidden": "true" } }),
            el("span", { className: "meal-row-text" }, el("span", { className: "meal-row-name", textContent: MEAL_LABELS[meal] }), el("span", { className: "meal-row-what", textContent: what })),
            logged ? el("span", { className: "meal-row-cal" }, whole(cal), el("span", { className: "unit", textContent: " cal" })) : null,
            el("span", { className: "meal-row-add" }, icon("plus")),
          );
          button.addEventListener("click", () => open(meal));
          return el("li", {}, button);
        }),
      );
    },
  };
}

/**
 * "Food balance" on Overview: the day's calories split into light, moderate and rich foods by how
 * many calories each packs per gram, with one calm sentence. Hidden until something is logged.
 */
export function balanceCard() {
  const bar = el("div", { className: "balance-bar", attrs: { "aria-hidden": "true" } });
  const keys = el("ul", { className: "balance-keys" });
  const sentence = el("p", { className: "balance-sentence" });
  const note = el("p", { className: "hint" });
  const node = el(
    "section",
    { className: "card balance-card", hidden: true, attrs: { "aria-labelledby": "balance-title" } },
    el("div", { className: "balance-head" }, el("h2", { id: "balance-title", textContent: "Food balance" }), el("p", { className: "hint", textContent: "Calories per bite" })),
    bar,
    keys,
    sentence,
    note,
  );

  return {
    node,
    paint(day: DayView) {
      const b = dayBalance(day.entries);
      const judged = b.calories.light + b.calories.moderate + b.calories.rich;
      node.hidden = judged <= 0;
      if (node.hidden) return;
      bar.replaceChildren(
        ...BANDS.filter((band) => b.pct[band.key] > 0).map((band) => {
          const seg = el("span", { className: "balance-seg" });
          seg.style.flexGrow = String(b.pct[band.key]);
          seg.style.background = `var(${band.color})`;
          return seg;
        }),
      );
      keys.replaceChildren(
        ...BANDS.map((band) => {
          const dot = el("span", { className: "balance-dot", attrs: { "aria-hidden": "true" } });
          dot.style.background = `var(${band.color})`;
          return el(
            "li",
            {},
            dot,
            el("span", { className: "balance-key-text" }, el("strong", { textContent: band.label }), el("span", { className: "balance-example", textContent: band.example })),
            el("span", { className: "balance-pct", textContent: `${b.pct[band.key]}%` }),
          );
        }),
      );
      sentence.textContent = balanceSentence(b);
      note.hidden = b.unknown <= 0;
      note.textContent = `${whole(b.unknown)} cal from restaurant items with no weight aren't counted here.`;
    },
  };
}
