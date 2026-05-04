"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Inbox,
  Save,
  Download,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface FormItem {
  itemId: string;
  title?: string;
  description?: string;
  questionItem?: {
    question?: {
      questionId?: string;
      required?: boolean;
      choiceQuestion?: {
        type?: string;
        options?: Array<{ value?: string }>;
      };
      textQuestion?: { paragraph?: boolean };
    };
  };
}

interface FormDetail {
  formId: string;
  info?: { title?: string; description?: string; documentTitle?: string };
  responderUri?: string;
  items?: FormItem[];
}

interface ResponseAnswer {
  questionId: string;
  textAnswers?: { answers?: Array<{ value?: string }> };
  fileUploadAnswers?: { answers?: Array<{ fileName?: string; fileId?: string }> };
}

interface FormResponse {
  responseId: string;
  createTime?: string;
  lastSubmittedTime?: string;
  respondentEmail?: string;
  answers?: Record<string, ResponseAnswer>;
}

interface ResponsesPayload {
  responses?: FormResponse[];
  nextPageToken?: string;
}

type CrmField =
  | "ignore"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "companyName"
  | "jobTitle"
  | "addressLine1"
  | "city"
  | "state"
  | "postalCode"
  | "country"
  | "notesInternal"
  | "tag"
  | "opportunity.title"
  | "opportunity.description"
  | "opportunity.budget"
  | "opportunity.notes";

interface FieldMappingEntry {
  questionId: string;
  questionTitle?: string;
  crmField: CrmField;
}

interface OpportunityDefaults {
  enabled: boolean;
  titleTemplate?: string;
  defaultBudget?: number;
  defaultCurrency?: string;
  defaultStatus?: string;
}

interface MappingPayload {
  id?: string;
  fieldMappings?: FieldMappingEntry[];
  opportunityDefaults?: OpportunityDefaults | null;
  autoCreate?: boolean;
  responsesProcessed?: number;
  contactsCreated?: number;
  opportunitiesCreated?: number;
  lastBackfillAt?: string | null;
  lastSeenResponseTime?: string | null;
}

const CRM_FIELD_OPTIONS: Array<{ value: CrmField; label: string; group: string }> = [
  { value: "ignore", label: "— Don't map —", group: "" },
  { value: "firstName", label: "First name", group: "Contact" },
  { value: "lastName", label: "Last name", group: "Contact" },
  { value: "email", label: "Email", group: "Contact" },
  { value: "phone", label: "Phone", group: "Contact" },
  { value: "companyName", label: "Company", group: "Contact" },
  { value: "jobTitle", label: "Job title", group: "Contact" },
  { value: "addressLine1", label: "Address", group: "Contact" },
  { value: "city", label: "City", group: "Contact" },
  { value: "state", label: "State / Region", group: "Contact" },
  { value: "postalCode", label: "Postal code", group: "Contact" },
  { value: "country", label: "Country", group: "Contact" },
  { value: "notesInternal", label: "Internal note", group: "Contact" },
  { value: "tag", label: "Add as tag", group: "Contact" },
  { value: "opportunity.title", label: "Title", group: "Opportunity" },
  { value: "opportunity.description", label: "Description", group: "Opportunity" },
  { value: "opportunity.budget", label: "Budget", group: "Opportunity" },
  { value: "opportunity.notes", label: "Notes", group: "Opportunity" },
];

function formatDateTime(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-TT", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function answerText(a?: ResponseAnswer): string {
  if (!a) return "—";
  const text = a.textAnswers?.answers
    ?.map((x) => x.value)
    .filter(Boolean)
    .join(", ");
  if (text) return text;
  const files = a.fileUploadAnswers?.answers
    ?.map((x) => x.fileName)
    .filter(Boolean)
    .join(", ");
  return files || "—";
}

function guessCrmField(title?: string): CrmField {
  const t = (title ?? "").toLowerCase();
  if (!t) return "ignore";
  if (t.includes("first") && t.includes("name")) return "firstName";
  if (t.includes("last") && t.includes("name")) return "lastName";
  if (t === "name" || t.includes("full name")) return "firstName";
  if (t.includes("email")) return "email";
  if (t.includes("phone") || t.includes("mobile") || t.includes("whatsapp"))
    return "phone";
  if (t.includes("company") || t.includes("business") || t.includes("organisation"))
    return "companyName";
  if (t.includes("title") || t.includes("role") || t.includes("position"))
    return "jobTitle";
  if (t.includes("address")) return "addressLine1";
  if (t.includes("city")) return "city";
  if (t.includes("state") || t.includes("region")) return "state";
  if (t.includes("zip") || t.includes("postal")) return "postalCode";
  if (t.includes("country")) return "country";
  if (t.includes("budget") || t.includes("price")) return "opportunity.budget";
  if (t.includes("service") || t.includes("project") || t.includes("interested"))
    return "opportunity.title";
  if (t.includes("message") || t.includes("note") || t.includes("describe"))
    return "opportunity.description";
  return "ignore";
}

