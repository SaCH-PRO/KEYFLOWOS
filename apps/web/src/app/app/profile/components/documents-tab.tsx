"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPostSimple } from "@/lib/api";
import {
  FileText,
  Plus,
  Shield,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Search,
  Building2,
  DollarSign,
  Palette,
  Settings,
  Users,
  Lock,
  Globe,
  TrendingUp,
  Truck,
  Award,
  Home,
  Package,
  Scale,
  Globe2,
  ShieldCheck,
  UserCheck,
  Sparkles,
  Eye,
  Zap,
  Mail,
  ExternalLink,
  X,
  Check,
  HardDrive,
} from "lucide-react";
import GoogleDriveBrowser from "./google-drive-browser";

interface DocumentCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  tier: string;
  trigger: string | null;
  sortOrder: number;
  documentTypes: DocumentType[];
}

interface DocumentType {
  id: string;
  name: string;
  slug: string;
  description: string;
  riskTier: string;
  brandSensitive: boolean;
  financialSensitive: boolean;
  legalSensitive: boolean;
  requiredProfileFields: string[];
  _count?: { instances: number };
}

interface DocumentSection {
  sectionKey: string;
  sectionName: string;
  content: string;
  riskScore: string;
  editableMode: string;
  sortOrder: number;
}

interface DocumentInstance {
  id: string;
  title: string;
  status: string;
  healthStatus: string;
  healthReason: string | null;
  currentVersionNum: number;
  createdAt: string;
  updatedAt: string;
  documentType: { name: string; riskTier: string; category: { name: string; slug: string } };
  sections?: DocumentSection[];
  _count: { versions: number; reviewTasks: number };
}

interface HealthData {
  total: number;
  current: number;
  stale: number;
  impacted: number;
  pendingReview: number;
  expired: number;
  healthScore: number;
}

const ICON_MAP: Record<string, React.ElementType> = {
  Building2, DollarSign, FileText, Palette, Settings, Shield,
  Users, UserCheck, Lock, Globe, TrendingUp, Truck, ShieldCheck,
  Award, Home, Package, Scale, Globe2,
};

