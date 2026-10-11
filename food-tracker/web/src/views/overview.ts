import type { DayView, SummaryResponse } from "../../../src/food/types";
import { api, ApiError, type Me } from "../api";
import { el, segmented } from "../dom";
import { fullDate, todayIn } from "../food";
import type { Go } from "../nav";
import { greeting, loggedStreak, shiftDate, type Period } from "../progress";
import { progressCard, weighInCard } from "./dashboard";
import { cachedDay, rememberDay } from "./diary";
import { todayRings } from "./summary";

const PERIOD_KEY = "food.period";

/** The Today / Week / Month choice, remembered on this device only. */
function savedPeriod(): Period {
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    if (v === "today" || v === "week" || v === "month") return v;
  } catch {
    // Private mode or blocked storage: just start on Today.
  }
  return "today";
}

function savePeriod(p: Period) {
  try {
    localStorage.setItem(PERIOD_KEY, p);
  } catch {
    // Not remembered; harmless.
  }
}

/** Today's totals against the goals, from the same day data the Diary uses. */
function todayCard(today: string): HTMLElement {
  const card = el("section", { className: "card today-card", attrs: { "aria-label": "Today's totals" } });
  const rings = todayRings();
  const paint = (day: DayView) => {
    if (rings.node.parentNode !== card) card.replaceChildren(rings.node);
    rings.paint(day);
  };
  const load = async () => {
    const cached = cachedDay(today);
    if (cached) paint(cached);
    else card.replaceChildren(el("p", { className: "muted", textContent: "Loading…" }));
    try {
      const day = await api<DayView>("GET", `/api/entries?date=${encodeURIComponent(today)}`);
      rememberDay(day);
      paint(day);
    } catch (err) {
      if (cached) return;
      const retry = el("button", { type: "button", className: "button secondary", textContent: "Try again" });
      retry.addEventListener("click", load);
      card.replaceChildren(
        el("p", { textContent: "Hmm, that didn't load." }),
        el("p", { className: "muted", textContent: err instanceof ApiError ? err.message : "Something went wrong. Please try again." }),
        retry,
      );
    }
  };
  load();
  return card;
}

/** How far back the days-in-a-row count looks; longer shows as "60+". */
const STREAK_DAYS = 60;

/** "🌱 5 days in a row", once there are two. Counts logging, nothing about amounts. */
function streakPill(today: string): HTMLElement {
  const pill = el("p", { className: "streak", hidden: true });
  api<SummaryResponse>("GET", `/api/summary?from=${shiftDate(today, -(STREAK_DAYS - 1))}&to=${today}`)
    .then((r) => {
      const n = loggedStreak(r.days, r.today);
      if (n < 2) return;
      pill.replaceChildren(el("span", { textContent: "🌱", attrs: { "aria-hidden": "true" } }), ` ${n >= STREAK_DAYS - 1 ? `${STREAK_DAYS}+` : n} days logged in a row`);
      pill.hidden = false;
    })
    .catch(() => {});
  return pill;
}

/** The home tab: today's totals or the Week / Month chart, and the weigh-in when weight tracking is on. */
export function overviewView({ me, go }: { me: Me; go: Go }): Node[] {
  const today = cachedDay(todayIn(me.timezone))?.today ?? todayIn(me.timezone);
  let period = savedPeriod();
  const slot = el("div", { className: "period-slot" });
  const show = () => slot.replaceChildren(period === "today" ? todayCard(today) : progressCard({ me, period, today, go }));
  show();

  const switcher = segmented<Period>({
    label: "Show",
    options: [
      { value: "today", label: "Today" },
      { value: "week", label: "Week" },
      { value: "month", label: "Month" },
    ],
    value: period,
    onChange: (p) => {
      period = p;
      savePeriod(p);
      show();
    },
  });
  switcher.classList.add("period-switch");

  const weighIn = me.trackWeight ? weighInCard({ today, onSaved: () => period !== "today" && show() }) : null;

  return [
    el(
      "header",
      { className: "page-head" },
      el("h1", { textContent: greeting(new Date().getHours(), me.displayName) }),
      el("p", { className: "muted", textContent: fullDate(today, today) }),
      streakPill(today),
    ),
    el("div", { className: "stack" }, switcher, slot, weighIn),
  ];
}
