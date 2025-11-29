"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative inline-flex h-7 w-12 items-center rounded-full border border-border bg-card shadow-soft-elevated transition-colors",
      )}
    >
      <span
        className={cn(
          "absolute inset-0 rounded-full bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950/80 opacity-80",
        )}
      />
      <span
        className={cn(
          "relative z-10 m-[3px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-950 shadow-glow-primary transition-transform",
          isDark ? "translate-x-[14px]" : "translate-x-0",
        )}
      >
        {isDark ? (
          <Moon className="w-3 h-3 text-primary" />
        ) : (
          <Sun className="w-3 h-3 text-amber-400" />
        )}
      </span>
    </button>
  );
}
