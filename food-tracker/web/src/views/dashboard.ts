import type { DaySummary, SummaryResponse, WeightEntry, WeightResponse } from "../../../src/food/types";
import { api, ApiError, type Me } from "../api";
import { progressChart } from "../chart";
import { el } from "../dom";
import { dayPath, whole } from "../food";
import type { Go } from "../nav";
import { macroCalories, movingAverage, PERIOD_DAYS, periodStats, shiftDate, summarySentence, watchBurned, type Period } from "../progress";

type Range = Exclude<Period, "today">;

interface Loaded {
  days: DaySummary[];
  weights: WeightEntry[];
  today: string;
}

// The last data per period, so switching back paints at once while it refreshes.
const cache = new Map<Range, Loaded>();
// One live chart at a time; a new render replaces it.
let live: { destroy(): void } | null = null;

const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const numericDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" });
const longDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function kpi(label: string, value: string, sub: string) {
  return el(
    "div",
    { className: "kpi" },
    el("p", { className: "kpi-label", textContent: label }),
    el("p", { className: "kpi-value", textContent: value }),
    el("p", { className: "kpi-sub", textContent: sub }),
  );
}

function key(kind: "swatch" | "line" | "dash" | "dot" | "tick", color: string, text: string) {
  const mark = el("span", { className: `key-${kind}`, attrs: { "aria-hidden": "true" } });
  if (kind === "dash") mark.style.borderTopColor = `var(${color})`;
  else mark.style.background = `var(${color})`;
  return el("span", { className: "key" }, mark, text);
}

function table(days: DaySummary[], averages: (number | null)[], weighIns: (number | null)[], showWeight: boolean) {
  const showBurned = days.some((d) => watchBurned(d.watch) !== null);
  const head = ["Day", "Cal", "Protein", "Carbs", "Fat", ...(showBurned ? ["Burned"] : []), ...(showWeight ? ["Weight"] : [])];
  return el(
    "div",
    { className: "table-wrap" },
    el(
      "table",
      { className: "data-table" },
      el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { scope: "col", textContent: h })))),
      el(
        "tbody",
        {},
        ...[...days].reverse().map((d) => {
          const i = days.indexOf(d);
          const weight = weighIns[i] !== null ? `${weighIns[i]}` : averages[i] !== null ? `(${averages[i]})` : "";
          const cells = [
            longDay(d.date),
            d.entries ? whole(d.calories) : "",
            d.entries ? `${whole(d.proteinG)} g` : "",
            d.entries ? `${whole(d.carbsG)} g` : "",
            d.entries ? `${whole(d.fatG)} g` : "",
            ...(showBurned ? [watchBurned(d.watch) === null ? "" : whole(watchBurned(d.watch)!)] : []),
            ...(showWeight ? [weight] : []),
          ];
          return el("tr", {}, el("th", { scope: "row", textContent: cells[0] }), ...cells.slice(1).map((c) => el("td", { textContent: c })));
        }),
      ),
    ),
    showBurned ? el("p", { className: "hint", textContent: "Burned is what your Apple Watch synced: active plus resting calories." }) : null,
    showWeight ? el("p", { className: "hint", textContent: "Weight in parentheses is the 7-day average on a day without a weigh-in." }) : null,
  );
}

