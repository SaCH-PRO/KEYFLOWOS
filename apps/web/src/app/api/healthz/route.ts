import { getApiBase } from "@/lib/api-base";
import { NextResponse } from "next/server";
import { ensureValidWebEnv } from "@/lib/env";
import { getReleaseVersion } from "@/lib/release-version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BOOT_TIME_MS = Date.now();

// Validate env once on first import (server-only, request-time). We catch
// here so the health endpoint still returns *something* — the body will
// indicate the problem instead of returning a 500 with no diagnostics.
let envOk = true;
let envError: string | null = null;
try {
  ensureValidWebEnv(process.env);
} catch (err) {
  envOk = false;
  envError = err instanceof Error ? err.message : String(err);
}

async function getCommit(): Promise<string> {
  return (await getReleaseVersion()).short;
}

async function probeApi(apiBase: string): Promise<{ ok: boolean; status?: number; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${apiBase.replace(/\/+$/, "")}/readyz`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  const apiBase = getApiBase();
  const apiProbe = await probeApi(apiBase);
  const status = envOk && apiProbe.ok ? "ok" : "degraded";
  const httpStatus = envOk ? 200 : 503;
  return NextResponse.json(
    {
      status,
      uptimeSec: Math.round((Date.now() - BOOT_TIME_MS) / 1000),
      commit: await getCommit(),
      nodeVersion: process.version,
      apiBase,
      apiReachable: apiProbe.ok,
      apiLatencyMs: apiProbe.latencyMs,
      apiStatus: apiProbe.status,
      apiError: apiProbe.error,
      env: envOk ? "ok" : "invalid",
      envError,
      timestamp: new Date().toISOString(),
    },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}
