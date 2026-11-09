import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { api, ApiError } from "../api";
import { el } from "../dom";

/** Face ID sign-in (src/passkeys.ts): set up, sign in, join from an invite, and the Goals card. */

interface Options<T> {
  challengeId: string;
  options: T;
}

/** Words for what went wrong. Closing the Face ID sheet isn't an error. */
function problem(err: unknown): string | null {
  if (err instanceof WebAuthnError && (err.code === "ERROR_CEREMONY_ABORTED" || err.name === "NotAllowedError")) return null;
  if (err instanceof DOMException && err.name === "NotAllowedError") return null;
  if (err instanceof WebAuthnError && err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "Face ID is already set up on this device.";
  if (err instanceof ApiError) return err.message;
  return "Face ID didn't work. Please try again.";
}

/** Makes a passkey on this device: as the signed-in person, or as the invite names. */
export async function setUpFaceId(invite?: string) {
  const start = await api<Options<Parameters<typeof startRegistration>[0]["optionsJSON"]>>("POST", "/api/auth/register/options", invite ? { invite } : {});
  const response = await startRegistration({ optionsJSON: start.options });
  return api<{ email: string }>("POST", "/api/auth/register/verify", { challengeId: start.challengeId, response });
}

export async function signInWithFaceId() {
  const start = await api<Options<Parameters<typeof startAuthentication>[0]["optionsJSON"]>>("POST", "/api/auth/signin/options", {});
  const response = await startAuthentication({ optionsJSON: start.options });
  return api<{ email: string }>("POST", "/api/auth/signin/verify", { challengeId: start.challengeId, response });
}

function brand() {
  return el(
    "div",
    { className: "signin-brand" },
    el("img", { src: "/icon.svg", alt: "", width: 88, height: 88 }),
    el("h1", { textContent: "Food Tracker" }),
  );
}

/** Shown when nobody is signed in: one button. */
export function signInView(): Node[] {
  const msg = el("p", { className: "form-msg", attrs: { "aria-live": "polite" } });
  const button = el("button", { type: "button", className: "button wide", textContent: "Sign in with Face ID" });
  button.addEventListener("click", async () => {
    button.disabled = true;
    msg.textContent = "";
    try {
      await signInWithFaceId();
      location.replace("/");
    } catch (err) {
      msg.textContent = problem(err) ?? "";
      button.disabled = false;
    }
  });
  const supported = browserSupportsWebAuthn();
  return [
    el(
      "div",
      { className: "signin" },
      brand(),
      el("p", { className: "muted", textContent: supported ? "Your family's food log. Sign in with Face ID or Touch ID." : "This browser can't use Face ID. Open the app in Safari on your iPhone." }),
      supported ? button : null,
      msg,
      el("p", { className: "hint", textContent: "New here, or on a new phone without your passkey? Ask Andrew for an invite link." }),
    ),
  ].filter(Boolean) as Node[];
}

/** /join#<token>: an invite link. Sets up Face ID as the invited person, then opens the app. */
export function joinView(): Node[] {
  const token = location.hash.slice(1);
  const box = el("div", { className: "signin" }, brand(), el("p", { className: "muted", textContent: "Checking your invite…" }));
  const msg = el("p", { className: "form-msg", attrs: { "aria-live": "polite" } });
  api<{ valid: boolean; email?: string }>("POST", "/api/auth/invite", { token })
    .then((res) => {
      if (!res.valid || !res.email) {
        box.replaceChildren(brand(), el("p", { textContent: "This invite link has expired or was already used." }), el("p", { className: "hint", textContent: "Ask Andrew for a new one. Already set up? Open the app and sign in with Face ID." }));
        return;
      }
      const button = el("button", { type: "button", className: "button wide", textContent: "Set up Face ID" });
      button.addEventListener("click", async () => {
        button.disabled = true;
        msg.textContent = "";
        try {
          await setUpFaceId(token);
          history.replaceState(null, "", "/");
          location.replace("/");
        } catch (err) {
          msg.textContent = problem(err) ?? "";
          button.disabled = false;
        }
      });
      box.replaceChildren(
        brand(),
        el("p", {}, "Welcome! You're joining as ", el("strong", { textContent: res.email }), "."),
        el("p", { className: "muted", textContent: "Set up Face ID once. After that, opening the app signs you in. No passwords, no codes." }),
        button,
        msg,
      );
    })
    .catch((err) => box.replaceChildren(brand(), el("p", { textContent: problem(err) ?? "Something went wrong. Please try again." })));
  return [box];
}

interface PasskeyItem {
  id: string;
  device: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Goals: which devices sign in with Face ID, set up this one, remove one. */
export function faceIdCard(): HTMLElement {
  const card = el("section", { className: "card stack", attrs: { "aria-label": "Face ID" } });
  const msg = el("p", { className: "form-msg", attrs: { "aria-live": "polite" } });
  const head = el("h2", {}, "Face ID sign-in");

  async function load() {
    let list: PasskeyItem[];
    try {
      list = (await api<{ passkeys: PasskeyItem[] }>("GET", "/api/passkeys")).passkeys;
    } catch (err) {
      card.replaceChildren(head, el("p", { className: "muted", textContent: problem(err) ?? "" }));
      return;
    }
    const add = el("button", { type: "button", className: list.length ? "button secondary wide" : "button wide", textContent: list.length ? "Set up on this device too" : "Set up Face ID" });
    add.addEventListener("click", async () => {
      add.disabled = true;
      msg.textContent = "";
      try {
        await setUpFaceId();
        msg.textContent = "Done. This device signs in with Face ID now.";
        load();
      } catch (err) {
        msg.textContent = problem(err) ?? "";
        add.disabled = false;
      }
    });
    const rows = list.map((p) => {
      const remove = el("button", { type: "button", className: "text-button quiet", textContent: "Remove", attrs: { "aria-label": `Remove ${p.device}, set up ${shortDate(p.createdAt)}` } });
      remove.addEventListener("click", async () => {
        if (!confirm(`Remove Face ID on this ${p.device}? It'll need a new invite link to sign in again.`)) return;
        remove.disabled = true;
        try {
          await api("DELETE", `/api/passkeys/${encodeURIComponent(p.id)}`);
          load();
        } catch (err) {
          msg.textContent = problem(err) ?? "";
          remove.disabled = false;
        }
      });
      return el(
        "li",
        { className: "passkey-row" },
        el("span", {}, el("strong", { textContent: p.device }), el("span", { className: "hint", textContent: ` · set up ${shortDate(p.createdAt)}${p.lastUsedAt ? `, last used ${shortDate(p.lastUsedAt)}` : ""}` })),
        remove,
      );
    });
    card.replaceChildren(
      head,
      el("p", { className: "hint", textContent: list.length ? "These devices sign in with Face ID or Touch ID. A passkey also follows you to your other Apple devices through iCloud Keychain." : "Sign in with Face ID instead of an emailed code. Takes a few seconds, once." }),
      list.length ? el("ul", { className: "passkey-list" }, ...rows) : el("span"),
      browserSupportsWebAuthn() ? add : el("p", { className: "hint", textContent: "This browser can't set up Face ID." }),
      msg,
    );
  }

  card.replaceChildren(head, el("p", { className: "muted", textContent: "Loading…" }));
  load();
  return card;
}

/** Sign out of this device: ends its Face ID session, then Cloudflare's while it's still in front. */
export async function signOut() {
  try {
    await api("POST", "/api/auth/signout", {});
  } catch {
    // Signing out anyway.
  }
  location.replace("/cdn-cgi/access/logout");
}
