"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative inline-flex h-8 w-14 items-center rounded-full border border-border bg-muted transition-colors hover:bg-muted/80"
      aria-label="Toggle theme"
    >
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300 ${
          isDark 
            ? "translate-x-7 bg-card" 
            : "translate-x-1 bg-white shadow-sm"
        }`}
        style={isDark ? { background: "hsl(var(--kf-accent1))" } : {}}
      >
        {isDark ? (
          <Moon className="h-3.5 w-3.5 text-white" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-amber-500" />
        )}
      </span>
    </button>
  );
}
