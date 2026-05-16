"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Building2, Loader2, Sparkles, Users, Briefcase, Activity } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import {
  fetchAccountDetail,
  fetchAccountInsight,
  type AccountInsight,
} from "@/lib/client";
import { getStoredBusinessId, ensureWorkspace } from "@/lib/workspace";

function fmtMoney(value: number | null | undefined, currency: string = "TTD") {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-TT", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

type Detail = NonNullable<Awaited<ReturnType<typeof fetchAccountDetail>>["data"]>;

export default function AccountDetailPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params?.accountId;
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [insight, setInsight] = useState<AccountInsight | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const id = getStoredBusinessId() || (await ensureWorkspace());
      setBusinessId(id);
    })();
  }, []);

  const reload = useCallback(async () => {
    if (!businessId || !accountId) return;
    setLoading(true);
    try {
      const [d, ins] = await Promise.all([
        fetchAccountDetail(accountId, businessId),
        fetchAccountInsight(accountId, businessId),
      ]);
      if (d.data) setDetail(d.data);
      if (ins.data) setInsight(ins.data);
    } finally {
      setLoading(false);
    }
  }, [businessId, accountId]);

  useEffect(() => { reload(); }, [reload]);

  if (loading || !detail) {
    return (
      <div className="flex items-center justify-center py-24"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
    );
  }

  const { account, contacts, deals, recentEvents, rollup } = detail;
  const currency = rollup.currency;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        icon={Building2}
        title={account.name}
        subtitle={[account.domain, account.industry].filter(Boolean).join(" · ") || "Account"}
      />

      {/* Account Insight card — reuses InsightSnapshot v1 payload shape */}
      {insight && (
        <div className="mb-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-[hsl(var(--kf-accent2))]/15 flex items-center justify-center text-[hsl(var(--kf-accent2))]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm">Account Insight</h3>
                <span className="text-[10px] uppercase text-muted-foreground">v{insight.version}</span>
                {insight.tags.map((t) => (
                  <span key={t} className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">{t}</span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{insight.summary}</p>
              {insight.nextAction && (
                <p className="text-xs mt-2">
                  <span className="text-muted-foreground">Next action: </span>
                  {insight.nextAction.type ?? "follow-up"}
                  {insight.nextAction.dueAt && <> · due {new Date(insight.nextAction.dueAt).toLocaleDateString()}</>}
                  {insight.nextAction.title && <> · {insight.nextAction.title}</>}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rollup KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat icon={Users} label="Contacts" value={String(rollup.contactCount)} />
        <Stat icon={Briefcase} label="Open pipeline" value={fmtMoney(rollup.openDealValue, currency)} />
        <Stat icon={Activity} label="Lifetime revenue" value={fmtMoney(rollup.lifetimeRevenue, currency)} hint={`${rollup.winRate}% win rate`} />
        <Stat icon={Activity} label="Activity / mo" value={`${rollup.eventsPerMonth}`} hint={rollup.lastActivityAt ? `last ${new Date(rollup.lastActivityAt).toLocaleDateString()}` : "—"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contacts */}
        <Section title={`Contacts (${contacts.length})`}>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">No contacts linked.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full w-full text-sm">
                <tbody>
                  {contacts.map((c) => (
                  <tr key={c.id} className="border-t border-border first:border-0">
                    <td className="p-2">
                      <Link href={`/app/crm?contactId=${c.id}`} className="font-medium text-[hsl(var(--kf-accent2))] hover:underline">
                        {c.displayName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || "Contact"}
                      </Link>
                      {c.jobTitle && <div className="text-xs text-muted-foreground">{c.jobTitle}</div>}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{c.lifecycleStage ?? "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground text-right">{c.lastInteractionAt ? new Date(c.lastInteractionAt).toLocaleDateString() : "—"}</td>
                  </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Deals */}
        <Section title={`Deals (${deals.length})`}>
          {deals.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">No deals linked.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full w-full text-sm">
                <tbody>
                  {deals.map((d) => (
                  <tr key={d.id} className="border-t border-border first:border-0">
                    <td className="p-2">
                      <div className="font-medium">{d.title}</div>
                      <div className="text-xs text-muted-foreground">{d.stage?.name}</div>
                    </td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(d.value, d.currency)}</td>
                    <td className="p-2 text-xs uppercase">
                      <span className={`px-1.5 py-0.5 rounded ${d.status === "WON" ? "bg-emerald-500/15 text-emerald-500" : d.status === "LOST" ? "bg-red-500/15 text-red-500" : "bg-sky-500/15 text-sky-500"}`}>{d.status}</span>
                    </td>
                  </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Recent activity */}
        <Section title="Recent activity" className="lg:col-span-2">
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">No recent activity.</p>
          ) : (
            <ul className="text-sm divide-y divide-border">
              {recentEvents.slice(0, 20).map((e) => (
                <li key={e.id} className="p-2 flex items-center gap-2">
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground whitespace-nowrap">{e.type}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.contact.displayName || `${e.contact.firstName ?? ""} ${e.contact.lastName ?? ""}`.trim() || "—"}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">{new Date(e.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className="text-lg font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-card overflow-hidden ${className ?? ""}`}>
      <div className="p-3 border-b border-border text-sm font-semibold">{title}</div>
      <div>{children}</div>
    </div>
  );
}