/** The Week or Month card: the combined chart, then the tapped day, the headline numbers and one calm sentence. */
export function progressCard(opts: { me: Me; period: Range; today: string; go: Go }): HTMLElement {
  const { me, period, go } = opts;
  const card = el("section", { className: "card progress", attrs: { "aria-label": period === "week" ? "This week" : "Last 30 days" } });
  const showWeight = me.trackWeight;
  let showTable = false;

  const render = (data: Loaded, stale = false) => {
    live?.destroy();
    live = null;
    card.classList.toggle("stale", stale);
    const { days, weights, today } = data;
    const dates = days.map((d) => d.date);
    const averages = showWeight ? movingAverage(dates, weights) : dates.map(() => null);
    const byDate = new Map(weights.map((w) => [w.date, w.weightLb]));
    const weighIns = dates.map((d) => (showWeight ? byDate.get(d) ?? null : null));
    const stats = periodStats(days, averages);
    const slices = days.map(macroCalories);
    // Watch calories for finished days only: today's are still adding up.
    const burned = days.map((d) => (d.date < today ? watchBurned(d.watch) : null));
    let selected = days.length - 1;

    const third = showWeight
      ? kpi(
          "Weight trend",
          stats.weightChange === null ? "–" : `${stats.weightChange < 0 ? "−" : stats.weightChange > 0 ? "+" : ""}${Math.abs(stats.weightChange)}`,
          stats.weightChange === null ? "needs a few weigh-ins" : "lb, 7-day avg",
        )
      : kpi("Avg protein", stats.avgProtein === null ? "–" : `${whole(stats.avgProtein)} g`, stats.goalProtein ? `of ${whole(stats.goalProtein)} g` : "a day");

    const readout = el("div", { className: "readout", attrs: { "aria-live": "polite" } });
    const paintReadout = () => {
      const d = days[selected];
      const items: Node[] = [
        el("strong", { textContent: `${longDay(d.date)} · ${d.entries ? `${whole(d.calories)} cal` : "nothing logged"}` }),
      ];
      if (d.entries) {
        items.push(
          key("swatch", "--protein", `${whole(d.proteinG)} g protein`),
          key("swatch", "--carbs", `${whole(d.carbsG)} g carbs`),
          key("swatch", "--fat", `${whole(d.fatG)} g fat`),
        );
        const other = Math.round(slices[selected].other);
        if (other > 0) items.push(key("swatch", "--other", `${whole(other)} cal other`));
      }
      // Against what the Watch measured that day when there is one, else the estimate.
      const measured = burned[selected];
      const burn = measured ?? d.goal?.baselineCalories;
      if (d.entries && burn) {
        const diff = Math.round(d.calories - burn);
        const against = measured !== null ? "what your Watch says you burned" : "what you burn";
        items.push(el("span", { className: diff > 0 ? "over-text" : "muted", textContent: `${whole(Math.abs(diff))} ${diff > 0 ? "over" : "under"} ${against}` }));
      }
      if (d.watch) {
        const sofar = watchBurned(d.watch);
        const parts = [
          sofar !== null ? `${whole(sofar)} burned${d.date === today ? " so far" : ""}` : d.watch.activeKcal !== null ? `${whole(d.watch.activeKcal)} active cal` : null,
          d.watch.steps !== null ? `${whole(d.watch.steps)} steps` : null,
        ].filter((p): p is string => p !== null);
        if (parts.length) items.push(key("tick", "--baseline", `Watch: ${parts.join(", ")}`));
      }
      if (weighIns[selected] !== null) items.push(key("dot", "--weight", `${weighIns[selected]} lb`));
      else if (averages[selected] !== null) items.push(key("line", "--weight", `avg ${averages[selected]} lb`));
      const open = el("button", { type: "button", className: "text-button open-day", textContent: d.date === today ? "See today ›" : "Open this day ›" });
      open.addEventListener("click", () => go(dayPath(d.date, today), d.date === today ? { replace: true } : {}));
      readout.replaceChildren(el("div", { className: "readout-values" }, ...items), open);
    };
    paintReadout();

    const legend = el(
      "div",
      { className: "legend" },
      key("swatch", "--protein", "Protein"),
      key("swatch", "--carbs", "Carbs"),
      key("swatch", "--fat", "Fat"),
      slices.some((m) => Math.round(m.other) > 0) ? key("swatch", "--other", "Other (calories only, alcohol)") : null,
      key("line", "--goal-line", "Goal"),
      days.some((d) => d.goal?.baselineCalories) ? key("dash", "--baseline", "Baseline (what you burn)") : null,
      burned.some((b) => b !== null) ? key("tick", "--baseline", "Burned (Apple Watch)") : null,
      showWeight ? key("line", "--weight", "Weight, 7-day avg") : null,
      showWeight ? key("dot", "--weight", "Weigh-in") : null,
    );
    const hasWeights = weights.some((w) => w.date >= days[0].date);
    const units = el(
      "div",
      { className: "axis-units", attrs: { "aria-hidden": "true" } },
      el("span", { textContent: "cal" }),
      showWeight && hasWeights ? el("span", { textContent: "lb" }) : null,
    );
    const canvas = el("canvas", {
      attrs: { role: "img", "aria-label": `Calories by macro${showWeight ? " and weight" : ""}, ${period === "week" ? "last 7 days" : "last 30 days"}. ${summarySentence(stats, period, showWeight)}` },
    });
    const plot = el("div", { className: "plot" }, canvas);
    const tableSlot = el("div");
    const toggle = el("button", { type: "button", className: "text-button", textContent: showTable ? "Hide table" : "Show as table" });
    const paintTable = () => {
      toggle.textContent = showTable ? "Hide table" : "Show as table";
      tableSlot.replaceChildren(...(showTable ? [table(days, averages, weighIns, showWeight)] : []));
    };
    toggle.addEventListener("click", () => {
      showTable = !showTable;
      paintTable();
    });
    paintTable();

    // The chart first; its key, the tapped day, and the period's numbers under it.
    card.replaceChildren(
      el("h2", { className: "chart-title", textContent: showWeight ? "Calories and weight" : "Calories by macro" }),
      units,
      plot,
      legend,
      readout,
      el(
        "div",
        { className: "kpis" },
        kpi("Avg per day", stats.avgCalories === null ? "–" : whole(stats.avgCalories), stats.goalCalories ? `of ${whole(stats.goalCalories)} cal` : "cal"),
        kpi("Days logged", String(stats.daysLogged), `of ${stats.days}`),
        third,
      ),
      el("p", { className: "progress-summary", textContent: summarySentence(stats, period, showWeight) }),
      toggle,
      tableSlot,
    );

    // Chart.js needs the canvas in the page to size it.
    requestAnimationFrame(() => {
      if (!canvas.isConnected) return;
      live = progressChart(canvas, {
        days,
        averages,
        weighIns,
        burned,
        showWeight,
        labels: dates.map((d, i) =>
          period === "week" ? shortDay(d) : i === dates.length - 1 || (dates.length - 1 - i) % 7 === 0 ? numericDay(d) : "",
        ),
        barThickness: period === "week" ? 24 : 8,
        selected,
        onSelect: (i) => {
          selected = i;
          paintReadout();
        },
      });
    });
  };

  const load = async () => {
    const cached = cache.get(period);
    if (cached) render(cached, true);
    else card.replaceChildren(el("p", { className: "muted", textContent: "Loading your progress…" }));
    const to = opts.today;
    const from = shiftDate(to, -(PERIOD_DAYS[period] - 1));
    try {
      const [summary, weight] = await Promise.all([
        api<SummaryResponse>("GET", `/api/summary?from=${from}&to=${to}`),
        // Six days before the chart starts, so its first days have a full 7-day average.
        showWeight ? api<WeightResponse>("GET", `/api/weight?from=${shiftDate(from, -6)}&to=${to}`) : null,
      ]);
      const data = { days: summary.days, weights: weight?.entries ?? [], today: summary.today };
      cache.set(period, data);
      if (card.isConnected || !cached) render(data);
    } catch (err) {
      if (cached) {
        card.classList.remove("stale");
        return;
      }
      const retry = el("button", { type: "button", className: "button secondary", textContent: "Try again" });
      retry.addEventListener("click", load);
      card.replaceChildren(
        el("p", { textContent: "Hmm, your progress didn't load." }),
        el("p", { className: "muted", textContent: err instanceof ApiError ? err.message : "Something went wrong. Please try again." }),
        retry,
      );
    }
  };
  load();
  return card;
}

