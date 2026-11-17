/**
 * The shared failure kit (FAILURE-KIT, re-cut v1 plan step 3; product principle "Failures are loud and kind":
 * nothing succeeds silently and no form is lost, a refusal says why and what to do next, and "no access" is never
 * shown as zeros).
 *
 * The api client answers a refused request as { data: null, error, status } and does not throw (lib/api.ts
 * handleErrorResponse; lib/client.ts passes it on), so a screen that only catches never sees a refusal: the browser
 * sweep found Customers quick add closing on a 403/409 with no message (BUG-009, BUG-097), a refused expense delete
 * saying "Expense deleted" (BUG-031), a refused stock adjustment closing silently (BUG-032), and refused reads shown
 * as "0" and empty lists (BUG-063, BUG-064). This kit is the one answer to that class, built on PR195's words for a
 * ModuleScopeGuard refusal (moduleWriteRefusal / moduleReadRefusal in ./module-scope-refusal, re-exported by
 * ./module-access):
 *
 *   - a write: `const { refused, message } = useRefusal();` then `if (refused(res, { what: "add customers" })) return;`
 *     shows one refusal toast that says why (and, for a missing module scope, to ask the owner) and tells the form
 *     it was refused, so it stays open with what was typed; `message` is the same reason for beside the button.
 *   - a read: `readState(res, { what: "your team" })` is "ok", "no-access" (show <NoAccessState message=...>,
 *     components/ui/no-access-state.tsx) or "failed" (say it could not load) - never an empty success.
 *
 * The kit reads answers; it never sends, retries or changes them. lib/client.ts, lib/api.ts and
 * lib/fetch-with-retry.ts are untouched and do not import it (the Release 0 evidence fetch-with-retry-503.test.ts
 * stays as it is). Per-screen adoption is the work of the screen packets that depend on this one.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { isModuleScopeRefusal, moduleReadRefusal, moduleWriteRefusal } from "./module-scope-refusal";

/** An answer as lib/api.ts and lib/client.ts give it: `error` is null on success; `status` is absent on success and on a network failure. */
export type ApiAnswer = { data?: unknown; error?: string | null; status?: number } | null | undefined;

/** What the action does, or what the screen shows, in the owner's words: "add customers", "delete expenses", "your team". */
export interface RefusalContext {
  what?: string;
}

/** The access levels ModuleScopeGuard names (apps/server core/auth/module-scope.guard.ts). */
export type ScopeLevel = "none" | "read" | "write" | "admin";

/** The one id every refusal toast shares, so a second refusal replaces the first instead of stacking. */
export const REFUSAL_TOAST_ID = "kf-refusal";

/** The next step a refusal for a missing module scope offers. */
const ASK_THE_OWNER = "Ask the owner for access.";
/** The next step for a server error (5xx). */
const TRY_AGAIN = "Try again in a moment.";

const SCOPE_REFUSAL = /\b([a-z]+) requires (none|read|write|admin) access \(you have (?:none|read|write|admin)\)/;

/**
 * The module and level a ModuleScopeGuard refusal names ("Insufficient permissions: crm requires write access (you
 * have read)" -> crm, write), or null for any other answer: a success, a BusinessGuard 403 ("Unable to verify business
 * access", "No access to this business"), a 4xx/5xx. Only that refusal says the member lacks a module (PR195,
 * CRR-P195JS-2), and it is recognised by PR195's isModuleScopeRefusal.
 */
export function scopeRefusalOf(res: ApiAnswer): { module: string; level: ScopeLevel } | null {
  if (!res || res.status !== 403 || !res.error) return null;
  const named = SCOPE_REFUSAL.exec(res.error);
  if (!named || !isModuleScopeRefusal(res, named[1])) return null;
  return { module: named[1], level: named[2] as ScopeLevel };
}

/**
 * What a screen says when a write is answered with an error, or null when it went through (or there is no answer).
 * A ModuleScopeGuard refusal is said with what the action needs, in PR195's words (moduleWriteRefusal: "You can't add
 * customers in this business: it needs crm write access. <the server's words>"), naming the module and level the
 * refusal itself names; any other error in the server's own words. It claims nothing else.
 */
