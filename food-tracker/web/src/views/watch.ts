import type { WatchKeyResponse, WatchStatus } from "../../../src/food/types";
import { api, ApiError, type Me } from "../api";
import { el } from "../dom";
import { native, inNativeApp, type NativeStatus } from "../native";

/** What the Shortcut must be called, so the Sync button on Today can run it. */
export const SHORTCUT_NAME = "Food Sync";
/** Runs the Shortcut from the app (iPhone only). */
export const SHORTCUT_URL = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;

/** "today at 9:02 pm", "Oct 15 at 7:10 am". */
export function syncedWhen(iso: string, now = new Date()) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay ? `today at ${time}` : `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${time}`;
}

/** Copies `text`, and says so on the button for a moment. */
function copyButton(label: string, text: () => string) {
  const button = el("button", { type: "button", className: "button secondary", textContent: label });
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text());
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy it";
    }
    setTimeout(() => (button.textContent = label), 2000);
  });
  return button;
}

/** A value to paste into the Shortcut: read-only, selectable, with a Copy button. */
function copyRow(id: string, label: string, value: string) {
  const input = el("input", { id, type: "text", className: "control mono", value, readOnly: true, attrs: { autocomplete: "off", spellcheck: "false" } });
  input.addEventListener("focus", () => input.select());
  return el(
    "div",
    { className: "stack tight" },
    el("label", { htmlFor: id, className: "field-label", textContent: label }),
    el("div", { className: "input-row" }, input, copyButton("Copy", () => value)),
  );
}

/** One step of the Shortcut, with its action names in bold. */
function step(...parts: (string | [string])[]) {
  return el("li", {}, ...parts.map((p) => (typeof p === "string" ? p : el("strong", { textContent: p[0] }))));
}

/** Building the Shortcut, once, on the iPhone. About ten minutes. */
function setupSteps(host: string) {
  return el(
    "ol",
    { className: "watch-steps" },
    step("Open the ", ["Shortcuts"], " app on your iPhone. Tap ", ["+"], " and name the new shortcut ", [SHORTCUT_NAME], " (exactly, so the Sync button in this app can run it)."),
    step("Add the action ", ["Find Health Samples"], ". Set Type to ", ["Active Energy"], ", Start Date to ", ["is today"], ", and Group By to ", ["Day"], "."),
    step("Add ", ["Find Health Samples"], " again the same way, for ", ["Resting Energy"], "."),
    step("Add it a third time, for ", ["Steps"], "."),
    step("Now yesterday, so a day you didn't sync, or last synced before bed, still fills in. Add ", ["Adjust Date"], ", set to ", ["Get Start of Day"], " of ", ["Current Date"], ". That's midnight this morning."),
    step("Add ", ["Adjust Date"], " again: ", ["Subtract"], " 1 day from the Adjusted Date above. That's midnight yesterday."),
    step(
      "Add ",
      ["Find Health Samples"],
      " three more times, for Active Energy, Resting Energy and Steps. This time set Start Date to ",
      ["is between"],
      ", from the second Adjusted Date (yesterday) to the first (this morning), and Group By ",
      ["Day"],
      ".",
    ),
    step("Add ", ["Get Contents of URL"], ". Paste the sync address as the URL. Tap the arrow to show more, then set Method to ", ["POST"], " and Request Body to ", ["JSON"], "."),
    step(
      "Add seven fields. ",
      ["key"],
      " (Text): paste your sync key. ",
      ["active"],
      ", ",
      ["resting"],
      " and ",
      ["steps"],
      " (Number): tap each value and pick today's Health Samples, in that order. ",
      ["yesterday_active"],
      ", ",
      ["yesterday_resting"],
      " and ",
      ["yesterday_steps"],
      " (Number): yesterday's three.",
    ),
    step("Optional: add ", ["Show Notification"], " with ", ["Contents of URL"], " in it, so you see what synced."),
    step("Tap ▶ to run it. Allow it to read your Health data and to connect to ", [host], ". It should say “Synced today” with your numbers."),
    step(
      "To sync on its own, open the ",
      ["Automation"],
      " tab, tap ",
      ["+"],
      ", pick ",
      ["App"],
      ", choose an app you open every day (Messages or Mail), tick ",
      ["Is Opened"],
      ", choose ",
      ["Run Immediately"],
      ", and pick ",
      [SHORTCUT_NAME],
      ". It then syncs quietly whenever you open that app. The phone is unlocked then, so Health can be read (a clock-based automation often runs while it's locked and gets skipped). Each run also sends yesterday, so every day ends up complete. The Sync button on Today works any time.",
    ),
  );
}

