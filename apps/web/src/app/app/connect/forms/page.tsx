"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Loader2,
  RefreshCw,
  Plus,
  ExternalLink,
  Trash2,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiGet, apiPostSimple, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface DriveForm {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

interface FormsListResponse {
  files?: DriveForm[];
  nextPageToken?: string;
}

function formatDate(s?: string) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-TT", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

export default function ConnectFormsPage() {
  const businessId = getStoredBusinessId();
  const [forms, setForms] = useState<DriveForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [confirm, setConfirm] = useState<{
    open: boolean;
    formId: string;
    name: string;
  }>({ open: false, formId: "", name: "" });
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      setError("No active business — pick a workspace first.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await apiGet<FormsListResponse>(
      `/connect/businesses/${businessId}/forms`,
    );
    if (res.error) {
      setError(res.error);
    } else {
      setForms(res.data?.files ?? []);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!businessId || !draftTitle.trim()) return;
    setCreating(true);
    const res = await apiPostSimple<{ formId?: string }>(
      `/connect/businesses/${businessId}/forms`,
      { title: draftTitle.trim(), description: draftDesc.trim() || undefined },
    );
    setCreating(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Form created");
      setShowCreate(false);
      setDraftTitle("");
      setDraftDesc("");
      await load();
    }
  };

  const requestDelete = (form: DriveForm) =>
    setConfirm({ open: true, formId: form.id, name: form.name });

  const performDelete = async () => {
    if (!businessId) return;
    setBusyId(confirm.formId);
    const res = await apiDelete<unknown>(
      `/connect/businesses/${businessId}/forms/${encodeURIComponent(confirm.formId)}`,
    );
    setBusyId(null);
    setConfirm({ open: false, formId: "", name: "" });
    if (res.error) {
      toast.error(res.error);
    } else {
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
        title="Google Forms"
        subtitle="Browse the forms in your connected Google Drive and review responses."
        actionLabel="New form"
        onAction={() => setShowCreate(true)}
        rightSlot={
          <Button
            size="sm"
            variant="ghost"
            onClick={load}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
        }
      />

      {showCreate && (
        <div className="rounded-2xl border border-border/50 p-4 bg-card/50 space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Title
            </label>
            <input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Customer feedback"
              className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1)/0.5)]"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Description (optional)
            </label>
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1)/0.5)]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowCreate(false);
                setDraftTitle("");
                setDraftDesc("");
              }}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!draftTitle.trim() || creating}
            >
              {creating ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Plus className="h-3 w-3 mr-1" />
              )}
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
            <div
              key={i}
              className="h-20 rounded-2xl bg-muted/10 border border-border/20"
            />
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
                    <h3 className="text-sm font-semibold truncate">
                      {form.name}
                    </h3>
                  </div>
                  <div className="text-[11px] text-muted-foreground space-x-2">
                    <span>Modified {formatDate(form.modifiedTime)}</span>
                    <span className="opacity-50">·</span>
                    <span>Created {formatDate(form.createdTime)}</span>
                  </div>
                </div>
                {form.webViewLink && (
                  <a
                    href={form.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Open in Google Forms"
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
                  View responses
                  <ChevronRight className="h-3 w-3" />
                </Link>
                <div className="ml-auto">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => requestDelete(form)}
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
