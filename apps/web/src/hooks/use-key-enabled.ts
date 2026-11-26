"use client";

/**
 * SWP-KEY-SHELL-SMOKE (V1-63; D-17, D-163): whether this deployment offers KEY at all.
 *
 * The server's KEY_DISABLED switch (keyDisabled() in apps/server/src/core/config/env.ts) reaches the web as
 * `keyDisabled: boolean` on GET /identity/me (P89). Under it the API refuses every model dispatch, so no KEY door may
 * render: the header's Ask KEY, Cmd/Ctrl+J, the drawer, push-to-talk, Settings > KEY and the awareness panel.
 *
 * Fail-safe, on purpose: KEY is offered only once /identity/me has answered and did not say `keyDisabled: true`.
 *   - While the read is in flight, nothing of KEY renders, so a KEY-disabled business never sees a door flash. A
 *     KEY-enabled one sees its doors a moment later; the shell has already waited for /identity/me (RequireAuth), so
 *     this read is quick.
 *   - When the read fails (refused, offline), KEY stays off: a door to a switched-off KEY is the defect this packet
 *     removes, while a KEY-enabled business that loses its doors to a failed read gets them back on the next mount
 *     (a failure is not kept; the next consumer to mount reads again).
 *   - A 200 without the field is a server from before P89, which had no switch the web could read: KEY stays on.
 *
 * One read is shared by every consumer and kept per session token: the switch is the deployment's, not the member's,
 * but a new sign-in reads it again.
 */
import { useEffect, useSyncExternalStore } from "react";
import { apiGet } from "@/lib/api";

export interface KeyEnabledState {
  /** KEY may render: the server answered and did not report KEY disabled. */
  enabled: boolean;
  /** The server has answered. */
  known: boolean;
}

const OFF_UNKNOWN: KeyEnabledState = { enabled: false, known: false };
const OFF_KNOWN: KeyEnabledState = { enabled: false, known: true };
const ON_KNOWN: KeyEnabledState = { enabled: true, known: true };

/** The answer per session token ("" when signed out), and the read in flight per token. */
const answers = new Map<string, KeyEnabledState>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function sessionKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage?.getItem("kf_admin_token") ?? window.localStorage?.getItem("kf_token") ?? "";
  } catch {
    return "";
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function readKeySwitch(): void {
  const key = sessionKey();
  if (answers.has(key) || inFlight.has(key)) return;
  const read = apiGet<{ keyDisabled?: unknown }>("/identity/me")
    .then(({ data, error }) => {
      if (error || !data || typeof data !== "object") return; // failed: not kept, KEY stays off
      answers.set(key, data.keyDisabled === true ? OFF_KNOWN : ON_KNOWN);
    })
    .catch(() => {
      /* failed: not kept, KEY stays off */
    })
    .finally(() => {
      inFlight.delete(key);
      notify();
    });
  inFlight.set(key, read);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): KeyEnabledState {
  return answers.get(sessionKey()) ?? OFF_UNKNOWN;
}

function serverSnapshot(): KeyEnabledState {
  return OFF_UNKNOWN;
}

/** Whether KEY may render here: `enabled` only once GET /identity/me said KEY is not disabled. */
export function useKeyEnabled(): KeyEnabledState {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    readKeySwitch();
  }, []);
  return state;
}
