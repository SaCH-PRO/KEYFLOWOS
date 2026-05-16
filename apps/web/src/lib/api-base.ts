/**
 * Resolves the API base URL with a production safety check.
 * Throws if NEXT_PUBLIC_API_BASE_URL is missing in production.
 */
export function getApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (env) return env;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is required in production. Set it in your environment or CI pipeline.",
    );
  }
  return "http://localhost:3001";
}
