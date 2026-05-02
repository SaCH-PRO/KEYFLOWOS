"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Copy, Check, Eye, EyeOff, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import { apiGet, apiPostSimple, apiDelete } from "@/lib/api";

export interface CredentialField {
  key: string;
  label: string;
  type: "text" | "password" | "textarea";
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  secret?: boolean;
}

interface CredentialSchemaResponse {
  type: string;
  name: string;
  connectMode: "dialog" | "oauth" | "webhook" | "external";
  authType: string;
  instructions: string | null;
  oauthStartPath: string | null;
  fields: CredentialField[];
  values: Record<string, string>;
  isConfigured: boolean;
}

interface WebhookInfo {
  url: string;
  secret: string;
  headerName: string;
  sampleCurl: string;
}

interface Props {
  businessId: string;
  type: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Modal that drives the "Connect account" experience for any connector. It pulls the
 * credential schema + masked existing values from the server, lets the user paste keys
 * (or, for webhook-only connectors, copy the per-business webhook URL), and persists
 * encrypted credentials via `POST /connectors/.../credentials/:type`.
 *
 * Secret fields render as masked inputs with a show/hide toggle and a "•••• <last4>"
 * placeholder so the user can confirm what's stored without exposing the full value.
 */
export function ConnectorCredentialDialog({ businessId, type, open, onClose, onSaved }: Props) {
  const [schema, setSchema] = useState<CredentialSchemaResponse | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const fetchSchema = useCallback(async () => {
    setLoading(true);
    setWebhookInfo(null);
    const res = await apiGet<CredentialSchemaResponse>(
      `/connectors/businesses/${businessId}/credentials/${type}`,
    );
    if (res.error || !res.data) {
      toast.error(res.error ?? "Failed to load credential form");
      setLoading(false);
      return;
    }
    setSchema(res.data);
    setValues(res.data.values ?? {});

    if (res.data.connectMode === "webhook") {
      const info = await apiGet<WebhookInfo>(
        `/connectors/businesses/${businessId}/webhook-info/${type}`,
      );
      if (info.data) setWebhookInfo(info.data);
    }
    setLoading(false);
  }, [businessId, type]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    setSchema(null);
    setValues({});
    setReveal({});
    setCopied(null);
    void fetchSchema();
  }, [open, fetchSchema]);

  const handleCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const handleSave = async () => {
    if (!schema) return;
    setSaving(true);
    const res = await apiPostSimple<{ success: boolean }>(
      `/connectors/businesses/${businessId}/credentials/${type}`,
      { values },
    );
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`${schema.name} connected`);
    onSaved();
    onClose();
  };

  const handleRemove = async () => {
    if (!schema) return;
    setRemoving(true);
    const res = await apiDelete<{ success: boolean }>(
      `/connectors/businesses/${businessId}/credentials/${type}`,
    );
    setRemoving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`${schema.name} disconnected`);
    onSaved();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-background border border-border/40 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <h3 className="text-sm font-semibold truncate">
                  {loading ? "Loading…" : `Connect ${schema?.name ?? ""}`}
                </h3>
              </div>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-4">
              {loading ? (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" />
                  Loading credential form…
                </div>
              ) : !schema ? (
                <p className="text-sm text-red-400">Credentials not available for this connector.</p>
              ) : (
                <>
                  {schema.instructions && (
                    <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-xs text-muted-foreground leading-relaxed">
                      {schema.instructions}
                    </div>
                  )}

                  {webhookInfo && (
                    <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                          Your webhook URL
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-[11px] font-mono break-all bg-background/40 rounded-lg px-2 py-1.5 border border-border/30">
                            {webhookInfo.url}
                          </code>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopy("url", webhookInfo.url)}
                            className="h-7 px-2 text-xs"
                            aria-label="Copy webhook URL"
                          >
                            {copied === "url" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            <span className="sr-only">{copied === "url" ? "Copied" : "Copy URL"}</span>
                          </Button>
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                          Signature secret
                          <span className="ml-1 normal-case text-muted-foreground/70">
                            (header: <code>{webhookInfo.headerName}</code>)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-[11px] font-mono break-all bg-background/40 rounded-lg px-2 py-1.5 border border-border/30">
                            {webhookInfo.secret}
                          </code>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopy("secret", webhookInfo.secret)}
                            className="h-7 px-2 text-xs"
                            aria-label="Copy webhook secret"
                          >
                            {copied === "secret" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            <span className="sr-only">{copied === "secret" ? "Copied" : "Copy secret"}</span>
                          </Button>
                        </div>
                      </div>
                      <details className="text-[11px] text-muted-foreground">
                        <summary className="cursor-pointer hover:text-foreground">
                          Sample <code>curl</code>
                        </summary>
                        <pre className="mt-2 rounded-lg border border-border/30 bg-background/40 p-2 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                          {webhookInfo.sampleCurl}
                        </pre>
                      </details>
                    </div>
                  )}

                  {schema.fields.length > 0 && (
                    <div className="space-y-3">
                      {schema.fields.map((field) => {
                        const v = values[field.key] ?? "";
                        const showValue = !field.secret || reveal[field.key];
                        const isMaskedExisting = field.secret && v.startsWith("••••");
                        return (
                          <div key={field.key}>
                            <label className="text-xs font-medium block mb-1">
                              {field.label}
                              {field.required && <span className="text-red-400 ml-0.5">*</span>}
                            </label>
                            <div className="relative">
                              {field.type === "textarea" ? (
                                <textarea
                                  value={v}
                                  onChange={(e) => setValues((p) => ({ ...p, [field.key]: e.target.value }))}
                                  placeholder={field.placeholder}
                                  rows={3}
                                  className="w-full text-sm rounded-lg border border-border/40 bg-background/60 px-3 py-2 focus:outline-none focus:border-border"
                                />
                              ) : (
                                <input
                                  type={showValue ? "text" : "password"}
                                  value={v}
                                  onChange={(e) => setValues((p) => ({ ...p, [field.key]: e.target.value }))}
                                  onFocus={() => {
                                    if (isMaskedExisting) setValues((p) => ({ ...p, [field.key]: "" }));
                                  }}
                                  placeholder={field.placeholder ?? (field.secret ? "Paste new value to replace" : "")}
                                  className="w-full text-sm rounded-lg border border-border/40 bg-background/60 px-3 py-2 pr-9 focus:outline-none focus:border-border font-mono"
                                />
                              )}
                              {field.secret && field.type !== "textarea" && (
                                <button
                                  type="button"
                                  onClick={() => setReveal((p) => ({ ...p, [field.key]: !p[field.key] }))}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                  aria-label={showValue ? "Hide" : "Show"}
                                >
                                  {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                              )}
                            </div>
                            {field.helpText && (
                              <p className="text-[11px] text-muted-foreground mt-1">{field.helpText}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {schema.fields.length === 0 && !webhookInfo && (
                    <p className="text-xs text-muted-foreground">
                      This connector has no credentials to enter.
                    </p>
                  )}
                </>
              )}
            </div>

            {schema && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-t border-border/30">
                <div className="flex items-center gap-2">
                  {schema.isConfigured && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleRemove}
                      disabled={removing}
                      className="text-red-400 hover:text-red-300"
                    >
                      {removing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Remove credentials
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  {(schema.fields.length > 0 || webhookInfo) && (
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Save & connect
                    </Button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

