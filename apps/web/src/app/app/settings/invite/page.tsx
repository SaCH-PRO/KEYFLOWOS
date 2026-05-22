"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Gift, Copy, CheckCircle2, Users, Link2, Share2, Loader2 } from "lucide-react";
import { API_BASE, getAuthHeaders } from "@/lib/api";

interface ReferralData {
  code: string | null;
  link: string;
  referrals: number;
  referredBy: string | null;
}

export default function InvitePage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchReferral = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/identity/referral`, {
        headers: getAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load referral data");
      const json: ReferralData = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReferral();
  }, [fetchReferral]);

  const handleCopy = useCallback(() => {
    if (!data?.link) return;
    navigator.clipboard.writeText(data.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data?.link]);

  const handleShare = useCallback(() => {
    if (!data?.link) return;
    const text = `I'm using KeyFlowOS to run my business on autopilot. Join me! ${data.link}`;
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, "_blank");
  }, [data?.link]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white">
            <Gift className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Invite & Earn</h2>
            <p className="text-sm text-muted-foreground">
              Share KeyFlowOS with other entrepreneurs and earn rewards.
            </p>
          </div>
        </div>

        {data?.code ? (
          <div className="space-y-5">
            {/* Referral Link Card */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                Your personal referral link
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2.5 bg-white/[0.03] border border-white/[0.08]">
                  <Link2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-mono text-foreground truncate">{data.link}</span>
                </div>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.07] transition-all"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={handleShare}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white hover:brightness-110 transition-all"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-[hsl(var(--kf-accent1))/0.1] flex items-center justify-center">
                  <Users className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.referrals}</p>
                  <p className="text-xs text-muted-foreground">Successful referrals</p>
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Gift className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.referrals * 50}</p>
                  <p className="text-xs text-muted-foreground">AI credits earned</p>
                </div>
              </div>
            </div>

            {/* How it works */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
              <h3 className="text-sm font-semibold mb-3">How it works</h3>
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-[hsl(var(--kf-accent1))] font-bold">1.</span>
                  Share your link with fellow entrepreneurs.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[hsl(var(--kf-accent1))] font-bold">2.</span>
                  They sign up and create their workspace.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[hsl(var(--kf-accent1))] font-bold">3.</span>
                  You both get 50 AI credits when they complete onboarding.
                </li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="text-center py-10">
            <p className="text-sm text-muted-foreground">
              Referral data unavailable. Try refreshing the page.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
