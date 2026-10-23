import "./styles.css";
import type { DayView, ParseResponse } from "../../src/food/types";
import { api, ApiError, signinWorked, type Me } from "./api";
import { el } from "./dom";
import { isIsoDate, todayIn } from "./food";
import { handleOverlayPop, type Go, type NavState } from "./nav";
import { confirmView, type Added } from "./views/confirm";
import { clearProgressCache } from "./views/dashboard";
import { cachedDay, clearDraft, diaryView, noteAdded, rememberDay, stopDiaryVoice, toggleDiaryVoice } from "./views/diary";
import { goalsView } from "./views/goals";
import { overviewView } from "./views/overview";
import { setupView } from "./views/setup";
import { tabBar } from "./views/tabs";

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

const tabs = tabBar(go);
document.body.append(tabs.nav);
tabs.mic.addEventListener("click", () => {
  // From Overview or Goals, the mic opens today's Diary and listens there, all in this tap
  // (browsers only start the microphone from a tap).
  if (!location.pathname.startsWith("/diary")) go("/diary", { replace: true });
  toggleDiaryVoice();
});

/** Profile saved: first run moves on to the Overview; on the Goals tab the form stays and says so. */
function saved(next: Me) {
  const firstRun = me === null;
  me = next;
  // Goals and weight tracking show on the charts.
  clearProgressCache();
  if (firstRun) go("/", { replace: true });
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
  // Its own Cancel and Add sit at the bottom instead.
  tabs.show(null);
  render(nodes);
}

function route() {
  stopDiaryVoice();
  if (!me) {
    tabs.show(null);
    render(setupView(saved));
    return;
  }
  const path = location.pathname;

  const state = navState();
  if (state?.confirm) {
    if (confirmSession?.id === state.confirm) {
      tabs.show(null);
      render(confirmSession.nodes);
      return;
    }
    // Saved already, or the page was reloaded: nothing to confirm any more.
    history.replaceState(null, "", path);
  } else if (state?.overlay) {
    // Forward onto a closed sheet, or a reload with one open: just show the screen.
    history.replaceState(null, "", path);
  }

  // Addresses from before the tabs.
  if (path === "/settings") return go("/goals", { replace: true });
  const old = /^\/day\/([^/]+)$/.exec(path);
  if (old) return go(`/diary/${old[1]}`, { replace: true });

  if (path === "/") {
    tabs.show("overview");
    render(overviewView({ me, go }));
    return;
  }
  if (path === "/goals") {
    tabs.show("goals");
    render(goalsView(me, saved));
    return;
  }
  const diary = /^\/diary(?:\/(.+))?$/.exec(path);
  if (!diary) return go("/", { replace: true });
  const today = todayIn(me.timezone);
  const date = diary[1];
  // Today (or a day that hasn't come yet) lives at /diary; a day that isn't a date goes home.
  if (date !== undefined && !(isIsoDate(date) && date < today)) return go(isIsoDate(date) ? "/diary" : "/", { replace: true });
  tabs.show("diary");
  render(diaryView({ me, date: date ?? today, go, mic: tabs.mic, openConfirm }));
}

/** The start failed: say why and offer a way out, never a page stuck on "Loading…". */
function showError(message: string, code: string) {
  const signin = code === "signin";
  const retry = el("button", { className: "button", type: "button", textContent: signin ? "Sign in again" : "Try again" });
  // A fresh address makes the browser ask the server again (and Access show its sign-in) instead of reusing a saved page.
  retry.addEventListener("click", () => location.replace(`/?r=${Date.now()}`));
  tabs.show(null);
  render([
    el("h1", { textContent: signin ? "Time to sign in again" : "Hmm, that didn't load" }),
    el("p", { textContent: signin ? "Your sign-in ran out. Tap below and use the code Cloudflare emails you." : message }),
    retry,
    el("p", { className: "hint", textContent: `If it keeps happening, tell Andrew: ${code}.` }),
  ]);
}

async function start() {
  try {
    me = await api<Me>("GET", "/api/me");
    signinWorked();
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "no_profile")) {
      showError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.", err instanceof ApiError ? err.code : "start");
      return;
    }
    me = null;
  }
  // The cache-busting "?r=" from Sign in again isn't part of any screen's address.
  if (location.search.startsWith("?r=")) history.replaceState(null, "", location.pathname);
  try {
    route();
  } catch (err) {
    console.error(err);
    showError("Something went wrong showing this screen. Please try again.", `screen: ${err instanceof Error ? err.message : String(err)}`.slice(0, 120));
  }
}

window.addEventListener("popstate", () => {
  if (handleOverlayPop()) return;
  route();
});
start();