export default function ConnectFormDetailPage() {
  const params = useParams<{ formId: string }>();
  const formId = decodeURIComponent(params?.formId ?? "");
  const businessId = getStoredBusinessId();
  const [detail, setDetail] = useState<FormDetail | null>(null);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [mapping, setMapping] = useState<MappingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [draftMappings, setDraftMappings] = useState<Record<string, CrmField>>({});
  const [draftOpp, setDraftOpp] = useState<OpportunityDefaults>({
    enabled: false,
    defaultCurrency: "TTD",
    defaultStatus: "DRAFT",
  });
  const [autoCreate, setAutoCreate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const load = useCallback(async () => {
    if (!businessId || !formId) {
      setLoading(false);
      setError("Missing business or form id.");
      return;
    }
    setError(null);
    setRefreshing(true);
    const [d, r, m] = await Promise.all([
      apiGet<FormDetail>(
        `/connect/businesses/${businessId}/forms/${encodeURIComponent(formId)}`,
      ),
      apiGet<ResponsesPayload>(
        `/connect/businesses/${businessId}/forms/${encodeURIComponent(formId)}/responses`,
      ),
      apiGet<MappingPayload | null>(
        `/connect/businesses/${businessId}/forms/${encodeURIComponent(formId)}/mapping`,
      ),
    ]);
    if (d.error) setError(d.error);
    else if (d.data) setDetail(d.data);
    if (!r.error && r.data) setResponses(r.data.responses ?? []);
    else if (r.error && !d.error) setError(r.error);
    if (!m.error && m.data) {
      setMapping(m.data);
      const draft: Record<string, CrmField> = {};
      (m.data.fieldMappings ?? []).forEach((entry) => {
        draft[entry.questionId] = entry.crmField;
      });
      setDraftMappings(draft);
      if (m.data.opportunityDefaults) setDraftOpp(m.data.opportunityDefaults);
      setAutoCreate(m.data.autoCreate ?? true);
    }
    setLoading(false);
    setRefreshing(false);
  }, [businessId, formId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const questionsById = useMemo(() => {
    const map: Record<string, { title: string; order: number }> = {};
    (detail?.items ?? []).forEach((item, i) => {
      const qId = item.questionItem?.question?.questionId;
      if (qId) {
        map[qId] = {
          title: item.title ?? `Question ${i + 1}`,
          order: i,
        };
      }
    });
    return map;
  }, [detail]);

  const orderedQuestions = useMemo(
    () =>
      Object.entries(questionsById)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([id, meta]) => ({ id, ...meta })),
    [questionsById],
  );

  const openMappingEditor = useCallback(() => {
    setDraftMappings((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const q of orderedQuestions) {
        if (!(q.id in next)) {
          next[q.id] = guessCrmField(q.title);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setShowMapping(true);
  }, [orderedQuestions]);

  const sortedResponses = useMemo(
    () =>
      [...responses].sort((a, b) =>
        (b.lastSubmittedTime ?? b.createTime ?? "").localeCompare(
          a.lastSubmittedTime ?? a.createTime ?? "",
        ),
      ),
    [responses],
  );

  const saveMapping = async () => {
    if (!businessId) return;
    setSaving(true);
    const fieldMappings: FieldMappingEntry[] = orderedQuestions.map((q) => ({
      questionId: q.id,
      questionTitle: q.title,
      crmField: draftMappings[q.id] ?? "ignore",
    }));
    const res = await apiPostSimple<MappingPayload>(
      `/connect/businesses/${businessId}/forms/${encodeURIComponent(formId)}/mapping`,
      {
        formTitle: detail?.info?.title ?? detail?.info?.documentTitle ?? null,
        fieldMappings,
        opportunityDefaults: draftOpp.enabled ? draftOpp : null,
        autoCreate,
      },
    );
    setSaving(false);
    if (res.error) {
      toast.error(`Save failed: ${res.error}`);
      return;
    }
    setMapping(res.data ?? null);
    toast.success("Mapping saved");
  };

  const runBackfill = async () => {
    if (!businessId || !mapping) return;
    setBackfilling(true);
    const res = await apiPostSimple<{
      responsesProcessed: number;
      contactsCreated: number;
      opportunitiesCreated: number;
      errors: string[];
    }>(
      `/connect/businesses/${businessId}/forms/${encodeURIComponent(formId)}/backfill`,
      {},
    );
    setBackfilling(false);
    if (res.error) {
      toast.error(`Backfill failed: ${res.error}`);
      return;
    }
    const d = res.data;
    toast.success(
      `Imported ${d?.responsesProcessed ?? 0} response(s) — ${d?.contactsCreated ?? 0} new contact(s)` +
        (d?.opportunitiesCreated ? `, ${d.opportunitiesCreated} opportunity` : ""),
    );
    if (d?.errors?.length) toast.warning(`${d.errors.length} response(s) had errors`);
    await load();
  };

  const hasMapping = (mapping?.fieldMappings?.length ?? 0) > 0;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <Link
        href="/app/connect/forms"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to all forms
      </Link>
      <PageHeader
        icon={FileText}
        title={detail?.info?.title || detail?.info?.documentTitle || "Form"}
        subtitle={
          detail?.info?.description ?? "Responses pulled directly from Google Forms."
        }
        rightSlot={
          <div className="flex items-center gap-2">
            {detail?.responderUri && (
              <a
                href={detail.responderUri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border/50 px-2 py-1 rounded-lg"
              >
                <ExternalLink className="h-3 w-3" />
                Live form
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (showMapping ? setShowMapping(false) : openMappingEditor())}
            >
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              {hasMapping ? "Edit CRM mapping" : "Map to CRM"}
            </Button>
            {hasMapping && (
              <Button
                size="sm"
                variant="ghost"
                onClick={runBackfill}
                disabled={backfilling}
              >
                {backfilling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                )}
                Backfill to CRM
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={load}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Refresh
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {hasMapping && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <strong className="text-foreground">{mapping?.responsesProcessed ?? 0}</strong>{" "}
            responses processed
          </span>
          <span>
            <strong className="text-foreground">{mapping?.contactsCreated ?? 0}</strong>{" "}
            contacts created
          </span>
          <span>
            <strong className="text-foreground">
              {mapping?.opportunitiesCreated ?? 0}
            </strong>{" "}
            opportunities created
          </span>
          {mapping?.lastBackfillAt && (
            <span>Last backfill: {formatDateTime(mapping.lastBackfillAt)}</span>
          )}
          <span>
            Auto-create on new responses:{" "}
            {mapping?.autoCreate ? "On" : "Off"}
          </span>
        </div>
      )}

      {showMapping && (
        <div className="rounded-2xl border border-border/40 bg-card/40 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-1">CRM field mapping</h3>
            <p className="text-xs text-muted-foreground">
              Choose which CRM property each form question fills when a response is
              imported.
            </p>
          </div>

          {orderedQuestions.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              This form has no questions yet.
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {orderedQuestions.map((q) => (
                <label key={q.id} className="flex flex-col gap-1 text-xs">
                  <span className="text-foreground/80 truncate" title={q.title}>
                    {q.title}
                  </span>
                  <select
                    className="bg-background border border-border/50 rounded-lg px-2 py-1.5 text-xs"
                    value={draftMappings[q.id] ?? "ignore"}
                    onChange={(e) =>
                      setDraftMappings((prev) => ({
                        ...prev,
                        [q.id]: e.target.value as CrmField,
                      }))
                    }
                  >
                    {CRM_FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.group ? `${opt.group} → ${opt.label}` : opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          <div className="border-t border-border/30 pt-3 space-y-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={autoCreate}
                onChange={(e) => setAutoCreate(e.target.checked)}
              />
              Automatically create CRM records when new responses arrive
            </label>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={draftOpp.enabled}
                onChange={(e) =>
                  setDraftOpp((p) => ({ ...p, enabled: e.target.checked }))
                }
              />
              Also create an opportunity (quote) for each lead
            </label>

            {draftOpp.enabled && (
              <div className="grid gap-2 md:grid-cols-3 pl-6">
                <input
                  type="text"
                  placeholder="Title template (use {form})"
                  className="bg-background border border-border/50 rounded-lg px-2 py-1.5 text-xs"
                  value={draftOpp.titleTemplate ?? ""}
                  onChange={(e) =>
                    setDraftOpp((p) => ({ ...p, titleTemplate: e.target.value }))
                  }
                />
                <input
                  type="number"
                  placeholder="Default budget"
                  className="bg-background border border-border/50 rounded-lg px-2 py-1.5 text-xs"
                  value={draftOpp.defaultBudget ?? ""}
                  onChange={(e) =>
                    setDraftOpp((p) => ({
                      ...p,
                      defaultBudget: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    }))
                  }
                />
                <input
                  type="text"
                  placeholder="Currency (e.g. TTD)"
                  className="bg-background border border-border/50 rounded-lg px-2 py-1.5 text-xs"
                  value={draftOpp.defaultCurrency ?? ""}
                  onChange={(e) =>
                    setDraftOpp((p) => ({
                      ...p,
                      defaultCurrency: e.target.value || undefined,
                    }))
                  }
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setShowMapping(false)}>
              Close
            </Button>
            <Button size="sm" onClick={saveMapping} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save mapping
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-72 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
      ) : sortedResponses.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No responses yet"
          description="Once people submit this form, their answers will appear here."
        />
      ) : (
        <div className="rounded-2xl border border-border/40 bg-card/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-muted/20 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">
                    Submitted
                  </th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">
                    Respondent
                  </th>
                  {orderedQuestions.map((q) => (
                    <th
                      key={q.id}
                      className="text-left px-3 py-2 font-medium whitespace-nowrap"
                    >
                      {q.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedResponses.map((r) => (
                  <tr
                    key={r.responseId}
                    className="border-t border-border/20 hover:bg-muted/10"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDateTime(r.lastSubmittedTime ?? r.createTime)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {r.respondentEmail ?? "—"}
                    </td>
                    {orderedQuestions.map((q) => (
                      <td key={q.id} className="px-3 py-2 align-top">
                        {answerText(r.answers?.[q.id])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border/30">
            {sortedResponses.length} response
            {sortedResponses.length === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
