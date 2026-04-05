"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import type { FaqEntry } from "@/lib/client";

type Props = {
  entries: FaqEntry[];
  heading?: string;
  primaryColor: string;
  accentColor: string;
};

function FaqItem({ entry, primaryColor, index }: { entry: FaqEntry; primaryColor: string; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="border border-white/[0.06] rounded-2xl overflow-hidden transition-all duration-300"
      style={{
        background: open ? `${primaryColor}06` : "rgba(255,255,255,0.02)",
        borderColor: open ? `${primaryColor}20` : undefined,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left min-h-[44px] group"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-white/80 group-hover:text-white transition-colors leading-relaxed">
          {entry.question}
        </span>
        <ChevronDown
          className="w-4 h-4 flex-shrink-0 text-white/30 transition-transform duration-300"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
        />
      </button>
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: open ? "500px" : "0",
          opacity: open ? 1 : 0,
        }}
      >
        <div className="px-5 pb-4 text-sm text-white/50 leading-relaxed whitespace-pre-line">
          {entry.answer}
        </div>
      </div>
    </div>
  );
}

export function FaqSection({ entries, heading, primaryColor, accentColor }: Props) {
  if (!entries || entries.length === 0) return null;

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${accentColor}15` }}
        >
          <HelpCircle className="w-4 h-4" style={{ color: accentColor }} />
        </div>
        <h3 className="text-lg font-semibold text-white/80">
          {heading || "Frequently Asked Questions"}
        </h3>
      </div>
      <div className="space-y-3">
        {entries.map((entry, idx) => (
          <FaqItem key={entry.id} entry={entry} primaryColor={primaryColor} index={idx} />
        ))}
      </div>
    </section>
  );
}
