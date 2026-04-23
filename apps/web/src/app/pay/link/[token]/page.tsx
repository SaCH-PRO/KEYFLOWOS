"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { Loader2, AlertCircle, LinkIcon } from "lucide-react";

export default function PaymentLinkPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const resolve = async () => {
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

    resolve();
  }, [token, router]);

  if (error) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-white/[0.04] backdrop-blur-xl p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-red-400">Payment Link Error</h1>
          <p className="text-sm text-slate-400">{error}</p>
          <p className="text-xs text-slate-500">Contact the business for a new payment link.</p>
        </div>
      </main>
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
