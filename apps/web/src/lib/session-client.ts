"use client";

export async function persistSessionToken(accessToken: string): Promise<void> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ accessToken }),
  });
  if (!res.ok) {
    throw new Error("Failed to persist session");
  }
}

export async function clearWebSession(): Promise<void> {
  await fetch("/api/session", {
    method: "DELETE",
    credentials: "include",
  }).catch(() => null);
}
