const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type FetchOptions = {
  path: string;
  body?: unknown;
  init?: RequestInit;
};

type ApiResponse<T> = { data: T | null; error: string | null };

export async function apiPost<T>({ path, body, init }: FetchOptions): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      ...init,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { data: null, error: data?.message ?? 'Request failed' };
    }
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message ?? 'Network error' };
  }
}

export { API_BASE };
