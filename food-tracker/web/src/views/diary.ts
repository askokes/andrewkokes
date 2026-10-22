import type { BarcodeResponse, DayView, EntryView, Meal, ParseResponse } from "../../../src/food/types";
import { api, ApiError, type Me } from "../api";
import { el, formatDay, icon } from "../dom";
import { confetti } from "../confetti";
import { bandFor } from "../balance";
import { foodEmoji, MEAL_EMOJI, OTHER_MEAL_EMOJI } from "../emoji";
import { addDays, amountText, dayPath, dayTitle, friendlyName, fullDate, MEAL_LABELS, MEAL_ORDER, todayIn, whole } from "../food";
import type { Go } from "../nav";
import { listen, voiceErrorMessage, voiceSupported, type Listening } from "../voice";
import { clearProgressCache } from "./dashboard";
import { openEditSheet } from "./editEntry";
import { openScanner } from "./scanner";
import { bar, totalsText } from "./summary";
import { usualCard } from "./usual";

// Days already seen this session, so going back to one paints instantly while it refreshes.
const days = new Map<string, DayView>();
// What's typed in the food box survives a trip to the confirm screen and back.
let draft = "";
// Set when the confirm screen saves; the next Diary render for that date shows it once.
let justAdded: { date: string; count: number; meal: Meal | null; ids: number[]; at: number } | null = null;

// The diary on screen answers the center mic in the tab bar; each new diary takes it over.
let voice: { toggle(): void; stop(): void } | null = null;
let voiceSession = 0;

/** The center mic was tapped: start listening on the diary on screen, or stop if it already is. */
export function toggleDiaryVoice() {
  voice?.toggle();
}

/** Leaving the screen: stop listening (what was heard so far is dropped). */
export function stopDiaryVoice() {
  voice?.stop();
}

/** How long the "Added" note stays; the `.entry.new` highlight in styles.css lasts as long. */
const NOTICE_MS = 3000;

export function rememberDay(day: DayView) {
  days.set(day.date, day);
}

export function cachedDay(date: string) {
  return days.get(date);
}

export function clearDraft() {
  draft = "";
}

/** "Added 2 foods to Lunch" on the next render of `date`, with the new rows (`ids`) highlighted. */
export function noteAdded(date: string, info: { count: number; meal: Meal | null; ids: number[] }) {
  justAdded = { date, ...info, at: performance.now() };
}

const CELEBRATED_KEY = "food.celebrated";
// Also kept in memory, for when the browser won't store it.
const celebrated = new Set<string>();

function allThreeMeals(day: DayView) {
  return (["breakfast", "lunch", "dinner"] as const).every((m) => day.entries.some((e) => e.meal === m));
}

/** True the first time `date` gets its confetti on this phone. */
function firstCelebration(date: string) {
  let stored: string[] = [];
  try {
    stored = JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? "[]");
    if (!Array.isArray(stored)) stored = [];
  } catch {
    stored = [];
  }
  if (celebrated.has(date) || stored.includes(date)) return false;
  celebrated.add(date);
  try {
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...stored, date].slice(-14)));
  } catch {
    // Remembered for this visit only.
  }
  return true;
}

interface DiaryOpts {
  me: Me;
  date: string;
  go: Go;
  /** The center mic in the tab bar, which shows when it's listening. */
  mic: HTMLButtonElement;
  openConfirm: (parsed: ParseResponse, text: string, date: string, today: string) => void;
}

function entryRow(entry: EntryView, onTap: (entry: EntryView) => void, highlight: { ids: Set<number>; at: number } | null) {
  // Light, moderate or rich (balance.ts): a colored edge on the food's picture.
  const band = bandFor(entry);
  const button = el(
    "button",
    { type: "button", className: "entry", dataset: { id: String(entry.id) } },
    el("span", { className: `food-emoji${band ? ` band-${band}` : ""}`, textContent: foodEmoji(entry.foodName, entry.usdaName), attrs: { "aria-hidden": "true" } }),
    el(
      "span",
      { className: "entry-main" },
      el("span", { className: "entry-name", textContent: friendlyName(entry.foodName) }),
      el(
        "span",
        { className: "entry-amount" },
        amountText(entry.quantity, entry.unitLabel),
        band ? el("span", { className: "sr-only", textContent: `, ${band} food` }) : null,
      ),
    ),
    el("span", { className: "entry-cal" }, whole(entry.nutrition.calories), el("span", { className: "unit", textContent: " cal" })),
    icon("chevron"),
  );
  if (highlight?.ids.has(entry.id)) {
    // A refresh repaints the rows; the negative delay keeps the fade where it was instead of restarting it.
    button.classList.add("new");
    button.style.animationDelay = `-${Math.round(performance.now() - highlight.at)}ms`;
  }
  button.addEventListener("click", () => onTap(entry));
  return el("li", {}, button);
}

