"use client";

/**
 * SWP-KEY-SHELL-SMOKE (V1-63; D-17, D-163): whether this deployment offers KEY at all.
 *
 * The server's KEY_DISABLED switch (keyDisabled() in apps/server/src/core/config/env.ts) reaches the web as
 * `keyDisabled: boolean` on GET /identity/me (P89). Under it the API refuses every model dispatch, so no KEY door may
 * render: the header's Ask KEY, Cmd/Ctrl+J, the drawer, push-to-talk, Settings > KEY and the awareness panel.
 *
 * Fail closed, on purpose: KEY is offered only once /identity/me has answered `keyDisabled: false`.
 *   - While the read is in flight, nothing of KEY renders, so a KEY-disabled business never sees a door flash. A
 *     KEY-enabled one sees its doors a moment later; the shell has already waited for /identity/me (RequireAuth), so
 *     this read is quick.
 *   - A 200 without the field, or with a value that is not a boolean, is not an answer that KEY is on: KEY stays off.
 *     The server always sends a boolean (identity.controller.ts getMe, keyDisabled(): boolean).
 *   - When the read fails (refused, offline) and nothing is known yet, KEY stays off and `useKeySwitchFailed()` says
 *     so (Settings > KEY shows an error with Try again, `retryKeySwitch()`). A failure is not final: the next consumer
 *     to mount, a new session token, or Try again reads again.
 *
 * The switch is the deployment's (an API environment variable), not the member's or the token's, so the answer is
 * kept once per tab, not per access token: a token refresh (refreshAccessToken writes a new kf_token) or a new
 * sign-in in the same tab keeps KEY as the server last said (repair round 1, COR-1). Only while nothing is known
 * does a new token start a read (SEC-M2: a sign-in after a refused, signed-out read turns KEY on without a remount).
 * Reads are never run twice at once.
 */
import { useEffect, useSyncExternalStore } from "react";
import { apiGet } from "@/lib/api";

export interface KeyEnabledState {
  /** KEY may render: the server answered keyDisabled: false. */
  enabled: boolean;
  /** The server has answered. */
  known: boolean;
}

const OFF_UNKNOWN: KeyEnabledState = { enabled: false, known: false };
const OFF_KNOWN: KeyEnabledState = { enabled: false, known: true };
const ON_KNOWN: KeyEnabledState = { enabled: true, known: true };

/** What the server last answered in this tab; null until it has. */
let answer: KeyEnabledState | null = null;
/** The session token of the read in flight, if one is. */
let reading: string | null = null;
/** The session token whose read last failed while nothing was known. */
let failedFor: string | null = null;
/** Bumped by resetKeySwitchForTests, so a read from before the reset changes nothing. */
let generation = 0;
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

/**
 * Reads the switch unless it is known or a read is in flight. A token whose read already failed is read again only
 * when `retryFailed` (a mount, or Try again), so a failing read does not repeat on every render.
 */
function readKeySwitch(retryFailed: boolean): void {
  if (answer || reading !== null) return;
  const key = sessionKey();
  if (failedFor === key && !retryFailed) return;
  const wasFailed = failedFor !== null;
  failedFor = null;
  reading = key;
  if (wasFailed) notify();
  let ok = false;
  const gen = generation;
  apiGet<{ keyDisabled?: unknown }>("/identity/me")
    .then(({ data, error }) => {
      if (gen !== generation) return;
      if (error || !data || typeof data !== "object") return;
      ok = true;
      answer = data.keyDisabled === false ? ON_KNOWN : OFF_KNOWN;
    })
    .catch(() => {
      /* failed: KEY stays off */
    })
    .finally(() => {
      if (gen !== generation) return;
      reading = null;
      if (!ok) failedFor = key;
      notify();
      // The token changed while that read was out (a sign-in): read for the token there is now.
      if (!answer && sessionKey() !== key) readKeySwitch(false);
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): KeyEnabledState {
  return answer ?? OFF_UNKNOWN;
}

function serverSnapshot(): KeyEnabledState {
  return OFF_UNKNOWN;
}

function failedSnapshot(): boolean {
  return !answer && reading === null && failedFor !== null && failedFor === sessionKey();
}

function failedServerSnapshot(): boolean {
  return false;
}

/** Whether KEY may render here: `enabled` only once GET /identity/me said keyDisabled: false. */
export function useKeyEnabled(): KeyEnabledState {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const token = sessionKey();
  useEffect(() => {
    readKeySwitch(true);
  }, []);
  useEffect(() => {
    readKeySwitch(false);
  }, [token]);
  return state;
}

/** True while nothing is known and the last read, for the current session token, failed. */
export function useKeySwitchFailed(): boolean {
  return useSyncExternalStore(subscribe, failedSnapshot, failedServerSnapshot);
}

/** Reads the switch again after a failed read (Settings > KEY's Try again). */
export function retryKeySwitch(): void {
  readKeySwitch(true);
}

/** Forgets what this tab read, as a new tab would start. For tests only. */
export function resetKeySwitchForTests(): void {
  generation += 1;
  answer = null;
  reading = null;
  failedFor = null;
  notify();
}
