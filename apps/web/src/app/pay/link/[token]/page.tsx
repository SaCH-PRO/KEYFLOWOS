"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, API_BASE } from "@/lib/api";
import { Loader2, LinkIcon } from "lucide-react";
import { PublicPageState } from "@/components/ui/public-page-state";
import { initPresence, trackPageView } from "@/app/_lib/presence-sdk";

export default function PaymentLinkPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [error, setError] = useState<string | null>(null);

  const resolve = async () => {
    setError(null);
    const res = await apiGet<{ invoiceId: string; active: boolean; expiresAt: string | null }>(
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

    router.replace(`/pay/${res.data.invoiceId}`);
  };

  useEffect(() => {
    initPresence({ apiBase: API_BASE });
    // We don't yet know the businessId on this redirect page — pass
    // empty so the server resolves it from the /pay/link/<token>
    // Referer URL. Fires before the redirect so the visit isn't lost.
    trackPageView("");
    resolve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) {
    return (
      <PublicPageState
        variant="error"
        title="Payment Link Error"
        message={`${error} Please contact the business for a new payment link.`}
        retry={resolve}
      />
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
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
