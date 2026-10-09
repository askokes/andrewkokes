import "./styles.css";

interface WhoAmI {
  email: string;
  hasProfile: boolean;
  displayName: string | null;
}

const root = document.getElementById("app")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function render(...children: Node[]) {
  root.replaceChildren(...children);
}

function showHello(me: WhoAmI) {
  const name = me.displayName ?? me.email;
  render(
    el("h1", {}, "Hello, ", el("span", { className: "who", textContent: name })),
    el("p", { className: "muted", textContent: `Signed in as ${me.email}` }),
    el(
      "ul",
      { className: "checks" },
      el("li", { textContent: "Sign-in works" }),
      el("li", { textContent: "Database connected" }),
    ),
    el("p", {
      className: "muted",
      textContent: me.hasProfile
        ? "Your profile is set up."
        : "Profile setup comes next. Nothing else to do here yet.",
    }),
    el("a", { className: "button secondary", href: "/cdn-cgi/access/logout", textContent: "Sign out" }),
  );
}

function showError(message: string) {
  const retry = el("button", { className: "button", type: "button", textContent: "Try again" });
  retry.addEventListener("click", () => location.reload());
  render(el("h1", { textContent: "Hmm, that didn't load" }), el("p", { textContent: message }), retry);
}

async function start() {
  try {
    const res = await fetch("/api/whoami", { headers: { Accept: "application/json" } });
    if (res.status === 401) {
      showError("Your sign-in has expired. Tap Try again to sign back in.");
      return;
    }
    if (!res.ok) {
      showError("The server had a problem. Give it a minute and try again.");
      return;
    }
    showHello((await res.json()) as WhoAmI);
  } catch {
    showError("Couldn't reach the server. Check your connection and try again.");
  }
}

start();
