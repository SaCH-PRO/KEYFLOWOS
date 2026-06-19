"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollText, Loader2, AlertCircle, RefreshCw, History, ChevronDown, ChevronUp, Archive, AlertTriangle } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getLatestConstitutionVersion,
  getConstitutionVersions,
  getConstitutionStaleness,
  generateConstitutionVersion,
  archiveConstitutionVersion,
  type GenomeIntegrityResult,
  type DnaSectionKey,
  type ConstitutionVersion,
  type ConstitutionStaleness,
} from "@/lib/api/business-genome";

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
  const [version, setVersion] = useState<ConstitutionVersion | null>(null);
  const [versions, setVersions] = useState<ConstitutionVersion[]>([]);
  const [staleness, setStaleness] = useState<ConstitutionStaleness | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [changeNotes, setChangeNotes] = useState("");

  const load = async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [{ data: latest }, { data: list }, { data: stale }] = await Promise.all([
      getLatestConstitutionVersion(businessId),
      getConstitutionVersions(businessId),
      getConstitutionStaleness(businessId),
    ]);
    setVersion(latest);
    setVersions(list ?? []);
    setStaleness(stale);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    setError(null);
    const { data, error: apiError } = await generateConstitutionVersion(businessId, {
      changeNotes: changeNotes.trim() || undefined,
    });
    if (apiError || !data) {
      setError(apiError || "Failed to generate Constitution version");
    } else {
      setChangeNotes("");
      await load();
    }
    setGenerating(false);
  };

  const handleArchive = async (v: number) => {
    if (!businessId) return;
    const { error: apiError } = await archiveConstitutionVersion(businessId, v);
    if (apiError) {
      setError(apiError);
      return;
    }
    await load();
  };

  const sections = Object.entries((version?.content?.sections ?? {}) as Record<string, ConstitutionSection>);
  const generatedAtText = version?.generatedAt ? new Date(version.generatedAt).toLocaleString() : "Unknown";

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3 min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading Constitution...</p>
      </div>
    );
  }

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
              A versioned, living operating document generated from your Business Genome.
            </p>
            {version && (
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <div
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
                >
                  Active Version <span className="font-semibold">v{version.version}</span>
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
                  <span
                    className="font-semibold"
                    style={{ color: strengthVariant(version.sourceGenomeIntegrity ?? genome.genomeIntegrity).color }}
                  >
                    {version.sourceGenomeIntegrity ?? genome.genomeIntegrity}%
                  </span>
                </div>
                <div
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
                >
                  Stage{" "}
                  <span className="font-semibold">
                    {(version.sourceGenomeStage ?? genome.genomeStage).replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {generating ? "Generating..." : "Generate New Version"}
            </button>
            <button
              onClick={() => setShowHistory((s) => !s)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
            >
              <History className="w-3.5 h-3.5" />
              Version History
              {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {version && (
          <div className="mt-4">
            <textarea
              value={changeNotes}
              onChange={(e) => setChangeNotes(e.target.value)}
              placeholder="Optional change notes for the next version..."
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
              style={{ borderColor: "hsl(var(--kf-border) / 0.3)", minHeight: 64 }}
            />
          </div>
        )}
      </div>

      {/* Staleness warning */}
      {staleness?.stale && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-4 flex items-start gap-3"
          style={{ background: "hsl(var(--kf-warning) / 0.08)", border: "1px solid hsl(var(--kf-warning) / 0.2)" }}
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: "hsl(var(--kf-warning))" }} />
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Constitution may be stale</h3>
            <p className="text-xs text-muted-foreground mt-1">{staleness.reason}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
              <Stat label="Current Integrity" value={`${staleness.currentGenomeIntegrity}%`} />
              <Stat label="Constitution Integrity" value={`${staleness.constitutionGenomeIntegrity ?? "—"}${typeof staleness.constitutionGenomeIntegrity === 'number' ? '%' : ''}`} />
              <Stat label="Current Readiness" value={`${staleness.currentExecutiveReadiness ?? "—"}${typeof staleness.currentExecutiveReadiness === 'number' ? '%' : ''}`} />
              <Stat label="Constitution Readiness" value={`${staleness.constitutionExecutiveReadiness ?? "—"}${typeof staleness.constitutionExecutiveReadiness === 'number' ? '%' : ''}`} />
              <Stat label="Current Stage" value={(staleness.currentGenomeStage ?? "—").replace(/_/g, " ")} />
              <Stat label="Constitution Stage" value={(staleness.constitutionGenomeStage ?? "—").replace(/_/g, " ")} />
            </div>
          </div>
        </motion.div>
      )}

      {/* Version history */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="rounded-xl p-4 space-y-2"
              style={{ background: "hsl(var(--kf-card) / 0.6)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
            >
              <h3 className="text-sm font-semibold mb-2">Version History</h3>
              {versions.length === 0 && (
                <p className="text-xs text-muted-foreground">No Constitution versions yet.</p>
              )}
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-lg"
                  style={{ background: "hsl(var(--kf-muted) / 0.06)" }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">v{v.version}</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{
                          color: v.status === 'ACTIVE' ? 'hsl(var(--kf-success))' : 'hsl(var(--kf-muted-foreground))',
                          background: v.status === 'ACTIVE' ? 'hsl(var(--kf-success) / 0.08)' : 'hsl(var(--kf-muted) / 0.15)',
                        }}
                      >
                        {v.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {new Date(v.generatedAt).toLocaleString()} · Genome {v.sourceGenomeIntegrity ?? "—"}% · Readiness {v.sourceExecutiveReadiness ?? "—"}%
                    </p>
                    {v.changeNotes && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{v.changeNotes}</p>
                    )}
                  </div>
                  {v.status === 'ACTIVE' && versions.length > 1 && (
                    <button
                      onClick={() => handleArchive(v.version)}
                      className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Archive className="w-3 h-3" />
                      Archive
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="kf-card p-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!version && !loading && (
        <div className="kf-card p-8 text-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">No Constitution version has been generated yet.</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {generating ? "Generating..." : "Generate Constitution v1"}
          </button>
        </div>
      )}

      {/* Sections */}
      {version && (
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
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md px-2 py-1.5" style={{ background: "hsl(var(--kf-muted) / 0.08)" }}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold truncate">{value}</div>
    </div>
  );
}
