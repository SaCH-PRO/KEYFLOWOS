"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  TrendingUp,
  Clock,
  Users,
  Brain,
  Zap,
  ChevronRight,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Contact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  status?: string | null;
  leadScore?: number | null;
  relationshipHealth?: string | null;
  lastInteractionAt?: string | null;
  lastContactedAt?: string | null;
  _count?: { invoices?: number; bookings?: number; deals?: number };
}

type AtRiskContact = Contact & { daysSinceLastContact?: number | null };

function contactName(c: Contact): string {
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown";
}

function relativeDays(dateStr?: string | null): string {
  if (!dateStr) return "Never";
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function ScoreBadge({ score }: { score?: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  const color = score >= 80 ? "bg-emerald-500/15 text-emerald-400" : score >= 60 ? "bg-amber-500/15 text-amber-400" : score >= 40 ? "bg-blue-500/15 text-blue-400" : "bg-red-500/15 text-red-400";
  return <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", color)}>{score}</span>;
}

function HealthBadge({ health }: { health?: string | null }) {
  if (!health) return null;
  const colors: Record<string, string> = {
    HOT: "bg-rose-500/15 text-rose-400",
    WARM: "bg-orange-500/15 text-orange-400",
    COLD: "bg-blue-500/15 text-blue-400",
    DORMANT: "bg-slate-500/15 text-slate-400",
    AT_RISK: "bg-red-500/15 text-red-400",
  };
  return <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", colors[health] || "bg-muted text-muted-foreground")}>{health}</span>;
}

function ContactRow({ contact, onClick }: { contact: Contact; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors group"
    >
      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold text-muted-foreground shrink-0">
        {contact.firstName?.[0] || contact.email?.[0] || "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{contactName(contact)}</span>
          <HealthBadge health={contact.relationshipHealth} />
        </div>
        <div className="text-[11px] text-muted-foreground truncate">{contact.email}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ScoreBadge score={contact.leadScore} />
        <span className="text-[10px] text-muted-foreground w-16 text-right">{relativeDays(contact.lastInteractionAt || contact.lastContactedAt)}</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      </div>
    </button>
  );
}

function SectionCard({
  title,
  icon: Icon,
  iconColor,
  children,
  count,
}: {
  title: string;
  icon: typeof Activity;
  iconColor: string;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
          <span className="text-sm font-medium">{title}</span>
        </div>
        {count != null && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted font-medium">{count}</span>
        )}
      </div>
      <div className="p-2">{children}</div>
    </div>
  );
}

export default function ContactIntelligencePage() {
  const router = useRouter();
  const businessId = getStoredBusinessId();
  const [loading, setLoading] = useState(true);
  const [atRisk, setAtRisk] = useState<AtRiskContact[]>([]);
  const [topOpportunities, setTopOpportunities] = useState<Contact[]>([]);
  const [neglected, setNeglected] = useState<Contact[]>([]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [atRiskRes, topRes, neglectedRes] = await Promise.all([
          apiGet<AtRiskContact[]>(`/crm/businesses/${businessId}/relationship-health/at-risk?limit=20`),
          apiGet<{ contacts: Contact[] }>(`/crm/businesses/${businessId}/contacts?sortBy=score&sortOrder=desc&take=15&includeStats=true`),
          apiGet<{ contacts: Contact[] }>(`/crm/businesses/${businessId}/contacts?staleDays=30&sortBy=lastInteraction&sortOrder=asc&take=15&includeStats=true`),
        ]);
        if (!cancelled) {
          setAtRisk(Array.isArray(atRiskRes.data) ? atRiskRes.data : []);
          setTopOpportunities(topRes.data?.contacts ?? []);
          setNeglected(neglectedRes.data?.contacts ?? []);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [businessId]);

  const stats = useMemo(() => {
    const all = [...atRisk, ...topOpportunities, ...neglected];
    const unique = new Map(all.map((c) => [c.id, c]));
    const contacts = Array.from(unique.values());
    const avgScore = contacts.length > 0
      ? Math.round(contacts.reduce((s, c) => s + (c.leadScore ?? 50), 0) / contacts.length)
      : 0;
    const hot = contacts.filter((c) => c.relationshipHealth === "HOT").length;
    const atRiskCount = contacts.filter((c) => c.relationshipHealth === "AT_RISK" || c.relationshipHealth === "DORMANT").length;
    return { total: contacts.length, avgScore, hot, atRiskCount };
  }, [atRisk, topOpportunities, neglected]);

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Contact Intelligence" icon={Brain} iconColor="#F97316" />
        <ListPageSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contact Intelligence"
        icon={Brain}
        iconColor="#F97316"
        subtitle="Lead scores, churn risk, and next best actions"
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border/50 bg-card/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <Users className="w-3 h-3" /> Analyzed
          </div>
          <div className="text-lg font-semibold">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <TrendingUp className="w-3 h-3" /> Avg Score
          </div>
          <div className="text-lg font-semibold">{stats.avgScore}</div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <Zap className="w-3 h-3" /> Hot
          </div>
          <div className="text-lg font-semibold text-rose-400">{stats.hot}</div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <AlertTriangle className="w-3 h-3" /> At Risk
          </div>
          <div className="text-lg font-semibold text-red-400">{stats.atRiskCount}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* At-risk contacts */}
        <SectionCard
          title="At Risk"
          icon={AlertTriangle}
          iconColor="#EF4444"
          count={atRisk.length}
        >
          {atRisk.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">No at-risk contacts</div>
          ) : (
            <div className="flex flex-col gap-px max-h-[360px] overflow-y-auto">
              {atRisk.map((c) => (
                <ContactRow key={c.id} contact={c} onClick={() => router.push(`/app/crm/contacts/${c.id}`)} />
              ))}
            </div>
          )}
        </SectionCard>

        {/* Top opportunities */}
        <SectionCard
          title="Top Opportunities"
          icon={TrendingUp}
          iconColor="#22C55E"
          count={topOpportunities.length}
        >
          {topOpportunities.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">No scored contacts yet</div>
          ) : (
            <div className="flex flex-col gap-px max-h-[360px] overflow-y-auto">
              {topOpportunities.map((c) => (
                <ContactRow key={c.id} contact={c} onClick={() => router.push(`/app/crm/contacts/${c.id}`)} />
              ))}
            </div>
          )}
        </SectionCard>

        {/* Neglected contacts */}
        <SectionCard
          title="Neglected"
          icon={Clock}
          iconColor="#F59E0B"
          count={neglected.length}
        >
          {neglected.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">All contacts recently active</div>
          ) : (
            <div className="flex flex-col gap-px max-h-[360px] overflow-y-auto">
              {neglected.map((c) => (
                <ContactRow key={c.id} contact={c} onClick={() => router.push(`/app/crm/contacts/${c.id}`)} />
              ))}
            </div>
          )}
        </SectionCard>

        {/* Lead score distribution */}
        <SectionCard title="Score Distribution" icon={Activity} iconColor="#8B5CF6">
          <div className="p-3 space-y-2">
            {[
              { label: "Hot (80-100)", min: 80, color: "bg-emerald-500" },
              { label: "Warm (60-79)", min: 60, color: "bg-amber-500" },
              { label: "Neutral (40-59)", min: 40, color: "bg-blue-500" },
              { label: "Cool (20-39)", min: 20, color: "bg-orange-500" },
              { label: "Cold (0-19)", min: 0, color: "bg-red-500" },
            ].map((band) => {
              const all = [...atRisk, ...topOpportunities, ...neglected];
              const unique = Array.from(new Map(all.map((c) => [c.id, c])).values());
              const count = unique.filter((c) => {
                const s = c.leadScore ?? 0;
                return band.min === 80 ? s >= 80 : band.min === 60 ? s >= 60 && s < 80 : band.min === 40 ? s >= 40 && s < 60 : band.min === 20 ? s >= 20 && s < 40 : s < 20;
              }).length;
              const pct = unique.length > 0 ? Math.round((count / unique.length) * 100) : 0;
              return (
                <div key={band.label} className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0">{band.label}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", band.color)} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] font-medium w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
