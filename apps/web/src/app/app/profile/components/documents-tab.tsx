"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPostSimple } from "@/lib/api";
import {
  FileText, Plus, Shield, AlertTriangle, CheckCircle2,
  ChevronRight, Search, Building2, DollarSign,
  Palette, Settings, Users, Lock, Globe, TrendingUp,
  Truck, Award, Home, Package, Scale, Globe2,
  ShieldCheck, UserCheck, Sparkles, Eye,
} from "lucide-react";

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

export default function DocumentsTab({ businessId }: { businessId: string | null }) {
  const router = useRouter();
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [instances, setInstances] = useState<DocumentInstance[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [view, setView] = useState<"catalog" | "documents">("catalog");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedType, setSelectedType] = useState<DocumentType | null>(null);
  const [genTitle, setGenTitle] = useState("");
  const [genContext, setGenContext] = useState("");
  const [genTone, setGenTone] = useState("professional");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (!businessId) {
        const catRes = await apiGet<DocumentCategory[]>(`/documents/categories`);
        if (catRes.data) setCategories(catRes.data);
        setLoading(false);
        return;
      }

      const catRes = await apiGet<DocumentCategory[]>(`/documents/categories?businessId=${businessId}`);
      if (catRes.data) setCategories(catRes.data);

      const [instRes, healthRes] = await Promise.all([
        apiGet<DocumentInstance[]>(`/documents/businesses/${businessId}/instances`),
        apiGet<HealthData>(`/documents/businesses/${businessId}/health`),
      ]);

      if (instRes.data) setInstances(instRes.data);
      if (healthRes.data) setHealth(healthRes.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => { loadData(); }, [loadData]);

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
        router.push(`/app/documents/${res.data.id}`);
      }
    } catch {}
    setGenerating(null);
    setShowGenerator(false);
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
        </div>

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
      </div>

      {view === "catalog" && (
        <div className="space-y-6">
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

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowGenerator(false)}
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
    </div>
  );
}
