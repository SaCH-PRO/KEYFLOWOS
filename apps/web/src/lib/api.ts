const API_BASE = (() => {
  const env = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (env) return env;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_BASE_URL is required in production. Set it in your environment or CI pipeline.',
    );
  }
  return 'http://localhost:3001';
})();
const AI_SUGGEST_URL = process.env.NEXT_PUBLIC_AI_SUGGEST_URL;

import { fetchWithRetry } from "./fetch-with-retry";
import { refreshAccessToken } from "./workspace";

// One-shot reachability check: the first time a network error is observed
// against API_BASE, log a single loud warning so the developer knows the
// configured backend URL is wrong. We only nag once per session.
let unreachableWarned = false;
function warnUnreachable(error: unknown) {
  if (unreachableWarned) return;
  unreachableWarned = true;
  const msg = error instanceof Error ? error.message : String(error);
  console.warn(
    `[keyflow-api] Could not reach API at ${API_BASE} (${msg}).\n` +
      `  - Verify NEXT_PUBLIC_API_BASE_URL in .env matches the running server port.\n` +
      `  - The default dev server runs on http://localhost:3001.\n` +
      `  - Run \`pnpm run verify:up\` to diagnose end-to-end.`,
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kf:api-unreachable", { detail: { apiBase: API_BASE, message: msg } }));
  }
}

type FetchOptions = {
  path: string;
  body?: unknown;
  init?: RequestInit;
};

type ApiResponse<T> = { data: T | null; error: string | null; planLimitReached?: PlanLimitError | null; rawError?: Record<string, unknown> | null };

export interface PlanLimitError {
  resource: string;
  current: number;
  limit: number;
  message: string;
  upgradeTo?: string;
}


function parsePlanLimitError(parsed: Record<string, unknown> | null): PlanLimitError | null {
  if (!parsed || parsed.error !== "PLAN_LIMIT_REACHED") return null;
  return {
    resource: (parsed.resource as string) ?? "",
    current: (parsed.current as number) ?? 0,
    limit: (parsed.limit as number) ?? 0,
    message: (parsed.message as string) ?? "Plan limit reached",
    upgradeTo: (parsed.upgradeTo as string) ?? undefined,
  };
}

function emitPlanLimitEvent(planLimit: PlanLimitError) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kf:plan-limit-reached", { detail: planLimit }));
  }
}

/**
 * Fired once per fetch wrapper response when the API returns 401. The
 * <RequireAuth> provider listens for this and performs the sign-out +
 * redirect-to-login. Centralising this here means every authenticated
 * request — whether it goes through apiGet/apiPost/apiPatch/apiPut/apiDelete
 * or the legacy `client.ts` apiGet — funnels through the same recovery path.
 */
export function emitUnauthorizedEvent(path: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("kf:unauthorized", { detail: { path } }));
}

function buildHeaders(initHeaders?: HeadersInit) {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  });
  if (initHeaders) {
    new Headers(initHeaders).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

function getAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  // Admin tokens take precedence on admin routes; regular tokens are the default.
  const adminToken = window.localStorage?.getItem("kf_admin_token");
  const userToken = window.localStorage?.getItem("kf_token");
  const token = adminToken ?? userToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const DEFAULT_TIMEOUT_MS = 30_000;

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return fetchWithRetry(url, init, { timeoutMs, retries: 3 });
}

/**
 * Wrapper around fetch that attempts to refresh the Supabase access token
 * on 401 and retries the request once with the new token.
 */
async function fetchWithRefresh(url: string, init: RequestInit): Promise<Response> {
  let res = await fetchWithTimeout(url, init);
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      // `init.headers` was built from the token that just expired, and
      // buildHeaders() lets caller-supplied headers overwrite the auth header —
      // so merging alone copied the stale Authorization back over the fresh one
      // and the refresh was silently discarded, meaning the retry 401'd again.
      // Every session therefore hard-failed the moment its token expired.
      //
      // Merge first to keep any custom caller headers, then re-stamp
      // Authorization from storage.
      //
      // Caveat worth knowing: getAuthHeaders() prefers `kf_admin_token`, while
      // refreshAccessToken() rotates `kf_token` only. When an admin token is
      // present this re-stamps the same admin token — correctly, because an
      // admin token is a separate credential that this refresh cannot renew. A
      // 401 there means the admin session genuinely expired and the user must
      // sign in again; the retry is a no-op rather than a fix.
      const headers = buildHeaders(init.headers);
      const { Authorization } = getAuthHeaders();
      // Unconditional set/delete: refreshAccessToken() only returns true after
      // writing a token, so the absent case is unreachable today — but keeping
      // the delete means a future change to that contract degrades to an
      // unauthenticated retry rather than silently replaying a stale header.
      if (Authorization) headers.set("Authorization", Authorization);
      else headers.delete("Authorization");
      res = await fetchWithTimeout(url, { ...init, headers });
    }
  }
  return res;
}

