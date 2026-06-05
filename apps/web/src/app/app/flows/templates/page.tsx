"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Loader2,
  Copy,
  ArrowLeft,
  MessageCircle,
  Phone,
  Receipt,
  CreditCard,
  Star,
  Mail,
  AlertTriangle,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  listFlowTemplates,
  cloneFlowTemplate,
  type FlowTemplate,
} from "@/lib/api/flow";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";

function categoryIcon(category: string) {
  switch (category) {
    case "messaging":
      return <MessageCircle className="w-4 h-4" />;
    case "calls":
      return <Phone className="w-4 h-4" />;
    case "finance":
      return <Receipt className="w-4 h-4" />;
    case "payments":
      return <CreditCard className="w-4 h-4" />;
    case "reviews":
      return <Star className="w-4 h-4" />;
    case "leads":
      return <Mail className="w-4 h-4" />;
    case "complaints":
      return <AlertTriangle className="w-4 h-4" />;
    default:
      return <Zap className="w-4 h-4" />;
  }
}

export default function FlowTemplatesPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [templates, setTemplates] = useState<FlowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [cloningId, setCloningId] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await listFlowTemplates(businessId);
        if (!cancelled) setTemplates(res.data?.items ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [businessId]);

  const handleClone = async (templateId: string) => {
    if (!businessId) return;
    setCloningId(templateId);
    try {
      const res = await cloneFlowTemplate(businessId, templateId);
      if (res.data) {
        router.push(`/app/flows/${res.data.id}`);
      }
    } finally {
      setCloningId(null);
    }
  };

  if (!businessId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Select a business to view templates.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/app/flows")}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Copy className="w-5 h-5 text-primary" />
            Flow Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Start from a proven automation template.
          </p>
        </div>
      </div>

      {/* Templates grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <SectionCard className="p-8 text-center">
          <Zap className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">No templates available</p>
          <p className="text-xs text-muted-foreground mt-1">
            Templates will appear here once they are configured by your admin.
          </p>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <SectionCard key={t.id} className="p-4 flex flex-col h-full">
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  {categoryIcon(t.category)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold truncate">{t.name}</h3>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">
                    {t.category}
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground flex-1 mb-3">
                {t.description || "No description provided."}
              </p>

              {t.estimatedImpact && (
                <p className="text-[10px] text-emerald-400 mb-3">
                  Estimated impact: {t.estimatedImpact}
                </p>
              )}

              {t.requiredConnectors.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {t.requiredConnectors.map((c) => (
                    <span
                      key={c}
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 mt-auto">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handleClone(t.id)}
                  disabled={cloningId === t.id}
                >
                  {cloningId === t.id ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Use Template
                </Button>
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
