// The dashboard chart: calories stacked by macro (left axis) with the 7-day
// average weight and weigh-ins on a right axis. Andrew asked for one combined
// chart; to keep two scales honest, both axes are labeled with their units and
// the weight axis is fitted to the weights actually shown, so its ticks never
// pretend to cover values that aren't there.
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  type ChartConfigurationCustomTypesPerDataset,
  type Plugin,
} from "chart.js";
import type { DaySummary } from "../../src/food/types";
import { macroCalories } from "./progress";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, LineController, LineElement, PointElement);

export interface ChartInput {
  days: DaySummary[];
  /** 7-day average weight per day (null where there's no window). */
  averages: (number | null)[];
  /** The weigh-in on each day, or null. */
  weighIns: (number | null)[];
  /** Calories the Apple Watch says were burned each finished day, or null. */
  burned: (number | null)[];
  showWeight: boolean;
  /** Tick labels under the bars ("Mon" or "9/16"); "" hides one. */
  labels: string[];
  barThickness: number;
  selected: number;
  onSelect: (index: number) => void;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const FONT = { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', size: 11 };

/** The left axis's top: room above the tallest bar (and the goal) so the weight line can ride above most bars. */
function calorieMax(days: DaySummary[], burned: (number | null)[]) {
  const peak = Math.max(...days.map((d, i) => Math.max(d.calories, d.goal?.calories ?? 0, d.goal?.baselineCalories ?? 0, burned[i] ?? 0)), 1000);
  return Math.ceil((peak * 1.3) / 500) * 500;
}

/**
 * The weight axis: the weights sit in the top part of the plot, above most
 * bars. Ticks are kept to the band the weights actually span.
 */
function weightAxis(values: number[]) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, 2);
  const bandLo = Math.floor(lo - span * 0.15);
  const bandHi = Math.ceil(hi + span * 0.15);
  // The band takes the top ~40% of the plot.
  const min = bandLo - (bandHi - bandLo) * 1.5;
  return { min, max: bandHi, bandLo, bandHi };
}

/** A hairline marking the selected day. */
// Chart.js draws datasets with a higher `order` first, so lower numbers end up on top.
const crosshair = (getIndex: () => number): Plugin<"bar" | "line"> => ({
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const el = chart.getDatasetMeta(0).data[getIndex()];
    if (!el) return;
    const { ctx, chartArea } = chart;
    const x = Math.round(el.x) + 0.5;
    ctx.save();
    ctx.strokeStyle = css("--chart-cross");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
});

