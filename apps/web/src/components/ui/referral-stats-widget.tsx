"use client";

import { useState, useEffect } from "react";
import { apiGet } from "@/lib/api";
import { Gift, Users, DollarSign, Copy, CheckCircle2 } from "lucide-react";

interface ReferralStats {
  referralCode?: string;
  rewardsEarned: number;
  rewardBalance: number;
  referredCount: number;
  currency: string;
}

interface Props {
  businessId: string;
  contactId: string;
}

export function ReferralStatsWidget({ businessId, contactId }: Props) {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!businessId || !contactId) return;
    apiGet<ReferralStats>(`/conversion/businesses/${businessId}/contacts/${contactId}/referral-stats`)
      .then((res) => {
        if (res.data) setStats(res.data);
      })
      .catch(() => {});
  }, [businessId, contactId]);

  if (!stats) return null;

  const copyCode = () => {
    if (!stats.referralCode) return;
    navigator.clipboard.writeText(stats.referralCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-xl border border-border/40 bg-background/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Gift className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        <h3 className="text-sm font-semibold">Referral Program</h3>
      </div>

      {stats.referralCode && (
        <button
          onClick={copyCode}
          className="w-full flex items-center justify-between p-2.5 rounded-lg border border-border/30 bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <span className="text-sm font-mono">{stats.referralCode}</span>
          {copied ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <Copy className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 rounded-lg bg-muted/20">
          <div className="text-lg font-bold">{stats.referredCount}</div>
          <div className="text-[10px] text-muted-foreground">Referred</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/20">
          <div className="text-lg font-bold">{stats.rewardsEarned}</div>
          <div className="text-[10px] text-muted-foreground">Rewards</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/20">
          <div className="text-lg font-bold">{stats.currency} {stats.rewardBalance}</div>
          <div className="text-[10px] text-muted-foreground">Balance</div>
        </div>
      </div>
    </div>
  );
}
