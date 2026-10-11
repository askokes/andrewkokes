import type { Me } from "../api";
import { el } from "../dom";
import { profileForm } from "./profileForm";

/** The Goals tab: daily goals, weight tracking and the profile, then the account. */
export function goalsView(me: Me, onSaved: (me: Me) => void) {
  return [
    el("header", { className: "page-head" }, el("h1", { textContent: "Goals" }), el("p", { className: "muted", textContent: "Change these any time. New goals start today." })),
    profileForm("settings", me, onSaved),
    el(
      "section",
      { className: "card stack account" },
      el("p", { className: "muted", textContent: `Signed in as ${me.email}` }),
      el("a", { className: "button secondary wide", href: "/cdn-cgi/access/logout", textContent: "Sign out" }),
    ),
  ];
}
