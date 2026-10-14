// Navigation types, and history entries for things that sit on top of a
// screen (the edit sheet), so the back gesture closes them instead of leaving
// the screen.
//
// Opening an overlay pushes { overlay: id } at the same URL. Back pops it and
// closes the overlay; closing it any other way (Cancel, Save, backdrop) pops
// the entry itself. Neither pop should re-render the screen underneath, so the
// router asks handleOverlayPop() first.

/** History state: the confirm screen's id, or an open overlay's. */
export type NavState = { confirm?: number; overlay?: number } | null;

export interface GoOpts {
  replace?: boolean;
  state?: NavState;
  /** Selector for the control to focus on the new screen (e.g. the day arrow just used). Defaults to the h1. */
  focus?: string;
}
export type Go = (path: string, opts?: GoOpts) => void;

let active: { id: number; close: () => void } | null = null;
let ownPops = 0;
/** Resolved as each of our own pops lands, oldest first. */
const popWaiters: (() => void)[] = [];
let nextId = 0;

export function pushOverlay(close: () => void): number {
  const id = ++nextId;
  active = { id, close };
  history.pushState({ overlay: id }, "", location.pathname + location.search);
  return id;
}

/**
 * Call when the overlay closed on its own (not from the back gesture). Resolves
 * once its history entry is gone, so the next push (say, the confirm screen)
 * can't be popped by mistake.
 */
export function overlayClosed(id: number): Promise<void> {
  if (active?.id === id) active = null;
  if ((history.state as { overlay?: number } | null)?.overlay !== id) return Promise.resolve();
  ownPops++;
  const popped = new Promise<void>((resolve) => popWaiters.push(resolve));
  history.back();
  return popped;
}

/** From the popstate listener: true when the pop belonged to an overlay and the screen should stay as it is. */
export function handleOverlayPop(): boolean {
  if (ownPops > 0) {
    ownPops--;
    popWaiters.shift()?.();
    return true;
  }
  if (active) {
    const { close } = active;
    active = null;
    close();
    return true;
  }
  return false;
}
