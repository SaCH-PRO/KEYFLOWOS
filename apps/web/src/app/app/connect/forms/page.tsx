"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  Loader2,
  RefreshCw,
  Plus,
  ExternalLink,
  Trash2,
  ChevronRight,
  Inbox,
  Webhook,
  Zap,
  Save,
  Settings2,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Badge } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiGet, apiPostSimple, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type Provider = "google" | "typeform" | "jotform" | "webhook_form";

const PROVIDER_TABS: Array<{
  id: Provider;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
}> = [
  { id: "google", label: "Google Forms", icon: FileText, blurb: "Forms in your connected Google Drive." },
  { id: "typeform", label: "Typeform", icon: Zap, blurb: "Submissions arriving from Typeform webhooks." },
  { id: "jotform", label: "Jotform", icon: Inbox, blurb: "Submissions arriving from Jotform webhooks." },
  { id: "webhook_form", label: "Webhook", icon: Webhook, blurb: "Generic landing-page / custom HTML form ingest." },
];

interface DriveForm {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

interface ConnectorForm {
  leadFormId: string;
  externalFormId: string;
  name: string;
  submissionCount: number;
  processedCount: number;
  pendingCount: number;
  hasMapping: boolean;
  autoCreate: boolean;
  lastBackfillAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Submission {
  id: string;
  data: Record<string, unknown> | null;
  contactId: string | null;
  createdAt: string;
  source: string;
}

interface MappingState {
  formTitle?: string | null;
  fieldMappings: Array<{ questionId: string; questionTitle?: string; crmField: string }>;
  defaultTags?: string[];
  defaultStatus?: string | null;
  autoCreate?: boolean;
}

const CRM_FIELDS = [
  "ignore",
  "firstName",
  "lastName",
  "email",
  "phone",
  "companyName",
  "jobTitle",
  "addressLine1",
  "city",
  "state",
  "postalCode",
  "country",
  "notesInternal",
  "tag",
];

function formatDate(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function GoogleFormsTab({ businessId }: { businessId: string }) {
  const [forms, setForms] = useState<DriveForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ open: boolean; formId: string; name: string }>({
    open: false,
    formId: "",
    name: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiGet<{ files?: DriveForm[] }>(
      `/connect/businesses/${businessId}/forms`,
    );
    if (res.error) setError(res.error);
    else setForms(res.data?.files ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!draftTitle.trim()) return;
    setCreating(true);
    const res = await apiPostSimple(
      `/connect/businesses/${businessId}/forms`,
      { title: draftTitle.trim(), description: draftDesc.trim() || undefined },
    );
    setCreating(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Form created");
      setShowCreate(false);
      setDraftTitle("");
      setDraftDesc("");
      await load();
    }
  };

  const performDelete = async () => {
    setBusyId(confirm.formId);
    const res = await apiDelete(
      `/connect/businesses/${businessId}/forms/${encodeURIComponent(confirm.formId)}`,
    );
    setBusyId(null);
    setConfirm({ open: false, formId: "", name: "" });
    if (res.error) toast.error(res.error);
    else {
      toast.success("Form deleted");
      await load();
    }
  };

  const sorted = useMemo(
    () =>
      [...forms].sort((a, b) =>
        (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""),
      ),
    [forms],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Browse the Google Forms in your connected Drive.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-3 w-3 mr-1" />
            New form
          </Button>
        </div>
      </div>

      {showCreate && (
        <div className="rounded-2xl border border-border/50 p-4 bg-card/50 space-y-3">
          <input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Form title"
            className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"
          />
          <textarea
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            rows={2}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm resize-none"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowCreate(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={!draftTitle.trim() || creating}>
              {creating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              Create
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-muted/10 border border-border/20" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={error ? "Couldn't load forms" : "No forms yet"}
          description={
            error
              ? "Make sure the Google account is connected and Drive scope was granted."
              : "Create your first Google Form or open Forms to bring one in."
          }
          actionLabel="Create form"
          onAction={() => setShowCreate(true)}
          secondaryAction={{
            label: "Open Google Forms",
            onClick: () => window.open("https://docs.google.com/forms", "_blank"),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sorted.map((form) => (
            <div
              key={form.id}
              className="rounded-2xl border border-border/40 bg-card/40 p-4 hover:border-border/70 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4 text-purple-400 shrink-0" />
                    <h3 className="text-sm font-semibold truncate">{form.name}</h3>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Modified {formatDate(form.modifiedTime)}
                  </div>
                </div>
                {form.webViewLink && (
                  <a
                    href={form.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
                <Link
                  href={`/app/connect/forms/${encodeURIComponent(form.id)}`}
                  className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
                >
                  Responses & mapping
                  <ChevronRight className="h-3 w-3" />
                </Link>
                <div className="ml-auto">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setConfirm({ open: true, formId: form.id, name: form.name })
                    }
                    disabled={busyId === form.id}
                    className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                  >
                    {busyId === form.id ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Trash2 className="h-3 w-3 mr-1" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirm.open}
        title="Delete form"
        message={`Permanently delete "${confirm.name}"? This will move the file to Google Drive trash.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={performDelete}
        onCancel={() => setConfirm({ open: false, formId: "", name: "" })}
      />
    </div>
  );
}

function ConnectorFormsTab({
  businessId,
  source,
}: {
  businessId: string;
  source: Exclude<Provider, "google">;
}) {
  const [forms, setForms] = useState<ConnectorForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConnectorForm | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [mapping, setMapping] = useState<MappingState | null>(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [tagsDraft, setTagsDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [view, setView] = useState<"list" | "responses" | "mapping">("list");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiGet<ConnectorForm[]>(
      `/connect/businesses/${businessId}/connector-forms/${source}`,
    );
    if (res.error) setError(res.error);
    else setForms(res.data ?? []);
    setLoading(false);
  }, [businessId, source]);

  useEffect(() => {
    load();
    setSelected(null);
    setView("list");
  }, [load]);

  const openForm = async (form: ConnectorForm) => {
    setSelected(form);
    setView("responses");
    setSubmissionsLoading(true);
    const res = await apiGet<{ submissions?: Submission[] }>(
      `/connect/businesses/${businessId}/connector-forms/${source}/${form.leadFormId}/submissions?limit=100`,
    );
    setSubmissionsLoading(false);
    setSubmissions(res.data?.submissions ?? []);
  };

  const openMapping = async (form: ConnectorForm) => {
    setSelected(form);
    setView("mapping");
    setMappingLoading(true);
    const res = await apiGet<MappingState>(
      `/connect/businesses/${businessId}/connector-forms/${source}/${form.externalFormId}/mapping`,
    );
    setMappingLoading(false);
    const mp: MappingState = res.data
      ? {
          formTitle: res.data.formTitle ?? form.name,
          fieldMappings: res.data.fieldMappings ?? [],
          defaultTags: res.data.defaultTags ?? [],
          defaultStatus: res.data.defaultStatus ?? null,
          autoCreate: res.data.autoCreate ?? true,
        }
      : {
          formTitle: form.name,
          fieldMappings: [],
          defaultTags: [],
          defaultStatus: null,
          autoCreate: true,
        };
    // Seed available question keys from latest submissions
    const subRes = await apiGet<{ submissions?: Submission[] }>(
      `/connect/businesses/${businessId}/connector-forms/${source}/${form.leadFormId}/submissions?limit=20`,
    );
    const allKeys = new Set<string>();
    for (const s of subRes.data?.submissions ?? []) {
      const data = (s.data ?? {}) as Record<string, unknown>;
      Object.keys(data).forEach((k) => {
        if (!k.startsWith("__")) allKeys.add(k);
      });
    }
    const existingKeys = new Set(mp.fieldMappings.map((f) => f.questionId));
    const seeded = [
      ...mp.fieldMappings,
      ...Array.from(allKeys)
        .filter((k) => !existingKeys.has(k))
        .map((k) => ({ questionId: k, questionTitle: k, crmField: "ignore" })),
    ];
    setMapping({ ...mp, fieldMappings: seeded });
    setTagsDraft((mp.defaultTags ?? []).join(", "));
    setStatusDraft(mp.defaultStatus ?? "");
  };

  const saveMapping = async () => {
    if (!selected || !mapping) return;
    setSavingMapping(true);
    const tags = tagsDraft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const res = await apiPostSimple(
      `/connect/businesses/${businessId}/connector-forms/${source}/${selected.externalFormId}/mapping`,
      {
        formTitle: mapping.formTitle ?? selected.name,
        fieldMappings: mapping.fieldMappings.filter((f) => f.crmField !== "ignore"),
        defaultTags: tags,
        defaultStatus: statusDraft || null,
        autoCreate: mapping.autoCreate ?? true,
      },
    );
    setSavingMapping(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Mapping saved");
      await load();
    }
  };

  const runBackfill = async () => {
    if (!selected) return;
    setBackfilling(true);
    const res = await apiPostSimple<{
      responsesProcessed: number;
      contactsCreated: number;
      responsesSkipped: number;
    }>(
      `/connect/businesses/${businessId}/connector-forms/${source}/${selected.leadFormId}/backfill`,
      {},
    );
    setBackfilling(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success(
        `Processed ${res.data?.responsesProcessed ?? 0} (created ${res.data?.contactsCreated ?? 0} contacts)`,
      );
      await load();
    }
  };

  if (view === "mapping" && selected) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => {
            setView("list");
            setSelected(null);
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to list
        </button>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold inline-flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Mapping for {selected.name}
          </h3>
          <Button size="sm" onClick={saveMapping} disabled={savingMapping}>
            {savingMapping ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
            Save mapping
          </Button>
        </div>

        {mappingLoading || !mapping ? (
          <div className="h-40 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
        ) : mapping.fieldMappings.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No submissions captured yet. Send a test submission and refresh — fields will appear automatically.
          </p>
        ) : (
          <div className="rounded-2xl border border-border/40 bg-card/40 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/10">
                <tr>
                  <th className="text-left px-3 py-2">Submission key</th>
                  <th className="text-left px-3 py-2">CRM field</th>
                </tr>
              </thead>
              <tbody>
                {mapping.fieldMappings.map((m, idx) => (
                  <tr key={m.questionId} className="border-t border-border/30">
                    <td className="px-3 py-2 font-mono">{m.questionId}</td>
                    <td className="px-3 py-2">
                      <select
                        value={m.crmField}
                        onChange={(e) => {
                          const next = [...mapping.fieldMappings];
                          next[idx] = { ...next[idx], crmField: e.target.value };
                          setMapping({ ...mapping, fieldMappings: next });
                        }}
                        className="rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-xs"
                      >
                        {CRM_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="rounded-2xl border border-border/40 bg-card/40 p-4 space-y-3">
          <h4 className="text-xs font-semibold inline-flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-amber-400" />
            Defaults applied to every new contact
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Default tags (comma)
              </label>
              <input
                value={tagsDraft}
                onChange={(e) => setTagsDraft(e.target.value)}
                placeholder="lead, webform"
                className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Default status
              </label>
              <input
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value)}
                placeholder="LEAD"
                className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={mapping?.autoCreate ?? true}
              onChange={(e) =>
                setMapping((prev) => (prev ? { ...prev, autoCreate: e.target.checked } : prev))
              }
            />
            Auto-create contacts from new submissions
          </label>
        </div>
      </div>
    );
  }

  if (view === "responses" && selected) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setView("list");
              setSelected(null);
            }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to list
          </button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => openMapping(selected)}>
              <Settings2 className="h-3 w-3 mr-1" />
              Edit mapping
            </Button>
            <Button size="sm" onClick={runBackfill} disabled={backfilling || !selected.hasMapping}>
              {backfilling ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              Backfill to CRM
            </Button>
          </div>
        </div>
        <h3 className="text-sm font-semibold">{selected.name}</h3>
        {!selected.hasMapping && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            No field mapping yet — set one before backfilling so fields land in the right CRM columns.
          </div>
        )}
        {submissionsLoading ? (
          <div className="h-40 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
        ) : submissions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No submissions yet.</p>
        ) : (
          <div className="space-y-2">
            {submissions.map((s) => {
              const data = (s.data ?? {}) as Record<string, unknown>;
              const entries = Object.entries(data).filter(([k]) => !k.startsWith("__"));
              return (
                <div
                  key={s.id}
                  className="rounded-xl border border-border/30 bg-card/40 p-3 text-xs"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-muted-foreground">{formatDate(s.createdAt)}</span>
                    {s.contactId ? (
                      <Link
                        href={`/app/crm/contacts/${s.contactId}`}
                        className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                      >
                        Contact linked
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    ) : (
                      <Badge tone="warning" className="text-[9px]">
                        No contact
                      </Badge>
                    )}
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
                    {entries.slice(0, 12).map(([k, v]) => (
                      <div key={k} className="truncate">
                        <span className="text-muted-foreground">{k}: </span>
                        <span>{typeof v === "string" ? v : JSON.stringify(v)}</span>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Forms appear here automatically the first time a submission arrives.
        </p>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Refresh
        </Button>
      </div>
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}
      {loading ? (
        <div className="h-40 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
      ) : forms.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No submissions yet"
          description="Once your form sends a submission to KeyFlow, it will appear here."
          actionLabel="Open KeyFlow Connect"
          onAction={() => (window.location.href = "/app/connect")}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {forms.map((f) => (
            <div
              key={f.leadFormId}
              className="rounded-2xl border border-border/40 bg-card/40 p-4"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold truncate">{f.name}</h3>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {f.externalFormId}
                  </div>
                </div>
                <Badge tone={f.hasMapping ? "success" : "default"} className="text-[9px]">
                  {f.hasMapping ? "Mapped" : "No mapping"}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <Badge tone="info" className="text-[9px]">
                  {f.processedCount} processed
                </Badge>
                <Badge tone={f.pendingCount > 0 ? "warning" : "default"} className="text-[9px]">
                  {f.pendingCount} pending
                </Badge>
                <span>· {f.submissionCount} total</span>
                {!f.autoCreate && (
                  <Badge tone="default" className="text-[9px]">
                    Auto-create off
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {f.lastBackfillAt ? `Last backfill ${formatDate(f.lastBackfillAt)}` : "Never backfilled"}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
                <Button size="sm" variant="ghost" onClick={() => openForm(f)}>
                  <Inbox className="h-3 w-3 mr-1" />
                  Responses
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openMapping(f)}>
                  <Settings2 className="h-3 w-3 mr-1" />
                  Mapping
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DashboardConnectionEntry {
  meta: { type: string; name?: string };
  health: { status: string };
}

function ProviderDisconnected({
  label,
  onConnect,
}: {
  label: string;
  onConnect: () => void;
}) {
  return (
    <EmptyState
      icon={Webhook}
      title={`${label} isn't connected yet`}
      description={`Connect ${label} from KeyFlow Connect to start ingesting submissions and mapping them to CRM contacts.`}
      actionLabel={`Connect ${label}`}
      onAction={onConnect}
    />
  );
}

export default function ConnectFormsPage() {
  const businessId = getStoredBusinessId();
  const [tab, setTab] = useState<Provider>("google");
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!businessId) return;
    apiGet<DashboardConnectionEntry[]>(
      `/connectors/businesses/${businessId}/dashboard`,
    ).then((res) => {
      if (res.data) {
        const map: Record<string, string> = {};
        for (const e of res.data) map[e.meta.type] = e.health.status;
        setStatuses(map);
      }
    });
  }, [businessId]);

  const providerStatus = (p: Provider): string => {
    if (p === "google") return statuses.google_forms ?? statuses.google ?? "unknown";
    return statuses[p] ?? "unknown";
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <Link
        href="/app/connect"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to KeyFlow Connect
      </Link>
      <PageHeader
        icon={FileText}
        title="Forms"
        subtitle="Unified inbox for Google Forms, Typeform, Jotform and webhook submissions."
      />

      <div className="flex items-center gap-1 border-b border-border/40 overflow-x-auto">
        {PROVIDER_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          const st = providerStatus(t.id);
          const connected = st === "connected";
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? "border-emerald-400 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              } ${connected ? "" : "opacity-60"}`}
              title={connected ? `${t.label} connected` : `${t.label} not connected`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  connected ? "bg-emerald-400" : "bg-muted-foreground/40"
                }`}
              />
            </button>
          );
        })}
      </div>

      {!businessId ? (
        <EmptyState
          icon={FileText}
          title="No active business"
          description="Pick an active workspace before browsing forms."
        />
      ) : providerStatus(tab) !== "connected" && Object.keys(statuses).length > 0 ? (
        <ProviderDisconnected
          label={PROVIDER_TABS.find((t) => t.id === tab)?.label ?? tab}
          onConnect={() => (window.location.href = "/app/connect")}
        />
      ) : tab === "google" ? (
        <GoogleFormsTab businessId={businessId} />
      ) : (
        <ConnectorFormsTab businessId={businessId} source={tab} />
      )}
    </div>
  );
}