const RECOMMENDED_SLUGS = [
  "privacy-policy",
  "service-agreement",
  "brand-guidelines",
  "employee-handbook",
  "sop",
  "proposal-template",
  "company-profile",
  "website-terms",
];

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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT: "bg-[hsl(var(--kf-info))]/15 text-[hsl(var(--kf-info))]",
    APPROVED: "bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))]",
    ARCHIVED: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
    IN_REVIEW: "bg-[hsl(var(--kf-warning))]/15 text-[hsl(var(--kf-warning))]",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.DRAFT}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function HealthBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    CURRENT: "text-[hsl(var(--kf-success))]",
    STALE: "text-[hsl(var(--kf-warning))]",
    IMPACTED: "text-[hsl(var(--kf-error))]",
    PENDING_REVIEW: "text-[hsl(var(--kf-warning))]",
    EXPIRED: "text-[hsl(var(--kf-error))]",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${colors[status] || ""}`}>
      {status === "CURRENT" ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}

function CategoryCard({ category, onSelectType }: { category: DocumentCategory; onSelectType: (t: DocumentType) => void }) {
  const [expanded, setExpanded] = useState(false);
  const IconComp = ICON_MAP[category.icon || "FileText"] || FileText;

  return (
    <div className="rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] overflow-hidden hover:border-[hsl(var(--kf-accent1))]/20 transition-colors">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3 text-left min-h-[44px]"
      >
        <div className="w-9 h-9 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center flex-shrink-0">
          <IconComp className="w-4.5 h-4.5 text-[hsl(var(--kf-accent1))]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-[hsl(var(--foreground))]">{category.name}</div>
          <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{category.documentTypes.length} document types</div>
        </div>
        <ChevronRight className={`w-4 h-4 text-[hsl(var(--muted-foreground))] transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-[hsl(var(--border))] px-4 py-2 space-y-1">
          {category.documentTypes.map((dt) => (
            <button
              key={dt.id}
              type="button"
              onClick={() => onSelectType(dt)}
              className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors text-left min-h-[44px]"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[hsl(var(--foreground))]">{dt.name}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{dt.description}</div>
              </div>
              <RiskBadge tier={dt.riskTier} />
              <Plus className="w-4 h-4 text-[hsl(var(--kf-accent1))] flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface DocumentsTabProps {
  businessId: string | null;
}

export default function DocumentsTab({ businessId }: DocumentsTabProps) {
  const router = useRouter();
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [instances, setInstances] = useState<DocumentInstance[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [view, setView] = useState<"catalog" | "documents" | "drive">("catalog");
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedType, setSelectedType] = useState<DocumentType | null>(null);
  const [genTitle, setGenTitle] = useState("");
  const [genContext, setGenContext] = useState("");
  const [genTone, setGenTone] = useState("professional");
  const [previewDoc, setPreviewDoc] = useState<DocumentInstance | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (!businessId) {
        const catRes = await apiGet<DocumentCategory[]>(`/documents/categories`);
        if (catRes.data) setCategories(catRes.data);
        setLoading(false);
        return;
      }

      const catRes = await apiGet<DocumentCategory[]>(`/documents/categories?businessId=${businessId}`);
      if (catRes.data) setCategories(catRes.data);
      else if (catRes.error) setLoadError(catRes.error);

      const [instRes, healthRes] = await Promise.all([
        apiGet<DocumentInstance[]>(`/documents/businesses/${businessId}/instances`),
        apiGet<HealthData>(`/documents/businesses/${businessId}/health`),
      ]);

      if (instRes.data) setInstances(instRes.data);
      else if (instRes.error) setLoadError(instRes.error);
      if (healthRes.data) setHealth(healthRes.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load documents");
    }
    setLoading(false);
  }, [businessId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") === "success" || params.get("drive") === "error") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
      setView("drive");
    }
    const generateSlug = params.get("generate");
    if (generateSlug && categories.length > 0) {
      const allTypes = categories.flatMap((c) => c.documentTypes);
      const match = allTypes.find((t) => t.slug === generateSlug);
      if (match) {
        setSelectedType(match);
        setShowGenerator(true);
        const url = new URL(window.location.href);
        url.searchParams.delete("generate");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [categories]);

  const handleGenerate = async () => {
    if (!businessId || !selectedType) return;
    setGenerating(selectedType.slug);
    try {
      const res = await apiPostSimple<DocumentInstance>(`/documents/businesses/${businessId}/generate`, {
        documentTypeSlug: selectedType.slug,
        title: genTitle || undefined,
        contextInputs: genContext ? { additionalContext: genContext } : undefined,
        toneSettings: { style: genTone },
      });
      if (res.data) {
        setGenerateError(null);
        setPreviewDoc(res.data);
        setShowPreview(true);
        setEmailSent(false);
        setShowGenerator(false);
        loadData();
      } else if (res.error) {
        setGenerateError(res.error);
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Document generation failed");
    }
    setGenerating(null);
  };

  const handleSendEmail = async () => {
    if (!businessId || !previewDoc) return;
    setSendingEmail(true);
    setEmailError(null);
    try {
      const res = await apiPostSimple<{ sent: boolean; reason?: string }>(`/documents/businesses/${businessId}/instances/${previewDoc.id}/send-email`, {});
      if (res.data?.sent) {
        setEmailSent(true);
      } else {
        setEmailError(res.data?.reason || "Could not send email");
      }
    } catch {
      setEmailError("Failed to send email");
    }
    setSendingEmail(false);
  };

  const filteredCategories = categories.filter((c) => {
    if (selectedCategory && c.slug !== selectedCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.documentTypes.some((t) => t.name.toLowerCase().includes(q));
    }
    return true;
  });

  const coreCategories = filteredCategories.filter((c) => c.tier === "UNIVERSAL_CORE");
  const triggeredCategories = filteredCategories.filter((c) => c.tier === "TRIGGERED_CORE");
  const advancedCategories = filteredCategories.filter((c) => c.tier === "ADVANCED");

  const recommendedTypes = categories
    .flatMap((c) => c.documentTypes.map((dt) => ({ ...dt, categoryName: c.name })))
    .filter((dt) => RECOMMENDED_SLUGS.includes(dt.slug))
    .filter((dt) => !dt._count || dt._count.instances === 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(var(--kf-accent1))]" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading documents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {loadError && (
        <div className="flex items-center gap-2 p-3 rounded-xl text-sm" role="alert" style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))", border: "1px solid hsl(var(--kf-error) / 0.2)" }}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>{loadError}</span>
          <button type="button" onClick={loadData} className="ml-auto text-xs underline underline-offset-2">Retry</button>
        </div>
      )}

      {health && health.total > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: "Health", value: `${health.healthScore}%`, color: health.healthScore >= 80 ? "hsl(var(--kf-success))" : health.healthScore >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))" },
            { label: "Total", value: health.total, color: "hsl(var(--foreground))" },
            { label: "Current", value: health.current, color: "hsl(var(--kf-success))" },
            { label: "Stale", value: health.stale, color: "hsl(var(--kf-warning))" },
            { label: "Impacted", value: health.impacted, color: "hsl(var(--kf-error))" },
            { label: "Reviews", value: health.pendingReview, color: "hsl(var(--kf-warning))" },
          ].map((stat) => (
            <div key={stat.label} className="p-2.5 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-center">
              <div className="text-lg font-bold" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-[hsl(var(--border))] overflow-hidden">
          <button
            type="button"
            onClick={() => setView("catalog")}
            className={`px-3 py-2 text-xs font-medium min-h-[44px] transition-colors ${
              view === "catalog"
                ? "bg-[hsl(var(--kf-accent1))] text-white"
                : "bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            Catalog
          </button>
          <button
            type="button"
            onClick={() => setView("documents")}
            className={`px-3 py-2 text-xs font-medium min-h-[44px] transition-colors ${
              view === "documents"
                ? "bg-[hsl(var(--kf-accent1))] text-white"
                : "bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            My Documents ({instances.length})
          </button>
          <button
            type="button"
            onClick={() => setView("drive")}
            className={`px-3 py-2 text-xs font-medium min-h-[44px] transition-colors flex items-center gap-1.5 ${
              view === "drive"
                ? "bg-[hsl(var(--kf-accent1))] text-white"
                : "bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            Google Drive
          </button>
        </div>

        {view !== "drive" && (
          <>
            <div className="relative flex-1 min-w-[140px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
              />
            </div>

            <select
              value={selectedCategory || ""}
              onChange={(e) => setSelectedCategory(e.target.value || null)}
              className="px-3 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-xs min-h-[44px] text-[hsl(var(--foreground))]"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {view === "catalog" && (
        <div className="space-y-6">
          {recommendedTypes.length > 0 && !searchQuery && !selectedCategory && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--kf-accent1))" }}>Recommended for You</h2>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Essential documents every business needs</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {recommendedTypes.map((dt) => (
                  <button
                    key={dt.id}
                    type="button"
                    onClick={() => { setSelectedType(dt); setShowGenerator(true); setGenTitle(""); setGenContext(""); }}
                    className="flex items-center gap-3 p-3 rounded-xl text-left min-h-[44px] transition-all hover:scale-[1.01]"
                    style={{
                      background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
                      border: "1px solid hsl(var(--kf-accent1) / 0.15)",
                    }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                      <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[hsl(var(--foreground))] truncate">{dt.name}</div>
                      <div className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">{(dt as unknown as { categoryName: string }).categoryName}</div>
                    </div>
                    <Plus className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {coreCategories.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-[hsl(var(--kf-success))]" />
                <h2 className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Universal Core</h2>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Every business needs these</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {coreCategories.map((cat) => (
                  <CategoryCard key={cat.id} category={cat} onSelectType={(t) => { setSelectedType(t); setShowGenerator(true); setGenTitle(""); setGenContext(""); }} />
                ))}
              </div>
            </div>
          )}

          {triggeredCategories.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-[hsl(var(--kf-warning))]" />
                <h2 className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Triggered Core</h2>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Required when conditions apply</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {triggeredCategories.map((cat) => (
                  <CategoryCard key={cat.id} category={cat} onSelectType={(t) => { setSelectedType(t); setShowGenerator(true); setGenTitle(""); setGenContext(""); }} />
                ))}
              </div>
            </div>
          )}

          {advancedCategories.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-[hsl(var(--kf-info))]" />
                <h2 className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Advanced</h2>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">For scale, regulation, or expansion</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {advancedCategories.map((cat) => (
                  <CategoryCard key={cat.id} category={cat} onSelectType={(t) => { setSelectedType(t); setShowGenerator(true); setGenTitle(""); setGenContext(""); }} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {view === "documents" && (
        <div className="space-y-2">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowDrivePicker(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-xs font-medium min-h-[40px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--kf-accent2))]/40 transition-colors"
              title="Browse Google Drive to open a document"
            >
              <HardDrive className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
              Open from Drive
            </button>
          </div>
          {instances.length === 0 ? (
            <div className="text-center py-12 bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))]">
              <FileText className="w-10 h-10 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
              <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">No documents yet</h3>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-4">
                Switch to the Catalog to generate your first document
              </p>
              <button
                type="button"
                onClick={() => setView("catalog")}
                className="px-4 py-2 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium min-h-[44px] hover:opacity-90 transition-opacity"
              >
                Browse Catalog
              </button>
            </div>
          ) : (
            instances.map((inst) => (
              <button
                key={inst.id}
                type="button"
                onClick={() => router.push(`/app/documents/${inst.id}`)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] hover:border-[hsl(var(--kf-accent1))]/30 transition-colors text-left min-h-[44px]"
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-[hsl(var(--foreground))] truncate">{inst.title}</span>
                    <RiskBadge tier={inst.documentType.riskTier} />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                    <span>{inst.documentType.category.name}</span>
                    <span>v{inst.currentVersionNum}</span>
                    <span>{new Date(inst.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <StatusBadge status={inst.status} />
                  <HealthBadge status={inst.healthStatus} />
                  {inst._count.reviewTasks > 0 && (
                    <span className="flex items-center gap-1 text-xs text-[hsl(var(--kf-warning))]">
                      <Eye className="w-3 h-3" /> {inst._count.reviewTasks}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {view === "drive" && businessId && (
        <GoogleDriveBrowser businessId={businessId} />
      )}

      {view === "drive" && !businessId && (
        <div className="text-center py-12 bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))]">
          <HardDrive className="w-10 h-10 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Set up your business profile to connect Google Drive</p>
        </div>
      )}

      {showGenerator && selectedType && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowGenerator(false)}>
          <div className="bg-[hsl(var(--card))] rounded-2xl border border-[hsl(var(--border))] p-6 max-w-lg w-full space-y-5" onClick={(e) => e.stopPropagation()}>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">Generate {selectedType.name}</h3>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">{selectedType.description}</p>
                </div>
              </div>
              <RiskBadge tier={selectedType.riskTier} />
              {selectedType.riskTier === "RED" && (
                <p className="text-xs text-[hsl(var(--kf-error))] mt-2">
                  High-risk document — will require review before use
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Document Title (optional)</label>
                <input
                  type="text"
                  value={genTitle}
                  onChange={(e) => setGenTitle(e.target.value)}
                  placeholder={selectedType.name}
                  className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Additional Context</label>
                <textarea
                  value={genContext}
                  onChange={(e) => setGenContext(e.target.value)}
                  placeholder="e.g. 'For a 12-month retainer engagement' or 'Premium but friendly tone'"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--foreground))] resize-none min-h-[44px]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Tone</label>
                <select
                  value={genTone}
                  onChange={(e) => setGenTone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-sm min-h-[44px] text-[hsl(var(--foreground))]"
                >
                  <option value="formal">Formal</option>
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="premium">Premium</option>
                  <option value="technical">Technical</option>
                </select>
              </div>
            </div>

            {generateError && (
              <div className="flex items-center gap-2 p-3 rounded-xl text-sm" role="alert" style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))", border: "1px solid hsl(var(--kf-error) / 0.2)" }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>{generateError}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowGenerator(false); setGenerateError(null); }}
                className="flex-1 px-4 py-2 rounded-lg border border-[hsl(var(--border))] text-sm font-medium min-h-[44px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!!generating}
                className="flex-1 px-4 py-2 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium min-h-[44px] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate with AI
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreview && previewDoc && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { setShowPreview(false); setPreviewDoc(null); }}>
          <div
            className="bg-[hsl(var(--card))] rounded-2xl border border-[hsl(var(--border))] max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                  <FileText className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-[hsl(var(--foreground))] truncate">{previewDoc.title}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">{previewDoc.documentType.category.name}</span>
                    <RiskBadge tier={previewDoc.documentType.riskTier} />
                    <StatusBadge status={previewDoc.status} />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowPreview(false); setPreviewDoc(null); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[hsl(var(--muted))] transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {(previewDoc.sections || []).map((section) => (
                <div key={section.sectionKey} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">{section.sectionName}</h4>
                    {section.riskScore === "RED" && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[hsl(var(--kf-error))]/15 text-[hsl(var(--kf-error))]">Review Required</span>
                    )}
                  </div>
                  <div className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed whitespace-pre-wrap rounded-lg p-3 bg-[hsl(var(--background))] border border-[hsl(var(--border))]">
                    {section.content}
                  </div>
                </div>
              ))}
              {(!previewDoc.sections || previewDoc.sections.length === 0) && (
                <div className="text-center py-8 text-[hsl(var(--muted-foreground))] text-sm">
                  No sections generated. Try regenerating this document.
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[hsl(var(--border))] space-y-2">
              {emailError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {emailError}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={sendingEmail || emailSent}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium min-h-[44px] flex items-center justify-center gap-2 transition-all"
                  style={{
                    background: emailSent ? "hsl(var(--kf-success) / 0.12)" : "hsl(var(--kf-accent2) / 0.12)",
                    color: emailSent ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent2))",
                    border: `1px solid ${emailSent ? "hsl(var(--kf-success) / 0.3)" : "hsl(var(--kf-accent2) / 0.3)"}`,
                    opacity: sendingEmail ? 0.6 : 1,
                  }}
                >
                  {emailSent ? (
                    <><Check className="w-4 h-4" /> Sent to Email</>
                  ) : sendingEmail ? (
                    <><div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: "hsl(var(--kf-accent2))" }} /> Sending...</>
                  ) : (
                    <><Mail className="w-4 h-4" /> Send to Email</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowPreview(false); setPreviewDoc(null); router.push(`/app/documents/${previewDoc.id}`); }}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium min-h-[44px] flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Full Document
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDrivePicker && businessId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowDrivePicker(false)}>
          <div
            className="bg-[hsl(var(--background))] rounded-2xl border border-[hsl(var(--border))] w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
              <div>
                <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">Open from Google Drive</h3>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Pick a Google Doc, HTML, or text file to open in Drive.</p>
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
                pickerTitle="Select a file"
                allowedMimeTypes={[
                  "application/vnd.google-apps.document",
                  "text/html",
                  "text/plain",
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ]}
                onSelect={(file) => {
                  setShowDrivePicker(false);
                  if (file.webViewLink) {
                    window.open(file.webViewLink, "_blank", "noopener,noreferrer");
                  } else {
                    setView("drive");
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
