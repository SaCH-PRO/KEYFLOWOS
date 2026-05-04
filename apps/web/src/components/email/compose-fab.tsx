"use client";

import { usePathname } from "next/navigation";
import { Pencil } from "lucide-react";
import { useCompose } from "./compose-context";

export function ComposeFab() {
  const pathname = usePathname();
  const { open } = useCompose();

  if (!pathname?.startsWith("/app")) return null;

  return (
    <button
      type="button"
      onClick={() => open()}
      aria-label="Compose new email (Cmd+Shift+M)"
      title="Compose (Cmd+Shift+M)"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 h-12 kf-radius-lg shadow-lg transition-transform hover:scale-105 active:scale-95"
      style={{
        background: "hsl(var(--kf-accent1))",
        color: "hsl(var(--kf-primary-foreground))",
        boxShadow: "0 8px 24px hsl(var(--kf-accent1) / 0.35)",
      }}
    >
      <Pencil className="w-4 h-4" />
      <span className="text-sm font-medium hidden sm:inline">Compose</span>
    </button>
  );
}
