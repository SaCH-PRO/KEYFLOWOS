"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Facebook, Instagram, MessageCircle, Lock, Linkedin, Bell } from "lucide-react";

const CHANNELS = [
  {
    name: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    description: "Pages, posts & stories",
  },
  {
    name: "Instagram",
    icon: Instagram,
    color: "#E4405F",
    description: "Feed posts & reels",
  },
  {
    name: "WhatsApp Business",
    icon: MessageCircle,
    color: "#25D366",
    description: "Status updates & broadcasts",
  },
  {
    name: "LinkedIn",
    icon: Linkedin,
    color: "#0A66C2",
    description: "Professional posts & articles",
  },
  {
    name: "TikTok",
    icon: ({ className }: { className?: string }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.87a8.16 8.16 0 003.76.92V6.34a4.83 4.83 0 01-.01.35z" />
      </svg>
    ),
    color: "#000000",
    description: "Short videos & clips",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

export function ChannelsPanel() {
  const [requestedAccess, setRequestedAccess] = useState<Set<string>>(new Set());

  function handleRequestAccess(name: string) {
    setRequestedAccess((prev) => new Set(prev).add(name));
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={item} className="flex items-center gap-2 mb-1">
        <Lock className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        <span className="text-[10px] px-2 py-0.5 rounded-full border" style={{ color: "hsl(var(--kf-accent1))", borderColor: "hsl(var(--kf-accent1) / 0.3)", background: "hsl(var(--kf-accent1) / 0.1)" }}>
          Coming Soon
        </span>
      </motion.div>

      <motion.p variants={item} className="text-xs text-muted-foreground">
        Connect your social accounts to publish posts directly from KeyFlowOS. One post, all platforms.
      </motion.p>

      <motion.div variants={container} className="grid gap-3 md:grid-cols-2">
        {CHANNELS.map((ch) => {
          const Icon = ch.icon;
          const requested = requestedAccess.has(ch.name);
          return (
            <motion.div
              key={ch.name}
              variants={item}
              whileHover={{ scale: 1.02, y: -2 }}
              className="rounded-2xl border backdrop-blur-xl p-4 space-y-3"
              style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${ch.color}20`, border: `1px solid ${ch.color}30` }}
                >
                  <Icon className="w-5 h-5" style={{ color: ch.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{ch.name}</p>
                  <p className="text-[11px] text-muted-foreground">{ch.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="kf-btn-secondary text-xs flex-1 opacity-50 cursor-not-allowed" disabled>
                  Connect
                </button>
                <button
                  onClick={() => handleRequestAccess(ch.name)}
                  disabled={requested}
                  className={`text-xs flex-1 inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 border transition-all ${
                    requested
                      ? "border-emerald-500/30 text-emerald-400 cursor-default"
                      : "border-[hsl(var(--kf-accent1)/0.3)] text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1)/0.1)] cursor-pointer"
                  }`}
                  style={{ background: requested ? "hsl(150 60% 40% / 0.1)" : "transparent" }}
                >
                  <Bell className="w-3 h-3" />
                  {requested ? "Requested!" : "Early Access"}
                </button>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
