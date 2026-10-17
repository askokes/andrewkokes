import type { Me } from "../api";
import { el } from "../dom";
import { inviteCard } from "./invite";
import { profileForm } from "./profileForm";
import { watchCard } from "./watch";

/** The Goals tab: daily goals, weight tracking and the profile, then the account. */
export function goalsView(me: Me, onSaved: (me: Me) => void): Node[] {
  const parts: (Node | null)[] = [
    el("header", { className: "page-head" }, el("h1", { textContent: "Goals" }), el("p", { className: "muted", textContent: "Change these any time. New goals start today." })),
    profileForm("settings", me, onSaved),
    watchCard(me),
    me.canInvite ? inviteCard() : null,
    el(
      "section",
      { className: "card stack account" },
      el("p", { className: "muted", textContent: `Signed in as ${me.email}` }),
      el("a", { className: "button secondary wide", href: "/cdn-cgi/access/logout", textContent: "Sign out" }),
    ),
  ];
  return parts.filter((n): n is Node => n !== null);
}
