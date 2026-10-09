import type { Me } from "../api";
import { el } from "../dom";
import { profileForm } from "./profileForm";

export function setupView(onSaved: (me: Me) => void) {
  return [
    el("h1", { textContent: "Welcome! Let's get you set up." }),
    el("p", { className: "muted", textContent: "Takes about a minute. You can change any of this later in Settings." }),
    profileForm("setup", null, onSaved),
  ];
}