function entryGroups(day: DayView, onTap: (entry: EntryView) => void, highlight: { ids: Set<number>; at: number } | null): Node[] {
  if (day.entries.length === 0) {
    return [
      el(
        "div",
        { className: "card empty" },
        el("p", { textContent: day.date === day.today ? "Nothing logged yet today." : "Nothing logged on this day." }),
        el("p", { className: "muted", textContent: "Tap the mic and say what you ate, or type it, like “a banana” or “two eggs and toast”." }),
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
        el(
          "div",
          { className: "meal-head" },
          el("h2", {}, el("span", { className: "meal-emoji", textContent: meal ? MEAL_EMOJI[meal] : OTHER_MEAL_EMOJI, attrs: { "aria-hidden": "true" } }), label),
          el("span", { className: "muted", textContent: `${whole(calories)} cal` }),
        ),
        el("ul", { className: "card entry-list" }, ...entries.map((e) => entryRow(e, onTap, highlight))),
      ),
    ];
  });
}

export function diaryView({ me, date, go, mic, openConfirm }: DiaryOpts): Node[] {
  let today = days.get(date)?.today ?? todayIn(me.timezone);
  const added = justAdded?.date === date ? justAdded : null;
  justAdded = null;
  let highlight = added && added.ids.length ? { ids: new Set(added.ids), at: added.at } : null;

  const prev = el("button", { type: "button", className: "icon-button", dataset: { nav: "prev" }, attrs: { "aria-label": "Previous day" } }, icon("back"));
  const next = el("button", { type: "button", className: "icon-button", dataset: { nav: "next" }, attrs: { "aria-label": "Next day" } }, icon("forward"));
  const title = el("h1");
  const backToToday = el("button", { type: "button", className: "text-button back-today", textContent: "Back to today" });
  // Day changes replace the history entry, so the back gesture doesn't walk through every day viewed.
  prev.addEventListener("click", () => go(dayPath(addDays(date, -1), today), { replace: true, focus: "[data-nav=prev]" }));
  next.addEventListener("click", () => {
    if (date < today) go(dayPath(addDays(date, 1), today), { replace: true, focus: "[data-nav=next]" });
  });
  backToToday.addEventListener("click", () => go(dayPath(today, today), { replace: true }));

  const paintHeader = () => {
    const yesterday = addDays(today, -1);
    title.textContent = dayTitle(date, today);
    title.classList.toggle("long", date < yesterday);
    // The date itself is in the green header just below.
    backToToday.hidden = date >= today;
    next.disabled = date >= today;
  };
  paintHeader();

  // Screen reader announcements (saved, removed, added). The visible notice below is for sighted users.
  const status = el("p", { className: "sr-only", attrs: { role: "status" } });
  const announce = (text: string) => {
    // Cleared first so the same words twice in a row are still read.
    status.textContent = "";
    setTimeout(() => (status.textContent = text), 100);
  };

  // ---- what did you eat?
  const input = el("input", {
    id: "food-text",
    type: "text",
    className: "control",
    value: draft,
    placeholder: "2 eggs and toast",
    attrs: { enterkeyhint: "send", autocomplete: "off", "aria-describedby": "food-text-msg" },
  });
  const add = el("button", { type: "submit", className: "button", textContent: "Add" });
  const scan = el("button", { type: "button", className: "button secondary scan-button", title: "Scan a barcode", attrs: { "aria-label": "Scan a barcode" } }, icon("scan"));
  const formMsg = el("p", { id: "food-text-msg", className: "form-msg", attrs: { "aria-live": "polite" } });
  const working = el("p", { className: "hint sr-only-empty", attrs: { role: "status" } });
  const form = el(
    "form",
    { className: "card add-form", noValidate: true },
    el("label", { htmlFor: "food-text", className: "add-label", textContent: "What did you eat?" }),
    el("div", { className: "input-row" }, input, scan, add),
    el("p", { className: "hint", textContent: voiceSupported() ? "Or say it with the green mic below, or scan a package." : "Or scan a package's barcode." }),
    working,
    formMsg,
  );
  input.addEventListener("input", () => {
    draft = input.value;
    formMsg.textContent = "";
  });

  // ---- voice, from the center mic
  let listening: Listening | null = null;
  const setListening = (on: boolean) => {
    mic.classList.toggle("listening", on);
    mic.setAttribute("aria-pressed", String(on));
    mic.setAttribute("aria-label", on ? "Stop listening" : "Say what you ate");
    input.placeholder = on ? "Listening…" : "2 eggs and toast";
    working.textContent = on ? "Listening. Say what you ate, like “two eggs and toast”." : "";
  };
  const toggle = () => {
    if (listening) {
      listening.stop();
      return;
    }
    if (add.disabled) return; // still looking up the last one
    const mine = ++voiceSession;
    formMsg.textContent = "";
    input.value = "";
    setListening(true);
    listening = listen({
      // Words appear in the box as they're heard.
      onWords: (text) => {
        input.value = text;
        draft = text;
      },
      // The same path as typing: straight to the confirm screen.
      onDone: (text) => {
        if (!form.isConnected) return;
        if (!text) {
          formMsg.textContent = voiceErrorMessage("no-speech");
          return;
        }
        input.value = text;
        draft = text;
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
      },
      onError: (code) => {
        const message = voiceErrorMessage(code);
        if (message) formMsg.textContent = message;
      },
      onEnd: () => {
        listening = null;
        // A newer session (on another diary) owns the mic now; leave it alone.
        if (mine === voiceSession) setListening(false);
      },
    });
    if (!listening && mine === voiceSession) setListening(false);
  };
  voice = { toggle, stop: () => listening?.stop() };

  /** While a lookup runs, the box can't take another. */
  const setBusy = (on: boolean, note = "") => {
    add.disabled = on;
    scan.disabled = on;
    add.textContent = on ? "Looking…" : "Add";
    input.readOnly = on;
    working.textContent = note;
  };

  // ---- a package's barcode: straight to the confirm screen, like typing
  scan.addEventListener("click", () => {
    if (add.disabled) return;
    if (listening) listening.stop();
    formMsg.textContent = "";
    openScanner(async (code) => {
      if (!form.isConnected) return;
      setBusy(true, "Looking up that barcode…");
      try {
        const res = await api<BarcodeResponse>("GET", `/api/foods/barcode?code=${encodeURIComponent(code)}`);
        // Found, or not found (the confirm screen offers search and the label's numbers); trouble stays here.
        if (res.status !== "ok" && res.status !== "not_found") {
          formMsg.textContent = res.message ?? "Something went wrong. Please try again.";
          return;
        }
        const product = res.candidates[0];
        const parsed: ParseResponse = {
          meal: null,
          items: [{ quantity: 1, unit: null, food: product?.entryName?.toLowerCase() ?? "", text: `Barcode ${res.code}`, barcode: res.code, status: res.status, message: res.message, candidates: res.candidates }],
        };
        openConfirm(parsed, `Barcode ${res.code}`, date, today);
      } catch (err) {
        formMsg.textContent = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      } finally {
        if (form.isConnected) setBusy(false);
      }
    });
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
    setBusy(true, "Looking that up…");
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
      setBusy(false);
    }
  });

  // ---- the day: a green header with where it stands, what was eaten under it, then the food box and usual foods
  const list = el("div", { className: "entries" });
  // The header stays at the top of the screen while the day's meals scroll under it.
  const logHead = el("header", { className: "day-log-head", tabIndex: -1, attrs: { "aria-label": "Totals" } });
  const log = el("section", { className: "day-log", attrs: { "aria-labelledby": "day-log-title" } }, logHead, list);
  const paintLogHead = (day: DayView | undefined) => {
    const name = date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : formatDay(date, { weekday: "long" });
    const titleBlock = el(
      "div",
      {},
      el("h2", { id: "day-log-title" }, el("span", { className: "day-log-emoji", textContent: "🍽️", attrs: { "aria-hidden": "true" } }), `${name}'s food`),
      el("p", { textContent: fullDate(date, today) }),
    );
    if (!day) {
      logHead.replaceChildren(el("div", { className: "day-log-top" }, titleBlock));
      return;
    }
    const g = day.goals;
    const eaten = Math.round(day.totals.calories);
    const left = g ? g.calories - eaten : null;
    const macro = (label: string, grams: number) => el("span", {}, el("strong", { textContent: whole(Math.round(grams)) }), ` g ${label}`);
    const parts: (HTMLElement | null)[] = [
      el(
        "div",
        { className: "day-log-top" },
        titleBlock,
        el("p", { className: "day-log-total" }, el("strong", { textContent: whole(eaten) }), " cal", g ? el("span", { textContent: `of ${whole(g.calories)}` }) : ""),
      ),
      g ? bar(eaten, g.calories, "Calories") : null,
      el(
        "div",
        { className: "day-log-foot" },
        el("p", { className: "day-log-macros" }, macro("protein", day.totals.proteinG), macro("carbs", day.totals.carbsG), macro("fat", day.totals.fatG)),
        left === null ? null : el("p", { className: left < 0 ? "day-log-left over" : "day-log-left", textContent: `${whole(Math.abs(left))} ${left < 0 ? "over" : "left"}` }),
      ),
    ];
    logHead.replaceChildren(...parts.filter((n): n is HTMLElement => n !== null));
  };
  paintLogHead(days.get(date));
  // One tap on a usual food adds it here; its new row lights up like the confirm screen's do.
  const usual = usualCard({
    date,
    onDay: (day, newIds) => {
      if (newIds.length) highlight = { ids: new Set(newIds), at: performance.now() };
      changed(day);
      if (newIds.length && allThreeMeals(day) && firstCelebration(day.date)) confetti();
    },
  });
  const page = el("div", { className: "stack" }, log, form, usual);

  if (added) {
    let what = `Added ${added.count} ${added.count === 1 ? "food" : "foods"}${added.meal ? ` to ${MEAL_LABELS[added.meal]}` : ""}. Nice!`;
    let shown = what;
    // Breakfast, lunch and dinner all in: a little party, once per day.
    const day = days.get(date);
    if (day && allThreeMeals(day) && firstCelebration(date)) {
      what = `Added ${added.count} ${added.count === 1 ? "food" : "foods"}. That's breakfast, lunch and dinner!`;
      shown = `${what} 🎉`;
      confetti();
    }
    const notice = el("p", { className: "notice", textContent: shown, attrs: { "aria-hidden": "true" } });
    page.prepend(notice);
    announce(what);
    setTimeout(() => {
      notice.classList.add("gone");
      // After the fade and fold in styles.css (instant with reduced motion).
      setTimeout(() => notice.remove(), 600);
    }, NOTICE_MS);
  }

  const paint = (day: DayView) => {
    today = day.today;
    paintHeader();
    paintLogHead(day);
    list.replaceChildren(...entryGroups(day, edit, highlight));
  };
  const saved = (day: DayView) => {
    rememberDay(day);
    paint(day);
  };
  // An edit or removal changes the charts too.
  const changed = (day: DayView) => {
    saved(day);
    clearProgressCache();
  };
  // The sheet lives inside this view, so leaving the view also closes it.
  const edit = (entry: EntryView) =>
    openEditSheet(page, entry, (day, kind) => {
      changed(day);
      announce(`${kind === "removed" ? "Removed" : "Saved"}. ${totalsText(day)}`);
      // The row that opened the sheet was just rebuilt; land on its replacement, or on the totals if it's gone.
      const row = list.querySelector<HTMLElement>(`.entry[data-id="${entry.id}"]`);
      (row ?? logHead).focus();
    });

  const load = async () => {
    const cached = days.get(date);
    if (cached) paint(cached);
    else list.replaceChildren(el("p", { className: "muted", textContent: "Loading…" }));
    try {
      saved(await api<DayView>("GET", `/api/entries?date=${encodeURIComponent(date)}`));
    } catch (err) {
      if (cached) return;
      const retry = el("button", { type: "button", className: "button secondary", textContent: "Try again" });
      retry.addEventListener("click", load);
      list.replaceChildren(
        el("p", { textContent: "Hmm, that didn't load." }),
        el("p", { className: "muted", textContent: err instanceof ApiError ? err.message : "Something went wrong. Please try again." }),
        retry,
      );
    }
  };
  load();

  return [
    el("header", { className: "daybar" }, el("div", { className: "daytitle" }, title, backToToday), el("div", { className: "daynav" }, prev, next)),
    status,
    page,
  ];
}
