// @keyflow:dormant
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useNavigationContext } from "@/lib/navigation-context";
import { TaskContinuityHeader } from "@/components/ui/task-continuity-header";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPostSimple, apiPatch, apiDelete } from "@/lib/api";
import {
  ArrowLeft,
  FileText,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Edit3,
  Save,
  Clock,
  Eye,
  ChevronDown,
  ChevronUp,
  Trash2,
  History,
  Copy,
  Cpu,
  Zap,
  Layers,
  DollarSign,
  Brain,
  Scale,
  Palette,
  Globe,
  BookOpen,
  Download,
  Printer,
  Mail,
  HardDrive,
  ExternalLink,
  Loader2,
  FolderOpen,
  Link2,
  Link2Off,
  X,
} from "lucide-react";
import GoogleDriveBrowser from "@/app/app/profile/components/google-drive-browser";
import sanitizeHtml from "sanitize-html";
import { RichSectionEditor } from "./rich-section-editor";

interface DocumentSection {
  id: string;
  sectionKey: string;
  sectionName: string;
  content: string;
  contentFormat: string;
  contentSource: string;
  editableMode: string;
  riskScore: string;
  reviewRequired: boolean;
  lastModifiedBy: string | null;
  approvedBy: string | null;
  sortOrder: number;
}

const SANITIZE_CONFIG = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "strong", "b", "em", "i", "u", "s", "sub", "sup",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "a",
    "table", "thead", "tbody", "tr", "th", "td",
    "span", "div",
    "img",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel", "title"],
    img: ["src", "alt", "title"],
    th: ["colspan", "rowspan", "style"],
    td: ["colspan", "rowspan", "style"],
    span: ["style"],
    div: ["style"],
  },
};

function sanitizeImportedHtml(html: string): string {
  // Google Docs export wraps content in <html><body>… — keep just the body.
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const inner = bodyMatch ? bodyMatch[1] : html;
  return sanitizeHtml(inner, SANITIZE_CONFIG);
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
  driveFileId: string | null;
  driveFileName: string | null;
  driveFileMimeType: string | null;
  driveLastSyncedAt: string | null;
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

const LAYER_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  "category-directive": { label: "Category Standards", icon: <BookOpen className="w-3 h-3" />, color: "text-[hsl(var(--kf-info))]" },
  "document-blueprint": { label: "Document Blueprint", icon: <Layers className="w-3 h-3" />, color: "text-[hsl(var(--kf-accent1))]" },
  "legal-framework": { label: "Legal Framework", icon: <Scale className="w-3 h-3" />, color: "text-[hsl(var(--kf-error))]" },
  "financial-standards": { label: "Financial Standards", icon: <DollarSign className="w-3 h-3" />, color: "text-[hsl(var(--kf-warning))]" },
  "modern-practices": { label: "Modern Practices", icon: <Zap className="w-3 h-3" />, color: "text-[hsl(var(--kf-success))]" },
  "legal-sensitivity": { label: "Legal Sensitivity", icon: <Shield className="w-3 h-3" />, color: "text-[hsl(var(--kf-error))]" },
  "financial-sensitivity": { label: "Financial Sensitivity", icon: <DollarSign className="w-3 h-3" />, color: "text-[hsl(var(--kf-warning))]" },
  "brand-sensitivity": { label: "Brand Sensitivity", icon: <Palette className="w-3 h-3" />, color: "text-[hsl(var(--kf-accent2))]" },
  "jurisdiction-sensitivity": { label: "Jurisdiction Aware", icon: <Globe className="w-3 h-3" />, color: "text-[hsl(var(--kf-info))]" },
};


