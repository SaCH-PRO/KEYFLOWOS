"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import type { FaqEntry } from "@/lib/client";

type Props = {
  entries: FaqEntry[];
  heading?: string;
  primaryColor: string;
  accentColor: string;
  showIcon?: boolean;
  compact?: boolean;
};

function FaqItem({ entry, primaryColor }: { entry: FaqEntry; primaryColor: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="border border-gray-200 rounded-2xl overflow-hidden transition-all duration-300"
      style={{
        background: open ? `${primaryColor}06` : "rgba(0,0,0,0.02)",
        borderColor: open ? `${primaryColor}20` : undefined,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left min-h-[44px] group"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 transition-colors leading-relaxed">
          {entry.question}
        </span>
        <ChevronDown
          className="w-4 h-4 flex-shrink-0 text-gray-400 transition-transform duration-300"
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
        <div className="px-5 pb-4 text-sm text-gray-500 leading-relaxed whitespace-pre-line">
          {entry.answer}
        </div>
      </div>
    </div>
  );
}

export function FaqSection({ entries, heading, primaryColor, accentColor, showIcon = true, compact = false }: Props) {
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!entries || entries.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      className={compact ? "space-y-3" : "space-y-5"}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
      }}
    >
      <div className="flex items-center gap-3">
        {showIcon && (
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${accentColor}15` }}
          >
            <HelpCircle className="w-4 h-4" style={{ color: accentColor }} />
          </div>
        )}
        <h3 className={`font-semibold text-gray-700 ${compact ? "text-base" : "text-lg"}`}>
          {heading || "Frequently Asked Questions"}
        </h3>
      </div>
      <div className={compact ? "space-y-2" : "space-y-3"}>
        {entries.map((entry) => (
          <FaqItem key={entry.id} entry={entry} primaryColor={primaryColor} />
        ))}
      </div>
    </section>
  );
}
