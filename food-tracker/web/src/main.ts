import "./styles.css";
import { api, ApiError, type Me } from "./api";
import { el } from "./dom";
import { homeView } from "./views/home";
import { settingsView } from "./views/settings";
import { setupView } from "./views/setup";

const root = document.getElementById("app")!;
let me: Me | null = null;

function render(nodes: Node[]) {
  root.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function go(path: string) {
  if (location.pathname !== path) history.pushState(null, "", path);
  route();
}

function saved(next: Me) {
  me = next;
  go("/");
}

function route() {
  if (!me) {
    render(setupView(saved));
    return;
  }
  if (location.pathname === "/settings") render(settingsView(me, go, saved));
  else render(homeView(me, go));
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
