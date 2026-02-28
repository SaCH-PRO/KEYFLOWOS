const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const AI_SUGGEST_URL = process.env.NEXT_PUBLIC_AI_SUGGEST_URL;

type FetchOptions = {
  path: string;
  body?: unknown;
  init?: RequestInit;
};

type ApiResponse<T> = { data: T | null; error: string | null };

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
    if (!res.ok) {
      const parsed = (typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null);
      const message =
        parsed && typeof parsed.message === "string" ? parsed.message : res.statusText || "Request failed";
      return { data: null, error: message };
    }
    return { data: data as T, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export async function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  try {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${API_BASE}${path}${sep}_t=${Date.now()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = (typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null);
      const message =
        parsed && typeof parsed.message === "string" ? parsed.message : res.statusText || "Request failed";
      return { data: null, error: message };
    }
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
    if (!res.ok) {
      const parsed = (typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null);
      const message =
        parsed && typeof parsed.message === "string" ? parsed.message : res.statusText || "Request failed";
      return { data: null, error: message };
    }
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
    if (!res.ok) {
      const parsed = (typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null);
      const message =
        parsed && typeof parsed.message === "string" ? parsed.message : res.statusText || "Request failed";
      return { data: null, error: message };
    }
    return { data: data as T, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    return { data: null, error: message };
  }
}

export async function apiPostSimple<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return apiPost<T>({ path, body });
}

export { API_BASE, getAuthHeaders, AI_SUGGEST_URL };
