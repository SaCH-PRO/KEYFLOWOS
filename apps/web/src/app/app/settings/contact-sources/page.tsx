"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ContactRound,
  Mail,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Plug,
  Unlink,
  Sparkles,
  ShieldCheck,
  History,
} from "lucide-react";
import { Button, Badge } from "@keyflow/ui";
import { toast } from "sonner";
import { apiGet, apiPostSimple, apiPut, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface SourceState {
  connected: boolean;
  account: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  syncCount: number;
  status: string;
  contactCount: number;
}

interface SignatureState {
  enabled: boolean;
  contactCount: number;
}

interface SummaryResponse {
  sources: {
    google_contacts: SourceState;
    outlook_contacts: SourceState;
    signature: SignatureState;
  };
  conflictsResolved: number;
}

interface AuditEntry {
  id: string;
  source: string;
  action: string;
  resolution: string | null;
  externalId: string | null;
  contactId: string | null;
  fieldsChanged: string[];
  createdAt: string;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "Never");

export default function ContactSourcesPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [savingSig, setSavingSig] = useState(false);
  const [testBody, setTestBody] = useState("");
  const [testResult, setTestResult] = useState<unknown>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async (bid: string) => {
    const [s, a] = await Promise.all([
      apiGet<SummaryResponse>(`/connect/businesses/${bid}/contact-sources/summary`),
      apiGet<AuditEntry[]>(`/connect/businesses/${bid}/contact-sources/audit?limit=25`),
    ]);
    if (!s.error && s.data) setSummary(s.data);
    if (!a.error && a.data) setAudit(a.data);
  }, []);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (!bid) {
      setLoading(false);
      return;
    }
    setBusinessId(bid);
    refresh(bid).finally(() => setLoading(false));
  }, [refresh]);

  // honor microsoft=connected/error from the OAuth callback redirect
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ms = params.get("microsoft");
    if (!ms) return;
    if (ms === "connected") toast.success("Outlook Contacts connected");
    else if (ms === "verify_failed") toast.warning("Connected but verification failed — try syncing");
    else if (ms === "error") toast.error(`Outlook OAuth failed: ${params.get("reason") ?? "unknown"}`);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const connect = async (provider: "google" | "microsoft") => {
    if (!businessId) return;
    setConnecting(provider);
    try {
      const path =
        provider === "google"
          ? `/connect/google-suite/businesses/${businessId}/auth-url?service=contacts`
          : `/connect/microsoft/businesses/${businessId}/auth-url`;
      const r = await apiGet<{ authUrl: string }>(path);
      if (!r.error && r.data?.authUrl) {
        window.location.href = r.data.authUrl;
      } else {
        toast.error("Failed to start OAuth flow");
      }
    } finally {
      setConnecting(null);
    }
  };

  const syncAll = async () => {
    if (!businessId) return;
    setSyncing(true);
    try {
      const r = await apiPostSimple<Record<string, unknown>>(
        `/connect/businesses/${businessId}/contact-sources/sync-all`,
        {},
      );
      if (!r.error) {
        toast.success("Sync complete");
        await refresh(businessId);
      } else {
        toast.error("Sync failed");
      }
    } finally {
      setSyncing(false);
    }
  };

  const toggleSignature = async (enabled: boolean) => {
    if (!businessId) return;
    setSavingSig(true);
    try {
      const r = await apiPut<{ enabled: boolean }>(
        `/connect/businesses/${businessId}/contact-sources/signature-parsing`,
        { enabled },
      );
      if (!r.error) {
        toast.success(enabled ? "Signature parsing enabled" : "Signature parsing disabled");
        await refresh(businessId);
      }
    } finally {
      setSavingSig(false);
    }
  };

  const resyncSource = async (source: "google_contacts" | "outlook_contacts") => {
    if (!businessId) return;
    const r = await apiPostSimple<unknown>(
      `/connect/businesses/${businessId}/contact-sources/${source}/resync`,
      {},
    );
    if (!r.error) {
      toast.success("Resync complete");
      await refresh(businessId);
    } else {
      toast.error("Resync failed");
    }
  };

  const disconnectSource = async (source: "google_contacts" | "outlook_contacts") => {
    if (!businessId) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Disconnect this source? Imported contacts stay in your CRM.")
    ) {
      return;
    }
    const r = await apiDelete<unknown>(
      `/connect/businesses/${businessId}/contact-sources/${source}`,
    );
    if (!r.error) {
      toast.success("Disconnected");
      await refresh(businessId);
    } else {
      toast.error("Disconnect failed");
    }
  };

  const runTestParse = async () => {
    if (!businessId || !testBody.trim()) return;
    setTesting(true);
    try {
      const r = await apiPostSimple<unknown>(
        `/connect/businesses/${businessId}/contact-sources/parse-signature`,
        { emailBody: testBody },
      );
      setTestResult(r.data ?? r);
      if (!r.error) {
        toast.success("Signature parsed");
        await refresh(businessId);
      }
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!businessId) {
    return <div className="p-6 text-sm text-muted-foreground">No workspace selected.</div>;
  }

  const google = summary?.sources.google_contacts;
  const outlook = summary?.sources.outlook_contacts;
  const sig = summary?.sources.signature;

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white shadow-md">
            <ContactRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Contact Sources</h2>
            <p className="text-sm text-muted-foreground">
              Sync contacts from Google, Outlook, and inbound email signatures.
            </p>
          </div>
        </div>
        <Button onClick={syncAll} disabled={syncing} variant="default">
          {syncing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sync all sources
        </Button>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2">
        <SourceCard
          title="Google Contacts"
          provider="google"
          state={google}
          onConnect={() => connect("google")}
          onResync={() => resyncSource("google_contacts")}
          onDisconnect={() => disconnectSource("google_contacts")}
          connecting={connecting === "google"}
        />
        <SourceCard
          title="Outlook Contacts"
          provider="microsoft"
          state={outlook}
          onConnect={() => connect("microsoft")}
          onResync={() => resyncSource("outlook_contacts")}
          onDisconnect={() => disconnectSource("outlook_contacts")}
          connecting={connecting === "microsoft"}
        />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/60 bg-card p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold">Email Signature Parsing</h3>
              <p className="text-sm text-muted-foreground">
                Auto-create &amp; enrich CRM contacts from inbound email signatures.
              </p>
            </div>
          </div>
          <Button
            variant={sig?.enabled ? "secondary" : "default"}
            disabled={savingSig}
            onClick={() => toggleSignature(!sig?.enabled)}
          >
            {savingSig ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : sig?.enabled ? (
              <ShieldCheck className="h-4 w-4 mr-2" />
            ) : (
              <Plug className="h-4 w-4 mr-2" />
            )}
            {sig?.enabled ? "Enabled" : "Enable"}
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          {sig?.contactCount ?? 0} contacts created or enriched from signatures
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Try it (paste an email body)
          </label>
          <textarea
            className="w-full h-32 rounded-lg border border-border/60 bg-background p-3 text-sm font-mono"
            placeholder={"Hi,\n\nThanks for reaching out!\n\n--\nJane Smith\nDirector of Marketing, Acme Inc.\njane@acme.com\n+1 555-1234"}
            value={testBody}
            onChange={(e) => setTestBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={testing || !testBody.trim()} onClick={runTestParse}>
              {testing ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <Mail className="h-3 w-3 mr-2" />
              )}
              Parse signature
            </Button>
          </div>
          {testResult ? (
            <pre className="mt-2 text-xs bg-muted/40 rounded-lg p-3 overflow-auto max-h-64">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          ) : null}
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/60 bg-card p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">Recent sync activity</h3>
          </div>
          <Badge tone="default">
            {summary?.conflictsResolved ?? 0} conflicts resolved
          </Badge>
        </div>
        {audit.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No sync activity yet. Connect a source and run a sync.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {audit.map((a) => (
              <div key={a.id} className="py-2 flex items-center gap-3 text-sm">
                <Badge tone="info" className="shrink-0">
                  {a.source}
                </Badge>
                <span className="font-medium">{a.action}</span>
                {a.resolution ? (
                  <span className="text-xs text-muted-foreground">({a.resolution})</span>
                ) : null}
                {a.fieldsChanged?.length ? (
                  <span className="text-xs text-muted-foreground">
                    {a.fieldsChanged.join(", ")}
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmt(a.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </motion.section>
    </div>
  );
}

function SourceCard({
  title,
  provider,
  state,
  onConnect,
  onResync,
  onDisconnect,
  connecting,
}: {
  title: string;
  provider: "google" | "microsoft";
  state: SourceState | undefined;
  onConnect: () => void;
  onResync: () => void;
  onDisconnect: () => void;
  connecting: boolean;
}) {
  const connected = !!state?.connected;
  const error = state?.lastError;
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border/60 bg-card p-5 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            {connected ? (
              <Badge tone="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </Badge>
            ) : (
              <Badge tone="default">Not connected</Badge>
            )}
            {error ? (
              <Badge tone="danger" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> Error
              </Badge>
            ) : null}
          </div>
          {state?.account ? (
            <div className="text-xs text-muted-foreground mt-1">{state.account}</div>
          ) : null}
        </div>
        <Button
          size="sm"
          variant={connected ? "secondary" : "default"}
          disabled={connecting}
          onClick={onConnect}
        >
          {connecting ? (
            <Loader2 className="h-3 w-3 mr-2 animate-spin" />
          ) : connected ? (
            <Unlink className="h-3 w-3 mr-2" />
          ) : (
            <Plug className="h-3 w-3 mr-2" />
          )}
          {connected ? "Reconnect" : `Connect ${provider === "google" ? "Google" : "Microsoft"}`}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <Stat label="Contacts" value={state?.contactCount ?? 0} />
        <Stat label="Syncs" value={state?.syncCount ?? 0} />
        <Stat label="Last sync" value={fmt(state?.lastSyncAt ?? null)} />
      </div>
      {error ? (
        <div className="text-xs text-red-500 bg-red-500/10 rounded-md p-2">
          {error}
          {state?.lastErrorAt ? <span className="ml-1">· {fmt(state.lastErrorAt)}</span> : null}
        </div>
      ) : null}
      {connected ? (
        <div className="flex items-center gap-2 pt-1 border-t border-border/40">
          <Button size="sm" variant="ghost" onClick={onResync} className="gap-1">
            <RefreshCw className="h-3 w-3" /> Resync
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDisconnect}
            className="gap-1 text-red-500 hover:text-red-600"
          >
            <Unlink className="h-3 w-3" /> Disconnect
          </Button>
        </div>
      ) : null}
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium truncate">{value}</div>
    </div>
  );
}
