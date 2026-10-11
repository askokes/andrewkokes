import type { DayView } from "../../../src/food/types";
import { el } from "../dom";
import { whole } from "../food";

/** A progress bar. Past the goal it fills completely in a calm neutral color, never red. */
function bar(value: number, goal: number, label: string, thin = false) {
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

/** One ring: a pale track in its own color and an arc that fills toward the goal. */
function ring(size: "big" | "small", color: string) {
  const stroke = size === "big" ? 9 : 11;
  const r = 50 - stroke / 2;
  const c = 2 * Math.PI * r;
  const node = svg("svg", { viewBox: "0 0 100 100", class: `ring ring-${size}`, "aria-hidden": "true" });
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
  const cal = ring("big", "--accent");
  const calNumber = el("p", { className: "ring-number" });
  const calOf = el("p", { className: "ring-of" });
  const calLeft = el("p", { className: "ring-left" });
  const calWrap = el("div", { className: "ring-big", attrs: { role: "progressbar", "aria-label": "Calories" } }, cal.node, el("div", { className: "ring-center" }, calNumber, calOf, calLeft));
  const hint = el("p", { className: "hint", textContent: "Add a daily goal on the Goals tab to see what's left." });

  const macros = MACROS.map((m) => {
    const r = ring("small", m.color);
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

  const node = el("div", { className: "rings" }, calWrap, hint, el("div", { className: "ring-row" }, ...macros.map((m) => m.wrap)));

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
      progressAttrs(calWrap, eaten, g?.calories ?? null, "calories");

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
        cal.set(g ? eaten / g.calories : 0, g !== null && eaten > g.calories);
        for (const m of macros) {
          const grams = Math.round(day.totals[m.key]);
          const goal = g?.[m.goalKey] ?? null;
          m.r.set(goal ? grams / goal : 0, goal !== null && grams > goal);
        }
      });
    },
  };
}

/** One line and a bar for the Diary: where the day stands while logging. */
export function compactTotals(day: DayView): Node[] {
  const g = day.goals;
  const eaten = Math.round(day.totals.calories);
  const left = g ? g.calories - eaten : null;
  const macro = (label: string, grams: number) => el("span", {}, el("strong", { textContent: whole(Math.round(grams)) }), ` g ${label}`);
  const parts: (Node | null)[] = [
    el(
      "div",
      { className: "compact-head" },
      el("p", {}, el("strong", { className: "compact-cal", textContent: whole(eaten) }), g ? ` of ${whole(g.calories)} cal` : " cal"),
      left === null
        ? null
        : el("p", { className: left < 0 ? "over-text" : "muted", textContent: `${whole(Math.abs(left))} ${left < 0 ? "over" : "left"}` }),
    ),
    g ? bar(eaten, g.calories, "Calories") : null,
    el("p", { className: "compact-macros muted" }, macro("protein", day.totals.proteinG), macro("carbs", day.totals.carbsG), macro("fat", day.totals.fatG)),
  ];
  return parts.filter((n): n is Node => n !== null);
}

/** "2,090 of 2,000 calories, 90 over." for the screen reader announcement after a change. */
export function totalsText(day: DayView) {
  const eaten = Math.round(day.totals.calories);
  if (!day.goals) return `${whole(eaten)} calories.`;
  const left = day.goals.calories - eaten;
  return `${whole(eaten)} of ${whole(day.goals.calories)} calories, ${whole(Math.abs(left))} ${left < 0 ? "over" : "left"}.`;
}
