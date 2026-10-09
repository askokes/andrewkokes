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
