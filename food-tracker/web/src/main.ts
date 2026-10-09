import "./styles.css";
import type { DayView, ParseResponse } from "../../src/food/types";
import { api, ApiError, type Me } from "./api";
import { el } from "./dom";
import { isIsoDate, todayIn } from "./food";
import { confirmView } from "./views/confirm";
import { settingsView } from "./views/settings";
import { setupView } from "./views/setup";
import { clearDraft, rememberDay, todayView } from "./views/today";

const root = document.getElementById("app")!;
let me: Me | null = null;

/**
 * The confirm screen lives only in memory. Its history entry carries the id, so
 * the back gesture returns to the day without saving and forward brings the
 * same screen (with the user's edits) back.
 */
let confirmSession: { id: number; nodes: Node[] } | null = null;

function render(nodes: Node[]) {
  root.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function go(path: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, "", path);
  else if (location.pathname !== path) history.pushState(null, "", path);
  route();
}

function saved(next: Me) {
  me = next;
  go("/");
}

function openConfirm(parsed: ParseResponse, text: string, date: string, today: string) {
  const id = Date.now();
  const nodes = confirmView({
    parsed,
    text,
    date,
    today,
    onCancel: () => history.back(),
    onAdded: (day: DayView) => {
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
    render(settingsView(me, go, saved));
    return;
  }

  const state = history.state as { confirm?: number } | null;
  if (state?.confirm) {
    if (confirmSession?.id === state.confirm) {
      render(confirmSession.nodes);
      return;
    }
    // Saved already, or the page was reloaded: nothing to confirm any more.
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

window.addEventListener("popstate", route);
start();
