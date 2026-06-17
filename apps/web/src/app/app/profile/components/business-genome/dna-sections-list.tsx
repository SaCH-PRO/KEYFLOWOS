"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Edit3, Dna } from "lucide-react";
import { Drawer } from "@keyflow/ui";
import type { GenomeIntegrityResult, DnaSectionKey } from "@/lib/api/business-genome";
import { DnaSectionDrawer } from "./dna-section-drawer";

interface DnaSectionsListProps {
  genome: GenomeIntegrityResult;
  onUpdate: () => void;
}

function scoreColor(score: number): string {
  if (score >= 80) return "hsl(var(--kf-success, 160 70% 45%))";
  if (score >= 50) return "hsl(var(--kf-accent1))";
  return "hsl(var(--kf-warning, 30 90% 55%))";
}

export function DnaSectionsList({ genome, onUpdate }: DnaSectionsListProps) {
  const [expanded, setExpanded] = useState<DnaSectionKey | null>(null);
  const [editing, setEditing] = useState<DnaSectionKey | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">DNA Sections</h3>
          <p className="text-xs text-muted-foreground">Edit each section to strengthen your Business Genome.</p>
        </div>
        <div className="text-xs font-medium text-muted-foreground">
          Integrity: <span className="font-semibold text-foreground">{genome.genomeIntegrity}%</span>
        </div>
      </div>

      {genome.dnaSections.map((section) => {
        const isExpanded = expanded === section.key;
        const color = scoreColor(section.integrity);

        return (
          <div
            key={section.key}
            className="rounded-xl overflow-hidden"
            style={{
              background: "hsl(var(--kf-card))",
              border: "1px solid hsl(var(--kf-border) / 0.2)",
            }}
          >
            <button
              onClick={() => setExpanded(isExpanded ? null : section.key)}
              className="w-full px-4 py-3.5 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}15` }}
                >
                  <Dna className="w-4 h-4" style={{ color }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{section.label}</span>
                    <span className="text-xs font-medium tabular-nums" style={{ color }}>
                      {section.integrity}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{section.summary}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(section.key);
                  }}
                  className="p-2 rounded-lg transition-colors hover:bg-muted"
                  aria-label={`Edit ${section.label}`}
                >
                  <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-0 border-t border-[hsl(var(--kf-border)/0.15)]">
                    <div className="pt-3 space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Fields captured</span>
                        <span className="font-medium">
                          {section.fieldsCaptured} of {section.fieldsTotal}
                        </span>
                      </div>

                      {section.missingFields.length > 0 && (
                        <div>
                          <span className="text-muted-foreground">Missing:</span>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {section.missingFields.map((field) => (
                              <span
                                key={field}
                                className="px-2 py-0.5 rounded-md text-[11px] font-medium"
                                style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
                              >
                                {field.replace(/([A-Z])/g, " $1").trim()}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg p-3" style={{ background: "hsl(var(--kf-muted) / 0.08)" }}>
                        <span className="text-muted-foreground">KEY recommends:</span>
                        <p className="mt-0.5">{section.recommendation}</p>
                      </div>

                      <button
                        onClick={() => setEditing(section.key)}
                        className="w-full py-2 rounded-lg text-xs font-semibold transition-colors"
                        style={{ background: "hsl(var(--kf-accent1))", color: "#fff" }}
                      >
                        Edit {section.label}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing ? genome.dnaSections.find((s) => s.key === editing)?.label : ""}>
        {editing && (
          <DnaSectionDrawer
            section={genome.dnaSections.find((s) => s.key === editing)!}
            onClose={() => setEditing(null)}
            onUpdate={onUpdate}
          />
        )}
      </Drawer>
    </div>
  );
}
