"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, Gift, Loader2, MessageCircle, Share2 } from "lucide-react";
import { apiPost } from "@/lib/api";

/**
 * S5 — Customer referral surface (`/me/refer`).
 *
 * A customer who has a confirmed booking or paid order on a storefront
 * lands here from a transactional email or order-confirmation deep
 * link. They enter their email + the storefront slug to mint their
 * personal referral link.
 *
 * The link routes to `/site/<slug>?ref=<code>`. The presence-event SDK
 * captures `?ref=` on landing, persists it on the visitor cookie, and
 * the server propagates the code onto any contact created during the
 * subsequent intake / checkout / qualification flow.
 */
type ReferralResponse = {
  business: { id: string; name: string; slug: string; logoUrl?: string | null; primaryColor?: string | null };
  code: string;
  shareUrl: string;
  stats: { completedBookings: number; paidOrders: number };
};

function ReferContent() {
  const params = useSearchParams();
  const initialSlug = params.get("slug") ?? "";
  const initialEmail = params.get("email") ?? "";

  const [slug, setSlug] = useState(initialSlug);
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReferralResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const absoluteUrl = useMemo(() => {
    if (!result || typeof window === "undefined") return "";
    try {
      return new URL(result.shareUrl, window.location.origin).toString();
    } catch {
      return result.shareUrl;
    }
  }, [result]);

  // Auto-submit when the user lands with both `?slug=` and `?email=`
  // pre-filled (e.g. from a transactional email's deep-link).
  useEffect(() => {
    if (initialSlug && initialEmail && !result && !submitting) {
      void mint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mint() {
    if (!slug.trim() || !email.trim()) {
      setError("Both the storefront name and your email are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await apiPost<ReferralResponse>({
      path: `/site/storefront/public/${encodeURIComponent(slug.trim())}/customer-referral`,
      body: { email: email.trim() },
    });
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    if (data) setResult(data);
  }

  async function copyLink() {
    if (!absoluteUrl) return;
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const whatsappHref = absoluteUrl
    ? `https://wa.me/?text=${encodeURIComponent(`I love ${result?.business.name}! Check them out — ${absoluteUrl}`)}`
    : "#";

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-teal-50 px-4 py-10 sm:py-16">
      <div className="max-w-md mx-auto">
        <div className="rounded-3xl bg-white shadow-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-8 text-center bg-gradient-to-br from-orange-500 to-amber-500 text-white">
            <Gift className="w-10 h-10 mx-auto mb-2 opacity-90" />
            <h1 className="text-xl font-bold tracking-tight">Refer a friend</h1>
            <p className="text-sm opacity-90 mt-1">
              Verified customers can share a personal link.
            </p>
          </div>

          <div className="p-6 space-y-4">
            {!result ? (
              <>
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-600 mb-1">Storefront name (slug)</span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="e.g. trinidad-catering"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-orange-500 focus:outline-none text-sm"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-600 mb-1">Your email (the one used to book/order)</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-orange-500 focus:outline-none text-sm"
                  />
                </label>
                {error ? (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
                ) : null}
                <button
                  onClick={mint}
                  disabled={submitting}
                  className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                  Generate my link
                </button>
                <p className="text-[11px] text-slate-500 text-center">
                  Only customers with a confirmed booking or paid order can refer.
                </p>
              </>
            ) : (
              <>
                <div className="text-center pb-2">
                  {result.business.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.business.logoUrl} alt="" className="w-12 h-12 mx-auto mb-2 rounded-xl" />
                  ) : null}
                  <p className="text-sm font-semibold text-slate-700">{result.business.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {result.stats.completedBookings + result.stats.paidOrders} verified transaction{result.stats.completedBookings + result.stats.paidOrders === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 break-all font-mono">
                  {absoluteUrl || result.shareUrl}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={copyLink}
                    className="flex-1 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copied" : "Copy link"}
                  </button>
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2 rounded-lg bg-[#25D366] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90"
                  >
                    <MessageCircle className="w-4 h-4" />
                    WhatsApp
                  </a>
                </div>
                <button
                  onClick={() => { setResult(null); setError(null); }}
                  className="w-full text-[11px] text-slate-500 hover:text-slate-700 underline pt-1"
                >
                  Generate a different link
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-slate-400 mt-4">
          Powered by KeyFlow
        </p>
      </div>
    </main>
  );
}

export default function MeReferPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>}>
      <ReferContent />
    </Suspense>
  );
}
