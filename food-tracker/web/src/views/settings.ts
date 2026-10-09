import type { Me } from "../api";
import { el } from "../dom";
import { profileForm } from "./profileForm";

export function settingsView(me: Me, go: (path: string) => void, onSaved: (me: Me) => void) {
  const back = el("button", { type: "button", className: "back", textContent: "‹ Back" });
  back.addEventListener("click", () => go("/"));
  return [
    el("header", { className: "topbar" }, back),
    el("h1", { textContent: "Settings" }),
    profileForm("settings", me, onSaved),
    el(
      "section",
      { className: "card stack account" },
      el("p", { className: "muted", textContent: `Signed in as ${me.email}` }),
      el("a", { className: "button secondary wide", href: "/cdn-cgi/access/logout", textContent: "Sign out" }),
    ),
  ];
}
