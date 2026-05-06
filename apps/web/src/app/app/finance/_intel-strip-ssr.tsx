import { cookies } from "next/headers";
import { Sparkles } from "lucide-react";

/**
 * FIN8 — Server-rendered insight strip. Fetches the AI-generated
 * headline at request time on the server (with the same 3s timeout +
 * deterministic fallback contract as the backend) so the panel HTML
 * is in the initial document instead of waiting for a client effect.
 *
 * `businessId` is read from the `kf_business_id` cookie that
 * `setStoredBusinessId()` mirrors alongside localStorage. If either
 * cookie is missing we render the deterministic skeleton — never
 * leak a Bearer token or block render.
 */

interface InsightDto {
  headline: string;
  body: string;
  source: "ai" | "deterministic";
  generatedAt: string;
}

const FALLBACK: InsightDto = {
  headline: "Finance is steady",
  body: "No critical risks detected. Run a scan from the Needs Attention panel for the latest read.",
  source: "deterministic",
  generatedAt: new Date(0).toISOString(),
};

function internalApiBase(): string {
  return process.env.KEYFLOW_API_INTERNAL_URL?.trim() || "http://localhost:3001";
}

async function fetchInsightSSR(token: string, businessId: string): Promise<InsightDto> {
  const url = `${internalApiBase()}/finance/businesses/${encodeURIComponent(businessId)}/intelligence/insight`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return FALLBACK;
    const json = (await res.json()) as { data?: InsightDto } | InsightDto;
    const data = (json as { data?: InsightDto }).data ?? (json as InsightDto);
    if (!data?.headline) return FALLBACK;
    return data;
  } catch {
    return FALLBACK;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function FinanceIntelStripSSR() {
  const jar = await cookies();
  const token = jar.get("kf_token")?.value;
  const businessId = jar.get("kf_business_id")?.value;
  const strip = token && businessId ? await fetchInsightSSR(token, businessId) : FALLBACK;
  return (
    <div className="rounded-xl border border-primary/30 bg-gradient-to-r from-primary/5 to-transparent p-3.5">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 mt-0.5 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{strip.headline}</p>
            <span className="text-[10px] uppercase tracking-wide rounded-md px-1.5 py-0.5 bg-muted/60 text-muted-foreground">
              {strip.source === "ai" ? "AI" : "auto"}
            </span>
          </div>
          {strip.body && <p className="text-xs text-muted-foreground mt-0.5">{strip.body}</p>}
        </div>
      </div>
    </div>
  );
}
