import type { Me } from "../api";
import { el } from "../dom";
import { profileForm } from "./profileForm";

/** `back` returns to where Settings was opened from (popping its history entry when the app pushed it). */
export function settingsView(me: Me, back: () => void, onSaved: (me: Me) => void) {
  const backButton = el("button", { type: "button", className: "back", textContent: "‹ Back" });
  backButton.addEventListener("click", back);
  return [
    el("header", { className: "topbar" }, backButton),
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
