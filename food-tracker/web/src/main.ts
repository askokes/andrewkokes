import "./styles.css";
import type { DayView, ParseResponse } from "../../src/food/types";
import { api, ApiError, type Me } from "./api";
import { el } from "./dom";
import { isIsoDate, todayIn } from "./food";
import { handleOverlayPop, type Go, type NavState } from "./nav";
import { confirmView, type Added } from "./views/confirm";
import { settingsView } from "./views/settings";
import { setupView } from "./views/setup";
import { cachedDay, clearDraft, noteAdded, rememberDay, todayView } from "./views/today";

const root = document.getElementById("app")!;
let me: Me | null = null;

/**
 * The confirm screen lives only in memory. Its history entry carries the id, so
 * the back gesture returns to the day without saving and forward brings the
 * same screen (with the user's edits) back.
 */
let confirmSession: { id: number; nodes: Node[] } | null = null;

const navState = () => history.state as NavState;

let pendingFocus: string | null = null;

/** Swaps the screen, then moves focus to its heading (or the requested control) so screen readers start there. */
function render(nodes: Node[]) {
  root.replaceChildren(...nodes);
  window.scrollTo(0, 0);
  const wanted = pendingFocus ? root.querySelector<HTMLElement>(pendingFocus) : null;
  pendingFocus = null;
  if (wanted && !(wanted as HTMLButtonElement).disabled) {
    wanted.focus({ preventScroll: true });
    return;
  }
  const h1 = root.querySelector<HTMLElement>("h1");
  if (h1) {
    h1.tabIndex = -1;
    h1.focus({ preventScroll: true });
  }
}

const go: Go = (path, opts = {}) => {
  pendingFocus = opts.focus ?? null;
  if (opts.replace) history.replaceState(opts.state ?? null, "", path);
  else if (location.pathname !== path) history.pushState(opts.state ?? null, "", path);
  route();
};

/** Back to where Settings was opened from: pop the entry the app pushed, else replace it with Today. */
function leaveSettings() {
  if (location.pathname === "/settings" && navState()?.fromApp) history.back();
  else go("/", { replace: true });
}

function saved(next: Me) {
  me = next;
  leaveSettings();
}

function openConfirm(parsed: ParseResponse, text: string, date: string, today: string) {
  const id = Date.now();
  const nodes = confirmView({
    parsed,
    text,
    date,
    today,
    onCancel: () => history.back(),
    onAdded: (day: DayView, added: Added) => {
      // The new rows are the ids this day didn't have before. Without an earlier copy, highlight nothing.
      const prev = cachedDay(day.date);
      const before = new Set(prev?.entries.map((e) => e.id));
      const ids = prev ? day.entries.filter((e) => !before.has(e.id)).map((e) => e.id) : [];
      noteAdded(day.date, { count: added.count, meal: added.meal, ids });
      rememberDay(day);
      clearDraft();
      confirmSession = null;
      history.back();
    },
  });
  confirmSession = { id, nodes };
  history.pushState({ confirm: id }, "", location.pathname);
  render(nodes);
}

function route() {
  if (!me) {
    render(setupView(saved));
    return;
  }
  const path = location.pathname;
  if (path === "/settings") {
    render(settingsView(me, leaveSettings, saved));
    return;
  }

  const state = navState();
  if (state?.confirm) {
    if (confirmSession?.id === state.confirm) {
      render(confirmSession.nodes);
      return;
    }
    // Saved already, or the page was reloaded: nothing to confirm any more.
    history.replaceState(null, "", path);
  } else if (state?.overlay) {
    // Forward onto a closed sheet, or a reload with one open: just show the day.
    history.replaceState(null, "", path);
  }

  const today = todayIn(me.timezone);
  const match = /^\/day\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (path !== "/" && !(match && isIsoDate(match[1]) && match[1] < today)) {
    go("/", { replace: true });
    return;
  }
  render(todayView({ me, date: match ? match[1] : today, go, openConfirm }));
}

function showError(message: string) {
  const retry = el("button", { className: "button", type: "button", textContent: "Try again" });
  retry.addEventListener("click", () => location.reload());
  render([el("h1", { textContent: "Hmm, that didn't load" }), el("p", { textContent: message }), retry]);
}

async function start() {
  try {
    me = await api<Me>("GET", "/api/me");
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "no_profile")) {
      showError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      return;
    }
    me = null;
  }
  route();
}

window.addEventListener("popstate", () => {
  if (handleOverlayPop()) return;
  route();
});
start();
