import { getApiBase } from "@/lib/api-base";
import { notFound } from "next/navigation";
import PresenceRenderer from "../../_components/presence-renderer";

const API_BASE = getApiBase();

type Props = { params: Promise<{ token: string }> };

async function fetchPreview(token: string) {
  try {
    const res = await fetch(`${API_BASE}/site/presence/preview/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export default async function PresencePreviewPage({ params }: Props) {
  const { token } = await params;
  const data = await fetchPreview(token);
  if (!data) notFound();
  return (
    <div>
      <div className="bg-amber-500 text-amber-950 text-center text-xs py-1.5 font-semibold">
        Preview mode — this is a private link of an unpublished draft. Expires in 24 hours.
      </div>
      <PresenceRenderer business={data.business} payload={data.payload} preview />
    </div>
  );
}

export const dynamic = "force-dynamic";
