"use client";

import { motion } from "framer-motion";
import { CategoryScores, DIMENSION_MAP, getDimensionScore, scoreColor, scoreBarColor, scoreLabel, fadeUp } from "./types";

export function DimensionScoresGrid({ scores }: { scores: CategoryScores | null }) {
  return (
    <>
      {Object.entries(DIMENSION_MAP).map(([key, dim]) => {
        const dimScore = getDimensionScore(scores, dim.key);
        return (
          <motion.div key={key} variants={fadeUp} className="kf-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{dim.label}</span>
              <span className={`text-lg font-bold ${scoreColor(dimScore)}`}>
                {dimScore ?? "—"}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted/20 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${dimScore ?? 0}%`,
                  backgroundColor: scoreBarColor(dimScore),
                }}
              />
            </div>
            <p className={`text-[11px] font-medium ${scoreColor(dimScore)}`}>
              {scoreLabel(dimScore)}
            </p>
          </motion.div>
        );
      })}
    </>
  );
}
