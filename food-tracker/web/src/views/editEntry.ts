import type { DayView, EntryView, Meal, UnitOption, UpdateEntryBody } from "../../../src/food/types";
import { api, ApiError } from "../api";
import { el, segmented } from "../dom";
import {
  convertQuantity,
  formatQuantity,
  friendlyName,
  gramsFor,
  macroText,
  MEAL_LABELS,
  MEAL_ORDER,
  parseQuantity,
  scaleNutrition,
  sortUnits,
  unitOptionLabel,
  whole,
} from "../food";
import { overlayClosed, pushOverlay } from "../nav";

/**
 * Bottom sheet to change an entry's amount or meal, or remove it. Every write
 * answers with the new day. The sheet is its own history entry, so the back
 * gesture closes it.
 */
export function openEditSheet(host: HTMLElement, entry: EntryView, onSaved: (day: DayView, kind: "saved" | "removed") => void) {
  const name = friendlyName(entry.foodName);
  const usda = entry.usdaName ? friendlyName(entry.usdaName) : null;
  const units: UnitOption[] = sortUnits(entry.units);
  if (!units.some((u) => u.unit === entry.unit)) {
    units.unshift({ unit: entry.unit, label: entry.unitLabel, grams: entry.quantity > 0 ? entry.grams / entry.quantity : 0 });
  }

  const qty = el("input", {
    type: "text",
    className: "control qty",
    value: formatQuantity(entry.quantity),
    attrs: { inputmode: "decimal", autocomplete: "off", enterkeyhint: "done", "aria-label": `Amount of ${name}` },
  });
  const unit = el(
    "select",
    { className: "control", attrs: { "aria-label": `Unit for ${name}` } },
    ...units.map((u) => el("option", { value: u.unit, textContent: unitOptionLabel(u), selected: u.unit === entry.unit })),
  );
  const calOut = el("span", { className: "item-cal" });
  const gramsOut = el("span", { className: "muted" });
  const macrosOut = el("p", { className: "macros muted" });

  let meal: Meal | null = entry.meal;
  const mealPicker = segmented<Meal>({
    label: "Meal",
    options: MEAL_ORDER.map((m) => ({ value: m, label: MEAL_LABELS[m] })),
    value: meal,
    onChange: (m) => {
      meal = m;
      msg.textContent = "";
    },
  });

  // Entries don't carry per-100 g values, so the preview scales what was saved.
  const current = () => {
    const q = parseQuantity(qty.value);
    const u = units.find((x) => x.unit === unit.value);
    if (q === null || !u) return null;
    const grams = gramsFor(q, u);
    const factor = entry.grams > 0 && u.grams > 0 ? grams / entry.grams : u.unit === entry.unit && entry.quantity > 0 ? q / entry.quantity : 1;
    return { quantity: q, unit: u, grams, nutrition: scaleNutrition(entry.nutrition, factor) };
  };
  const update = () => {
    const c = current();
    if (c) qty.removeAttribute("aria-invalid");
    else qty.setAttribute("aria-invalid", "true");
    if (!c) {
      calOut.textContent = "Enter an amount";
      gramsOut.textContent = "";
      macrosOut.textContent = "";
      return;
    }
    calOut.textContent = `${whole(c.nutrition.calories)} cal`;
    gramsOut.textContent = c.unit.unit === "g" || c.grams <= 0 ? "" : `${whole(c.grams)} g`;
    macrosOut.textContent = macroText(c.nutrition);
  };
  qty.addEventListener("input", () => {
    msg.textContent = "";
    update();
  });
  let lastUnit = unit.value;
  unit.addEventListener("change", () => {
    const from = units.find((u) => u.unit === lastUnit);
    const to = units.find((u) => u.unit === unit.value);
    const q = parseQuantity(qty.value);
    if (from && to && q !== null) qty.value = formatQuantity(convertQuantity(q, from, to));
    lastUnit = unit.value;
    update();
  });
  update();

  const msg = el("p", { className: "form-msg", attrs: { role: "alert" } });
  const save = el("button", { type: "button", className: "button wide", textContent: "Save" });
  const remove = el("button", { type: "button", className: "button secondary", textContent: "Remove" });
  const cancel = el("button", { type: "button", className: "button secondary", textContent: "Cancel" });
  const actions = el("div", { className: "sheet-actions" }, remove, cancel);
  const yes = el("button", { type: "button", className: "button", textContent: "Yes, remove" });
  const no = el("button", { type: "button", className: "button secondary", textContent: "Keep it" });
  const confirmRemove = el("div", { className: "confirm-remove", hidden: true }, el("p", { className: "confirm-q", textContent: "Remove this?" }), el("div", { className: "sheet-actions" }, no, yes));

  const heading = el("h2", { className: "food-name", textContent: name, tabIndex: -1, attrs: { autofocus: "" } });
  const dialog = el(
    "dialog",
    { className: "sheet", attrs: { "aria-label": `Edit ${name}` } },
    el(
      "div",
      { className: "sheet-body" },
      el("div", { className: "name-block" }, heading, usda && usda !== name ? el("p", { className: "usda-name", textContent: usda }) : null),
      el("div", { className: "amount-row" }, qty, unit),
      el("div", { className: "item-cal-row" }, calOut, gramsOut),
      macrosOut,
      el("div", { className: "meal-pick" }, el("p", { className: "small-label", textContent: "Meal" }), mealPicker),
      msg,
      save,
      actions,
      confirmRemove,
    ),
  );

  const busy = (on: boolean) => {
    for (const b of [save, remove, cancel, yes, no]) b.disabled = on;
  };
  const fail = (err: unknown) => {
    msg.textContent = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
  };

  save.addEventListener("click", async () => {
    const c = current();
    if (!c) {
      msg.textContent = "Enter an amount, like 1 or 1.5.";
      qty.focus();
      return;
    }
    const body: UpdateEntryBody = {};
    if (c.quantity !== entry.quantity || c.unit.unit !== entry.unit) {
      body.quantity = c.quantity;
      body.unit = c.unit.unit;
    }
    if (meal !== entry.meal) body.meal = meal;
    if (Object.keys(body).length === 0) {
      dialog.close();
      return;
    }
    busy(true);
    save.textContent = "Saving…";
    try {
      const day = await api<DayView>("PATCH", `/api/entries/${entry.id}`, body);
      dialog.close();
      onSaved(day, "saved");
    } catch (err) {
      fail(err);
    } finally {
      busy(false);
      save.textContent = "Save";
    }
  });

  remove.addEventListener("click", () => {
    actions.hidden = true;
    save.hidden = true;
    confirmRemove.hidden = false;
    no.focus();
  });
  no.addEventListener("click", () => {
    confirmRemove.hidden = true;
    actions.hidden = false;
    save.hidden = false;
    remove.focus();
  });
  yes.addEventListener("click", async () => {
    busy(true);
    yes.textContent = "Removing…";
    try {
      const day = await api<DayView>("DELETE", `/api/entries/${entry.id}`);
      dialog.close();
      onSaved(day, "removed");
    } catch (err) {
      fail(err);
    } finally {
      busy(false);
      yes.textContent = "Yes, remove";
    }
  });

  cancel.addEventListener("click", () => dialog.close());
  // A tap on the dimmed backdrop (the dialog itself, outside .sheet-body) closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  host.append(dialog);
  dialog.showModal();
  const overlay = pushOverlay(() => dialog.close());
  dialog.addEventListener("close", () => {
    dialog.remove();
    overlayClosed(overlay);
  });
}
