"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, Lightbulb } from "lucide-react";

export function ExplainerButton({ items }: { items: { title: string; text: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
        style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
      >
        <HelpCircle className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        How this works
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              className="absolute right-0 top-full mt-2 z-50 w-80 sm:w-96 rounded-xl border shadow-2xl p-4 space-y-3"
              style={{
                background: "hsl(var(--kf-bg))",
                borderColor: "hsl(var(--kf-accent1) / 0.2)",
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Lightbulb className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  Quick Guide
                </div>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground text-xs">
                  Close
                </button>
              </div>
              <div className="space-y-2">
                {items.map((item, i) => (
                  <div
                    key={i}
                    className="rounded-lg px-3 py-2.5 flex gap-2.5 items-start"
                    style={{
                      background: "hsl(var(--kf-muted) / 0.25)",
                      border: "1px solid hsl(var(--kf-border) / 0.2)",
                    }}
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                      style={{
                        background: "hsl(var(--kf-accent1) / 0.15)",
                        color: "hsl(var(--kf-accent1))",
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-tight">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
