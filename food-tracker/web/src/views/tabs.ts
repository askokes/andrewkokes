import { el, icon } from "../dom";
import type { Go } from "../nav";

export type Tab = "overview" | "diary" | "goals";

const TABS = [
  { tab: "overview", label: "Overview", path: "/", icon: "home" },
  { tab: "diary", label: "Diary", path: "/diary", icon: "book" },
  { tab: "goals", label: "Goals", path: "/goals", icon: "target" },
] as const;

/**
 * The bottom tab bar: one element for the life of the page. Switching tabs
 * replaces the history entry, as a phone app's tabs do, so the back gesture
 * doesn't walk through every tab visited.
 */
export function tabBar(go: Go) {
  const links = TABS.map((t) => {
    const a = el(
      "a",
      { className: "tab", href: t.path },
      el("span", { className: "tab-icon" }, icon(t.icon)),
      el("span", { className: "tab-label", textContent: t.label }),
    );
    a.addEventListener("click", (event) => {
      // Let a new-tab click (or a middle click) do what it normally does.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      go(t.path, { replace: true });
    });
    return { tab: t.tab as Tab, a };
  });
  const nav = el("nav", { className: "tabbar", hidden: true, attrs: { "aria-label": "Main" } }, el("div", { className: "tabbar-inner" }, ...links.map((l) => l.a)));
  return {
    nav,
    /** Mark the current tab, or hide the bar (first-run setup, the confirm screen). */
    show(active: Tab | null) {
      nav.hidden = active === null;
      document.body.classList.toggle("has-tabs", active !== null);
      for (const l of links) {
        if (l.tab === active) l.a.setAttribute("aria-current", "page");
        else l.a.removeAttribute("aria-current");
      }
    },
  };
}
