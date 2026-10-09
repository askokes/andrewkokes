import type { Candidate, CreateEntriesBody, DayView, EntryInput, LookupStatus, Meal, ParseItemResult, ParseResponse, SearchResponse } from "../../../src/food/types";
import { api, ApiError } from "../api";
import { el, segmented } from "../dom";
import {
  amountText,
  convertQuantity,
  formatQuantity,
  fullDate,
  gramsFor,
  macroText,
  MEAL_LABELS,
  MEAL_ORDER,
  mealForTime,
  nutritionFor,
  parseQuantity,
  sortUnits,
  unitOptionLabel,
  whole,
} from "../food";

interface ConfirmOpts {
  parsed: ParseResponse;
  /** What the user typed (or said), sent along as spokenText. */
  text: string;
  date: string;
  today: string;
  onCancel: () => void;
  onAdded: (day: DayView) => void;
}

interface Pick {
  quantity: number;
  unit: string;
  guessed: boolean;
}

const SOMETHING_WRONG = "Something went wrong. Please try again.";
let nextId = 0;

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Drops the nulls from a list of optional parts. */
function parts(...nodes: (Node | null)[]): Node[] {
  return nodes.filter((n): n is Node => n !== null);
}

function errorText(err: unknown) {
  return err instanceof ApiError ? err.message : SOMETHING_WRONG;
}

/** A blank manual number counts as 0; anything else must be a plain number from 0 to max. */
function readNumber(raw: string, max: number, required: boolean): number | null | "bad" {
  const s = raw.trim().replace(",", ".");
  if (s === "") return required ? null : 0;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return "bad";
  const n = Number(s);
  return n <= max ? n : "bad";
}

function smallField(label: string, value: string, opts: { inputmode?: string; suffix?: string; onInput: (v: string) => void; validate?: (v: string) => boolean }) {
  const id = `m-${++nextId}`;
  const input = el("input", {
    id,
    type: "text",
    className: "control",
    value,
    attrs: { inputmode: opts.inputmode ?? "text", autocomplete: "off", "aria-describedby": `${id}-msg` },
  });
  const msg = el("p", { id: `${id}-msg`, className: "field-msg" });
  const check = () => {
    const bad = opts.validate ? !opts.validate(input.value) : false;
    if (bad) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    msg.textContent = bad ? "Numbers only" : "";
  };
  input.addEventListener("input", () => {
    opts.onInput(input.value);
    check();
  });
  check();
  return el(
    "div",
    { className: "field" },
    el("label", { htmlFor: id, textContent: label }),
    opts.suffix ? el("div", { className: "with-suffix" }, input, el("span", { className: "suffix", textContent: opts.suffix })) : input,
    msg,
  );
}

/**
 * One parsed item. Starts as a match (status ok) or as a lookup that needs help
 * (not found, rate limited, unavailable). The user can switch to another match,
 * search, or type the numbers in themselves.
 */