/** Forget cached charts, e.g. after a food or weigh-in is saved. */
export function clearProgressCache() {
  cache.clear();
}

/** "Today's weight": a quick weigh-in, shown when weight tracking is on. */
export function weighInCard(opts: { today: string; onSaved: () => void }): HTMLElement {
  const card = el("section", { className: "card weigh-in", attrs: { "aria-label": "Today's weight" } });
  const id = "weigh-in";
  const input = el("input", {
    id,
    type: "text",
    className: "control",
    placeholder: "lb",
    attrs: { inputmode: "decimal", autocomplete: "off", "aria-describedby": `${id}-msg` },
  });
  const save = el("button", { type: "submit", className: "button", textContent: "Save" });
  const current = el("p", { className: "muted weigh-in-current" });
  const msg = el("p", { id: `${id}-msg`, className: "form-msg", attrs: { "aria-live": "polite" } });
  const form = el(
    "form",
    { className: "weigh-in-form", noValidate: true },
    el("label", { htmlFor: id, className: "add-label", textContent: "Today's weight" }),
    current,
    el("div", { className: "input-row" }, input, save),
    msg,
  );
  card.append(form);

  const showCurrent = (entry: WeightEntry | undefined) => {
    current.textContent = entry ? `Logged ${entry.weightLb} lb today. Saving again replaces it.` : "One weigh-in a day is plenty. Your trend uses the 7-day average.";
  };
  showCurrent(undefined);
  api<WeightResponse>("GET", `/api/weight?from=${opts.today}&to=${opts.today}`)
    .then((r) => showCurrent(r.entries[0]))
    .catch(() => {});

  input.addEventListener("input", () => (msg.textContent = ""));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      msg.textContent = "Type your weight first, like 162.4.";
      input.focus();
      return;
    }
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      const { entry } = await api<{ entry: WeightEntry }>("POST", "/api/weight", { weightLb: value });
      input.value = "";
      input.blur();
      showCurrent(entry);
      msg.textContent = "Saved.";
      clearProgressCache();
      opts.onSaved();
    } catch (err) {
      msg.textContent = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
    } finally {
      save.disabled = false;
      save.textContent = "Save";
    }
  });
  return card;
}
