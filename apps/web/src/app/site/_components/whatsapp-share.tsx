"use client";

import { useMemo, useSyncExternalStore } from "react";
import { MessageCircle } from "lucide-react";
import { trackPresence } from "../../_lib/presence-sdk";

// Subscribe to the browser `location.origin` so we can resolve the
// share URL to an absolute https:// link without triggering a setState
// inside an effect (which the lint rule forbids in newer React).
function useOrigin(): string | null {
  return useSyncExternalStore(
    () => () => {},
    () => (typeof window !== "undefined" ? window.location.origin : null),
    () => null,
  );
}

/**
 * S5 — WhatsApp share button.
 *
 * Uses `https://wa.me/?text=...` which the WhatsApp app intercepts on
 * mobile devices that have it installed; on desktop / mobile-without-
 * app, the URL falls back to wa.me's web client. We intentionally do
 * NOT pin the link to a phone number — recipient choice is part of
 * the share gesture.
 *
 * The shareable URL appends `?ref=<code>` so the visitor that lands
 * via the link gets credited back to the sharer (when present).
 */
export function WhatsAppShare({
  businessId,
  businessName,
  shareUrl,
  referralCode,
  primaryColor = "#25D366",
}: {
  businessId?: string;
  businessName: string;
  shareUrl: string;
  referralCode?: string | null;
  primaryColor?: string;
}) {
  // Resolve to an absolute URL on the client so the WhatsApp message
  // contains a proper https:// link the recipient can tap. Until the
  // origin is known (SSR / first paint) we fall back to the relative
  // share URL — the link is hidden behind a click anyway.
  const origin = useOrigin();
  const absoluteUrl = useMemo(() => {
    if (!origin) return shareUrl;
    try {
      const u = new URL(shareUrl, origin);
      if (referralCode && !u.searchParams.has("ref")) {
        u.searchParams.set("ref", referralCode);
      }
      return u.toString();
    } catch {
      return shareUrl;
    }
  }, [origin, shareUrl, referralCode]);

  const text = `Check out ${businessName} on KeyFlow — ${absoluteUrl}`;
  const href = `https://wa.me/?text=${encodeURIComponent(text)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        if (businessId) {
          trackPresence(businessId, "share_click", { channel: "whatsapp" });
        }
      }}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 hover:scale-105 active:scale-95 shadow-sm"
      style={{
        background: `linear-gradient(135deg, ${primaryColor}, #128C7E)`,
        color: "white",
      }}
    >
      <MessageCircle className="w-4 h-4" />
      Share on WhatsApp
    </a>
  );
}
