"use client";

import { useEffect, useMemo, useState } from "react";
import { LifeBuoy, Plus, X, Trash2, AlertCircle, Clock, CheckCircle2, PauseCircle, Loader2 } from "lucide-react";
import {
  SupportTicket,
  fetchSupportTickets,
  createSupportTicket,
  updateSupportTicket,
  deleteSupportTicket,
  fetchOrgUnits,
  OrgUnit,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  OPEN: { label: "Open", color: "text-emerald-400", bg: "bg-emerald-500/10", icon: AlertCircle },
  IN_PROGRESS: { label: "In Progress", color: "text-amber-400", bg: "bg-amber-500/10", icon: Loader2 },
  WAITING: { label: "Waiting", color: "text-blue-400", bg: "bg-blue-500/10", icon: PauseCircle },
  RESOLVED: { label: "Resolved", color: "text-violet-400", bg: "bg-violet-500/10", icon: CheckCircle2 },
  CLOSED: { label: "Closed", color: "text-muted-foreground", bg: "bg-muted/30", icon: CheckCircle2 },
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "text-muted-foreground",
  NORMAL: "text-foreground",
  HIGH: "text-amber-400",
  URGENT: "text-red-400",
};

export default function HelpdeskPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState("NORMAL");
  const [filter, setFilter] = useState<string>("ALL");
  const [orgUnitFilter, setOrgUnitFilter] = useState("");
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);

  const businessId = getStoredBusinessId();

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await fetchSupportTickets(businessId);
    if (res.data) setTickets(res.data);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!businessId) return;
      const [ticketsRes, orgUnitsRes] = await Promise.all([
        fetchSupportTickets(businessId, orgUnitFilter || undefined),
        fetchOrgUnits(businessId).catch(() => ({ data: null, error: null })),
      ]);
      if (!cancelled && ticketsRes.data) setTickets(ticketsRes.data);
      if (!cancelled && orgUnitsRes.data) setOrgUnits(orgUnitsRes.data);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId, orgUnitFilter]);

  const handleCreate = async () => {
    if (!businessId || !newTitle.trim()) return;
    const res = await createSupportTicket(businessId, {
      title: newTitle.trim(),
      description: newDescription || undefined,
      priority: newPriority,
    });
    if (res.data) {
      setTickets((prev) => [res.data as SupportTicket, ...prev]);
      setNewTitle("");
      setNewDescription("");
      setNewPriority("NORMAL");
      setShowForm(false);
      toast.success("Ticket created");
    } else {
      toast.error("Failed to create ticket");
    }
  };

  const handleStatusChange = async (ticket: SupportTicket, status: string) => {
    if (!businessId) return;
    const res = await updateSupportTicket(businessId, ticket.id, { status });
    if (res.data) {
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, status } : t)));
    }
  };

  const handleDelete = async (ticketId: string) => {
    if (!businessId) return;
    const res = await deleteSupportTicket(businessId, ticketId);
    if (res.data) {
      setTickets((prev) => prev.filter((t) => t.id !== ticketId));
      toast.success("Ticket deleted");
    }
  };

  const filtered = useMemo(() => {
    if (filter === "ALL") return tickets;
    return tickets.filter((t) => t.status === filter);
  }, [tickets, filter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    return counts;
  }, [tickets]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={LifeBuoy}
        title="Helpdesk"
        subtitle={`${tickets.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS").length} active tickets`}
        actionLabel="New Ticket"
        actionIcon={Plus}
        onAction={() => setShowForm(true)}
      />

      {showForm && (
        <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Create Ticket</h3>
            <button onClick={() => setShowForm(false)} className="p-1 rounded-md hover:bg-muted transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            placeholder="Ticket title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
          />
          <textarea
            placeholder="Description (optional)..."
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={2}
            className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Priority:</span>
            {(["LOW", "NORMAL", "HIGH", "URGENT"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setNewPriority(p)}
                className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${
                  newPriority === p ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              className="kf-btn-primary px-4 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
            >
              Create
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setFilter("ALL")}
            className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors ${filter === "ALL" ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            All ({tickets.length})
          </button>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                filter === key ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <cfg.icon className={`w-3 h-3 ${cfg.color}`} />
              {cfg.label} ({statusCounts[key] ?? 0})
            </button>
          ))}
        </div>
        {orgUnits.length > 0 && (
          <select
            value={orgUnitFilter}
            onChange={(e) => setOrgUnitFilter(e.target.value)}
            className="h-7 px-2 rounded-md border border-border bg-background text-[11px]"
          >
            <option value="">All Units</option>
            {orgUnits.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading tickets...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {filter === "ALL" ? "No tickets yet. Create one to get started." : `No ${STATUS_CONFIG[filter]?.label ?? filter} tickets.`}
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((ticket) => {
            const cfg = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.OPEN;
            const Icon = cfg.icon;
            return (
              <div
                key={ticket.id}
                className="flex items-center gap-3 py-2.5 px-3 rounded-lg border border-border/30 hover:border-border/60 hover:bg-card/50 transition-colors group"
              >
                <Icon className={`w-4 h-4 shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{ticket.title}</span>
                    <span className={`text-[10px] font-medium uppercase ${PRIORITY_COLORS[ticket.priority] ?? "text-muted-foreground"}`}>
                      {ticket.priority}
                    </span>
                  </div>
                  {ticket.description && (
                    <p className="text-[11px] text-muted-foreground truncate">{ticket.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ticket.orgUnit && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-muted border border-border/40 text-muted-foreground">
                        {ticket.orgUnit.name}
                      </span>
                    )}
                    {ticket.contact && (
                      <span className="text-[10px] text-muted-foreground/70">
                        {ticket.contact.displayName || [ticket.contact.firstName, ticket.contact.lastName].filter(Boolean).join(" ") || ticket.contact.email}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status changer */}
                <select
                  value={ticket.status}
                  onChange={(e) => handleStatusChange(ticket, e.target.value)}
                  className="text-[10px] bg-transparent border border-border/40 rounded-md px-2 py-1 focus:outline-none cursor-pointer"
                >
                  {Object.entries(STATUS_CONFIG).map(([key, c]) => (
                    <option key={key} value={key}>{c.label}</option>
                  ))}
                </select>

                <button
                  onClick={() => handleDelete(ticket.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
