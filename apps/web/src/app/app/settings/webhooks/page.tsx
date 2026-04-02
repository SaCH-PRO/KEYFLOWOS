"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Webhook,
  Trash2,
  Plus,
  Copy,
  Eye,
  EyeOff,
  X,
  Loader2,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
  Activity,
  Power,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { InfoBadge } from "@/components/ui/info-badge";
import {
  fetchWebhooks,
  createWebhook,
  deleteWebhook,
  testWebhook,
  fetchWebhookDeliveries,
  toggleWebhook,
} from "@/lib/client";
import type { WebhookConfig, WebhookDeliveryLog } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { toast } from "sonner";

const EVENT_GROUPS: { group: string; events: string[] }[] = [
  {
    group: "Commerce",
    events: [
      "invoice.created",
      "invoice.sent",
      "invoice.paid",
      "invoice.overdue",
      "quote.created",
      "quote.accepted",
      "quote.rejected",
      "payment.received",
      "payment.refunded",
    ],
  },
  {
    group: "Bookings",
    events: [
      "booking.created",
      "booking.confirmed",
      "booking.completed",
      "booking.cancelled",
      "booking.rescheduled",
    ],
  },
  {
    group: "CRM",
    events: [
      "contact.created",
      "contact.updated",
      "contact.deleted",
      "lead.scored",
      "note.created",
    ],
  },
  {
    group: "Marketing",
    events: [
      "campaign.sent",
      "campaign.opened",
      "campaign.clicked",
      "form.submitted",
      "subscriber.created",
    ],
  },
  {
    group: "Operations",
    events: [
      "expense.created",
      "project.created",
      "task.completed",
      "playbook.triggered",
      "store.order_placed",
    ],
  },
];

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function WebhooksSettingsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [webhookForm, setWebhookForm] = useState({ name: "", url: "", events: "" });
  const [showSecrets, setShowSecrets] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, WebhookDeliveryLog>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveryLogs, setDeliveryLogs] = useState<Record<string, WebhookDeliveryLog[]>>({});
  const [loadingLogs, setLoadingLogs] = useState<string | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadWebhooks = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWebhooks(businessId);
      if (res.data) setWebhooks(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void loadWebhooks();
  }, [loadWebhooks]);

  const handleCreate = async () => {
    if (!businessId || !webhookForm.url.trim()) return;
    setCreating(true);
    try {
      const events = webhookForm.events
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      const res = await createWebhook(businessId, {
        url: webhookForm.url.trim(),
        events,
        name: webhookForm.name.trim() || undefined,
      });
      if (res.data) {
        setWebhooks((prev) => [...prev, res.data!]);
        toast.success("Webhook created");
      } else {
        toast.error("Failed to create webhook");
      }
    } catch {
      toast.error("Failed to create webhook");
    }
    setWebhookForm({ name: "", url: "", events: "" });
    setShowWebhookModal(false);
    setCreating(false);
  };

  const handleDelete = async (webhookId: string) => {
    if (!businessId) return;
    try {
      await deleteWebhook(businessId, webhookId);
      setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
      toast.success("Webhook deleted");
    } catch {
      toast.error("Failed to delete webhook");
    }
  };

  const handleTest = async (webhookId: string) => {
    if (!businessId) return;
    setTestingId(webhookId);
    setTestResults((prev) => { const n = { ...prev }; delete n[webhookId]; return n; });
    try {
      const res = await testWebhook(businessId, webhookId);
      if (res.data) {
        setTestResults((prev) => ({ ...prev, [webhookId]: res.data! }));
        const logsRes = await fetchWebhookDeliveries(businessId, webhookId, 10);
        if (logsRes.data) {
          setDeliveryLogs((prev) => ({ ...prev, [webhookId]: logsRes.data! }));
        }
      }
    } catch {}
    setTestingId(null);
  };

  const handleToggle = async (webhookId: string, currentActive: boolean) => {
    if (!businessId) return;
    const res = await toggleWebhook(businessId, webhookId, !currentActive);
    if (res.data?.success) {
      setWebhooks((prev) =>
        prev.map((w) => (w.id === webhookId ? { ...w, isActive: !currentActive } : w))
      );
      toast.success(!currentActive ? "Webhook enabled" : "Webhook disabled");
    } else {
      toast.error("Failed to update webhook");
    }
  };

  const handleExpand = async (webhookId: string) => {
    if (expandedId === webhookId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(webhookId);
    if (!deliveryLogs[webhookId] && businessId) {
      setLoadingLogs(webhookId);
      try {
        const res = await fetchWebhookDeliveries(businessId, webhookId, 10);
        if (res.data) {
          setDeliveryLogs((prev) => ({ ...prev, [webhookId]: res.data! }));
        }
      } catch {}
      setLoadingLogs(null);
    }
  };

  const toggleSecret = (id: string) => {
    setShowSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-5 w-28 bg-muted/40 rounded-lg" />
            <div className="h-3 w-56 bg-muted/30 rounded-lg" />
          </div>
          <div className="h-10 w-32 bg-muted/30 rounded-xl" />
        </div>
        <div className="kf-card p-6 space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 bg-muted/20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Webhook className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            Webhooks
            <InfoBadge title="Webhooks" body="Webhooks send HTTP POST requests to your URL when events happen in your business (e.g., new booking, paid invoice). Each payload is HMAC-signed for security." side="right" iconSize={13} />
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Receive real-time event notifications with automatic retries and delivery tracking
          </p>
        </div>
        <button
          onClick={() => setShowWebhookModal(true)}
          className="kf-btn-primary flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          Add Webhook
        </button>
      </div>

      {loading ? (
        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-12 text-center">
          <Webhook className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">No webhooks configured</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add a webhook to start receiving event notifications with automatic retries
          </p>
          <button
            onClick={() => setShowWebhookModal(true)}
            className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium min-h-[44px]"
          >
            Add Your First Webhook
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => {
            const testResult = testResults[webhook.id];
            const isExpanded = expandedId === webhook.id;
            const logs = deliveryLogs[webhook.id] || [];
            return (
              <motion.div
                key={webhook.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/5 backdrop-blur border border-white/10 rounded-xl overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold truncate">
                          {webhook.name || "Unnamed Webhook"}
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            webhook.isActive
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                              : "bg-white/5 text-muted-foreground border border-white/10"
                          }`}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full ${webhook.isActive ? "bg-emerald-400" : "bg-muted-foreground"}`} />
                          {webhook.isActive ? "Active" : "Paused"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {webhook.url}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => handleToggle(webhook.id, webhook.isActive)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
                        title={webhook.isActive ? "Pause" : "Activate"}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleTest(webhook.id)}
                        disabled={testingId === webhook.id}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center disabled:opacity-40"
                        title="Send Test Event"
                      >
                        {testingId === webhook.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(webhook.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {testResult && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className={`rounded-lg px-3 py-2 mb-3 flex items-center gap-2 text-xs ${
                        testResult.status === "success"
                          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                          : "bg-red-500/10 border border-red-500/20 text-red-400"
                      }`}
                    >
                      {testResult.status === "success" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>
                        {testResult.status === "success"
                          ? `Test delivered (${testResult.statusCode}, ${testResult.duration}ms, ${testResult.attempts} attempt${testResult.attempts > 1 ? "s" : ""})`
                          : `Test failed: ${testResult.error || "Unknown error"} (${testResult.attempts} attempt${testResult.attempts > 1 ? "s" : ""})`}
                      </span>
                    </motion.div>
                  )}

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {webhook.events.map((event) => (
                      <span
                        key={event}
                        className="text-[10px] font-medium uppercase px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground"
                      >
                        {event}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between">
                    {webhook.secret && (
                      <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5 flex-1 mr-2">
                        <span className="text-xs text-muted-foreground shrink-0">Secret:</span>
                        <code className="text-xs font-mono flex-1 truncate">
                          {showSecrets.has(webhook.id)
                            ? webhook.secret
                            : "••••••••••••••••"}
                        </code>
                        <button
                          onClick={() => toggleSecret(webhook.id)}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center"
                        >
                          {showSecrets.has(webhook.id) ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => copyToClipboard(webhook.secret!)}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => handleExpand(webhook.id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg hover:bg-white/5 min-h-[32px]"
                    >
                      <Activity className="w-3 h-3" />
                      Deliveries
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-white/[0.06] overflow-hidden"
                    >
                      <div className="p-4">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          Recent Deliveries
                        </h4>
                        {loadingLogs === webhook.id ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : logs.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-6">
                            No deliveries recorded yet. Send a test event to see results here.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {logs.map((log) => (
                              <div
                                key={log.id}
                                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] text-xs"
                              >
                                <div className={`w-2 h-2 rounded-full shrink-0 ${
                                  log.status === "success" ? "bg-emerald-400" : "bg-red-400"
                                }`} />
                                <span className="font-mono text-muted-foreground min-w-[100px]">{log.event}</span>
                                <span className={`min-w-[48px] ${
                                  log.status === "success" ? "text-emerald-400" : "text-red-400"
                                }`}>
                                  {log.statusCode || "ERR"}
                                </span>
                                <span className="text-muted-foreground">{log.duration}ms</span>
                                <span className="text-muted-foreground/60">{log.attempts} try</span>
                                <span className="ml-auto text-muted-foreground/60">{formatRelativeTime(log.timestamp)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Delivery Guarantees
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Each webhook delivery is retried up to 3 times with exponential backoff (1s → 4s). All deliveries are signed with HMAC-SHA256 for verification.
        </p>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-4">
          Available Events
        </h3>
        <div className="space-y-2">
          {EVENT_GROUPS.map((g) => (
            <div key={g.group}>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold">{g.group}</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {g.events.map((event) => (
                  <span
                    key={event}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-muted-foreground"
                  >
                    {event}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {showWebhookModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowWebhookModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Add Webhook</h3>
                <button
                  onClick={() => setShowWebhookModal(false)}
                  className="p-1 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Name (optional)</label>
                  <input
                    value={webhookForm.name}
                    onChange={(e) =>
                      setWebhookForm((f) => ({ ...f, name: e.target.value }))
                    }
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1"
                    placeholder="My Webhook"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">URL</label>
                  <input
                    value={webhookForm.url}
                    onChange={(e) =>
                      setWebhookForm((f) => ({ ...f, url: e.target.value }))
                    }
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1"
                    placeholder="https://example.com/webhook"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">
                    Events (click to select)
                  </label>
                  <div className="space-y-2 mt-2">
                    {EVENT_GROUPS.map((g) => (
                      <div key={g.group}>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold">{g.group}</span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {g.events.map((event) => {
                            const selected = webhookForm.events.split(",").map((e) => e.trim()).includes(event);
                            return (
                              <button
                                key={event}
                                type="button"
                                onClick={() => {
                                  setWebhookForm((f) => {
                                    const existing = f.events.split(",").map((e) => e.trim()).filter(Boolean);
                                    if (existing.includes(event)) {
                                      return { ...f, events: existing.filter((e) => e !== event).join(", ") };
                                    }
                                    return { ...f, events: [...existing, event].join(", ") };
                                  });
                                }}
                                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors min-h-[28px] ${
                                  selected
                                    ? "bg-[hsl(var(--kf-accent1)_/_0.15)] border-[hsl(var(--kf-accent1)_/_0.4)] text-foreground"
                                    : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                                }`}
                              >
                                {selected ? "\u2713" : "+"} {event}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleCreate}
                    disabled={!webhookForm.url.trim() || creating}
                    className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium flex-1 disabled:opacity-40 min-h-[44px]"
                  >
                    {creating ? "Creating..." : "Create Webhook"}
                  </button>
                  <button
                    onClick={() => setShowWebhookModal(false)}
                    className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 min-h-[44px]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
