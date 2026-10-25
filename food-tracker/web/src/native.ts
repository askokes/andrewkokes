/**
 * The iPhone app (ios/): the same web app inside a native shell that reads Apple Health and syncs in the
 * background. The shell answers messages on `window.webkit.messageHandlers.foodTracker`, each with a reply.
 * In a browser none of this exists and the Apple Shortcut is the way to sync.
 */
export interface NativeStatus {
  /** Health access asked for and a sync key stored. */
  connected: boolean;
  /** ISO time of the last sync the app sent, or null. */
  lastSync: string | null;
  /** What the last sync said, or why it failed. */
  message: string | null;
}

type NativeMessage = { type: "status" } | { type: "sync" } | { type: "disconnect" } | { type: "connect"; key: string; syncUrl: string };

interface Handler {
  postMessage(message: NativeMessage): Promise<unknown>;
}

function handler(): Handler | null {
  const w = window as unknown as { webkit?: { messageHandlers?: { foodTracker?: Handler } } };
  return w.webkit?.messageHandlers?.foodTracker ?? null;
}

/** Running inside the iPhone app. */
export function inNativeApp() {
  return handler() !== null;
}

/** Ask the iPhone app to do something; resolves with its status afterwards. */
export async function native(message: NativeMessage): Promise<NativeStatus> {
  const h = handler();
  if (!h) throw new Error("Not in the iPhone app.");
  return (await h.postMessage(message)) as NativeStatus;
}
