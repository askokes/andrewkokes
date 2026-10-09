type Child = Node | string | null | undefined | false;

/** Tiny element builder. Props are assigned as DOM properties; "dataset" and "attrs" are merged. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { attrs?: Record<string, string> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const { attrs, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  node.append(...(children.filter(Boolean) as (Node | string)[]));
  return node;
}

export function formatNumber(n: number) {
  return n.toLocaleString("en-US");
}

/** "2026-10-09" -> "Friday, October 9" without time zone drift. */
export function formatDay(isoDate: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

const ICONS = {
  back: "M15 5l-7 7 7 7",
  forward: "M9 5l7 7-7 7",
  chevron: "M9 6l6 6-6 6",
} as const;

/** A stroked 24x24 icon in the current text color. Decorative: label the button, not the icon. */
export function icon(name: keyof typeof ICONS) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

/** Mutually exclusive buttons: a radio group that looks like a segmented control. */
export function segmented<T extends string>(opts: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const group = el("div", { className: "segmented", attrs: { role: "radiogroup", "aria-label": opts.label } });
  const buttons = opts.options.map((o) => {
    const b = el("button", { type: "button", textContent: o.label, attrs: { role: "radio", "aria-checked": String(o.value === opts.value) } });
    b.addEventListener("click", () => {
      for (const other of buttons) other.setAttribute("aria-checked", String(other === b));
      opts.onChange(o.value);
    });
    return b;
  });
  group.append(...buttons);
  return group;
}
