"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ScrollText, Loader2, AlertCircle } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { getConstitution, type GenomeIntegrityResult, type DnaSectionKey } from "@/lib/api/business-genome";

interface ConstitutionPanelProps {
  genome: GenomeIntegrityResult;
}

const DNA_COLORS: Record<DnaSectionKey, string> = {
  founder: "hsl(var(--kf-accent1))",
  vision: "hsl(var(--kf-violet-accent))",
  business: "hsl(var(--kf-accent2))",
  market: "hsl(210 80% 60%)",
  financial: "hsl(145 70% 45%)",
  legal: "hsl(260 70% 60%)",
  operations: "hsl(35 90% 55%)",
  sales: "hsl(0 80% 60%)",
  marketing: "hsl(320 80% 60%)",
  growth: "hsl(170 80% 40%)",
  technology: "hsl(190 90% 55%)",
  risk: "hsl(0 75% 55%)",
};

interface ConstitutionSection {
  title: string;
  sourceDna: DnaSectionKey[];
  strength: number;
  content: string;
}

interface ConstitutionData {
  businessId?: string;
  generatedAt?: string;
  version?: number;
  genomeIntegrity?: number;
  genomeStage?: string;
  sections?: Record<string, ConstitutionSection>;
}

function strengthVariant(strength: number): { label: string; color: string } {
  if (strength >= 80) return { label: "Strong", color: "hsl(var(--kf-success))" };
  if (strength >= 50) return { label: "Developing", color: "hsl(var(--kf-accent1))" };
  if (strength >= 25) return { label: "Sparse", color: "hsl(var(--kf-warning))" };
  return { label: "Minimal data", color: "hsl(var(--kf-warning))" };
}

function isSparse(section: ConstitutionSection): boolean {
  if (section.strength < 30) return true;
  if (!section.content || section.content.trim().length < 20) return true;
  if (section.content.startsWith("Generated from")) return true;
  return false;
}

export function ConstitutionPanel({ genome }: ConstitutionPanelProps) {
  const businessId = getStoredBusinessId();
  const [constitution, setConstitution] = useState<ConstitutionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    getConstitution(businessId).then(({ data, error: apiError }) => {
      if (apiError || !data) {
        setError(apiError || "Failed to load Constitution");
      } else {
        setConstitution(data as ConstitutionData);
      }
      setLoading(false);
    });
  }, [businessId]);

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3 min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading Constitution...</p>
      </div>
    );
  }

  if (error || !constitution) {
    return (
      <div className="kf-card p-8 text-center">
        <p className="text-sm text-destructive">{error || "Constitution unavailable."}</p>
      </div>
    );
  }

  const sections = Object.entries(constitution.sections || {});
  const generatedAtText = constitution.generatedAt
    ? new Date(constitution.generatedAt).toLocaleString()
    : "Unknown";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.1) 100%)",
          border: "1px solid hsl(var(--kf-border) / 0.2)",
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
          >
            <ScrollText className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold">Constitution</h2>
            <p className="text-sm text-muted-foreground mt-1">
              A living operating document generated from your Business Genome.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <div
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
              >
                Version <span className="font-semibold">{constitution.version ?? 1}</span>
              </div>
              <div
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
              >
                Generated <span className="font-semibold">{generatedAtText}</span>
              </div>
              <div
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
              >
                Genome Integrity{" "}
                <span className="font-semibold" style={{ color: strengthVariant(constitution.genomeIntegrity ?? 0).color }}>
                  {constitution.genomeIntegrity ?? genome.genomeIntegrity}%
                </span>
              </div>
              <div
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
              >
                Stage <span className="font-semibold">{(constitution.genomeStage ?? genome.genomeStage).replace(/_/g, " ")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="grid gap-4">
        {sections.length === 0 && (
          <div className="kf-card p-8 text-center text-sm text-muted-foreground">
            No Constitution sections are available yet.
          </div>
        )}

        {sections.map(([key, section], index) => {
          const sparse = isSparse(section);
          const status = strengthVariant(section.strength);

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 }}
              className="kf-card p-4 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{section.title || key}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {section.sourceDna?.map((dnaKey) => (
                      <span
                        key={dnaKey}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium"
                        style={{
                          background: `${DNA_COLORS[dnaKey]}15`,
                          color: DNA_COLORS[dnaKey],
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: DNA_COLORS[dnaKey] }}
                        />
                        {genome.dnaSections.find((s) => s.key === dnaKey)?.label || dnaKey}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Strength</span>
                    <div className="text-xs font-semibold" style={{ color: status.color }}>
                      {status.label} · {section.strength ?? 0}%
                    </div>
                  </div>
                  <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: status.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, Math.max(0, section.strength ?? 0))}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                </div>
              </div>

              <div
                className="rounded-lg p-3 text-sm leading-relaxed"
                style={{ background: "hsl(var(--kf-muted) / 0.06)" }}
              >
                {sparse ? (
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      This section is still sparse because its source DNA is incomplete. Strengthen{" "}
                      {section.sourceDna?.join(", ") || "the related"} DNA to generate richer content.
                    </span>
                  </div>
                ) : (
                  section.content
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
