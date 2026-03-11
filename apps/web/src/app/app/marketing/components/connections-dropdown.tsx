"use client";

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  CheckCircle2,
  Circle,
  Settings,
  Mail,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Share2,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import type { SocialConnection } from "@/lib/client";

const SOCIAL_PLATFORM_META: Record<string, { icon: React.ElementType; color: string }> = {
  facebook: { icon: Facebook, color: "#1877F2" },
  instagram: { icon: Instagram, color: "#E4405F" },
  linkedin: { icon: Linkedin, color: "#0A66C2" },
  twitter: { icon: Twitter, color: "#1DA1F2" },
};

interface ConnectionsDropdownProps {
  gmailConnected: boolean;
  gmailEmail?: string | null;
  socialConnections: SocialConnection[];
  onGmailConnect?: () => void;
  loading?: boolean;
}

export function ConnectionsDropdown({
  gmailConnected,
  gmailEmail,
  socialConnections,
  onGmailConnect,
  loading,
}: ConnectionsDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const platforms = ["facebook", "instagram", "linkedin", "twitter"].map((platform) => {
    const conn = socialConnections.find((c) => c.platform.toLowerCase() === platform);
    const meta = SOCIAL_PLATFORM_META[platform] || { icon: Share2, color: "#6366f1" };
    return {
      key: platform,
      name: platform.charAt(0).toUpperCase() + platform.slice(1),
      icon: meta.icon,
      color: meta.color,
      connected: conn?.status === "CONNECTED",
    };
  });

  const totalConnected =
    (gmailConnected ? 1 : 0) + platforms.filter((p) => p.connected).length;
  const totalChannels = 1 + platforms.length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl border border-border bg-card/60 hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Connections"
        aria-expanded={open}
      >
        <Wifi className="w-4 h-4" />
        <span className="hidden sm:inline">
          {totalConnected}/{totalChannels} connected
        </span>
        <span className="sm:hidden">{totalConnected}/{totalChannels}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-border">
              <h4 className="text-sm font-semibold">Connections</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {totalConnected} of {totalChannels} channels connected
              </p>
            </div>

            <div className="py-1.5">
              <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "#EA433518" }}
                >
                  <Mail className="w-4 h-4" style={{ color: "#EA4335" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">Gmail</span>
                  {gmailConnected && gmailEmail && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {gmailEmail}
                    </p>
                  )}
                </div>
                {gmailConnected ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : onGmailConnect ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onGmailConnect();
                    }}
                    disabled={loading}
                    className="text-[11px] px-2 py-1 rounded-md bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                  >
                    Connect
                  </button>
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
                )}
              </div>

              <div className="h-px bg-border mx-4 my-1" />

              {platforms.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.key}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        background: p.connected ? `${p.color}18` : "hsl(var(--kf-muted))",
                      }}
                    >
                      <Icon
                        className="w-4 h-4"
                        style={{
                          color: p.connected
                            ? p.color
                            : "hsl(var(--kf-muted-foreground))",
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium flex-1">{p.name}</span>
                    {p.connected ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border px-4 py-3">
              <Link
                href="/app/settings/connections"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-2 w-full text-sm font-medium text-[hsl(var(--kf-accent1))] hover:underline transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                Manage Connections
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