function itemCard(item: ParseItemResult, changed: () => void) {
  const found = item.status === "ok" && item.candidates.length > 0;
  const s = {
    status: (found ? "ok" : item.status === "ok" ? "not_found" : item.status) as LookupStatus,
    message: item.message,
    pool: item.candidates,
    selected: found ? item.candidates[0] : (null as Candidate | null),
    qty: "",
    unit: "",
    guessed: false,
    /** True once the user touches the amount; until then each match uses its own reading of what was said. */
    edited: false,
    mode: (found ? "match" : "missing") as "match" | "missing" | "manual",
    changeOpen: false,
    removed: false,
    query: item.food,
    results: null as Candidate[] | null,
    searchMsg: "",
    searching: false,
    manual: { name: capitalize(item.food), calories: "", protein: "", carbs: "", fat: "" },
  };
  if (s.selected) setPick(s.selected.amount);

  const node = el("article", { className: "card item-card" });

  function setPick(p: Pick) {
    s.qty = formatQuantity(p.quantity);
    s.unit = p.unit;
    s.guessed = p.guessed;
  }

  /** The amount a candidate gets if picked: keep what the user set when that food has the same unit, else the same weight. */
  function pickFor(c: Candidate): Pick {
    const q = parseQuantity(s.qty);
    const cur = s.selected?.units.find((u) => u.unit === s.unit);
    if (!s.edited || q === null || !cur) return c.amount;
    if (c.units.some((u) => u.unit === s.unit)) return { quantity: q, unit: s.unit, guessed: false };
    return { quantity: gramsFor(q, cur), unit: "g", guessed: false };
  }

  function caloriesFor(c: Candidate, p: Pick) {
    const u = c.units.find((x) => x.unit === p.unit);
    return u ? nutritionFor(c.per100g, gramsFor(p.quantity, u)).calories : c.nutrition.calories;
  }

  function select(c: Candidate) {
    setPick(pickFor(c));
    s.selected = c;
    if (!s.pool.some((p) => p.fdcId === c.fdcId)) s.pool = [c, ...s.pool];
    s.status = "ok";
    s.mode = "match";
    s.changeOpen = false;
    s.results = null;
    s.searchMsg = "";
    render();
    changed();
  }

  /** Searches with the amount as said, or as the user changed it, so results come back sized to match. */
  async function search(query: string, retry: boolean) {
    const q = query.trim();
    if (!q) {
      s.searchMsg = "Type a food to search for.";
      render();
      return;
    }
    const params = new URLSearchParams({ q });
    const typed = parseQuantity(s.qty);
    if (s.edited && typed !== null) {
      params.set("quantity", String(typed));
      params.set("unit", s.unit);
    } else {
      params.set("quantity", String(item.quantity));
      if (item.unit) params.set("unit", item.unit);
    }
    s.searching = true;
    s.searchMsg = "";
    render();
    try {
      const res = await api<SearchResponse>("GET", `/api/foods/search?${params}`);
      s.searching = false;
      if (retry) {
        if (res.status === "ok" && res.candidates.length > 0) {
          s.pool = res.candidates;
          select(res.candidates[0]);
          return;
        }
        s.status = res.status === "ok" ? "not_found" : res.status;
        s.message = res.message;
      } else if (res.status === "ok" && res.candidates.length > 0) {
        s.results = res.candidates;
      } else {
        s.results = null;
        s.searchMsg = res.status === "ok" || res.status === "not_found" ? `No matches for “${q}”. Try a shorter name, or enter it yourself.` : (res.message ?? SOMETHING_WRONG);
      }
    } catch (err) {
      s.searching = false;
      if (retry) s.message = errorText(err);
      else s.searchMsg = errorText(err);
    }
    render();
  }

  function entry(): EntryInput | null {
    if (s.removed) return null;
    if (s.mode === "match" && s.selected) {
      const q = parseQuantity(s.qty);
      return q === null ? null : { fdcId: s.selected.fdcId, quantity: q, unit: s.unit };
    }
    if (s.mode === "manual") {
      const name = s.manual.name.trim();
      const calories = readNumber(s.manual.calories, 20000, true);
      const proteinG = readNumber(s.manual.protein, 2000, false);
      const carbsG = readNumber(s.manual.carbs, 2000, false);
      const fatG = readNumber(s.manual.fat, 2000, false);
      const nums = [calories, proteinG, carbsG, fatG];
      if (!name || nums.some((n) => n === null || n === "bad")) return null;
      return { manual: { name: name.slice(0, 100), calories: calories as number, proteinG: proteinG as number, carbsG: carbsG as number, fatG: fatG as number } };
    }
    return null;
  }

  // ---- pieces

  const textButton = (label: string, extra: string, onClick: () => void) => {
    const b = el("button", { type: "button", className: `text-button ${extra}`.trim(), textContent: label });
    b.addEventListener("click", onClick);
    return b;
  };

  const removeButton = () =>
    textButton("Remove", "quiet", () => {
      s.removed = true;
      render();
      changed();
    });

  const manualButton = () =>
    textButton("Enter it yourself", "", () => {
      s.mode = "manual";
      render();
      changed();
      node.querySelector<HTMLInputElement>(".manual input[inputmode=decimal]")?.focus();
    });

  function choiceList(cands: Candidate[]) {
    return el(
      "ul",
      { className: "choices" },
      ...cands.map((c) => {
        const p = pickFor(c);
        const label = c.units.find((u) => u.unit === p.unit)?.label ?? p.unit;
        const b = el(
          "button",
          { type: "button", className: "choice" },
          el("span", { className: "choice-name", textContent: c.name }),
          c.brand ? el("span", { className: "choice-meta", textContent: c.brand }) : null,
          el("span", { className: "choice-meta", textContent: `${amountText(p.quantity, label)} · ${whole(caloriesFor(c, p))} cal` }),
        );
        b.addEventListener("click", () => select(c));
        return el("li", {}, b);
      }),
    );
  }

  function searchBlock(): Node[] {
    const input = el("input", {
      type: "search",
      className: "control",
      value: s.query,
      placeholder: "Search for a food",
      attrs: { enterkeyhint: "search", autocomplete: "off", "aria-label": "Search for a food" },
    });
    input.addEventListener("input", () => (s.query = input.value));
    const go = el("button", { type: "submit", className: "button secondary", textContent: s.searching ? "Searching…" : "Search", disabled: s.searching });
    const form = el("form", { className: "input-row", noValidate: true, attrs: { role: "search" } }, input, go);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      input.blur();
      search(s.query, false);
    });
    const results = (s.results ?? []).filter((c) => c.fdcId !== s.selected?.fdcId);
    return parts(
      form,
      s.searchMsg ? el("p", { className: "hint", attrs: { role: "status" }, textContent: s.searchMsg }) : null,
      results.length ? el("p", { className: "small-label", textContent: "Search results" }) : null,
      results.length ? choiceList(results) : null,
    );
  }

  function matchParts(c: Candidate): Node[] {
    const qty = el("input", {
      type: "text",
      className: "control qty",
      value: s.qty,
      attrs: { inputmode: "decimal", autocomplete: "off", enterkeyhint: "done", "aria-label": "Amount" },
    });
    const unit = el(
      "select",
      { className: "control", attrs: { "aria-label": "Unit" } },
      ...sortUnits(c.units).map((u) => el("option", { value: u.unit, textContent: unitOptionLabel(u), selected: u.unit === s.unit })),
    );
    const note = s.guessed
      ? el("p", { className: "note", textContent: item.quantity === 1 ? "We guessed 100 g. Check the amount." : "We guessed 100 g each. Check the amount." })
      : null;
    const calOut = el("span", { className: "item-cal" });
    const gramsOut = el("span", { className: "muted" });
    const macrosOut = el("p", { className: "macros muted" });

    const update = () => {
      const q = parseQuantity(s.qty);
      const u = c.units.find((x) => x.unit === s.unit);
      if (q === null) qty.setAttribute("aria-invalid", "true");
      else qty.removeAttribute("aria-invalid");
      if (q === null || !u) {
        calOut.textContent = "Enter an amount";
        gramsOut.textContent = "";
        macrosOut.textContent = "";
        return;
      }
      const grams = gramsFor(q, u);
      const n = nutritionFor(c.per100g, grams);
      calOut.textContent = `${whole(n.calories)} cal`;
      gramsOut.textContent = u.unit === "g" ? "" : `${grams < 10 ? formatQuantity(grams) : whole(grams)} g`;
      macrosOut.textContent = macroText(n);
    };
    const edited = () => {
      s.edited = true;
      if (s.guessed) {
        s.guessed = false;
        note?.remove();
      }
      update();
      changed();
    };
    qty.addEventListener("input", () => {
      s.qty = qty.value;
      edited();
    });
    unit.addEventListener("change", () => {
      const from = c.units.find((u) => u.unit === s.unit);
      const to = c.units.find((u) => u.unit === unit.value);
      const q = parseQuantity(s.qty);
      // A guessed "100 g" was only a placeholder, so a real unit starts from the number that was said.
      if (from && to && q !== null) {
        s.qty = formatQuantity(s.guessed && to.unit !== "g" ? item.quantity : convertQuantity(q, from, to));
        qty.value = s.qty;
      }
      s.unit = unit.value;
      edited();
    });
    update();

    const change = el("button", {
      type: "button",
      className: "text-button",
      textContent: s.changeOpen ? "Close" : "Change",
      attrs: { "aria-expanded": String(s.changeOpen) },
    });
    change.addEventListener("click", () => {
      s.changeOpen = !s.changeOpen;
      if (!s.changeOpen) {
        s.results = null;
        s.searchMsg = "";
      }
      render();
    });

    // Once the user searches, the results take the place of the original matches.
    const others = s.results ? [] : s.pool.filter((p) => p.fdcId !== c.fdcId);
    const panel = s.changeOpen
      ? el(
          "div",
          { className: "change-panel" },
          others.length ? el("p", { className: "small-label", textContent: "Other matches" }) : null,
          others.length ? choiceList(others) : null,
          el("p", { className: "small-label", textContent: others.length ? "Not here? Search" : "Search" }),
          ...searchBlock(),
          manualButton(),
        )
      : null;

    return parts(
      el("h2", { className: "food-name", textContent: c.name }),
      c.brand ? el("p", { className: "muted small", textContent: c.brand }) : null,
      note,
      el("div", { className: "amount-row" }, qty, unit),
      el("div", { className: "item-cal-row" }, calOut, gramsOut),
      macrosOut,
      el("div", { className: "card-actions" }, change, removeButton()),
      panel,
    );
  }

  function missingParts(): Node[] {
    if (s.status === "not_found") {
      return [
        el("h2", { className: "food-name", textContent: `We couldn't find “${item.food}”` }),
        el("p", { className: "hint", textContent: "Try another name, or enter it yourself." }),
        ...searchBlock(),
        el("div", { className: "card-actions" }, manualButton(), removeButton()),
      ];
    }
    const retry = el("button", { type: "button", className: "button secondary wide", textContent: s.searching ? "Trying…" : "Try again", disabled: s.searching });
    retry.addEventListener("click", () => search(item.food, true));
    return [
      el("h2", { className: "food-name", textContent: capitalize(item.food) }),
      el("p", { className: "note", textContent: s.message ?? "We couldn't look that up just now." }),
      retry,
      el("div", { className: "card-actions" }, manualButton(), removeButton()),
    ];
  }

  function manualParts(): Node[] {
    const m = s.manual;
    const okNumber = (v: string) => readNumber(v, 20000, false) !== "bad";
    const back = textButton(s.selected ? "Back to matches" : "Back to search", "", () => {
      s.mode = s.selected ? "match" : "missing";
      render();
      changed();
    });
    return [
      el("h2", { className: "food-name", textContent: "Enter it yourself" }),
      el("p", { className: "hint", textContent: "Use the numbers for the whole amount you had. A food label works great." }),
      el(
        "div",
        { className: "manual stack" },
        smallField("Name", m.name, { onInput: (v) => ((m.name = v), changed()) }),
        smallField("Calories", m.calories, { inputmode: "decimal", suffix: "cal", onInput: (v) => ((m.calories = v), changed()), validate: okNumber }),
        el(
          "div",
          { className: "grid3" },
          smallField("Protein", m.protein, { inputmode: "decimal", suffix: "g", onInput: (v) => ((m.protein = v), changed()), validate: okNumber }),
          smallField("Carbs", m.carbs, { inputmode: "decimal", suffix: "g", onInput: (v) => ((m.carbs = v), changed()), validate: okNumber }),
          smallField("Fat", m.fat, { inputmode: "decimal", suffix: "g", onInput: (v) => ((m.fat = v), changed()), validate: okNumber }),
        ),
      ),
      el("div", { className: "card-actions" }, back, removeButton()),
    ];
  }

  function render() {
    if (s.removed) {
      const undo = textButton("Undo", "", () => {
        s.removed = false;
        render();
        changed();
      });
      node.className = "card item-card removed";
      node.replaceChildren(el("p", { className: "muted", textContent: `Removed “${item.text}”` }), undo);
      return;
    }
    node.className = "card item-card";
    const said = el("p", { className: "said-small", textContent: `“${item.text}”` });
    const body = s.mode === "match" && s.selected ? matchParts(s.selected) : s.mode === "manual" ? manualParts() : missingParts();
    node.replaceChildren(said, ...body);
  }
  render();

  return { node, entry, isRemoved: () => s.removed };
}

