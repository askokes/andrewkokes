import type { CreateEntriesBody, DayView, Meal, UsualFood, UsualResponse } from "../../../src/food/types";
import { api, ApiError } from "../api";
import { el, icon, segmented } from "../dom";
import { foodEmoji } from "../emoji";
import { amountText, friendlyName, MEAL_LABELS, MEAL_ORDER, mealForTime, whole } from "../food";

/** Foods shown before "Show more". */
const SHOWN = 4;
/** How long "Added ... Undo" stays. */
const UNDO_MS = 8000;
const NOTE_MS = 3000;

// The last list loaded, painted at once on the next Diary while it refreshes.
let cached: UsualFood[] | null = null;

interface UsualOpts {
  /** The day on screen, which a tap adds to. */
  date: string;
  /** A food was added (the new row's id) or taken back out (no ids). */
  onDay: (day: DayView, newIds: number[]) => void;
}

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

/**
 * "Your usual foods" on the Diary: what this person logs most, one tap to add
 * again at the same amount. Hidden until they've logged something.
 */
export function usualCard({ date, onDay }: UsualOpts): HTMLElement {
  let foods = cached ?? [];
  let meal: Meal = mealForTime();
  let expanded = false;
  let msgTimer: ReturnType<typeof setTimeout> | undefined;

  const list = el("ul", { className: "usual-list" });
  const more = el("button", { type: "button", className: "text-button usual-more" });
  const msg = el("p", { className: "usual-msg", attrs: { "aria-live": "polite" } });
  const picker = segmented<Meal>({
    label: "Add to which meal",
    options: MEAL_ORDER.map((m) => ({ value: m, label: MEAL_LABELS[m] })),
    value: meal,
    onChange: (m) => {
      meal = m;
      paint();
    },
  });
  const card = el(
    "section",
    { className: "card usual", attrs: { "aria-labelledby": "usual-title" } },
    el("h2", { id: "usual-title", className: "add-label", textContent: "Your usual foods" }),
    picker,
    // Right under the meals, where it's still in sight after a tap further down.
    msg,
    list,
    more,
  );

  more.addEventListener("click", () => {
    expanded = !expanded;
    paint();
  });

  /** The note under the meal buttons; with `ms`, it goes away after that long. */
  const say = (parts: (Node | string)[], ms?: number) => {
    clearTimeout(msgTimer);
    msg.replaceChildren(...parts);
    if (ms) msgTimer = setTimeout(() => msg.replaceChildren(), ms);
  };

  async function add(food: UsualFood, button: HTMLButtonElement) {
    const to = meal;
    button.disabled = true;
    button.classList.add("adding");
    say([]);
    try {
      const body: CreateEntriesBody = { date, meal: to, items: [food.entry] };
      const day = await api<DayView>("POST", "/api/entries", body);
      // The row just made: the newest one with this name.
      const same = day.entries.filter((e) => e.foodName === food.foodName);
      const ids = same.length ? [Math.max(...same.map((e) => e.id))] : [];
      onDay(day, ids);
      button.classList.add("added");
      setTimeout(() => button.classList.remove("added"), 1500);

      const undo = el("button", { type: "button", className: "text-button", textContent: "Undo" });
      undo.addEventListener("click", async () => {
        if (!ids.length) return;
        undo.disabled = true;
        try {
          onDay(await api<DayView>("DELETE", `/api/entries/${ids[0]}`), []);
          say([`Removed ${friendlyName(food.foodName)}.`], NOTE_MS);
        } catch (err) {
          say([errorText(err)]);
        }
      });
      say([`Added ${friendlyName(food.foodName)} to ${MEAL_LABELS[to]}. `, ids.length ? undo : ""], UNDO_MS);
    } catch (err) {
      say([errorText(err)]);
    } finally {
      button.disabled = false;
      button.classList.remove("adding");
    }
  }

  function tile(food: UsualFood) {
    const name = friendlyName(food.foodName);
    const amount = amountText(food.quantity, food.unitLabel);
    const calories = whole(food.nutrition.calories);
    const button = el(
      "button",
      {
        type: "button",
        className: "usual-food",
        dataset: { key: food.key },
        attrs: { "aria-label": `Add ${name}, ${amount}, ${calories} calories, to ${MEAL_LABELS[meal]}` },
      },
      el("span", { className: "food-emoji", textContent: foodEmoji(food.foodName, food.usdaName), attrs: { "aria-hidden": "true" } }),
      el(
        "span",
        { className: "usual-text" },
        el("span", { className: "usual-name", textContent: name }),
        el("span", { className: "usual-amount", textContent: `${amount} · ${calories} cal` }),
      ),
      el("span", { className: "usual-plus", attrs: { "aria-hidden": "true" } }, icon("plus"), icon("check")),
    );
    button.addEventListener("click", () => add(food, button));
    return el("li", {}, button);
  }

  function paint() {
    card.hidden = foods.length === 0;
    // What's usually eaten at the picked meal comes first; otherwise the server's order (most logged).
    const ordered = [...foods].sort((a, b) => b.meals[meal] - a.meals[meal]);
    list.replaceChildren(...(expanded ? ordered : ordered.slice(0, SHOWN)).map(tile));
    more.hidden = ordered.length <= SHOWN;
    more.textContent = expanded ? "Show fewer" : `Show ${ordered.length - SHOWN} more`;
  }

  async function load() {
    try {
      foods = (await api<UsualResponse>("GET", "/api/foods/usual")).foods;
      cached = foods;
      paint();
    } catch {
      // The card is a shortcut: without it, typing and the mic still work.
    }
  }

  paint();
  load();
  return card;
}
