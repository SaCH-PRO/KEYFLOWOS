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
} from "lucide-react";
import { Button } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { apiGet } from "@/lib/api";
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

function formatDateTime(s?: string) {
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

export default function ConnectFormDetailPage() {
  const params = useParams<{ formId: string }>();
  const formId = decodeURIComponent(params?.formId ?? "");
  const businessId = getStoredBusinessId();
  const [detail, setDetail] = useState<FormDetail | null>(null);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId || !formId) {
      setLoading(false);
      setError("Missing business or form id.");
      return;
    }
    setError(null);
    setRefreshing(true);
    const [d, r] = await Promise.all([
      apiGet<FormDetail>(
        `/connect/businesses/${businessId}/forms/${encodeURIComponent(formId)}`,
      ),
      apiGet<ResponsesPayload>(
        `/connect/businesses/${businessId}/forms/${encodeURIComponent(formId)}/responses`,
      ),
    ]);
    if (d.error) {
      setError(d.error);
    } else if (d.data) {
      setDetail(d.data);
    }
    if (!r.error && r.data) {
      setResponses(r.data.responses ?? []);
    } else if (r.error && !d.error) {
      setError(r.error);
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

  const sortedResponses = useMemo(
    () =>
      [...responses].sort((a, b) =>
        (b.lastSubmittedTime ?? b.createTime ?? "").localeCompare(
          a.lastSubmittedTime ?? a.createTime ?? "",
        ),
      ),
    [responses],
  );

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
