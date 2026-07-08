const OAUTH_STATE_COOKIE = "kf_oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10; // 10 minutes

function isHttps(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:";
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate a high-entropy OAuth state parameter using the Web Crypto API.
 * The output is URL-safe and unpredictable; there is no Math.random() fallback.
 */
export function generateOAuthState(): string {
  const array = new Uint8Array(32);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(array);
  } else {
    // crypto is required in all modern browsers and Node 20+ runtimes.
    throw new Error("Web Crypto API is not available; cannot generate OAuth state securely.");
  }
  return base64UrlEncode(array);
}

/**
 * Store the OAuth state in a short-lived cookie with SameSite protection.
 * HttpOnly is intentionally not used because the client must read the cookie
 * to validate the state returned by the OAuth provider. For server-side state
 * validation, move this to a Route Handler that reads an HttpOnly cookie.
 */
export function setOAuthState(state: string): void {
  if (typeof document === "undefined") return;
  const secure = isHttps() ? "; Secure" : "";
  document.cookie = `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function getOAuthState(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${OAUTH_STATE_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function clearOAuthState(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
