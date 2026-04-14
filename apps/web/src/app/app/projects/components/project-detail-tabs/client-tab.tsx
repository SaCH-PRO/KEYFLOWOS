"use client";

import { useEffect, useState } from "react";
import {
  User, ExternalLink, Mail, Phone, Building, Tag,
  Calendar, TrendingUp, Globe, Briefcase, Clock,
  MessageSquare, Star,
} from "lucide-react";
import { fetchContactDetail } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

interface ClientTabProps {
  contactId?: string;
}

interface ClientData {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  status?: string;
  tags?: string[];
  lifecycleStage?: string | null;
  leadScore?: number | null;
  lastInteractionAt?: string | null;
  source?: string | null;
  city?: string | null;
  country?: string | null;
  preferredChannel?: string | null;
  createdAt?: string;
}

export function ClientTab({ contactId }: ClientTabProps) {
  const [client, setClient] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contactId) return;
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchContactDetail(contactId, businessId, { signal: ctrl.signal })
      .then((res) => {
        if (res.data?.contact) {
          const contact = res.data.contact;
          const meta = res.data.meta;
          setClient({
            ...contact,
            leadScore: meta?.leadScore ?? contact.leadScore ?? null,
            lastInteractionAt: meta?.lastInteractionAt ?? contact.lastInteractionAt ?? null,
          } as ClientData);
        } else if (res.error) {
          setError(res.error);
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setError("Failed to load client data");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [contactId]);

  if (!contactId) {
    return (
      <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
        <User className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">No client linked</p>
        <p className="text-xs text-muted-foreground mt-1">Link a client to this project to track deliverables against their account.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border/40 bg-card p-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-muted/30" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 bg-muted/30 rounded" />
              <div className="h-3 w-48 bg-muted/20 rounded" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/40 bg-card p-3 animate-pulse">
              <div className="h-3 w-16 bg-muted/20 rounded mb-2" />
              <div className="h-4 w-24 bg-muted/30 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 rounded-xl border border-border/40 bg-card">
        <User className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">Could not load client</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center py-8 rounded-xl border border-border/40 bg-card">
        <User className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">Client data unavailable</p>
        <p className="text-xs text-muted-foreground mt-1">Could not load client profile. Try refreshing the page.</p>
      </div>
    );
  }

  const displayName = [client.firstName, client.lastName].filter(Boolean).join(" ") || client.email || "Unknown";
  const initials = [client.firstName?.[0], client.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?";
  const tags = client.tags ?? [];

  const statusColors: Record<string, { color: string; bg: string }> = {
    LEAD: { color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.1)" },
    ACTIVE: { color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.1)" },
    CLIENT: { color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.1)" },
    PROSPECT: { color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.1)" },
    INACTIVE: { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.3)" },
  };
  const statusStyle = statusColors[client.status ?? ""] ?? statusColors.LEAD;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/40 bg-card p-4">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: "hsl(var(--kf-info) / 0.1)", color: "hsl(var(--kf-info))" }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold truncate">{displayName}</h3>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold shrink-0 uppercase"
                style={{ background: statusStyle.bg, color: statusStyle.color }}
              >
                {client.status || "Lead"}
              </span>
            </div>
            {(client.jobTitle || client.companyName) && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {[client.jobTitle, client.companyName].filter(Boolean).join(" at ")}
              </p>
            )}
          </div>
          <a
            href={`/app/crm/contacts/${contactId}`}
            className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors shrink-0"
            style={{ background: "hsl(var(--kf-info) / 0.1)", color: "hsl(var(--kf-info))" }}
          >
            <ExternalLink className="w-3 h-3" />
            Full Profile
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <InfoCard icon={Mail} label="Email" value={client.email || "Not set"} linked={!!client.email} />
        <InfoCard icon={Phone} label="Phone" value={client.phone || "Not set"} linked={!!client.phone} />
        <InfoCard icon={Building} label="Company" value={client.companyName || "Not set"} linked={!!client.companyName} />
        <InfoCard icon={Globe} label="Location" value={[client.city, client.country].filter(Boolean).join(", ") || "Not set"} linked={!!(client.city || client.country)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Relationship Context</h4>
          <div className="space-y-2">
            <DetailRow icon={Star} label="Lead Score" value={client.leadScore != null ? String(client.leadScore) : "—"} color={client.leadScore != null && client.leadScore >= 70 ? "hsl(var(--kf-success))" : "hsl(var(--muted-foreground))"} />
            <DetailRow icon={TrendingUp} label="Lifecycle" value={client.lifecycleStage || "—"} />
            <DetailRow icon={Briefcase} label="Source" value={client.source || "—"} />
            <DetailRow icon={MessageSquare} label="Preferred Channel" value={client.preferredChannel || "—"} />
            <DetailRow
              icon={Clock}
              label="Last Interaction"
              value={client.lastInteractionAt ? new Date(client.lastInteractionAt).toLocaleDateString() : "—"}
            />
            <DetailRow
              icon={Calendar}
              label="Client Since"
              value={client.createdAt ? new Date(client.createdAt).toLocaleDateString() : "—"}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tags & Segments</h4>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-2 py-0.5 rounded-md inline-flex items-center gap-1"
                  style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
                >
                  <Tag className="w-2.5 h-2.5" />
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No tags assigned to this client.</p>
          )}

          <div className="pt-2 border-t border-border/30 space-y-2">
            <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Quick Actions</h5>
            <div className="flex flex-wrap gap-2">
              <a
                href={`/app/crm/contacts/${contactId}?tab=communications`}
                className="text-[10px] px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-colors"
                style={{ background: "hsl(var(--muted) / 0.2)", color: "hsl(var(--muted-foreground))" }}
              >
                <MessageSquare className="w-3 h-3" />
                Messages
              </a>
              <a
                href={`/app/crm/contacts/${contactId}?tab=invoices`}
                className="text-[10px] px-2.5 py-1 rounded-lg inline-flex items-center gap-1 transition-colors"
                style={{ background: "hsl(var(--muted) / 0.2)", color: "hsl(var(--muted-foreground))" }}
              >
                <Briefcase className="w-3 h-3" />
                Invoices
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value, linked }: { icon: React.ElementType; label: string; value: string; linked: boolean }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3" style={{ color: linked ? "hsl(var(--kf-accent2))" : "hsl(var(--muted-foreground) / 0.4)" }} />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-xs font-medium truncate ${linked ? "" : "text-muted-foreground/50"}`}>{value}</p>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground inline-flex items-center gap-1.5">
        <Icon className="w-3 h-3" />
        {label}
      </span>
      <span className="font-medium capitalize" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}
