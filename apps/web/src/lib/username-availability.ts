import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();

export type UsernameAvailability =
  | { status: "available"; available: true }
  | { status: "taken"; available: false }
  | { status: "unknown"; available: null };

export interface CheckUsernameOptions {
  signal?: AbortSignal;
}

export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 32;

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function validateUsernameFormat(username: string): {
  valid: boolean;
  error?: string;
} {
  const value = username.trim();
  if (!value) {
    return { valid: false, error: "Username is required." };
  }
  if (value.length < USERNAME_MIN_LENGTH) {
    return {
      valid: false,
      error: `Username must be at least ${USERNAME_MIN_LENGTH} characters.`,
    };
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return {
      valid: false,
      error: `Username must be no more than ${USERNAME_MAX_LENGTH} characters.`,
    };
  }
  if (!USERNAME_PATTERN.test(value)) {
    return {
      valid: false,
      error: "Username can only contain letters, numbers, dots, underscores, and hyphens.",
    };
  }
  return { valid: true };
}

export async function checkUsernameAvailability(
  username: string,
  options: CheckUsernameOptions = {},
): Promise<UsernameAvailability> {
  const value = username.trim();
  const format = validateUsernameFormat(value);
  if (!format.valid) {
    return { status: "unknown", available: null };
  }

  try {
    const res = await fetch(
      `${API_BASE}/identity/check-username?username=${encodeURIComponent(value)}`,
      { signal: options.signal },
    );
    if (!res.ok) {
      return { status: "unknown", available: null };
    }
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { status: "unknown", available: null };
    }
    return data.available === true
      ? { status: "available", available: true }
      : { status: "taken", available: false };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    return { status: "unknown", available: null };
  }
}