function AiInsightsPanel({ meta, createdAt }: { meta: Record<string, unknown>; createdAt: string }) {
  const [expanded, setExpanded] = useState(false);

  const m = meta as Record<string, unknown>;
  const qualityLayers = (m.qualityLayers as string[]) || [];
  const hasBlueprint = m.hasBlueprint as boolean;
  const promptTokens = (m.promptTokens as number) || 0;
  const completionTokens = (m.completionTokens as number) || 0;
  const totalTokens = (m.totalTokens as number) || 0;
  const estimatedCost = (m.estimatedCost as number) || 0;
  const creditsUsed = (m.creditsUsed as number) || 0;
  const blueprintSections = (m.blueprintSections as number) || 0;
  const sectionsGenerated = (m.sectionsGenerated as number) || 0;
  const tokenBudget = (m.tokenBudget as number) || 0;
  const temperature = (m.temperature as number) || 0;
  const missingFields = (m.missingFields as string[]) || [];
  const model = (m.model as string) || "gpt-4o";
  const riskTier = (m.riskTier as string) || "GREEN";
  const profileVersion = (m.profileVersionNumber as number) || 1;
  const generatedAt = (m.generatedAt as string) || createdAt;

  const hasDetailedMeta = totalTokens > 0;

  return (
    <div className="rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-[hsl(var(--muted))]/30 transition-colors min-h-[44px]"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <span className="text-sm font-semibold text-[hsl(var(--foreground))]">AI Generation Insights</span>
          {hasDetailedMeta && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">
              {qualityLayers.length} quality layer{qualityLayers.length !== 1 ? "s" : ""} applied
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-[hsl(var(--muted-foreground))]" /> : <ChevronDown className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-[hsl(var(--border))]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
            <div className="p-3 rounded-lg bg-[hsl(var(--background))]">
              <div className="flex items-center gap-1.5 mb-1">
                <Cpu className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Model</span>
              </div>
              <div className="text-sm font-semibold text-[hsl(var(--foreground))]">{model}</div>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--background))]">
              <div className="flex items-center gap-1.5 mb-1">
                <Shield className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Risk Tier</span>
              </div>
              <div><RiskBadge tier={riskTier} /></div>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--background))]">
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Sections</span>
              </div>
              <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
                {sectionsGenerated > 0 ? sectionsGenerated : "—"}
                {blueprintSections > 0 && <span className="text-xs text-[hsl(var(--muted-foreground))] font-normal"> / {blueprintSections} planned</span>}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--background))]">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Generated</span>
              </div>
              <div className="text-sm font-semibold text-[hsl(var(--foreground))]">{new Date(generatedAt).toLocaleDateString()}</div>
            </div>
          </div>

          {hasDetailedMeta && (
            <>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wider">Token Usage & Cost</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div className="p-2.5 rounded-lg bg-[hsl(var(--background))] text-center">
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">Input</div>
                    <div className="text-sm font-bold text-[hsl(var(--foreground))]">{promptTokens.toLocaleString()}</div>
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))]">tokens</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[hsl(var(--background))] text-center">
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">Output</div>
                    <div className="text-sm font-bold text-[hsl(var(--foreground))]">{completionTokens.toLocaleString()}</div>
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))]">tokens</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[hsl(var(--background))] text-center">
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">Total</div>
                    <div className="text-sm font-bold text-[hsl(var(--foreground))]">{totalTokens.toLocaleString()}</div>
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))]">tokens</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[hsl(var(--background))] text-center">
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">API Cost</div>
                    <div className="text-sm font-bold text-[hsl(var(--kf-success))]">${estimatedCost.toFixed(4)}</div>
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))]">USD</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[hsl(var(--background))] text-center">
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">Credits</div>
                    <div className="text-sm font-bold text-[hsl(var(--kf-accent1))]">{creditsUsed}</div>
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))]">used</div>
                  </div>
                </div>
                {tokenBudget > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[10px] text-[hsl(var(--muted-foreground))] mb-1">
                      <span>Token utilization</span>
                      <span>{completionTokens.toLocaleString()} / {tokenBudget.toLocaleString()} budget</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[hsl(var(--kf-accent1))] transition-all"
                        style={{ width: `${Math.min(100, (completionTokens / tokenBudget) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {qualityLayers.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Layers className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                    <span className="text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wider">Quality Layers Applied</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {qualityLayers.map((layer) => {
                      const info = LAYER_LABELS[layer] || { label: layer, icon: <Layers className="w-3 h-3" />, color: "text-[hsl(var(--muted-foreground))]" };
                      return (
                        <span
                          key={layer}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-xs ${info.color}`}
                        >
                          {info.icon}
                          {info.label}
                        </span>
                      );
                    })}
                  </div>
                  {hasBlueprint && (
                    <p className="mt-2 text-[10px] text-[hsl(var(--muted-foreground))] leading-relaxed">
                      This document was generated using a specialized blueprint with {blueprintSections} predefined sections,
                      each with specific quality guidance, risk scores, and editing restrictions.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-[hsl(var(--border))]">
            <div className="text-xs">
              <span className="text-[hsl(var(--muted-foreground))]">Profile Version</span>
              <div className="text-[hsl(var(--foreground))] font-medium">v{profileVersion}</div>
            </div>
            {temperature > 0 && (
              <div className="text-xs">
                <span className="text-[hsl(var(--muted-foreground))]">Temperature</span>
                <div className="text-[hsl(var(--foreground))] font-medium">{temperature} {temperature <= 0.4 ? "(precise)" : temperature <= 0.7 ? "(balanced)" : "(creative)"}</div>
              </div>
            )}
            <div className="text-xs">
              <span className="text-[hsl(var(--muted-foreground))]">Blueprint</span>
              <div className="text-[hsl(var(--foreground))] font-medium">{hasBlueprint ? "Yes" : "Standard"}</div>
            </div>
          </div>

          {missingFields.length > 0 && (
            <div className="p-2.5 rounded-lg bg-[hsl(var(--kf-warning))]/10 border border-[hsl(var(--kf-warning))]/20">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--kf-warning))]" />
                <span className="text-xs font-medium text-[hsl(var(--kf-warning))]">Missing Profile Fields</span>
              </div>
              <p className="text-[10px] text-[hsl(var(--kf-warning))]/80">
                The following fields were not set in your business profile, so the AI used industry-appropriate defaults: {missingFields.join(", ")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getOriginContext, setCurrentMeta } = useNavigationContext();
  const { navigateBackWithFallback, getReturnLabel, getReturnHref } = useReturnNavigation({ fallback: "/app/documents" });
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
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveResult, setDriveResult] = useState<{ fileId: string; webViewLink: string } | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [driveStatus, setDriveStatus] = useState<{ connected: boolean; email?: string } | null>(null);
  const [importingFromDrive, setImportingFromDrive] = useState(false);
  const [savingBackToDrive, setSavingBackToDrive] = useState(false);
  const [autoSyncStatus, setAutoSyncStatus] = useState<"idle" | "pending" | "syncing" | "synced" | "error">("idle");
  const [autoSyncError, setAutoSyncError] = useState<string | null>(null);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSyncInFlightRef = useRef(false);
  const autoSyncPendingRef = useRef<DocInstance | null>(null);
  const [driveRemote, setDriveRemote] = useState<{
    hasRemoteChanges: boolean;
    hasLocalChanges: boolean;
    conflict: boolean;
    remoteModifiedTime: string | null;
    remoteName: string | null;
    error?: string;
  } | null>(null);
  const [pullingFromDrive, setPullingFromDrive] = useState(false);
  const [dismissedRemoteAt, setDismissedRemoteAt] = useState<string | null>(null);

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

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    apiGet<{ connected: boolean; email?: string }>(`/drive/businesses/${businessId}/status`).then((res) => {
      if (!cancelled && res.data) setDriveStatus(res.data);
    });
    return () => { cancelled = true; };
  }, [businessId]);

  useEffect(() => {
    if (doc?.title) {
      setCurrentMeta({ selectedEntityLabel: doc.title });
    }
  }, [doc?.title, setCurrentMeta]);

  const runAutoSync = useCallback(async () => {
    if (!businessId) return;
    if (autoSyncInFlightRef.current) return;
    const initial = autoSyncPendingRef.current;
    if (!initial || !initial.driveFileId) return;

    autoSyncInFlightRef.current = true;
    try {
      while (autoSyncPendingRef.current) {
        const instance = autoSyncPendingRef.current;
        autoSyncPendingRef.current = null;
        if (!instance.driveFileId) continue;

        setAutoSyncStatus("syncing");
        setAutoSyncError(null);
        try {
          const payload = {
            title: instance.title,
            sections: instance.sections.map((s) => ({ sectionName: s.sectionName, content: s.content })),
            documentType: instance.documentType.name,
            category: instance.documentType.category.name,
            version: instance.currentVersionNum,
          };
          const htmlRes = await apiPostSimple<{ html: string }>(
            `/drive/businesses/${businessId}/export-html`,
            payload,
          );
          if (!htmlRes.data?.html) {
            throw new Error(htmlRes.error || "Could not build HTML");
          }
          const writeRes = await apiPatch<{ fileId: string; webViewLink?: string }>(
            `/drive/businesses/${businessId}/files/${instance.driveFileId}/content`,
            { html: htmlRes.data.html },
          );
          if (!writeRes.data) {
            throw new Error(writeRes.error || "Failed to sync to Drive");
          }
          const syncedRes = await apiPatch<DocInstance>(
            `/documents/businesses/${businessId}/instances/${instance.id}/drive-synced`,
            {},
          );
          if (syncedRes.data) {
            setDoc(syncedRes.data);
          }
          if (!autoSyncPendingRef.current) {
            setAutoSyncStatus("synced");
          }
        } catch (err) {
          setAutoSyncStatus("error");
          setAutoSyncError(err instanceof Error ? err.message : "Sync failed");
          autoSyncPendingRef.current = null;
          break;
        }
      }
    } finally {
      autoSyncInFlightRef.current = false;
    }
  }, [businessId]);

  const scheduleAutoSync = useCallback((instance: DocInstance) => {
    if (!instance.driveFileId) return;
    autoSyncPendingRef.current = instance;
    setAutoSyncStatus("pending");
    setAutoSyncError(null);
    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncTimerRef.current = null;
      runAutoSync();
    }, 1500);
  }, [runAutoSync]);

  useEffect(() => {
    return () => {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    };
  }, []);

  // Poll Drive for remote changes when this document is linked. Skips while
  // the tab is hidden, an auto-sync is running, or the user is editing a
  // section, so we don't overwrite their work or waste API calls.
  useEffect(() => {
    if (!businessId || !doc?.driveFileId) {
      setDriveRemote(null);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (autoSyncInFlightRef.current || autoSyncPendingRef.current) return;
      if (editingSection || pullingFromDrive) return;
      const res = await apiGet<{
        linked: boolean;
        hasRemoteChanges: boolean;
        hasLocalChanges: boolean;
        conflict: boolean;
        remoteModifiedTime: string | null;
        remoteName: string | null;
        error?: string;
      }>(`/documents/businesses/${businessId}/instances/${doc.id}/drive-status`);
      if (cancelled) return;
      if (res.data?.linked) {
        setDriveRemote({
          hasRemoteChanges: res.data.hasRemoteChanges,
          hasLocalChanges: res.data.hasLocalChanges,
          conflict: res.data.conflict,
          remoteModifiedTime: res.data.remoteModifiedTime,
          remoteName: res.data.remoteName,
          error: res.data.error,
        });
      }
    };

    poll();
    const intervalId = setInterval(poll, 30_000);
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) poll();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [businessId, doc?.id, doc?.driveFileId, editingSection, pullingFromDrive]);

  const handlePullFromDrive = useCallback(async () => {
    if (!businessId || !doc?.driveFileId) return;
    if (driveRemote?.conflict) {
      const confirmed = confirm(
        "Both KeyflowOS and Google Drive have changes since the last sync. Pulling will REPLACE your local edits with the version from Drive. Continue?",
      );
      if (!confirmed) return;
    }
    setPullingFromDrive(true);
    setStatusMsg(null);
    const res = await apiPostSimple<DocInstance>(
      `/documents/businesses/${businessId}/instances/${doc.id}/pull-from-drive`,
      {},
    );
    if (res.data) {
      setDoc(res.data);
      setDriveRemote((prev) => prev ? { ...prev, hasRemoteChanges: false, hasLocalChanges: false, conflict: false } : prev);
      setDismissedRemoteAt(null);
      setStatusMsg({ type: "success", message: "Pulled latest changes from Google Drive" });
    } else {
      setStatusMsg({ type: "error", message: res.error || "Failed to pull from Drive" });
    }
    setPullingFromDrive(false);
  }, [businessId, doc?.id, doc?.driveFileId, driveRemote?.conflict]);

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
      if (res.data.driveFileId) {
        scheduleAutoSync(res.data);
      }
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

  const getDocPayload = () => {
    if (!doc) return null;
    return {
      title: doc.title,
      sections: doc.sections.map((s) => ({
        sectionName: s.sectionName,
        content: s.content,
        contentFormat: s.contentFormat || "PLAIN",
      })),
      documentType: doc.documentType.name,
      category: doc.documentType.category.name,
      version: doc.currentVersionNum,
    };
  };

  const handleSaveToDrive = async () => {
    if (!businessId || !doc) return;
    setSavingToDrive(true);
    setDriveResult(null);
    const payload = getDocPayload();
    const res = await apiPostSimple<{ fileId: string; webViewLink: string }>(
      `/drive/businesses/${businessId}/save-document`,
      payload,
    );
    if (res.data) {
      setDriveResult(res.data);
      setStatusMsg({ type: "success", message: "Document saved to Google Drive" });
    } else {
      setStatusMsg({ type: "error", message: res.error || "Failed to save to Google Drive. Make sure Drive is connected." });
    }
    setSavingToDrive(false);
  };

  const handleEmailDocument = async () => {
    if (!businessId || !doc) return;
    setEmailing(true);
    const res = await apiPostSimple<{ sent: boolean; reason?: string }>(
      `/documents/businesses/${businessId}/instances/${doc.id}/send-email`,
      {},
    );
    if (res.data?.sent) {
      setStatusMsg({ type: "success", message: "Document emailed to your inbox" });
    } else {
      setStatusMsg({ type: "error", message: res.data?.reason || res.error || "Failed to send email. Make sure Gmail is connected." });
    }
    setEmailing(false);
  };

  const handleDownload = () => {
    if (!doc) return;
    const text = [
      doc.title,
      `${doc.documentType.category.name} · ${doc.documentType.name} · Version ${doc.currentVersionNum}`,
      `Generated by KeyflowOS · ${new Date(doc.updatedAt).toLocaleDateString()}`,
      "",
      "═".repeat(60),
      "",
      ...doc.sections.flatMap((s) => [
        s.sectionName.toUpperCase(),
        "─".repeat(40),
        s.content,
        "",
      ]),
      "═".repeat(60),
      "This document was generated by KeyflowOS Business Documentation Engine",
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_")}_v${doc.currentVersionNum}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusMsg({ type: "success", message: "Document downloaded" });
  };

  const handlePickFromDrive = async (file: { id: string; name: string; mimeType: string; webViewLink?: string }) => {
    if (!businessId || !doc) return;
    setShowDrivePicker(false);
    setImportingFromDrive(true);
    setStatusMsg(null);
    try {
      const contentRes = await apiGet<{ html: string; mimeType: string; name: string }>(
        `/drive/businesses/${businessId}/files/${file.id}/content?as=html`,
      );
      if (!contentRes.data) {
        setStatusMsg({ type: "error", message: contentRes.error || "Failed to load Drive file content" });
        setImportingFromDrive(false);
        return;
      }

      const sanitized = sanitizeImportedHtml(contentRes.data.html);

      const importRes = await apiPostSimple<DocInstance>(
        `/documents/businesses/${businessId}/instances/${doc.id}/import-from-drive`,
        {
          driveFileId: file.id,
          driveFileName: file.name,
          driveFileMimeType: file.mimeType,
          content: sanitized,
          contentFormat: "HTML",
        },
      );
      if (importRes.data) {
        setDoc(importRes.data);
        setStatusMsg({ type: "success", message: `Loaded "${file.name}" from Drive` });
      } else {
        setStatusMsg({ type: "error", message: importRes.error || "Failed to import Drive file" });
      }
    } catch (err) {
      setStatusMsg({ type: "error", message: err instanceof Error ? err.message : "Failed to import" });
    }
    setImportingFromDrive(false);
  };

  const handleSaveBackToDrive = async () => {
    if (!businessId || !doc?.driveFileId) return;
    setSavingBackToDrive(true);
    const payload = getDocPayload();
    const htmlRes = await apiPostSimple<{ html: string }>(
      `/drive/businesses/${businessId}/export-html`,
      payload,
    );
    if (!htmlRes.data?.html) {
      setStatusMsg({ type: "error", message: htmlRes.error || "Could not build HTML" });
      setSavingBackToDrive(false);
      return;
    }
    const writeRes = await apiPatch<{ fileId: string; webViewLink?: string }>(
      `/drive/businesses/${businessId}/files/${doc.driveFileId}/content`,
      { html: htmlRes.data.html },
    );
    if (writeRes.data) {
      await apiPatch(`/documents/businesses/${businessId}/instances/${doc.id}/drive-synced`, {});
      loadDoc();
      setStatusMsg({ type: "success", message: "Changes saved back to Google Drive" });
    } else {
      setStatusMsg({ type: "error", message: writeRes.error || "Failed to save back to Drive" });
    }
    setSavingBackToDrive(false);
  };

  const handleUnlinkDrive = async () => {
    if (!businessId || !doc) return;
    const res = await apiPatch<DocInstance>(
      `/documents/businesses/${businessId}/instances/${doc.id}/drive-link`,
      { driveFileId: null, driveFileName: null, driveFileMimeType: null },
    );
    if (res.data) {
      setDoc(res.data);
      setStatusMsg({ type: "success", message: "Unlinked from Drive" });
      if (autoSyncTimerRef.current) {
        clearTimeout(autoSyncTimerRef.current);
        autoSyncTimerRef.current = null;
      }
      autoSyncPendingRef.current = null;
      setAutoSyncStatus("idle");
      setAutoSyncError(null);
      setDriveRemote(null);
      setDismissedRemoteAt(null);
    }
  };

  const handlePrint = async () => {
    if (!businessId || !doc) return;
    setPrinting(true);
    const payload = getDocPayload();
    const res = await apiPostSimple<{ html: string }>(
      `/drive/businesses/${businessId}/export-html`,
      payload,
    );
    if (res.data?.html) {
      const safeHtml = sanitizeHtml(res.data.html, {
        ...SANITIZE_CONFIG,
        enforceHtmlBoundary: false,
        allowedTags: [...SANITIZE_CONFIG.allowedTags, "html", "head", "body", "title", "meta"],
      });
      const printWindow = window.open("", "_blank", "width=800,height=600");
      if (printWindow) {
        printWindow.document.write(safeHtml);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
        }, 500);
      }
    } else {
      setStatusMsg({ type: "error", message: "Failed to generate print view" });
    }
    setPrinting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(var(--kf-accent1))]" />
      </div>
    );
  }

  if (!doc) {
    const returnLabel = getReturnLabel() ?? "Documents";
    const returnHref = getReturnHref() ?? "/app/documents";
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-[hsl(var(--muted-foreground))]">Document not found</p>
        <p className="text-sm text-[hsl(var(--muted-foreground))/60]">
          This document may have been deleted or you may not have access.
        </p>
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            type="button"
            onClick={() => navigateBackWithFallback({ targetExists: false, targetDeletedMessage: "This document is no longer available." })}
            className="text-sm text-[hsl(var(--kf-accent1))] min-h-[44px] underline-offset-2 hover:underline"
          >
            Return to {returnLabel}
          </button>
          <a href={returnHref} className="text-xs text-[hsl(var(--muted-foreground))] underline-offset-2 hover:underline">
            or go to Documents
          </a>
        </div>
      </div>
    );
  }

  const pendingReviews = doc.reviewTasks.filter((r) => r.status === "PENDING");

  const origin = getOriginContext();
  const showContinuityHeader = !!origin;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {showContinuityHeader && (
        <TaskContinuityHeader taskLabel={doc.title} />
      )}
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
          {driveResult && statusMsg.type === "success" && statusMsg.message.includes("Drive") && (
            <a
              href={driveResult.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 inline-flex items-center gap-1 underline"
            >
              Open in Google Docs <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <button type="button" onClick={() => setStatusMsg(null)} className="ml-2 opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {driveStatus && !driveStatus.connected && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[hsl(var(--kf-warning))]/10 border border-[hsl(var(--kf-warning))]/30">
          <div className="flex items-center gap-2 min-w-0">
            <HardDrive className="w-4 h-4 text-[hsl(var(--kf-warning))] flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-[hsl(var(--foreground))]">Google Drive isn&apos;t connected</div>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Connect your Drive account to open and round-trip documents from Drive.</p>
            </div>
          </div>
          <a
            href="/app/connect"
            className="flex-shrink-0 px-3 py-2 text-xs font-medium rounded-lg bg-[hsl(var(--kf-warning))]/20 text-[hsl(var(--kf-warning))] hover:bg-[hsl(var(--kf-warning))]/30 transition-colors min-h-[36px] inline-flex items-center"
          >
            Connect Google Drive
          </a>
        </div>
      )}

      {doc.driveFileId && driveRemote?.error && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[hsl(var(--kf-warning))]/10 border border-[hsl(var(--kf-warning))]/30 text-xs text-[hsl(var(--kf-warning))]">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Couldn&apos;t check Google Drive for new changes — {driveRemote.error}. Will retry shortly.</span>
        </div>
      )}

      {doc.driveFileId && driveRemote?.hasRemoteChanges && driveRemote.remoteModifiedTime !== dismissedRemoteAt && (
        <div
          className={
            "flex items-center justify-between gap-3 px-4 py-3 rounded-xl border " +
            (driveRemote.conflict
              ? "bg-[hsl(var(--kf-error))]/10 border-[hsl(var(--kf-error))]/30"
              : "bg-[hsl(var(--kf-info))]/10 border-[hsl(var(--kf-info))]/30")
          }
        >
          <div className="flex items-center gap-2 min-w-0">
            {driveRemote.conflict ? (
              <AlertTriangle className="w-4 h-4 text-[hsl(var(--kf-error))] flex-shrink-0" />
            ) : (
              <HardDrive className="w-4 h-4 text-[hsl(var(--kf-info))] flex-shrink-0" />
            )}
            <div className="min-w-0">
              <div className={"text-sm font-medium " + (driveRemote.conflict ? "text-[hsl(var(--kf-error))]" : "text-[hsl(var(--foreground))]")}>
                {driveRemote.conflict
                  ? "Conflict: both sides have unsynced changes"
                  : "Drive has new changes"}
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {driveRemote.conflict
                  ? "Pulling will replace your local edits with the version from Google Drive. Push your changes first if you want to keep them."
                  : `The linked Drive file was edited${driveRemote.remoteModifiedTime ? ` ${new Date(driveRemote.remoteModifiedTime).toLocaleString()}` : ""}. Pull to bring those edits into the editor.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={handlePullFromDrive}
              disabled={pullingFromDrive}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-[hsl(var(--kf-info))]/20 text-[hsl(var(--kf-info))] hover:bg-[hsl(var(--kf-info))]/30 transition-colors disabled:opacity-50 min-h-[36px]"
            >
              {pullingFromDrive ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              {pullingFromDrive ? "Pulling…" : "Pull changes"}
            </button>
            <button
              type="button"
              onClick={() => setDismissedRemoteAt(driveRemote.remoteModifiedTime)}
              className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] min-h-[36px] min-w-[36px] flex items-center justify-center"
              title="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {doc.driveFileId && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/30">
          <div className="flex items-center gap-2 min-w-0">
            <Link2 className="w-4 h-4 text-[hsl(var(--kf-accent2))] flex-shrink-0" />
            <span className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
              Linked to Drive: {doc.driveFileName || doc.driveFileId}
            </span>
            {doc.driveLastSyncedAt && (
              <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                · Last synced {new Date(doc.driveLastSyncedAt).toLocaleString()}
              </span>
            )}
            {autoSyncStatus !== "idle" && (
              <span
                className={
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 " +
                  (autoSyncStatus === "synced"
                    ? "bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))]"
                    : autoSyncStatus === "error"
                    ? "bg-[hsl(var(--kf-error))]/15 text-[hsl(var(--kf-error))]"
                    : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]")
                }
                title={autoSyncStatus === "error" ? autoSyncError || "Sync failed" : undefined}
              >
                {autoSyncStatus === "syncing" && <Loader2 className="w-3 h-3 animate-spin" />}
                {autoSyncStatus === "pending" && <Clock className="w-3 h-3" />}
                {autoSyncStatus === "synced" && <CheckCircle2 className="w-3 h-3" />}
                {autoSyncStatus === "error" && <AlertTriangle className="w-3 h-3" />}
                {autoSyncStatus === "pending" && "Saving soon…"}
                {autoSyncStatus === "syncing" && "Saving to Drive…"}
                {autoSyncStatus === "synced" && "Saved to Drive"}
                {autoSyncStatus === "error" && "Sync failed"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a
              href={`https://drive.google.com/file/d/${doc.driveFileId}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg hover:bg-[hsl(var(--kf-accent2))]/20 text-[hsl(var(--kf-accent2))] transition-colors"
              title="Open in Google Drive"
            >
              <ExternalLink className="w-3 h-3" /> Open in Drive
            </a>
            <button
              type="button"
              onClick={handleUnlinkDrive}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg hover:bg-[hsl(var(--kf-error))]/10 text-[hsl(var(--kf-error))] transition-colors"
              title="Unlink from Drive"
            >
              <Link2Off className="w-3 h-3" /> Unlink
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setShowDrivePicker(true)}
          disabled={importingFromDrive || (driveStatus !== null && !driveStatus.connected)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--kf-accent1))]/40 transition-colors disabled:opacity-50"
          title="Open a document from Google Drive"
        >
          {importingFromDrive ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />}
          Open from Drive
        </button>
        {doc.driveFileId && (
          <button
            type="button"
            onClick={handleSaveBackToDrive}
            disabled={savingBackToDrive}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--kf-accent2))]/15 border border-[hsl(var(--kf-accent2))]/30 text-sm min-h-[44px] text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/25 transition-colors disabled:opacity-50"
            title="Save changes back to the linked Drive file"
          >
            {savingBackToDrive ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
            Save to linked Drive
          </button>
        )}
        <button
          type="button"
          onClick={handleSaveToDrive}
          disabled={savingToDrive}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--kf-accent2))]/40 transition-colors disabled:opacity-50"
          title="Save to Google Drive"
        >
          {savingToDrive ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />}
          Save to Drive
        </button>
        <button
          type="button"
          onClick={handleEmailDocument}
          disabled={emailing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--kf-accent1))]/40 transition-colors disabled:opacity-50"
          title="Email document to yourself"
        >
          {emailing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />}
          Email
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--kf-info))]/40 transition-colors"
          title="Download document"
        >
          <Download className="w-4 h-4 text-[hsl(var(--kf-info))]" />
          Download
        </button>
        <button
          type="button"
          onClick={handlePrint}
          disabled={printing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--foreground))]/20 transition-colors disabled:opacity-50"
          title="Print document"
        >
          {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
          Print
        </button>
      </div>

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
                section.contentFormat === "HTML" ? (
                  <RichSectionEditor value={editContent} onChange={setEditContent} />
                ) : (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={Math.max(6, section.content.split("\n").length + 2)}
                    className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--foreground))] font-mono resize-y"
                  />
                )
              ) : section.contentFormat === "HTML" ? (
                <div
                  className="prose prose-sm max-w-none text-sm text-[hsl(var(--foreground))] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(section.content, SANITIZE_CONFIG) }}
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

      {doc.generationMeta && <AiInsightsPanel meta={doc.generationMeta} createdAt={doc.createdAt} />}

      {showDrivePicker && businessId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowDrivePicker(false)}>
          <div
            className="bg-[hsl(var(--background))] rounded-2xl border border-[hsl(var(--border))] w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
              <div>
                <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">Open from Google Drive</h3>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Pick a Google Doc, HTML, or text file. Its contents will replace the current document body.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDrivePicker(false)}
                className="p-2 rounded-lg hover:bg-[hsl(var(--muted))]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              <GoogleDriveBrowser
                businessId={businessId}
                pickerTitle="Select a file to open"
                onSelect={handlePickFromDrive}
                allowedMimeTypes={[
                  "application/vnd.google-apps.document",
                  "text/html",
                  "text/plain",
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ]}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}