function handleErrorResponse<T>(data: unknown, statusText: string, status?: number, path?: string): ApiResponse<T> {

  const parsed = (typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null);
  const planLimit = parsePlanLimitError(parsed);
  if (planLimit) emitPlanLimitEvent(planLimit);
  if (status === 401) emitUnauthorizedEvent(path ?? "");
  let message: string;
  if (parsed) {
    if (typeof parsed.message === "string") {
      message = parsed.message;
    } else if (Array.isArray(parsed.message) && parsed.message.length > 0) {
      message = parsed.message.join("; ");
    } else if (typeof parsed.error === "string") {
      message = parsed.error;
    } else {
      message = statusText || "Request failed";
    }
  } else {
    message = statusText || "Request failed";
  }
  return { data: null, error: message, planLimitReached: planLimit, rawError: parsed };
}

export async function apiPost<T>({ path, body, init }: FetchOptions): Promise<ApiResponse<T>> {
  const { headers: initHeaders, ...restInit } = init ?? {};
  const headers = buildHeaders(initHeaders);

  try {
    const res = await fetchWithRefresh(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...restInit,
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText, res.status, path);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    warnUnreachable(error);
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export async function apiGet<T>(path: string, opts?: { signal?: AbortSignal }): Promise<ApiResponse<T>> {
  try {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${API_BASE}${path}${sep}_t=${Date.now()}`;
    const res = await fetchWithRefresh(url, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store",
      signal: opts?.signal,
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText, res.status, path);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    warnUnreachable(error);
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export async function apiPatch<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetchWithRefresh(`${API_BASE}${path}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText, res.status, path);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    warnUnreachable(error);
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetchWithRefresh(`${API_BASE}${path}`, {
      method: "DELETE",
      headers: buildHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText, res.status, path);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    warnUnreachable(error);
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

/**
 * @deprecated Use `apiPost<T>({ path, body })` directly. This wrapper exists
 * only for legacy callers and will be removed in a future refactor.
 */
export async function apiPostSimple<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return apiPost<T>({ path, body });
}

export async function apiPut<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetchWithRefresh(`${API_BASE}${path}`, {
      method: "PUT",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText, res.status, path);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    warnUnreachable(error);
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export function isPlanLimitError<T>(res: ApiResponse<T>): res is ApiResponse<T> & { planLimitReached: PlanLimitError } {
  return res.planLimitReached != null;
}

/**
 * Drop-in replacement for `fetch` that retries once with a refreshed token.
 *
 * The typed apiGet/apiPost/... wrappers already do this. But client.ts contains
 * a couple of dozen hand-rolled `fetch()` calls — file uploads that need
 * FormData (so they cannot use the JSON wrappers), plus a long tail of one-offs
 * — and none of them had a refresh path. Every one hard-401'd the moment the
 * Supabase access token expired, in the middle of a working session.
 *
 * Deliberately identical in signature and first-attempt behaviour to `fetch`:
 * the caller's init is passed through untouched, so headers, method, body and
 * Content-Type are exactly what they were. The ONLY change is what happens on
 * a 401 — refresh, re-stamp Authorization, retry once. That makes this a safe
 * mechanical substitution at an existing call site.
 *
 * FormData note: this never sets Content-Type, so the browser's multipart
 * boundary is preserved on both the first attempt and the retry. Setting it
 * would corrupt uploads.
 */
export async function fetchWithAuthRetry(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 401) return res;

  const refreshed = await refreshAccessToken();
  if (!refreshed) return res;

  // Rebuild from the caller's headers, then let the fresh token win — the
  // caller's copy was minted from the token that just expired.
  const headers = new Headers(init.headers);
  const { Authorization } = getAuthHeaders();
  if (Authorization) headers.set("Authorization", Authorization);
  else headers.delete("Authorization");

  return fetch(url, { ...init, headers });
}

export { API_BASE, getAuthHeaders, AI_SUGGEST_URL };
