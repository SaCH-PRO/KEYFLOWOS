"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { Loader2, LinkIcon } from "lucide-react";
import { PublicPageState } from "@/components/ui/public-page-state";
import { PresenceTracker } from "@/app/_lib/PresenceTracker";

export default function PaymentLinkPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [error, setError] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);

  const resolve = async () => {
    setError(null);
    const res = await apiGet<{ invoiceId: string; businessId?: string; active: boolean; expiresAt: string | null }>(
      `/commerce/payment-links/${encodeURIComponent(token)}`
    );

    if (res.error || !res.data) {
      setError("This payment link is invalid or has expired.");
      return;
    }

    if (!res.data.active) {
      setError("This payment link has been deactivated.");
      return;
    }

    if (res.data.expiresAt && new Date(res.data.expiresAt) < new Date()) {
      setError("This payment link has expired.");
      return;
    }

    if (res.data.businessId) setBusinessId(res.data.businessId);
    router.replace(`/pay/${res.data.invoiceId}`);
  };

  useEffect(() => {
    resolve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // `emitWhenUnknown` makes the tracker fire one page_view with an empty
  // businessId so the server resolves it from the /pay/link/<token>
  // Referer URL. Once the resolve API returns a real businessId, the
  // tracker's per-(businessId,pathname) dedupe key changes and fires
  // exactly one more attributed page_view — no duplicates per id.
  const tracker = <PresenceTracker businessId={businessId} emitWhenUnknown />;

  if (error) {
    return (
      <>
        {tracker}
        <PublicPageState
          variant="error"
          title="Payment Link Error"
          message={`${error} Please contact the business for a new payment link.`}
          retry={resolve}
        />
      </>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
      {tracker}
      <div className="text-center space-y-4">
        <div className="relative">
          <Loader2 className="w-10 h-10 animate-spin mx-auto text-orange-400" />
          <LinkIcon className="w-4 h-4 text-orange-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <p className="text-sm text-slate-400">Resolving payment link...</p>
      </div>
    </main>
  );
}
