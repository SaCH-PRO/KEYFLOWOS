const OAUTH_STATE_COOKIE = "kf_oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10; // 10 minutes

function isHttps(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:";
}

export function generateOAuthState(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for very old environments
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
