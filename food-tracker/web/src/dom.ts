type Child = Node | string | null | undefined | false;

/** Tiny element builder. Props are assigned as DOM properties; "dataset" and "attrs" are merged. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { attrs?: Record<string, string> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const { attrs, dataset, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  Object.assign(node.dataset, dataset);
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
  // Feather "mic" (MIT): capsule, cradle, stand.
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" + "M19 10v2a7 7 0 0 1-14 0v-2" + "M12 19v3" + "M8 22h8",
  // Feather "home" (MIT): the house, then the door.
  home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" + "M9 22V12h6v10",
  // Feather "book-open" (MIT): left page, right page.
  book: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" + "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  // Feather "target" (MIT): three rings.
  target: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" + "M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z" + "M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
} as const;

/** A stroked 24x24 icon in the current text color. Decorative: label the button, not the icon. */
export function icon(name: keyof typeof ICONS) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `icon icon-${name}`);
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
