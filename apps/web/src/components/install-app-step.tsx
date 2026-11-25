"use client";

/**
 * OWNER-ALERTS-WEB: "Install KEYFLOWOS on your phone" (D-154: the owner hears about a booking, a payment or an "I've
 * paid" claim by phone push first). The app is installable already: app/manifest.ts (display standalone, start_url
 * /app) and public/sw.js (push and notificationclick). On an iPhone a web app gets push only once it is on the Home
 * Screen, and there is no install prompt there, so the step says how.
 *
 * Every state is said:
 *   installed  running as the installed app (display-mode standalone, or iOS navigator.standalone), or the browser
 *              reported appinstalled
 *   prompt     the browser offered install (beforeinstallprompt): an Install app button that opens its prompt
 *   ios        iPhone or iPad without the installed app: Share, then Add to Home Screen
 *   manual     any other browser without a prompt: its menu's Install app or Add to Home screen
 *   dismissed  the owner closed the browser's prompt: not installed, and the menu steps (a prompt is usable once)
 *
 * Chromium may fire beforeinstallprompt once, on the first page load, before this step is ever shown. It is held at
 * module load (and the browser's own mini-bar held back) so a later visit to this step can still use it. If this
 * module was not loaded in time, the step shows the menu steps, which are still true.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Smartphone } from "lucide-react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

type InstallState = "checking" | "installed" | "prompt" | "ios" | "manual" | "dismissed";

let heldPrompt: InstallPromptEvent | null = null;
let installedSeen = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    heldPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installedSeen = true;
    heldPrompt = null;
    notify();
  });
}

function runningInstalled(): boolean {
  if (installedSeen) return true;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
}

function isIos(): boolean {
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports itself as a Mac; a Mac with touch is an iPad.
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

function currentState(): Exclude<InstallState, "checking" | "dismissed"> {
  if (runningInstalled()) return "installed";
  if (heldPrompt) return "prompt";
  return isIos() ? "ios" : "manual";
}

export function InstallAppStep() {
  const [state, setState] = useState<InstallState>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const update = () => setState((prev) => (prev === "dismissed" && !runningInstalled() ? prev : currentState()));
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  const install = useCallback(async () => {
    const event = heldPrompt;
    if (!event || busy) return;
    setBusy(true);
    // The browser lets a prompt be shown once.
    heldPrompt = null;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") installedSeen = true;
      setState(choice.outcome === "accepted" ? "installed" : "dismissed");
    } catch {
      setState("dismissed");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (state === "checking") return null;

  return (
    <div className="kf-card p-4 space-y-2" data-testid="install-app-step" data-state={state}>
      <div className="flex items-start gap-3">
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
        >
          {state === "installed" ? (
            <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
          ) : (
            <Smartphone className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold">Install KEYFLOWOS on your phone</h3>
          {state === "installed" ? (
            <p className="kf-text-caption text-muted-foreground">KEYFLOWOS is installed on this device.</p>
          ) : (
            <p className="kf-text-caption text-muted-foreground">
              Your alerts reach you fastest from the installed app, even when it is closed.
            </p>
          )}
          {state === "ios" && (
            <p className="kf-text-caption">
              In Safari, tap <span className="font-medium">Share</span>, then{" "}
              <span className="font-medium">Add to Home Screen</span>. On an iPhone, push alerts work only from the
              app on your Home Screen.
            </p>
          )}
          {state === "dismissed" && (
            <p className="kf-text-caption" role="status">
              Not installed. You can install it any time.
            </p>
          )}
          {(state === "manual" || state === "dismissed") && (
            <p className="kf-text-caption">
              Open your browser&apos;s menu and choose <span className="font-medium">Install app</span> or{" "}
              <span className="font-medium">Add to Home screen</span>.
            </p>
          )}
        </div>
      </div>
      {state === "prompt" && (
        <button
          type="button"
          onClick={install}
          disabled={busy}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          Install app
        </button>
      )}
    </div>
  );
}
