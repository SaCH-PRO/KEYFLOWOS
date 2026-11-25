/**
 * OWNER-ALERTS-WEB repair round 1 (COR-OAW-2): the browser's install prompt, held for the "Install KEYFLOWOS on your
 * phone" step (components/install-app-step.tsx). Chromium fires beforeinstallprompt once, as the page loads, so it is
 * caught here, by a module the /app layout imports, whichever page loads first.
 *
 * The browser's own install UI (its mini-infobar) is held back (preventDefault) only while our own button is on
 * screen, that is while an install step is mounted (ownButtonShown). A prompt that comes before that is kept, but the
 * browser may show its own UI for it.
 *
 * Side effects run only in a browser (the module is also evaluated during the server render of the client layout).
 */

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

let held: InstallPromptEvent | null = null;
let installed = false;
let ownButtons = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    if (ownButtons > 0) event.preventDefault();
    held = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    held = null;
    notify();
  });
}

/** The held prompt, if the browser offered one and it has not been used. */
export function heldInstallPrompt(): InstallPromptEvent | null {
  return held;
}

/** Takes the held prompt for one use (the browser lets a prompt be shown once). */
export function takeInstallPrompt(): InstallPromptEvent | null {
  const event = held;
  held = null;
  return event;
}

/** Whether the browser reported the app installed (appinstalled) or an install was accepted here. */
export function installSeen(): boolean {
  return installed;
}

export function markInstalled(): void {
  installed = true;
  held = null;
  notify();
}

/** Calls `fn` when the held prompt or the installed state changes. Returns the unsubscribe. */
export function onInstallPromptChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** While our own install button is on screen: a prompt that comes then holds back the browser's own UI. */
export function ownButtonShown(): () => void {
  ownButtons += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    ownButtons -= 1;
  };
}
