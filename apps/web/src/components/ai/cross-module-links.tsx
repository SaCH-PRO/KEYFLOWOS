"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Calendar, FolderKanban, ExternalLink } from "lucide-react";
import { fetchCrossModuleLinks, type CrossModuleLinks as CrossModuleLinksData } from "@/lib/client";

interface CrossModuleLinksProps {
  businessId: string | null;
  entityType: string;
  entityId: string;
  className?: string;
}

const STATUS_COLORS: Record<string, string> = {
  PAID: "text-emerald-400",
  SENT: "text-blue-400",
  OVERDUE: "text-red-400",
  DRAFT: "text-muted-foreground",
  CONFIRMED: "text-emerald-400",
  COMPLETED: "text-emerald-400",
  CANCELLED: "text-red-400/60",
  PENDING: "text-amber-400",
  ACTIVE: "text-emerald-400",
  IN_PROGRESS: "text-blue-400",
};

export function CrossModuleEntityLinks({ businessId, entityType, entityId, className = "" }: CrossModuleLinksProps) {
  const router = useRouter();
  const [links, setLinks] = useState<CrossModuleLinksData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!businessId || !entityId) return;
    setLoading(true);
    fetchCrossModuleLinks(businessId, entityType, entityId)
      .then((res) => { if (res.data) setLinks(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, entityType, entityId]);

  if (loading || !links) return null;

  const hasAny = links.invoices.length > 0 || links.bookings.length > 0 || links.projects.length > 0;
  if (!hasAny) return null;

  return (
    <div className={`rounded-xl border border-border/30 bg-card/50 overflow-hidden ${className}`}>
      <div className="px-3 py-2 border-b border-border/20">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          Related Across Modules
        </span>
      </div>
      <div className="p-2 space-y-1">
        {links.invoices.length > 0 && (
          <LinkSection
            icon={FileText}
            label="Invoices"
            items={links.invoices.map((inv) => ({
              id: inv.id,
              primary: `#${inv.number}`,
              secondary: `TTD ${inv.amount.toLocaleString()}`,
              status: inv.status,
              onClick: () => router.push(`/app/commerce?tab=invoices&id=${inv.id}`),
            }))}
          />
        )}
        {links.bookings.length > 0 && (
          <LinkSection
            icon={Calendar}
            label="Bookings"
            items={links.bookings.map((b) => ({
              id: b.id,
              primary: b.service,
              secondary: b.date ? new Date(b.date).toLocaleDateString() : "",
              status: b.status,
              onClick: () => router.push("/app/bookings"),
            }))}
          />
        )}
        {links.projects.length > 0 && (
          <LinkSection
            icon={FolderKanban}
            label="Projects"
            items={links.projects.map((p) => ({
              id: p.id,
              primary: p.name,
              secondary: "",
              status: p.status,
              onClick: () => router.push("/app/projects"),
            }))}
          />
        )}
      </div>
    </div>
  );
}

function LinkSection({
  icon: Icon,
  label,
  items,
}: {
  icon: React.ElementType;
  label: string;
  items: Array<{ id: string; primary: string; secondary: string; status: string; onClick: () => void }>;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-1 py-1">
        <Icon className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40">{label}</span>
      </div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={item.onClick}
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/10 transition-colors group text-left"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[11px] text-foreground/90 truncate">{item.primary}</span>
              {item.secondary && (
                <span className="text-[10px] text-muted-foreground/50 truncate">{item.secondary}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`text-[9px] font-medium ${STATUS_COLORS[item.status] || "text-muted-foreground/50"}`}>
                {item.status}
              </span>
              <ExternalLink className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