export function confirmView({ parsed, text, date, today, onCancel, onAdded }: ConfirmOpts): Node[] {
  let meal: Meal = parsed.meal ?? mealForTime();
  let saving = false;

  const footMsg = el("p", { className: "form-msg", attrs: { role: "alert" } });
  const skipped = el("p", { className: "hint", hidden: true });
  const add = el("button", { type: "button", className: "button add" });
  const cancel = el("button", { type: "button", className: "button secondary", textContent: "Cancel" });

  const refresh = () => {
    const ready = cards.filter((c) => c.entry() !== null).length;
    const waiting = cards.filter((c) => !c.isRemoved() && c.entry() === null).length;
    add.textContent = saving ? "Adding…" : ready === 0 ? "Add" : `Add ${ready} ${ready === 1 ? "item" : "items"}`;
    add.disabled = saving || ready === 0;
    cancel.disabled = saving;
    skipped.hidden = waiting === 0;
    skipped.textContent = waiting === 1 ? "We'll skip 1 item that isn't ready." : `We'll skip ${waiting} items that aren't ready.`;
  };
  const changed = () => {
    footMsg.textContent = "";
    refresh();
  };
  const cards = parsed.items.map((item) => itemCard(item, changed));
  refresh();

  cancel.addEventListener("click", onCancel);
  add.addEventListener("click", async () => {
    const items = cards.map((c) => c.entry()).filter((e): e is EntryInput => e !== null);
    if (items.length === 0 || saving) return;
    const body: CreateEntriesBody = { date, meal, spokenText: text, items };
    saving = true;
    footMsg.textContent = "";
    refresh();
    try {
      const day = await api<DayView>("POST", "/api/entries", body);
      onAdded(day);
    } catch (err) {
      footMsg.textContent = errorText(err);
    } finally {
      saving = false;
      refresh();
    }
  });

  const mealPicker = segmented<Meal>({
    label: "Meal",
    options: MEAL_ORDER.map((m) => ({ value: m, label: MEAL_LABELS[m] })),
    value: meal,
    onChange: (m) => {
      meal = m;
      changed();
    },
  });

  return [
    el(
      "header",
      { className: "confirm-head" },
      el("h1", { textContent: "Check and add" }),
      date !== today ? el("p", { className: "muted", textContent: `Adding to ${fullDate(date, today)}` }) : null,
    ),
    el("blockquote", { className: "said" }, `“${text}”`),
    el("div", { className: "meal-pick" }, el("p", { className: "small-label", textContent: "Which meal?" }), mealPicker),
    ...cards.map((c) => c.node),
    el("div", { className: "sticky-footer" }, footMsg, skipped, el("div", { className: "footer-buttons" }, cancel, add)),
  ];
}
