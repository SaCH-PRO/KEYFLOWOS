"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPostSimple, apiPatch, apiDelete } from "@/lib/api";
import {
  ArrowLeft, FileText, Shield, AlertTriangle, CheckCircle2,
  Sparkles, Edit3, Save, Clock, Eye, ChevronDown, ChevronUp,
  Trash2, History, Copy,
} from "lucide-react";

interface DocumentSection {
  id: string;
  sectionKey: string;
  sectionName: string;
  content: string;
  contentSource: string;
  editableMode: string;
  riskScore: string;
  reviewRequired: boolean;
  lastModifiedBy: string | null;
  approvedBy: string | null;
  sortOrder: number;
}

interface DocumentVersion {
  id: string;
  versionNumber: number;
  status: string;
  approvalStatus: string | null;
  createdBy: string | null;
  changeNotes: string | null;
  createdAt: string;
}

interface ReviewTask {
  id: string;
  sectionKey: string | null;
  reviewType: string;
  status: string;
  notes: string | null;
  createdAt: string;
}

interface ChangeLog {
  id: string;
  changeType: string;
  auditLevel: string;
  sectionKey: string | null;
  changedBy: string | null;
  reason: string | null;
  createdAt: string;
}

interface DocInstance {
  id: string;
  title: string;
  status: string;
  healthStatus: string;
  healthReason: string | null;
  currentVersionNum: number;
  contextInputs: Record<string, string> | null;
  toneSettings: Record<string, string> | null;
  generationMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  documentType: { name: string; slug: string; riskTier: string; category: { name: string } };
  sections: DocumentSection[];
  versions: DocumentVersion[];
  reviewTasks: ReviewTask[];
  changeLogs: ChangeLog[];
}

function RiskBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    GREEN: "bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))]",
    YELLOW: "bg-[hsl(var(--kf-warning))]/15 text-[hsl(var(--kf-warning))]",
    RED: "bg-[hsl(var(--kf-error))]/15 text-[hsl(var(--kf-error))]",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors[tier] || colors.GREEN}`}>
      {tier === "RED" && <Shield className="w-3 h-3" />}
      {tier === "YELLOW" && <AlertTriangle className="w-3 h-3" />}
      {tier === "GREEN" && <CheckCircle2 className="w-3 h-3" />}
      {tier}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, { label: string; class: string }> = {
    AI_GENERATED: { label: "AI Generated", class: "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" },
    USER_EDITED: { label: "User Edited", class: "bg-[hsl(var(--kf-info))]/15 text-[hsl(var(--kf-info))]" },
    TEMPLATE: { label: "Template", class: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]" },
    APPROVED: { label: "Approved", class: "bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))]" },
  };
  const badge = labels[source] || labels.AI_GENERATED;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${badge.class}`}>{badge.label}</span>;
}

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const instanceId = params.instanceId as string;
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [tweakInstruction, setTweakInstruction] = useState("");
  const [tweaking, setTweaking] = useState(false);
  const [tweakSection, setTweakSection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadDoc = useCallback(async () => {
    const bid = getStoredBusinessId();
    if (!bid) return;
    setBusinessId(bid);
    setLoading(true);
    const res = await apiGet<DocInstance>(`/documents/businesses/${bid}/instances/${instanceId}`);
    if (res.data) setDoc(res.data);
    setLoading(false);
  }, [instanceId]);

  useEffect(() => { loadDoc(); }, [loadDoc]);

  const handleSaveSection = async (sectionKey: string) => {
    if (!businessId || !doc) return;
    setSaving(true);
    const res = await apiPatch<DocInstance>(`/documents/businesses/${businessId}/instances/${doc.id}/sections/${sectionKey}`, {
      content: editContent,
    });
    if (res.data) {
      setDoc(res.data);
      setEditingSection(null);
      setStatusMsg({ type: "success", message: "Section saved" });
    } else {
      setStatusMsg({ type: "error", message: res.error || "Failed to save" });
    }
    setSaving(false);
  };

  const handleTweak = async () => {
    if (!businessId || !doc || !tweakInstruction) return;
    setTweaking(true);
    const res = await apiPostSimple<DocInstance>(`/documents/businesses/${businessId}/instances/${doc.id}/tweak`, {
      instruction: tweakInstruction,
      sectionKey: tweakSection || undefined,
    });
    if (res.data) {
      setDoc(res.data);
      setTweakInstruction("");
      setTweakSection(null);
      setStatusMsg({ type: "success", message: "Document tweaked by AI" });
    } else {
      setStatusMsg({ type: "error", message: res.error || "Tweak failed" });
    }
    setTweaking(false);
  };

  const handleStatusChange = async (status: string) => {
    if (!businessId || !doc) return;
    const res = await apiPatch<DocInstance>(`/documents/businesses/${businessId}/instances/${doc.id}/status`, { status });
    if (res.data) {
      setDoc(res.data);
      setStatusMsg({ type: "success", message: `Status changed to ${status}` });
    } else {
      setStatusMsg({ type: "error", message: res.error || "Failed to update status" });
    }
  };

  const handleDelete = async () => {
    if (!businessId || !doc) return;
    if (!confirm("Delete this document? This cannot be undone.")) return;
    await apiDelete(`/documents/businesses/${businessId}/instances/${doc.id}`);
    router.push("/app/documents");
  };

  const handleResolveReview = async (reviewId: string) => {
    if (!businessId) return;
    await apiPatch(`/documents/businesses/${businessId}/reviews/${reviewId}`, { status: "RESOLVED", resolvedBy: "user" });
    loadDoc();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(var(--kf-accent1))]" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="text-center py-16">
        <p className="text-[hsl(var(--muted-foreground))]">Document not found</p>
        <button type="button" onClick={() => router.push("/app/documents")} className="mt-3 text-sm text-[hsl(var(--kf-accent1))] min-h-[44px]">
          Back to Documents
        </button>
      </div>
    );
  }

  const pendingReviews = doc.reviewTasks.filter((r) => r.status === "PENDING");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => router.push("/app/documents")} className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">{doc.title}</h1>
            <RiskBadge tier={doc.documentType.riskTier} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            <span>{doc.documentType.category.name}</span>
            <span>v{doc.currentVersionNum}</span>
            <span>Updated {new Date(doc.updatedAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={doc.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))]"
          >
            <option value="DRAFT">Draft</option>
            <option value="IN_REVIEW">In Review</option>
            <option value="APPROVED">Approved</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <button
            type="button"
            onClick={handleDelete}
            className="p-2 rounded-lg hover:bg-[hsl(var(--kf-error))]/10 text-[hsl(var(--kf-error))] min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors"
            title="Delete document"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className={`p-3 rounded-lg text-sm ${statusMsg.type === "success" ? "bg-[hsl(var(--kf-success))]/10 text-[hsl(var(--kf-success))]" : "bg-[hsl(var(--kf-error))]/10 text-[hsl(var(--kf-error))]"}`}>
          {statusMsg.message}
          <button type="button" onClick={() => setStatusMsg(null)} className="ml-2 opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {pendingReviews.length > 0 && (
        <div className="p-4 rounded-xl bg-[hsl(var(--kf-warning))]/10 border border-[hsl(var(--kf-warning))]/20">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="w-4 h-4 text-[hsl(var(--kf-warning))]" />
            <span className="text-sm font-medium text-[hsl(var(--kf-warning))]">{pendingReviews.length} Pending Review(s)</span>
          </div>
          {pendingReviews.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 border-t border-[hsl(var(--kf-warning))]/10">
              <div className="text-xs text-[hsl(var(--foreground))]">
                {r.notes || r.reviewType.replace(/_/g, " ")}
                {r.sectionKey && <span className="text-[hsl(var(--muted-foreground))]"> ({r.sectionKey})</span>}
              </div>
              <button
                type="button"
                onClick={() => handleResolveReview(r.id)}
                className="text-xs px-3 py-1 rounded-lg bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))] min-h-[36px] hover:bg-[hsl(var(--kf-success))]/25 transition-colors"
              >
                Resolve
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="p-4 rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <span className="text-sm font-medium text-[hsl(var(--foreground))]">AI Tweak</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">Describe what you want changed</span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={tweakInstruction}
              onChange={(e) => setTweakInstruction(e.target.value)}
              placeholder='e.g. "Make it more premium" or "Stronger late payment protection"'
              className="flex-1 px-3 py-2 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
              onKeyDown={(e) => e.key === "Enter" && handleTweak()}
            />
            <select
              value={tweakSection || ""}
              onChange={(e) => setTweakSection(e.target.value || null)}
              className="px-2 py-2 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-xs min-h-[44px] text-[hsl(var(--foreground))] max-w-[140px]"
            >
              <option value="">All Sections</option>
              {doc.sections.map((s) => (
                <option key={s.sectionKey} value={s.sectionKey}>{s.sectionName}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleTweak}
            disabled={tweaking || !tweakInstruction}
            className="px-4 py-2 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium min-h-[44px] hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {tweaking ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Sparkles className="w-4 h-4" />}
            Tweak
          </button>
        </div>
        <div className="flex gap-2 mt-2 flex-wrap">
          {["Make it more concise", "More professional tone", "Stronger protection", "Friendlier language", "Add more detail"].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setTweakInstruction(suggestion)}
              className="px-2.5 py-1 rounded-full border border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--kf-accent1))]/30 transition-colors min-h-[32px]"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {doc.sections.map((section) => (
          <div key={section.id} className="rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{section.sectionName}</h3>
                <RiskBadge tier={section.riskScore} />
                <SourceBadge source={section.contentSource} />
                {section.editableMode === "RESTRICTED" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[hsl(var(--kf-error))]/10 text-[hsl(var(--kf-error))]">
                    <Shield className="w-3 h-3" /> Restricted
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {editingSection === section.sectionKey ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSaveSection(section.sectionKey)}
                      disabled={saving}
                      className="p-2 rounded-lg hover:bg-[hsl(var(--kf-success))]/10 text-[hsl(var(--kf-success))] min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSection(null)}
                      className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSection(section.sectionKey);
                        setEditContent(section.content);
                      }}
                      className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] min-h-[36px] min-w-[36px] flex items-center justify-center"
                      title="Edit section"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(section.content)}
                      className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] min-h-[36px] min-w-[36px] flex items-center justify-center"
                      title="Copy section"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="p-4">
              {editingSection === section.sectionKey ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={Math.max(6, section.content.split("\n").length + 2)}
                  className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--foreground))] font-mono resize-y"
                />
              ) : (
                <div className="text-sm text-[hsl(var(--foreground))] whitespace-pre-wrap leading-relaxed">
                  {section.content}
                </div>
              )}
            </div>
            {section.lastModifiedBy && (
              <div className="px-4 pb-3 text-xs text-[hsl(var(--muted-foreground))]">
                Last modified by: {section.lastModifiedBy}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setShowVersions(!showVersions)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
        >
          <History className="w-4 h-4" />
          Versions ({doc.versions.length})
          {showVersions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <button
          type="button"
          onClick={() => setShowAuditLog(!showAuditLog)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
        >
          <Clock className="w-4 h-4" />
          Audit Log ({doc.changeLogs.length})
          {showAuditLog ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {showVersions && (
        <div className="rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] p-4 space-y-2">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Version History</h3>
          {doc.versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between py-2 border-b border-[hsl(var(--border))] last:border-0">
              <div>
                <span className="text-sm font-medium text-[hsl(var(--foreground))]">v{v.versionNumber}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))] ml-2">{v.createdBy || "system"}</span>
                {v.changeNotes && <span className="text-xs text-[hsl(var(--muted-foreground))] ml-2">— {v.changeNotes}</span>}
              </div>
              <div className="flex items-center gap-2">
                {v.approvalStatus && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${v.approvalStatus === "APPROVED" ? "bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))]" : ""}`}>
                    {v.approvalStatus}
                  </span>
                )}
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{new Date(v.createdAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAuditLog && (
        <div className="rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] p-4 space-y-2">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Audit Log</h3>
          {doc.changeLogs.map((log) => (
            <div key={log.id} className="flex items-center justify-between py-2 border-b border-[hsl(var(--border))] last:border-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  log.auditLevel === "LOGIC" ? "bg-[hsl(var(--kf-info))]/15 text-[hsl(var(--kf-info))]" :
                  log.auditLevel === "FACT" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" :
                  "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                }`}>{log.auditLevel}</span>
                <span className="text-sm text-[hsl(var(--foreground))]">{log.changeType.replace(/_/g, " ")}</span>
                {log.sectionKey && <span className="text-xs text-[hsl(var(--muted-foreground))]">({log.sectionKey})</span>}
                {log.reason && <span className="text-xs text-[hsl(var(--muted-foreground))]">— {log.reason}</span>}
              </div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                {log.changedBy || "system"} · {new Date(log.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {doc.generationMeta && (
        <div className="rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] p-4">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-2">Generation Details</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-[hsl(var(--muted-foreground))]">Model</span>
              <div className="text-[hsl(var(--foreground))] font-medium">{(doc.generationMeta as Record<string, string>).model || "gpt-4o"}</div>
            </div>
            <div>
              <span className="text-[hsl(var(--muted-foreground))]">Profile Version</span>
              <div className="text-[hsl(var(--foreground))] font-medium">v{(doc.generationMeta as Record<string, number>).profileVersionNumber || 1}</div>
            </div>
            <div>
              <span className="text-[hsl(var(--muted-foreground))]">Risk Tier</span>
              <div><RiskBadge tier={(doc.generationMeta as Record<string, string>).riskTier || "GREEN"} /></div>
            </div>
            <div>
              <span className="text-[hsl(var(--muted-foreground))]">Generated</span>
              <div className="text-[hsl(var(--foreground))] font-medium">{new Date((doc.generationMeta as Record<string, string>).generatedAt || doc.createdAt).toLocaleDateString()}</div>
            </div>
          </div>
          {((doc.generationMeta as Record<string, string[]>).missingFields || []).length > 0 && (
            <div className="mt-3 p-2 rounded-lg bg-[hsl(var(--kf-warning))]/10 text-xs text-[hsl(var(--kf-warning))]">
              Missing profile fields: {((doc.generationMeta as Record<string, string[]>).missingFields).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
