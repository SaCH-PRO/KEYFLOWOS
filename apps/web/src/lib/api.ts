const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const AI_SUGGEST_URL = process.env.NEXT_PUBLIC_AI_SUGGEST_URL;

type FetchOptions = {
  path: string;
  body?: unknown;
  init?: RequestInit;
};

type ApiResponse<T> = { data: T | null; error: string | null; planLimitReached?: PlanLimitError | null };

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
  const token = window.localStorage?.getItem("kf_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiPost<T>({ path, body, init }: FetchOptions): Promise<ApiResponse<T>> {
  const { headers: initHeaders, ...restInit } = init ?? {};
  const headers = buildHeaders(initHeaders);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...restInit,
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

function handleErrorResponse<T>(data: unknown, statusText: string): ApiResponse<T> {
  const parsed = (typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null);
  const planLimit = parsePlanLimitError(parsed);
  if (planLimit) emitPlanLimitEvent(planLimit);
  const message =
    parsed && typeof parsed.message === "string" ? parsed.message : statusText || "Request failed";
  return { data: null, error: message, planLimitReached: planLimit };
}

export async function apiGet<T>(path: string, opts?: { signal?: AbortSignal }): Promise<ApiResponse<T>> {
  try {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${API_BASE}${path}${sep}_t=${Date.now()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store",
      signal: opts?.signal,
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export async function apiPatch<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "DELETE",
      headers: buildHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export async function apiPostSimple<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return apiPost<T>({ path, body });
}

export async function apiPut<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return handleErrorResponse<T>(data, res.statusText);
    return { data: data as T, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export function isPlanLimitError<T>(res: ApiResponse<T>): res is ApiResponse<T> & { planLimitReached: PlanLimitError } {
  return res.planLimitReached != null;
}

export { API_BASE, getAuthHeaders, AI_SUGGEST_URL };
