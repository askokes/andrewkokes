import { api, ApiError } from "../api";
import { el } from "../dom";

interface InviteResult {
  email: string;
  added: boolean;
  people: string[];
}

/** The note to send someone just invited: where to go and which email to use. */
function inviteText(email: string) {
  return `Join me on Food Tracker, our family food log! Open the link on your phone and sign in with ${email}. It emails you a 6-digit code (no password). Then tap Share, Add to Home Screen.`;
}

/** Opens the phone's share sheet (Messages, Mail...), or copies the note where there's none. */
async function share(email: string, msg: HTMLElement) {
  const url = location.origin;
  const text = inviteText(email);
  if (navigator.share) {
    try {
      await navigator.share({ title: "Food Tracker", text, url });
    } catch (err) {
      // Closing the share sheet isn't an error.
      if (!(err instanceof DOMException && err.name === "AbortError")) msg.textContent = "Couldn't open sharing. Try again.";
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    msg.textContent = "Copied. Paste it in a text or email.";
  } catch {
    msg.textContent = `Send them this: ${text} ${url}`;
  }
}

/** "Invite someone", on the Goals tab for whoever may invite (Me.canInvite). */
export function inviteCard(): HTMLElement {
  const id = "invite-email";
  const input = el("input", {
    id,
    type: "email",
    className: "control",
    placeholder: "name@example.com",
    attrs: { inputmode: "email", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-describedby": `${id}-msg` },
  });
  const button = el("button", { type: "submit", className: "button", textContent: "Invite" });
  const msg = el("p", { id: `${id}-msg`, className: "form-msg", attrs: { "aria-live": "polite" } });
  const done = el("div", { className: "invite-done", hidden: true, attrs: { "aria-live": "polite" } });
  const peopleList = el("ul", { className: "people" });
  const people = el("details", { className: "people-box" }, el("summary", { textContent: "Who can sign in" }), peopleList);

  const showPeople = (list: string[]) => peopleList.replaceChildren(...list.map((e) => el("li", { textContent: e })));
  let loaded = false;
  people.addEventListener("toggle", async () => {
    if (!people.open || loaded) return;
    peopleList.replaceChildren(el("li", { className: "muted", textContent: "Loading…" }));
    try {
      showPeople((await api<{ people: string[] }>("GET", "/api/people")).people);
      loaded = true;
    } catch (err) {
      peopleList.replaceChildren(el("li", { className: "muted", textContent: err instanceof ApiError ? err.message : "Couldn't load the list." }));
    }
  });

  const form = el(
    "form",
    { className: "stack", noValidate: true },
    el("label", { htmlFor: id, className: "add-label", textContent: "Invite someone" }),
    el("p", { className: "hint", textContent: "Add their email and they can sign in. They get a 6-digit code by email each time, no password. Their food and weight stay private to them." }),
    el("div", { className: "input-row" }, input, button),
    msg,
    done,
    people,
  );
  input.addEventListener("input", () => (msg.textContent = ""));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = input.value.trim();
    if (!email) {
      msg.textContent = "Type their email first.";
      input.focus();
      return;
    }
    button.disabled = true;
    button.textContent = "Adding…";
    msg.textContent = "";
    try {
      const res = await api<InviteResult>("POST", "/api/invites", { email });
      input.value = "";
      input.blur();
      const shareMsg = el("p", { className: "hint", attrs: { "aria-live": "polite" } });
      const send = el("button", { type: "button", className: "button wide", textContent: "Send them the link" });
      send.addEventListener("click", () => share(res.email, shareMsg));
      done.replaceChildren(
        el("p", {}, el("strong", { textContent: res.email }), res.added ? " can sign in now." : " could already sign in."),
        send,
        shareMsg,
      );
      done.hidden = false;
      showPeople(res.people);
      loaded = true;
    } catch (err) {
      msg.textContent = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Invite";
    }
  });

  return el("section", { className: "card", attrs: { "aria-label": "Invite someone" } }, form);
}
