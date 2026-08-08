"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Grid3X3,
  Target,
  User,
  Lightbulb,
  Building2,
  TrendingUp,
  Shield,
  Cog,
  Megaphone,
  Rocket,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import type { GenomeIntegrityResult, DnaSectionKey } from "@/lib/api/business-genome";
import { DnaSectionDrawer } from "../../profile/components/business-genome/dna-section-drawer";
import { Badge } from "@/components/ui-v2/badge";

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

const SECTION_ICONS: Record<DnaSectionKey, React.ElementType> = {
  founder: User,
  vision: Lightbulb,
  business: Building2,
  market: Target,
  financial: TrendingUp,
  legal: Shield,
  operations: Cog,
  sales: Megaphone,
  marketing: Rocket,
  growth: TrendingUp,
  technology: Cpu,
  risk: AlertTriangle,
};

function scoreColor(score: number): string {
  if (score >= 80) return "hsl(var(--kf-success, 160 70% 45%))";
  if (score >= 50) return "hsl(var(--kf-accent1))";
  return "hsl(var(--kf-warning, 30 90% 55%))";
}

interface DnaConstellationProps {
  genome: GenomeIntegrityResult;
}

export function DnaConstellation({ genome }: DnaConstellationProps) {
  const [selectedSection, setSelectedSection] = useState<GenomeIntegrityResult["dnaSections"][number] | null>(null);

  const sortedSections = useMemo(
    () => [...genome.dnaSections].sort((a, b) => b.integrity - a.integrity),
    [genome.dnaSections],
  );

  const weakest = sortedSections[sortedSections.length - 1];
  const strongest = sortedSections[0];

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="kf-card p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sections</div>
          <div className="text-lg font-bold">{genome.dnaSections.length}</div>
        </div>
        <div className="kf-card p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Strong</div>
          <div className="text-lg font-bold text-[hsl(var(--kf-success))]">
            {genome.dnaSections.filter((s) => s.integrity >= 80).length}
          </div>
        </div>
        <div className="kf-card p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Needs work</div>
          <div className="text-lg font-bold text-[hsl(var(--kf-warning))]">
            {genome.dnaSections.filter((s) => s.integrity < 50).length}
          </div>
        </div>
        <div className="kf-card p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg</div>
          <div className="text-lg font-bold">
            {Math.round(genome.dnaSections.reduce((sum, s) => sum + s.integrity, 0) / genome.dnaSections.length)}%
          </div>
        </div>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sortedSections.map((section, index) => {
          const Icon = SECTION_ICONS[section.key];
          const color = DNA_COLORS[section.key];
          const isStrong = section.integrity >= 80;
          const isWeak = section.integrity < 50;

          return (
            <motion.button
              key={section.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              onClick={() => setSelectedSection(section)}
              className="text-left rounded-2xl p-4 bg-card border border-border/20 transition-all hover:shadow-md hover:scale-[1.01] active:scale-[0.99]"
              style={{
                borderColor: isWeak ? "hsl(var(--kf-warning) / 0.3)" : undefined,
                boxShadow: isStrong ? `0 0 0 1px ${color}20` : undefined,
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${color}15` }}
                  >
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{section.label}</h3>
                    <p className="text-[10px] text-muted-foreground">
                      {section.fieldsCaptured}/{section.fieldsTotal} fields
                    </p>
                  </div>
                </div>
                <Badge color={isStrong ? "mint" : isWeak ? "orange" : "gold"}>{section.integrity}%</Badge>
              </div>

              <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(section.integrity, 100)}%` }}
                  transition={{ duration: 0.6, delay: index * 0.04 }}
                  className="h-full rounded-full"
                  style={{ background: scoreColor(section.integrity) }}
                />
              </div>

              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{section.summary || section.recommendation}</p>

              <div className="flex items-center gap-2 text-[10px] font-medium">
                {isStrong ? (
                  <span className="text-[hsl(var(--kf-success))] flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Strong
                  </span>
                ) : isWeak ? (
                  <span className="text-[hsl(var(--kf-warning))] flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Priority
                  </span>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Grid3X3 className="w-3 h-3" />
                    Building
                  </span>
                )}
                <span className="ml-auto text-primary flex items-center gap-1">
                  Explore <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Highlight cards */}
      <div className="grid md:grid-cols-2 gap-4">
        {strongest && (
          <div className="kf-card p-4" style={{ borderColor: "hsl(var(--kf-success) / 0.2)" }}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-success))]" />
              Strongest section
            </h4>
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: `${DNA_COLORS[strongest.key]}15` }}
              >
                {(() => {
                  const Icon = SECTION_ICONS[strongest.key];
                  return <Icon className="w-4 h-4" style={{ color: DNA_COLORS[strongest.key] }} />;
                })()}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">{strongest.label}</div>
                <div className="text-xs text-muted-foreground">{strongest.summary}</div>
              </div>
              <Badge color="mint">{strongest.integrity}%</Badge>
            </div>
          </div>
        )}
        {weakest && (
          <div className="kf-card p-4" style={{ borderColor: "hsl(var(--kf-warning) / 0.2)" }}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--kf-warning))]" />
              Priority section
            </h4>
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: `${DNA_COLORS[weakest.key]}15` }}
              >
                {(() => {
                  const Icon = SECTION_ICONS[weakest.key];
                  return <Icon className="w-4 h-4" style={{ color: DNA_COLORS[weakest.key] }} />;
                })()}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">{weakest.label}</div>
                <div className="text-xs text-muted-foreground">{weakest.recommendation}</div>
              </div>
              <Badge color="orange">{weakest.integrity}%</Badge>
            </div>
          </div>
        )}
      </div>

      {/* Section detail drawer */}
      {selectedSection && (
        <DnaSectionDrawer
          section={selectedSection}
          onClose={() => setSelectedSection(null)}
          onUpdate={() => {
            setSelectedSection(null);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
