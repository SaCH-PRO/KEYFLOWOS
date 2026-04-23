import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "kf_session";
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 8;

function decodeJwtExpiry(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const cookieStore = await cookies();
  return NextResponse.json({ hasSession: Boolean(cookieStore.get(SESSION_COOKIE)?.value) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { accessToken?: string } | null;
  const accessToken = body?.accessToken?.trim();
  if (!accessToken) {
    return NextResponse.json({ error: "Missing access token" }, { status: 400 });
  }

  const exp = decodeJwtExpiry(accessToken);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttl = exp ? Math.max(exp - nowSeconds, 60) : DEFAULT_MAX_AGE_SECONDS;

  const cookieStore = await cookies();
  cookieStore.set({
    name: SESSION_COOKIE,
    value: accessToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttl,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return NextResponse.json({ ok: true });
}
