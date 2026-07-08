const CODE_VERIFIER_KEY = "kf_oauth_code_verifier";
const CODE_VERIFIER_MAX_AGE_SECONDS = 60 * 10; // 10 minutes

function isHttps(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:";
}

function writeCodeVerifierCookie(value: string): void {
  if (typeof document === "undefined") return;
  const secure = isHttps() ? "; Secure" : "";
  document.cookie = `${CODE_VERIFIER_KEY}=${encodeURIComponent(value)}; Path=/; Max-Age=${CODE_VERIFIER_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function clearCodeVerifierCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${CODE_VERIFIER_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function readCodeVerifierCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${CODE_VERIFIER_KEY}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return base64UrlEncode(array);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function storeCodeVerifier(verifier: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CODE_VERIFIER_KEY, verifier);
  writeCodeVerifierCookie(verifier);
}

export function getCodeVerifier(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CODE_VERIFIER_KEY) ?? readCodeVerifierCookie();
}

export function clearCodeVerifier(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CODE_VERIFIER_KEY);
  clearCodeVerifierCookie();
}