export function refusalMessage(res: ApiAnswer, ctx: RefusalContext = {}): string | null {
  if (!res || !res.error) return null;
  const scope = scopeRefusalOf(res);
  if (!scope) return res.error;
  const what = ctx.what ?? "do this";
  if (scope.level === "write") return moduleWriteRefusal(res, scope.module, what);
  return `You can't ${what} in this business: it needs ${scope.module} ${scope.level} access. ${res.error}`;
}

/**
 * The words of a no-access state for a read the server refused this member (a ModuleScopeGuard refusal), in PR195's
 * words (moduleReadRefusal: "You don't have access to <what> in this business. <the server's words>"), or null for
 * any other answer. A refused read is said as a refusal, never shown as an empty list or a zero.
 */
export function readRefusal(res: ApiAnswer, ctx: RefusalContext = {}): string | null {
  const scope = scopeRefusalOf(res);
  if (!scope) return null;
  return moduleReadRefusal(res, scope.module, ctx.what ?? "this");
}

/** What a screen has after a read: its data, no access (show <NoAccessState>), or a failed load (say so). */
export type ReadState = { kind: "ok" } | { kind: "no-access"; message: string } | { kind: "failed"; message: string };

/**
 * Which of the three a read's answer is. "ok" only when the answer carries no error; a ModuleScopeGuard refusal is
 * "no-access"; anything else (BusinessGuard's transient 403s, a 5xx, a network failure, no answer at all) is
 * "failed", said as "Couldn't load <what>: <the server's words>". None of them is an empty success.
 */
export function readState(res: ApiAnswer, ctx: RefusalContext = {}): ReadState {
  const what = ctx.what ?? "this";
  if (!res) return { kind: "failed", message: `Couldn't load ${what}.` };
  if (!res.error) return { kind: "ok" };
  const noAccess = readRefusal(res, ctx);
  if (noAccess) return { kind: "no-access", message: noAccess };
  return { kind: "failed", message: `Couldn't load ${what}: ${res.error}` };
}

/** The next step a refusal toast offers, if there is one to offer. */
function nextStep(res: ApiAnswer): string | undefined {
  if (scopeRefusalOf(res)) return ASK_THE_OWNER;
  if (res && typeof res.status === "number" && res.status >= 500) return TRY_AGAIN;
  return undefined;
}

/** The one refusal toast: the reason, and the next step when there is one. Every refusal shares REFUSAL_TOAST_ID. */
function toastRefusal(res: ApiAnswer, message: string): void {
  const description = nextStep(res);
  toast.error(message, description ? { id: REFUSAL_TOAST_ID, description } : { id: REFUSAL_TOAST_ID });
}

/**
 * Outside a component: show the refusal toast for a refused write and return true, or return false (and show
 * nothing) when the write went through. The caller keeps its form open on true.
 */
export function showRefusal(res: ApiAnswer, ctx: RefusalContext = {}): boolean {
  const message = refusalMessage(res, ctx);
  if (message === null) return false;
  toastRefusal(res, message);
  return true;
}

/**
 * For a form: `refused(res, ctx)` shows the refusal toast and returns true when the write was refused (the form then
 * returns early and stays open with what was typed), or returns false when it went through. `message` holds the last
 * refusal's reason (null after a success or clear()) for showing beside the button.
 */
export function useRefusal(): {
  refused: (res: ApiAnswer, ctx?: RefusalContext) => boolean;
  message: string | null;
  clear: () => void;
} {
  const [message, setMessage] = useState<string | null>(null);
  const refused = useCallback((res: ApiAnswer, ctx: RefusalContext = {}) => {
    const reason = refusalMessage(res, ctx);
    setMessage(reason);
    if (reason === null) return false;
    toastRefusal(res, reason);
    return true;
  }, []);
  const clear = useCallback(() => setMessage(null), []);
  return { refused, message, clear };
}

/** A thrown error as an answer the kit can say (a screen's catch path), in its own words when it has any. */
export function answerFromThrown(error: unknown): { data: null; error: string } {
  const words = error instanceof Error ? error.message.trim() : "";
  return { data: null, error: words || "Something went wrong." };
}
