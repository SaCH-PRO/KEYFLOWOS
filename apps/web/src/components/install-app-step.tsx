"use client";

/**
 * OWNER-ALERTS-WEB: "Install KEYFLOWOS on your phone" (D-154: the business owner hears about a booking, a payment or
 * an "I've paid" claim by phone push first). The app is installable already: app/manifest.ts (display standalone,
 * start_url /app) and public/sw.js (push and notificationclick). On an iPhone a web app gets push only once it is on
 * the Home Screen, and there is no install prompt there, so the step says how.
 *
 * Every state is said:
 *   installed  running as the installed app (display-mode standalone, or iOS navigator.standalone), or the browser
 *              reported appinstalled
 *   prompt     the browser offered install (beforeinstallprompt): an Install app button that opens its prompt
 *   ios        iPhone or iPad without the installed app: Share, then Add to Home Screen
 *   manual     a phone browser without a prompt: its menu's Install app or Add to Home screen
 *   desktop    a desktop browser without a prompt (repair round 1, COR-OAW-3: desktop Firefox, macOS Safari without
 *              touch): open KEYFLOWOS on the phone to install it
 *   dismissed  the owner closed the browser's prompt (or it could not be shown): not installed, and the steps above
 *              for this device (a prompt is usable once)
 *
 * The prompt is held by lib/install-prompt.ts, which the /app layout imports, so it is kept whichever page loads
 * first (repair round 1, COR-OAW-2). While this step is mounted it is our own button, so a prompt that comes then
 * holds back the browser's own install UI.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Smartphone } from "lucide-react";
import {
  heldInstallPrompt,
  installSeen,
  markInstalled,
  onInstallPromptChange,
  ownButtonShown,
  takeInstallPrompt,
} from "@/lib/install-prompt";

type Fallback = "ios" | "manual" | "desktop";
type InstallState = "checking" | "installed" | "prompt" | Fallback | "dismissed";

function runningInstalled(): boolean {
  if (installSeen()) return true;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
}

/** iPadOS 13+ reports itself as a Mac; a Mac with touch is an iPad. */
function macWithTouch(ua: string): boolean {
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/** What to say on this device when the browser offers no prompt. */
function fallback(): Fallback {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua) || macWithTouch(ua)) return "ios";
  if (/Android|Mobi/i.test(ua)) return "manual";
  return "desktop";
}

function currentState(): Exclude<InstallState, "checking" | "dismissed"> {
  if (runningInstalled()) return "installed";
  if (heldInstallPrompt()) return "prompt";
  return fallback();
}

export function InstallAppStep() {
  const [state, setState] = useState<InstallState>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const release = ownButtonShown();
    const update = () => setState((prev) => (prev === "dismissed" && !runningInstalled() ? prev : currentState()));
    update();
    const unsubscribe = onInstallPromptChange(update);
    return () => {
      unsubscribe();
      release();
    };
  }, []);

  const install = useCallback(async () => {
    if (busy) return;
    const event = takeInstallPrompt();
    if (!event) return;
    setBusy(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") {
        markInstalled();
        setState("installed");
      } else {
        setState("dismissed");
      }
    } catch {
      setState("dismissed");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (state === "checking") return null;
  const steps: Fallback | null = state === "dismissed" ? fallback() : state === "installed" || state === "prompt" ? null : state;

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
              Alerts reach a phone fastest from the installed app, even when it is closed.
            </p>
          )}
          {state === "dismissed" && (
            <p className="kf-text-caption" role="status">
              Not installed. You can install it any time.
            </p>
          )}
          {steps === "ios" && (
            <p className="kf-text-caption">
              In Safari, tap <span className="font-medium">Share</span>, then{" "}
              <span className="font-medium">Add to Home Screen</span>. On an iPhone, push alerts work only from the
              app on your Home Screen.
            </p>
          )}
          {steps === "manual" && (
            <p className="kf-text-caption">
              Open your browser&apos;s menu and choose <span className="font-medium">Install app</span> or{" "}
              <span className="font-medium">Add to Home screen</span>.
            </p>
          )}
          {steps === "desktop" && (
            <p className="kf-text-caption">Open KEYFLOWOS on your phone to install it there.</p>
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
