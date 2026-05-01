"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, X, Smartphone, Zap } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    const dismissed = localStorage.getItem("kf-pwa-dismissed");
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShowBanner(true), 2000);
    };

    const installedHandler = () => {
      setIsInstalled(true);
      setShowBanner(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") {
      setIsInstalled(true);
      setShowBanner(false);
    }
    setInstalling(false);
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShowBanner(false);
    localStorage.setItem("kf-pwa-dismissed", String(Date.now()));
  }, []);

  if (isInstalled || !showBanner || !deferredPrompt) return null;

  return (
    <div
      className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[380px] z-50"
      style={{
        animation: "pwaSlideUp 500ms cubic-bezier(0.16,1,0.3,1) forwards",
      }}
    >
      <div className="relative rounded-2xl border border-white/[0.12] bg-[#0c0c14]/95 backdrop-blur-2xl shadow-2xl overflow-hidden">
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 20% 0%, #F9731620, transparent 50%), radial-gradient(ellipse at 80% 100%, #14B8A610, transparent 50%)",
          }}
        />

        <div className="relative p-4">
          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center transition-colors"
          >
            <X className="w-3.5 h-3.5 text-white/50" />
          </button>

          <div className="flex gap-3.5">
            <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-teal-500/20 border border-white/[0.08] flex items-center justify-center">
              <img
                src="/icons/icon-192x192.png"
                alt="KEYFLOWOS"
                className="w-8 h-8 rounded-lg"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  (e.target as HTMLImageElement).parentElement!.innerHTML =
                    '<span class="text-lg font-bold text-white">K</span>';
                }}
              />
            </div>

            <div className="flex-1 min-w-0 pr-6">
              <h3 className="text-sm font-semibold text-white mb-0.5">
                Install KEYFLOWOS
              </h3>
              <p className="text-xs text-white/45 leading-relaxed">
                Add to your home screen for instant access, offline support, and a native app experience.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center gap-3 flex-1">
              <div className="flex items-center gap-1.5 text-[10px] text-white/35">
                <Zap className="w-3 h-3" />
                <span>Instant</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-white/35">
                <Smartphone className="w-3 h-3" />
                <span>Native feel</span>
              </div>
            </div>

            <button
              onClick={handleInstall}
              disabled={installing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, #F97316, #14B8A6)",
              }}
            >
              {installing ? (
                <span className="animate-pulse">Installing...</span>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  Install
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pwaSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

