import type { DayView } from "../../../src/food/types";
import { el } from "../dom";
import { whole } from "../food";
import { macroCalories } from "../progress";

/** A progress bar. Past the goal it fills completely in a calm neutral color, never red. */
export function bar(value: number, goal: number, label: string, thin = false) {
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

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** A macro's ring: a pale track in its own color and an arc that fills toward the goal. */
function ring(color: string) {
  const stroke = 11;
  const r = 50 - stroke / 2;
  const c = 2 * Math.PI * r;
  const node = svg("svg", { viewBox: "0 0 100 100", class: "ring", "aria-hidden": "true" });
  node.style.setProperty("--ring-color", `var(${color})`);
  const track = svg("circle", { cx: 50, cy: 50, r, fill: "none", "stroke-width": stroke, class: "ring-track" });
  const arc = svg("circle", {
    cx: 50,
    cy: 50,
    r,
    fill: "none",
    "stroke-width": stroke,
    "stroke-linecap": "round",
    "stroke-dasharray": c,
    "stroke-dashoffset": c,
    transform: "rotate(-90 50 50)",
    class: "ring-arc",
  });
  node.append(track, arc);
  return {
    node,
    /** Past the goal the ring closes in the calm "over" color, never red. */
    set(fraction: number, over: boolean) {
      const f = Math.max(0, Math.min(1, fraction));
      arc.style.strokeDashoffset = String(c * (1 - f));
      arc.classList.toggle("over", over);
      // A round cap on an empty arc still draws a dot.
      arc.style.opacity = f > 0 ? "1" : "0";
    },
  };
}

/** The slices of the calorie ring, in the chart's order and colors. */
const SLICES = [
  { key: "protein", label: "protein", color: "--protein" },
  { key: "carbs", label: "carbs", color: "--carbs" },
  { key: "fat", label: "fat", color: "--fat" },
  { key: "other", label: "other", color: "--other" },
] as const;

/**
 * The big calorie ring, split like the chart's bars: protein, carbs, fat and
 * other end to end, together as far round as the day is toward its goal. A
 * hairline gap separates the slices.
 */
function calorieRing() {
  const stroke = 9;
  const r = 50 - stroke / 2;
  const c = 2 * Math.PI * r;
  const GAP = 1.2;
  const node = svg("svg", { viewBox: "0 0 100 100", class: "ring", "aria-hidden": "true" });
  node.style.setProperty("--ring-color", "var(--accent)");
  const track = svg("circle", { cx: 50, cy: 50, r, fill: "none", "stroke-width": stroke, class: "ring-track" });
  const arcs = SLICES.map((s) => {
    const arc = svg("circle", {
      cx: 50,
      cy: 50,
      r,
      fill: "none",
      "stroke-width": stroke,
      "stroke-dasharray": `0 ${c}`,
      "stroke-dashoffset": 0,
      transform: "rotate(-90 50 50)",
      class: "ring-slice",
    });
    arc.style.stroke = `var(${s.color})`;
    return arc;
  });
  node.append(track, ...arcs);
  return {
    node,
    /** `slices` are calories per slice; `fraction` how far round they go together (1 = the whole ring). */
    set(slices: Record<(typeof SLICES)[number]["key"], number>, fraction: number) {
      const total = SLICES.reduce((sum, s) => sum + Math.max(0, slices[s.key]), 0);
      const span = c * Math.max(0, Math.min(1, fraction));
      const shown = SLICES.filter((s) => slices[s.key] > 0).length;
      let start = 0;
      SLICES.forEach((s, i) => {
        const len = total > 0 ? (span * Math.max(0, slices[s.key])) / total : 0;
        // Each slice gives up a hairline at its end, so neighbors read apart; a lone slice keeps it all.
        const drawn = shown > 1 && len > GAP ? len - GAP : len;
        arcs[i].style.strokeDasharray = `${drawn} ${c}`;
        arcs[i].style.strokeDashoffset = String(-start);
        start += len;
      });
    },
  };
}

function progressAttrs(node: HTMLElement, value: number, goal: number | null, unit: string) {
  if (goal === null) {
    node.removeAttribute("aria-valuemax");
    node.removeAttribute("aria-valuenow");
    node.setAttribute("aria-valuetext", `${whole(value)} ${unit}, no goal`);
    return;
  }
  node.setAttribute("aria-valuemin", "0");
  node.setAttribute("aria-valuemax", String(goal));
  node.setAttribute("aria-valuenow", String(Math.min(value, goal)));
  node.setAttribute("aria-valuetext", `${whole(value)} of ${whole(goal)} ${unit}`);
}

const MACROS = [
  { key: "proteinG", goalKey: "proteinG", label: "Protein", color: "--protein" },
  { key: "carbsG", goalKey: "carbsG", label: "Carbs", color: "--carbs" },
  { key: "fatG", goalKey: "fatG", label: "Fat", color: "--fat" },
] as const;

/**
 * The Overview's Today card: a big calorie ring, then a ring per macro in the
 * chart's colors. Build once and paint as the day's data arrives; the rings
 * sweep from where they were, so a refresh with the same numbers doesn't move.
 */
export function todayRings() {
  const cal = calorieRing();
  const calNumber = el("p", { className: "ring-number" });
  const calOf = el("p", { className: "ring-of" });
  const calLeft = el("p", { className: "ring-left" });
  const calWrap = el("div", { className: "ring-big", attrs: { role: "progressbar", "aria-label": "Calories" } }, cal.node, el("div", { className: "ring-center" }, calNumber, calOf, calLeft));
  const hint = el("p", { className: "hint", textContent: "Add a daily goal on the Goals tab to see what's left." });
  // What the ring's colors are: each slice's share of the day's calories.
  const split = el("p", { className: "ring-split" });
  // Against what they burn on a normal day, when set: a goal below it can hide eating above it.
  const burn = el("p", { className: "ring-baseline" });

  const macros = MACROS.map((m) => {
    const r = ring(m.color);
    const grams = el("p", { className: "ring-grams" });
    const sub = el("p", { className: "ring-sub" });
    const wrap = el(
      "div",
      { className: "ring-macro", attrs: { role: "progressbar", "aria-label": m.label } },
      el("div", { className: "ring-small" }, r.node, el("div", { className: "ring-center" }, grams)),
      el("p", { className: "ring-name", textContent: m.label }),
      sub,
    );
    return { ...m, r, grams, sub, wrap };
  });

  const node = el("div", { className: "rings" }, calWrap, split, burn, hint, el("div", { className: "ring-row" }, ...macros.map((m) => m.wrap)));

  return {
    node,
    paint(day: DayView) {
      const g = day.goals;
      const eaten = Math.round(day.totals.calories);
      calNumber.textContent = whole(eaten);
      calOf.textContent = g ? `of ${whole(g.calories)} cal` : "calories";
      const left = g ? g.calories - eaten : 0;
      calLeft.textContent = g ? `${whole(Math.abs(left))} ${left < 0 ? "over" : "left"}` : "";
      calLeft.classList.toggle("over-text", left < 0);
      hint.hidden = g !== null;
      const baseline = g?.baselineCalories ?? null;
      burn.hidden = baseline === null;
      if (baseline !== null) {
        const diff = eaten - baseline;
        burn.replaceChildren(
          el("span", { className: "ring-baseline-mark", attrs: { "aria-hidden": "true" } }),
          `You burn about ${whole(baseline)} a day · `,
          el("strong", { className: diff > 0 ? "over-text" : "", textContent: `${whole(Math.abs(diff))} ${diff > 0 ? "over" : "under"}` }),
        );
      }
      progressAttrs(calWrap, eaten, g?.calories ?? null, "calories");

      const slices = macroCalories(day.totals);
      const sliceTotal = slices.protein + slices.carbs + slices.fat + slices.other;
      split.hidden = !(sliceTotal > 0);
      split.replaceChildren(
        ...SLICES.map((s) => ({ ...s, pct: sliceTotal > 0 ? Math.round((slices[s.key] / sliceTotal) * 100) : 0 }))
          .filter((s) => s.pct > 0)
          .map((s) => {
            const swatch = el("span", { className: "ring-split-swatch", attrs: { "aria-hidden": "true" } });
            swatch.style.background = `var(${s.color})`;
            return el("span", {}, swatch, `${s.pct}% ${s.label}`);
          }),
      );

      for (const m of macros) {
        const grams = Math.round(day.totals[m.key]);
        const goal = g?.[m.goalKey] ?? null;
        m.grams.replaceChildren(whole(grams), el("small", { textContent: " g" }));
        m.sub.textContent = goal === null ? "no goal" : grams > goal ? `${whole(grams - goal)} g over` : `of ${whole(goal)} g`;
        m.sub.classList.toggle("over-text", goal !== null && grams > goal);
        progressAttrs(m.wrap, grams, goal, "grams");
      }

      // Sweep after the rings are on screen at their old values, so the change animates.
      requestAnimationFrame(() => {
        void node.getBoundingClientRect();
        // With no goal the ring is just the split of what was eaten.
        cal.set(slices, g ? eaten / g.calories : sliceTotal > 0 ? 1 : 0);
        for (const m of macros) {
          const grams = Math.round(day.totals[m.key]);
          const goal = g?.[m.goalKey] ?? null;
          m.r.set(goal ? grams / goal : 0, goal !== null && grams > goal);
        }
      });
    },
  };
}

/** "2,090 of 2,000 calories, 90 over." for the screen reader announcement after a change. */
export function totalsText(day: DayView) {
  const eaten = Math.round(day.totals.calories);
  if (!day.goals) return `${whole(eaten)} calories.`;
  const left = day.goals.calories - eaten;
  return `${whole(eaten)} of ${whole(day.goals.calories)} calories, ${whole(Math.abs(left))} ${left < 0 ? "over" : "left"}.`;
}
