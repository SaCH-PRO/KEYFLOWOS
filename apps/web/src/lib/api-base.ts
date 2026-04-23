export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (typeof window !== "undefined" ? `${window.location.origin}/backend` : "http://localhost:3001");