/**
 * The Apple Watch card on the Goals tab: connect with a sync key the Shortcut
 * sends, see when it last synced, make a new key, or disconnect. Keeps
 * `me.watch` current so Today knows to show the Sync button.
 */
export function watchCard(me: Me): HTMLElement {
  if (inNativeApp()) return nativeWatchCard(me);
  const card = el("section", { className: "card stack watch-card", attrs: { "aria-label": "Apple Watch" } });
  const msg = el("p", { className: "form-msg", attrs: { "aria-live": "polite" } });
  const host = location.host;

  const setStatus = (status: WatchStatus) => {
    me.watch = status;
    paint();
  };

  async function makeKey(button: HTMLButtonElement) {
    button.disabled = true;
    msg.textContent = "";
    try {
      const res = await api<WatchKeyResponse>("POST", "/api/watch/key", {});
      me.watch = { connected: true, lastSync: me.watch.lastSync };
      showKey(res);
    } catch (err) {
      msg.textContent = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      button.disabled = false;
    }
  }

  async function disconnect(button: HTMLButtonElement) {
    if (!confirm("Disconnect your Apple Watch? The Shortcut stops working. What it already synced stays.")) return;
    button.disabled = true;
    try {
      setStatus(await api<WatchStatus>("DELETE", "/api/watch/key"));
    } catch (err) {
      msg.textContent = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      button.disabled = false;
    }
  }

  const head = () =>
    el("h2", {}, el("span", { textContent: "⌚ ", attrs: { "aria-hidden": "true" } }), "Apple Watch");

  /** Just made: the key, shown this once, and the steps to build the Shortcut. */
  function showKey(res: WatchKeyResponse) {
    const done = el("button", { type: "button", className: "button wide", textContent: "Done" });
    done.addEventListener("click", () => {
      paint();
      card.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    card.replaceChildren(
      head(),
      el("p", { className: "hint", textContent: "Copy these into the Shortcut as you build it. The key shows only this once. If you lose it, make a new one." }),
      copyRow("watch-key", "Your sync key", res.key),
      copyRow("watch-url", "Sync address", res.syncUrl),
      setupSteps(host),
      done,
    );
  }

  function paint() {
    const status = me.watch;
    if (!status.connected) {
      const start = el("button", { type: "button", className: "button wide", textContent: "Connect my Apple Watch" });
      start.addEventListener("click", () => makeKey(start));
      card.replaceChildren(
        head(),
        el("p", { className: "hint", textContent: "Bring in the calories your Watch says you burned and your steps, with an Apple Shortcut on your iPhone. It takes about ten minutes to set up, once." }),
        el("p", { className: "hint", textContent: "Your daily goals stay as they are. Watch calorie counts often run high, so they're shown next to what you ate, not added to your goal." }),
        start,
        msg,
      );
      return;
    }
    const again = el("button", { type: "button", className: "button secondary", textContent: "Make a new key" });
    again.addEventListener("click", () => {
      if (confirm("Make a new sync key? The old one stops working until you paste the new one into the Shortcut.")) makeKey(again);
    });
    const off = el("button", { type: "button", className: "button secondary", textContent: "Disconnect" });
    off.addEventListener("click", () => disconnect(off));
    const steps = el(
      "details",
      { className: "watch-help" },
      el("summary", { textContent: "How to build the Shortcut" }),
      el("p", { className: "hint", textContent: "Built it before October 23? Add steps 5 to 7 and the three yesterday fields, so a missed day fills in." }),
      setupSteps(host),
    );
    card.replaceChildren(
      head(),
      el("p", {}, status.lastSync ? `Connected. Last synced ${syncedWhen(status.lastSync)}.` : "Connected. Nothing has synced yet. Run the Shortcut once to check it works."),
      steps,
      el("div", { className: "button-row" }, again, off),
      msg,
    );
  }

  paint();
  return card;
}

/**
 * The Apple Watch card inside the iPhone app: one tap makes a sync key, hands it to the app and asks for
 * Health access. From then on the app syncs in the background, with no Shortcut.
 */
const present = (...nodes: (Node | null)[]) => nodes.filter((n): n is Node => n !== null);

function nativeWatchCard(me: Me): HTMLElement {
  const card = el("section", { className: "card stack watch-card", attrs: { "aria-label": "Apple Watch" } });
  const msg = el("p", { className: "form-msg", attrs: { "aria-live": "polite" } });
  const head = () => el("h2", {}, el("span", { textContent: "⌚ ", attrs: { "aria-hidden": "true" } }), "Apple Watch");
  const fail = (err: unknown) => (msg.textContent = err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

  async function turnOn(button: HTMLButtonElement) {
    button.disabled = true;
    msg.textContent = "";
    try {
      const res = await api<WatchKeyResponse>("POST", "/api/watch/key", {});
      const status = await native({ type: "connect", key: res.key, syncUrl: res.syncUrl });
      me.watch = { connected: true, lastSync: status.lastSync ?? me.watch.lastSync };
      paint(status);
    } catch (err) {
      fail(err);
      button.disabled = false;
    }
  }

  async function syncNow(button: HTMLButtonElement) {
    button.disabled = true;
    button.textContent = "Syncing…";
    try {
      const status = await native({ type: "sync" });
      if (status.lastSync) me.watch = { connected: true, lastSync: status.lastSync };
      paint(status);
    } catch (err) {
      fail(err);
      button.disabled = false;
      button.textContent = "Sync now";
    }
  }

  async function turnOff(button: HTMLButtonElement) {
    if (!confirm("Turn off Apple Watch sync? What already synced stays.")) return;
    button.disabled = true;
    try {
      await native({ type: "disconnect" });
      me.watch = await api<WatchStatus>("DELETE", "/api/watch/key");
      paint({ connected: false, lastSync: null, message: null });
    } catch (err) {
      fail(err);
      button.disabled = false;
    }
  }

  function paint(status: NativeStatus) {
    if (!status.connected) {
      const on = el("button", { type: "button", className: "button wide", textContent: "Turn on automatic sync" });
      on.addEventListener("click", () => turnOn(on));
      card.replaceChildren(
        ...present(
        head(),
        el("p", { className: "hint", textContent: "Brings in the calories your Watch says you burned and your steps from Apple Health, on its own in the background. Your phone asks once to share them." }),
        me.watch.connected
          ? el("p", { className: "hint", textContent: "This replaces the Apple Shortcut: once it's on, the old Shortcut's key stops working and you can delete the Shortcut and its automation." })
          : null,
        on,
        msg,
        ),
      );
      return;
    }
    const now = el("button", { type: "button", className: "button secondary", textContent: "Sync now" });
    now.addEventListener("click", () => syncNow(now));
    const off = el("button", { type: "button", className: "button secondary", textContent: "Turn off" });
    off.addEventListener("click", () => turnOff(off));
    const last = status.lastSync ?? me.watch.lastSync;
    card.replaceChildren(
      ...present(
      head(),
      el("p", {}, last ? `Syncing on its own. Last synced ${syncedWhen(last)}.` : "Syncing on its own. Nothing has come in yet."),
      status.message ? el("p", { className: "hint", textContent: status.message }) : null,
      el("p", { className: "hint", textContent: "It fills in the last week each time, so a day the phone missed catches up. If numbers stop, check Settings > Health > Data Access & Devices > Food Tracker and turn everything on." }),
      el("div", { className: "button-row" }, now, off),
      msg,
      ),
    );
  }

  card.replaceChildren(head(), el("p", { className: "muted", textContent: "Checking…" }));
  native({ type: "status" })
    .then(paint)
    .catch(() => paint({ connected: false, lastSync: null, message: null }));
  return card;
}
