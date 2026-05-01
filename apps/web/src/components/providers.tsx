"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeColorsProvider } from "@/lib/theme-context";
import { RegisterSW } from "@/components/register-sw";
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ThemeColorsProvider>
        <RegisterSW />
        <PWAInstallPrompt />
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            style: {
              background: "rgba(15, 23, 42, 0.95)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#e2e8f0",
            },
          }}
          closeButton
          richColors
        />
        {children}
      </ThemeColorsProvider>
    </ThemeProvider>
  );
}

