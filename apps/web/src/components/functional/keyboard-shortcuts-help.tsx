"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

const SHORTCUT_GROUPS = [
  {
    category: "Navigation",
    items: [
      { keys: ["⌘", "K"], description: "Command palette" },
      { keys: ["⌘", "J"], description: "Talk to KEY" },
      { keys: ["⌘", "H"], description: "Go to Cockpit" },
      { keys: ["Esc"], description: "Close overlays / go back" },
    ],
  },
  {
    category: "Actions",
    items: [
      { keys: ["⌘", "N"], description: "Create new item" },
      { keys: ["?"], description: "Show this help" },
    ],
  },
  {
    category: "Workspace Mode",
    items: [
      { keys: ["⌘", "1"], description: "Startup mode" },
      { keys: ["⌘", "2"], description: "Growth mode" },
      { keys: ["⌘", "3"], description: "Enterprise mode" },
    ],
  },
];

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("kf:show-shortcuts", handler);
    return () => window.removeEventListener("kf:show-shortcuts", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[71] w-full max-w-md mx-4"
          >
            <div className="kf-glass-key p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
                  <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                {SHORTCUT_GROUPS.map((group) => (
                  <div key={group.category}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
                      {group.category}
                    </p>
                    <div className="space-y-1.5">
                      {group.items.map((item) => (
                        <div
                          key={item.description}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/30 transition-colors"
                        >
                          <span className="text-xs text-foreground/80">{item.description}</span>
                          <div className="flex items-center gap-1">
                            {item.keys.map((key) => (
                              <kbd
                                key={key}
                                className={cn(
                                  "inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 rounded-md text-[10px] font-mono font-medium",
                                  key === "⌘"
                                    ? "bg-gradient-to-br from-orange-500/20 to-teal-500/10 text-orange-400 border border-orange-500/20"
                                    : "bg-muted border border-border/50 text-muted-foreground"
                                )}
                              >
                                {key}
                              </kbd>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-border/30">
                <p className="text-[10px] text-muted-foreground/50 text-center">
                  Press <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">Esc</kbd> to close
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
