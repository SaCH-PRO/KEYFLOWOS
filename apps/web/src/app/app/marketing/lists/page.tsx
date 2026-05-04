"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Users, Send, RefreshCw, Plug, Megaphone, X, Tag, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import {
  fetchMarketingLists,
  pushContactsToMarketingList,
  fetchMarketingCampaigns,
  triggerMarketingCampaign,
  type MarketingList,
  type MarketingCampaign,
  type MarketingProvider,
} from "@/lib/client";

const PROVIDER_LABEL: Record<MarketingProvider, string> = {
  mailchimp: "Mailchimp",
  klaviyo: "Klaviyo",
};

export default function MarketingListsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [providers, setProviders] = useState<MarketingProvider[]>([]);
  const [lists, setLists] = useState<MarketingList[]>([]);
  const [errors, setErrors] = useState<Array<{ provider: MarketingProvider; error: string }>>([]);
  const [pushDialog, setPushDialog] = useState<MarketingList | null>(null);
  const [segmentTag, setSegmentTag] = useState("");
  const [segmentStatus, setSegmentStatus] = useState("");
  const [optInOnly, setOptInOnly] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [campaigns, setCampaigns] = useState<Record<MarketingProvider, MarketingCampaign[]>>({ mailchimp: [], klaviyo: [] });
  const [triggering, setTriggering] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const fresh = await refreshWorkspace();
      const id = fresh ?? getStoredBusinessId();
      if (id) setBusinessId(id);
    })();
  }, []);

  const loadLists = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await fetchMarketingLists(businessId);
    if (res.data) {
      setConnected(res.data.connected);
      setProviders(res.data.providers);
      setLists(res.data.lists);
      setErrors(res.data.errors ?? []);
    }
    setLoading(false);
  }, [businessId]);

  const loadCampaigns = useCallback(async (provs: MarketingProvider[]) => {
    if (!businessId) return;
    const next: Record<MarketingProvider, MarketingCampaign[]> = { mailchimp: [], klaviyo: [] };
    await Promise.all(
      provs.map(async (p) => {
        const res = await fetchMarketingCampaigns(p, businessId);
        if (res.data) next[p] = res.data.campaigns;
      }),
    );
    setCampaigns(next);
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    void loadLists();
  }, [businessId, loadLists]);

  useEffect(() => {
    if (providers.length > 0) void loadCampaigns(providers);
  }, [providers, loadCampaigns]);

  const handlePush = async () => {
    if (!pushDialog) return;
    setPushing(true);
    const res = await pushContactsToMarketingList(
      {
        provider: pushDialog.provider,
        listId: pushDialog.id,
        segment: {
          tag: segmentTag.trim() || undefined,
          status: segmentStatus.trim() || undefined,
          marketingOptIn: optInOnly ? true : undefined,
        },
      },
      businessId ?? undefined,
    );
    setPushing(false);
    if (res.error || !res.data) {
      toast.error(res.error || "Failed to push contacts");
      return;
    }
    const { created, updated, failed, total } = res.data;
    if (total === 0) toast.info("No contacts matched the segment");
    else if (failed === 0) toast.success(`${created} added, ${updated} updated in ${pushDialog.name}`);
    else toast.warning(`${created} added, ${updated} updated, ${failed} failed`);
    setPushDialog(null);
    void loadLists();
  };

  const handleTrigger = async (provider: MarketingProvider, c: MarketingCampaign) => {
    if (!confirm(`Send campaign "${c.name}" via ${PROVIDER_LABEL[provider]}?`)) return;
    setTriggering(c.id);
    const res = await triggerMarketingCampaign(provider, c.id, businessId ?? undefined);
    setTriggering(null);
    if (res.error) toast.error(res.error);
    else toast.success(`Campaign "${c.name}" triggered`);
    void loadCampaigns(providers);
  };

  const totalMembers = useMemo(() => lists.reduce((s, l) => s + (l.memberCount || 0), 0), [lists]);

  const statusHeader = (
    <div className="kf-card kf-radius-lg p-4 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 kf-radius-md flex items-center justify-center"
          style={{ background: connected ? "color-mix(in srgb, hsl(var(--kf-success)) 18%, transparent)" : "color-mix(in srgb, hsl(var(--kf-muted-foreground)) 14%, transparent)" }}
        >
          {connected ? (
            <CheckCircle2 className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
          ) : (
            <Plug className="w-5 h-5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
          )}
        </div>
        <div>
          <div className="text-sm font-medium kf-text-foreground">
            {connected ? `Connected: ${providers.map((p) => PROVIDER_LABEL[p]).join(", ")}` : "No marketing provider connected"}
          </div>
          <div className="text-xs kf-text-muted-foreground">
            {connected ? `${lists.length} list${lists.length === 1 ? "" : "s"} • ${totalMembers.toLocaleString()} members` : "Connect Mailchimp or Klaviyo to sync your lists and campaigns"}
          </div>
        </div>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => { void loadLists(); void loadCampaigns(providers); }}
        className="kf-btn-secondary h-8 px-3 text-xs inline-flex items-center gap-1"
        disabled={loading}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
      </button>
    </div>
  );

  return (
    <WorkspaceShell
      icon={Mail}
      title="Marketing lists"
      subtitle="Sync contacts and trigger campaigns in Mailchimp or Klaviyo"
      banners={statusHeader}
    >
      {!connected && !loading && (
        <SectionCard>
          <EmptyState
            icon={Plug}
            title="Connect a marketing provider"
            description="Link Mailchimp or Klaviyo to push your contacts to lists and trigger campaigns directly from Keyflow."
            actionLabel="Connect provider"
            onAction={() => { window.location.href = "/app/integrations?category=marketing"; }}
            tip="Available providers: Mailchimp, Klaviyo"
          />
        </SectionCard>
      )}

      {connected && (
        <SectionCard title="Lists" subtitle={`${lists.length} across ${providers.length} provider${providers.length === 1 ? "" : "s"}`} icon={Users} noPadding>
          {loading ? (
            <div className="p-8 text-center text-sm kf-text-muted-foreground">Loading lists…</div>
          ) : lists.length === 0 ? (
            <div className="p-8">
              <EmptyState icon={Users} title="No lists found" description="Create a list in your provider, then refresh." variant="compact" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider kf-text-muted-foreground border-b" style={{ borderColor: "hsl(var(--kf-border))" }}>
                    <th className="px-4 py-2 text-left">List</th>
                    <th className="px-4 py-2 text-left">Provider</th>
                    <th className="px-4 py-2 text-right">Members</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lists.map((l) => (
                    <tr key={`${l.provider}:${l.id}`} className="border-b" style={{ borderColor: "hsl(var(--kf-border))" }}>
                      <td className="px-4 py-2 kf-text-foreground font-medium">{l.name}</td>
                      <td className="px-4 py-2 kf-text-muted-foreground">{PROVIDER_LABEL[l.provider]}</td>
                      <td className="px-4 py-2 text-right kf-text-foreground">{(l.memberCount || 0).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => { setPushDialog(l); setSegmentTag(""); setSegmentStatus(""); setOptInOnly(true); }}
                          className="kf-btn-secondary h-8 px-3 text-xs inline-flex items-center gap-1"
                        >
                          <Send className="w-3.5 h-3.5" /> Push contacts
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {errors.length > 0 && (
            <div className="p-4 border-t text-xs" style={{ borderColor: "hsl(var(--kf-border))", color: "hsl(var(--kf-destructive))" }}>
              {errors.map((e, i) => (
                <div key={i}>{PROVIDER_LABEL[e.provider]}: {e.error}</div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {connected && providers.map((p) => (
        <SectionCard key={p} title={`${PROVIDER_LABEL[p]} campaigns`} subtitle={`${campaigns[p].length} campaign${campaigns[p].length === 1 ? "" : "s"}`} icon={Megaphone} noPadding>
          {campaigns[p].length === 0 ? (
            <div className="p-6 text-sm kf-text-muted-foreground">No campaigns available.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider kf-text-muted-foreground border-b" style={{ borderColor: "hsl(var(--kf-border))" }}>
                    <th className="px-4 py-2 text-left">Campaign</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-right">Sent</th>
                    <th className="px-4 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns[p].map((c) => {
                    const canTrigger = ["draft", "scheduled", "save", "ready"].some((s) => (c.status || "").toLowerCase().includes(s));
                    return (
                      <tr key={c.id} className="border-b" style={{ borderColor: "hsl(var(--kf-border))" }}>
                        <td className="px-4 py-2 kf-text-foreground font-medium">{c.name}</td>
                        <td className="px-4 py-2 kf-text-muted-foreground">{c.status}</td>
                        <td className="px-4 py-2 text-right kf-text-muted-foreground">{(c.emailsSent ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void handleTrigger(p, c)}
                            disabled={!canTrigger || triggering === c.id}
                            className="kf-btn-primary h-8 px-3 text-xs inline-flex items-center gap-1 disabled:opacity-50"
                          >
                            <Send className="w-3.5 h-3.5" /> {triggering === c.id ? "Sending…" : "Trigger"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ))}

      {pushDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="kf-card kf-radius-lg w-full max-w-md p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-semibold kf-text-foreground">Push contacts to {pushDialog.name}</h3>
                <p className="text-xs kf-text-muted-foreground">Provider: {PROVIDER_LABEL[pushDialog.provider]}</p>
              </div>
              <button onClick={() => setPushDialog(null)} className="kf-btn-secondary h-7 w-7 p-0" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs kf-text-muted-foreground">
                Tag (optional)
                <div className="mt-1 flex items-center gap-2 kf-input kf-radius-md px-2 h-9">
                  <Tag className="w-3.5 h-3.5 kf-text-muted-foreground" />
                  <input
                    type="text"
                    value={segmentTag}
                    onChange={(e) => setSegmentTag(e.target.value)}
                    placeholder="e.g. vip"
                    className="flex-1 bg-transparent outline-none text-sm kf-text-foreground"
                  />
                </div>
              </label>
              <label className="block text-xs kf-text-muted-foreground">
                Status (optional)
                <input
                  type="text"
                  value={segmentStatus}
                  onChange={(e) => setSegmentStatus(e.target.value)}
                  placeholder="e.g. lead, customer"
                  className="mt-1 kf-input kf-radius-md px-3 h-9 w-full text-sm kf-text-foreground bg-transparent"
                />
              </label>
              <label className="flex items-center gap-2 text-sm kf-text-foreground">
                <input type="checkbox" checked={optInOnly} onChange={(e) => setOptInOnly(e.target.checked)} />
                Only opted-in contacts
              </label>
              <p className="text-xs kf-text-muted-foreground">Contacts without an email or who are marked do-not-contact are always excluded.</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPushDialog(null)} className="kf-btn-secondary h-9 px-3 text-sm">Cancel</button>
              <button
                onClick={handlePush}
                disabled={pushing}
                className="kf-btn-primary h-9 px-4 text-sm inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> {pushing ? "Pushing…" : "Push contacts"}
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
