import type { Me } from "../api";
import { el } from "../dom";
import { faceIdCard, signOut } from "./faceId";
import { inviteCard } from "./invite";
import { profileForm } from "./profileForm";
import { watchCard } from "./watch";

/** The Goals tab: daily goals, weight tracking and the profile, then the account. */
export function goalsView(me: Me, onSaved: (me: Me) => void): Node[] {
  const parts: (Node | null)[] = [
    el("header", { className: "page-head" }, el("h1", { textContent: "Goals" }), el("p", { className: "muted", textContent: "Change these any time. New goals start today." })),
    profileForm("settings", me, onSaved),
    watchCard(me),
    faceIdCard(),
    me.canInvite ? inviteCard() : null,
    el("section", { className: "card stack account" }, el("p", { className: "muted", textContent: `Signed in as ${me.email}` }), signOutButton()),
  ];
  return parts.filter((n): n is Node => n !== null);
}

function signOutButton() {
  const button = el("button", { type: "button", className: "button secondary wide", textContent: "Sign out" });
  button.addEventListener("click", () => {
    button.disabled = true;
    signOut();
  });
  return button;
}
