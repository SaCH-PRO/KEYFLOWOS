"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle } from "lucide-react";

interface MetricExplainerProps {
  label: string;
  explanation: string;
  formula?: string;
  goodValue?: string;
  children: ReactNode;
}

export function MetricExplainer({
  label,
  explanation,
  formula,
  goodValue,
  children,
}: MetricExplainerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative group/metric">
      {children}
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="absolute top-1.5 right-1.5 p-1.5 rounded-full opacity-100 sm:opacity-0 sm:group-hover/metric:opacity-100 focus:opacity-100 transition-opacity hover:bg-muted/30 touch-manipulation"
        aria-label={`What is ${label}? Tap for details`}
      >
        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full left-0 right-0 mt-1.5 z-50"
          >
            <div
              className="rounded-lg p-2.5 shadow-xl"
              style={{
                background: "hsl(var(--kf-bg))",
                border: "1px solid hsl(var(--kf-border) / 0.4)",
                boxShadow: "0 8px 24px hsl(0 0% 0% / 0.3)",
              }}
            >
              <p className="text-[11px] font-medium mb-1" style={{ color: "hsl(var(--kf-accent2))" }}>
                {label}
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {explanation}
              </p>
              {formula && (
                <p
                  className="text-[10px] mt-1.5 px-2 py-1 rounded font-mono"
                  style={{ background: "hsl(var(--kf-muted) / 0.25)", color: "hsl(var(--kf-accent1))" }}
                >
                  {formula}
                </p>
              )}
              {goodValue && (
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  <span className="font-medium" style={{ color: "hsl(var(--kf-success))" }}>Good: </span>
                  {goodValue}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
