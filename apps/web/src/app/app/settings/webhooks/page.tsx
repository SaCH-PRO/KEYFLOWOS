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
} from "lucide-react";
import {
  fetchWebhooks,
  createWebhook,
  deleteWebhook,
} from "@/lib/client";
import type { WebhookConfig } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const AVAILABLE_EVENTS = [
  "invoice.paid",
  "invoice.created",
  "contact.created",
  "booking.created",
  "payment.received",
  "expense.created",
];

export default function WebhooksSettingsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [webhookForm, setWebhookForm] = useState({ name: "", url: "", events: "" });
  const [showSecrets, setShowSecrets] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

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
      }
    } catch {}
    setWebhookForm({ name: "", url: "", events: "" });
    setShowWebhookModal(false);
    setCreating(false);
  };

  const handleDelete = async (webhookId: string) => {
    if (!businessId) return;
    try {
      await deleteWebhook(businessId, webhookId);
      setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
    } catch {}
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Webhook className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            Webhooks & Integrations
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure webhooks to receive real-time event notifications
          </p>
        </div>
        <button
          onClick={() => setShowWebhookModal(true)}
          className="kf-btn-primary flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium"
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
            Add a webhook to start receiving event notifications
          </p>
          <button
            onClick={() => setShowWebhookModal(true)}
            className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium"
          >
            Add Your First Webhook
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <motion.div
              key={webhook.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold truncate">
                    {webhook.name || "Unnamed Webhook"}
                  </h3>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {webhook.url}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(webhook.id)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors ml-2"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

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

              {webhook.secret && (
                <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                  <span className="text-xs text-muted-foreground shrink-0">Secret:</span>
                  <code className="text-xs font-mono flex-1 truncate">
                    {showSecrets.has(webhook.id)
                      ? webhook.secret
                      : "••••••••••••••••"}
                  </code>
                  <button
                    onClick={() => toggleSecret(webhook.id)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showSecrets.has(webhook.id) ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => copyToClipboard(webhook.secret!)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Available Events
        </h3>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_EVENTS.map((event) => (
            <span
              key={event}
              className="text-xs font-mono px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-muted-foreground"
            >
              {event}
            </span>
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
              className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Add Webhook</h3>
                <button
                  onClick={() => setShowWebhookModal(false)}
                  className="p-1 text-muted-foreground hover:text-foreground"
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
                    Events (comma-separated)
                  </label>
                  <input
                    value={webhookForm.events}
                    onChange={(e) =>
                      setWebhookForm((f) => ({ ...f, events: e.target.value }))
                    }
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1"
                    placeholder="invoice.paid, contact.created"
                  />
                  <div className="flex flex-wrap gap-1 mt-2">
                    {AVAILABLE_EVENTS.map((event) => (
                      <button
                        key={event}
                        type="button"
                        onClick={() => {
                          setWebhookForm((f) => {
                            const existing = f.events
                              .split(",")
                              .map((e) => e.trim())
                              .filter(Boolean);
                            if (existing.includes(event)) return f;
                            return {
                              ...f,
                              events: [...existing, event].join(", "),
                            };
                          });
                        }}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
                      >
                        + {event}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleCreate}
                    disabled={!webhookForm.url.trim() || creating}
                    className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium flex-1 disabled:opacity-40"
                  >
                    {creating ? "Creating..." : "Create Webhook"}
                  </button>
                  <button
                    onClick={() => setShowWebhookModal(false)}
                    className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30"
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
