"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Send, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { approveDraft, rejectDraft, sendDraft, updateDraft } from "@/lib/api/omnichannel";

export interface DraftItem {
  id: string;
  channel: string;
  purpose: string;
  body: string;
  tone: string | null;
  status: string;
  requiresApproval: boolean;
  riskTier: number;
  createdAt: string;
  sentAt: string | null;
}

interface ResponseDraftPanelProps {
  businessId: string;
  drafts: DraftItem[];
  onMutate?: () => void;
}

export function ResponseDraftPanel({ businessId, drafts, onMutate }: ResponseDraftPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const handleApprove = async (draftId: string) => {
    setLoadingId(draftId);
    try {
      await approveDraft(businessId, draftId);
      onMutate?.();
    } finally {
      setLoadingId(null);
    }
  };

  const handleReject = async (draftId: string) => {
    setLoadingId(draftId);
    try {
      await rejectDraft(businessId, draftId, "Rejected by user");
      onMutate?.();
    } finally {
      setLoadingId(null);
    }
  };

  const handleSend = async (draftId: string) => {
    setLoadingId(draftId);
    try {
      await sendDraft(businessId, draftId);
      onMutate?.();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Failed to send draft");
    } finally {
      setLoadingId(null);
    }
  };

  const startEdit = (draft: DraftItem) => {
    setEditingId(draft.id);
    setEditBody(draft.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditBody("");
  };

  const handleSave = async (draftId: string) => {
    if (!editBody.trim()) return;
    setSavingId(draftId);
    try {
      await updateDraft(businessId, draftId, editBody.trim());
      cancelEdit();
      onMutate?.();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Failed to save draft");
    } finally {
      setSavingId(null);
    }
  };

  if (!drafts.length) {
    return (
      <div className="rounded-lg border p-6 text-center text-muted-foreground">
        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
        <p className="text-sm">No pending drafts. KEY will draft replies when new messages arrive.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {drafts.map((draft) => (
        <div
          key={draft.id}
          className={`rounded-lg border p-4 space-y-3 ${
            draft.status === "PENDING_APPROVAL"
              ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20"
              : draft.status === "APPROVED"
                ? "border-green-200 bg-green-50/50 dark:bg-green-950/20"
                : "bg-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs capitalize">
                {draft.channel}
              </Badge>
              <span className="text-sm font-medium">{draft.purpose}</span>
              {draft.requiresApproval && (
                <Badge variant="secondary" className="text-xs">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Approval Required
                </Badge>
              )}
              {draft.riskTier >= 3 && (
                <Badge variant="destructive" className="text-xs">
                  High Risk
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {new Date(draft.createdAt).toLocaleTimeString()}
            </span>
          </div>

          {editingId === draft.id ? (
            <Textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="min-h-[120px]"
            />
          ) : (
            <div className="text-sm leading-relaxed whitespace-pre-wrap bg-muted/50 rounded-md p-3">
              {draft.body}
            </div>
          )}

          <div className="flex items-center gap-2">
            {draft.status === "PENDING_APPROVAL" && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleApprove(draft.id)}
                  disabled={loadingId === draft.id}
                >
                  {loadingId === draft.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                  )}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReject(draft.id)}
                  disabled={loadingId === draft.id}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={() => startEdit(draft)}>
                  Edit
                </Button>
              </>
            )}

            {draft.status === "APPROVED" && (
              <Button
                size="sm"
                variant="default"
                onClick={() => handleSend(draft.id)}
                disabled={loadingId === draft.id}
              >
                {loadingId === draft.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                Send
              </Button>
            )}

            {draft.status === "SENT" && (
              <Badge variant="outline" className="text-xs text-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Sent {draft.sentAt && new Date(draft.sentAt).toLocaleTimeString()}
              </Badge>
            )}

            {editingId === draft.id && (
              <>
                <Button size="sm" variant="ghost" onClick={cancelEdit}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleSave(draft.id)}
                  disabled={savingId === draft.id}
                >
                  {savingId === draft.id ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : null}
                  Save Draft
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