export function progressChart(canvas: HTMLCanvasElement, input: ChartInput) {
  let selected = input.selected;
  const surface = css("--surface");
  const muted = css("--muted");
  const macros = input.days.map(macroCalories);

  type Slice = "protein" | "carbs" | "fat" | "other";
  const ORDER: Slice[] = ["protein", "carbs", "fat", "other"];
  // The highest slice with anything in it gets the rounded end; the ones under it a gap above them.
  const isTop = (key: Slice, i: number) => !ORDER.slice(ORDER.indexOf(key) + 1).some((k) => Math.round(macros[i][k]) > 0);
  const bar = (key: Slice, label: string, color: string) => ({
    type: "bar" as const,
    label,
    data: macros.map((m) => Math.round(m[key])),
    yAxisID: "y",
    stack: "calories",
    backgroundColor: color,
    hoverBackgroundColor: color,
    maxBarThickness: input.barThickness,
    categoryPercentage: 0.72,
    barPercentage: 1,
    // A 2px gap in the card color between stacked segments; only the top gets the rounded end.
    borderColor: surface,
    borderWidth: (c: { dataIndex: number }) => ({ top: isTop(key, c.dataIndex) ? 0 : 2, right: 0, bottom: 0, left: 0 }),
    borderSkipped: false as const,
    borderRadius: (c: { dataIndex: number }) => (isTop(key, c.dataIndex) ? { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 } : 0),
    order: 4,
  });

  const weights = [...input.averages, ...input.weighIns].filter((v): v is number => v !== null);
  const showWeight = input.showWeight && weights.length > 0;
  const wAxis = showWeight ? weightAxis(weights) : null;
  const weightColor = css("--weight");

  type Config = ChartConfigurationCustomTypesPerDataset<"bar" | "line", (number | null)[], string>;
  const datasets: Config["data"]["datasets"] = [
    bar("protein", "Protein", css("--protein")),
    bar("carbs", "Carbs", css("--carbs")),
    bar("fat", "Fat", css("--fat")),
    // Calories the macros don't account for: foods logged with calories only, a drink's alcohol.
    bar("other", "Other", css("--other")),
    {
      type: "line",
      label: "Goal",
      data: input.days.map((d) => d.goal?.calories ?? null),
      yAxisID: "y",
      // The calorie axis stacks the macro bars; each line is its own stack so it isn't added on top of another.
      stack: "goal",
      borderColor: css("--goal-line"),
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 0,
      stepped: "middle",
      spanGaps: true,
      order: 3,
    },
  ];
  // What the user burns on a normal day: dashed, so it reads as a different line from the goal.
  const baselines = input.days.map((d) => d.goal?.baselineCalories ?? null);
  if (baselines.some((b) => b !== null)) {
    datasets.push({
      type: "line",
      label: "Baseline",
      data: baselines,
      yAxisID: "y",
      stack: "baseline",
      borderColor: css("--baseline"),
      borderWidth: 1.5,
      borderDash: [5, 4],
      pointRadius: 0,
      pointHoverRadius: 0,
      stepped: "middle",
      spanGaps: false,
      order: 3,
    });
  }
  // What the Apple Watch says was burned: a short solid tick across each bar, in the baseline's color
  // (same idea, measured), over a card-colored halo so it reads on top of the bars.
  if (input.burned.some((b) => b !== null)) {
    const reach = Math.max(6, input.barThickness / 2 + 3);
    const tick = (label: string, color: string, width: number, order: number) => ({
      type: "line" as const,
      label,
      data: input.burned,
      yAxisID: "y",
      stack: "watch",
      showLine: false,
      pointStyle: "line" as const,
      pointRadius: reach,
      pointHoverRadius: reach,
      pointBorderColor: color,
      pointBorderWidth: width,
      pointHoverBorderWidth: width,
      order,
    });
    datasets.push(tick("watch halo", surface, 6, 2), tick("Burned (Apple Watch)", css("--baseline"), 3, 1));
  }
  if (showWeight) {
    datasets.push(
      // A wider line in the card color under the weight line keeps it readable where it crosses bars.
      {
        type: "line",
        label: "halo",
        data: input.averages,
        yAxisID: "w",
        borderColor: surface,
        borderWidth: 6,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.35,
        spanGaps: true,
        clip: 8,
        order: 2,
      },
      {
        type: "line",
        label: "7-day average",
        data: input.averages,
        yAxisID: "w",
        borderColor: weightColor,
        borderWidth: 2,
        borderCapStyle: "round",
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.35,
        spanGaps: true,
        clip: 8,
        order: 1,
      },
      {
        type: "line",
        label: "Weigh-in",
        data: input.weighIns,
        yAxisID: "w",
        showLine: false,
        pointRadius: input.barThickness > 12 ? 4 : 3,
        pointHoverRadius: input.barThickness > 12 ? 4 : 3,
        pointBackgroundColor: weightColor,
        pointBorderColor: surface,
        pointBorderWidth: 2,
        pointHoverBorderWidth: 2,
        clip: 8,
        order: 0,
      },
    );
  }

  const config: Config = {
    data: { labels: input.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // Taps select a day; there's no hover on a phone, and the readout above shows the numbers.
      events: ["click"],
      interaction: { mode: "index", intersect: false },
      layout: { autoPadding: false, padding: { top: 8, right: showWeight ? 0 : 8, bottom: 0, left: 0 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      onClick: (event, _elements, c) => {
        const hits = c.getElementsAtEventForMode(event as unknown as Event, "index", { intersect: false }, false);
        if (!hits.length) return;
        selected = hits[0].index;
        c.draw();
        input.onSelect(selected);
      },
      scales: {
        x: {
          stacked: true,
          offset: true,
          grid: { display: false },
          border: { color: css("--border") },
          ticks: { color: muted, font: FONT, maxRotation: 0, autoSkip: false },
        },
        y: {
          position: "left",
          stacked: true,
          min: 0,
          max: calorieMax(input.days, input.burned),
          afterFit: (axis) => void (axis.width = 40),
          grid: { color: css("--chart-grid") },
          border: { display: false },
          ticks: { color: muted, font: FONT, maxTicksLimit: 4, callback: (v) => (Number(v) >= 1000 ? `${Number(v) / 1000}K` : String(v)) },
        },
        w: {
          display: showWeight,
          position: "right",
          min: wAxis?.min,
          max: wAxis?.max,
          afterFit: (axis) => void (axis.width = 40),
          grid: { display: false },
          border: { display: false },
          ticks: { color: muted, font: FONT, precision: 0 },
          afterBuildTicks: (axis) => {
            if (!wAxis) return;
            // Two or three clean ticks inside the weights' band only.
            const step = Math.max(1, Math.round((wAxis.bandHi - wAxis.bandLo) / 2));
            const ticks = [];
            for (let v = wAxis.bandLo; v <= wAxis.bandHi + 1e-9; v += step) ticks.push({ value: v });
            axis.ticks = ticks;
          },
        },
      },
    },
    plugins: [crosshair(() => selected)],
  };
  const chart = new Chart(canvas, config);

  return {
    chart,
    select(index: number) {
      selected = index;
      chart.draw();
    },
    destroy: () => chart.destroy(),
  };
}
