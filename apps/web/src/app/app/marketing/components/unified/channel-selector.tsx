"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, ChevronDown, Facebook, Instagram, Mail, MessageCircle,
  Globe, Wifi, WifiOff, Plus, RefreshCw, Loader2,
} from "lucide-react";
import { listChannelConnections, listChannelDestinations } from "@/lib/client";
import type { ChannelConnection, ChannelDestination } from "@/lib/client";

interface ChannelSelectorProps {
  businessId: string;
  selectedDestinations: ChannelDestination[];
  onSelectionChange: (destinations: ChannelDestination[]) => void;
  contentType?: string;
}

const PLATFORM_ICONS: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  FACEBOOK: { icon: Facebook, color: "#1877F2", label: "Facebook" },
  INSTAGRAM: { icon: Instagram, color: "#E4405F", label: "Instagram" },
  GOOGLE: { icon: Mail, color: "#F97316", label: "Email (Gmail)" },
  EMAIL: { icon: Mail, color: "#F97316", label: "Email" },
  WHATSAPP: { icon: MessageCircle, color: "#25D366", label: "WhatsApp" },
  META: { icon: Globe, color: "#0668E1", label: "Meta" },
};

function getPlatformMeta(platform: string) {
  return PLATFORM_ICONS[platform.toUpperCase()] || { icon: Globe, color: "#94a3b8", label: platform };
}

export function ChannelSelector({ businessId, selectedDestinations, onSelectionChange, contentType }: ChannelSelectorProps) {
  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [destinations, setDestinations] = useState<ChannelDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [connRes, destRes] = await Promise.all([
      listChannelConnections(businessId),
      listChannelDestinations(businessId, { activeOnly: true }),
    ]);
    if (connRes.data) setConnections(connRes.data);
    if (destRes.data) setDestinations(destRes.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const toggleDestination = (dest: ChannelDestination) => {
    const exists = selectedDestinations.find((d) => d.id === dest.id);
    if (exists) {
      onSelectionChange(selectedDestinations.filter((d) => d.id !== dest.id));
    } else {
      onSelectionChange([...selectedDestinations, dest]);
    }
  };

  const selectAll = () => {
    onSelectionChange([...destinations]);
  };

  const selectedIds = new Set(selectedDestinations.map((d) => d.id));

  const groupedByConnection = connections.map((conn) => ({
    connection: conn,
    destinations: destinations.filter((d) => d.connectionId === conn.id),
  })).filter((g) => g.destinations.length > 0);

  const ungrouped = destinations.filter((d) => !connections.some((c) => c.id === d.connectionId));

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border/30 bg-muted/10 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : selectedDestinations.length === 0 ? (
            <span className="text-xs text-muted-foreground">Select channels to distribute...</span>
          ) : (
            <div className="flex items-center gap-1.5">
              {selectedDestinations.slice(0, 4).map((dest) => {
                const meta = getPlatformMeta(dest.platform);
                const Icon = meta.icon;
                return (
                  <div key={dest.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                    <Icon className="w-3 h-3" />
                    <span className="max-w-16 truncate">{dest.displayName}</span>
                  </div>
                );
              })}
              {selectedDestinations.length > 4 && (
                <span className="text-[10px] text-muted-foreground">+{selectedDestinations.length - 4} more</span>
              )}
            </div>
          )}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-border/30 bg-card p-3 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : destinations.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <WifiOff className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                  <p className="text-xs text-muted-foreground">No channels connected yet</p>
                  <p className="text-[10px] text-muted-foreground/60">Connect Facebook, Instagram, or Email to start distributing content</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Channels</span>
                    <div className="flex items-center gap-2">
                      <button onClick={selectAll} className="text-[10px] text-[hsl(var(--kf-accent1))] hover:underline">Select all</button>
                      <button onClick={() => { void loadData(); }} className="p-1 rounded hover:bg-muted/20">
                        <RefreshCw className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                  </div>

                  {groupedByConnection.map(({ connection, destinations: dests }) => {
                    const connMeta = getPlatformMeta(connection.platform || connection.providerType);
                    return (
                      <div key={connection.id} className="space-y-1.5">
                        <div className="flex items-center gap-2 px-1">
                          <connMeta.icon className="w-3 h-3" style={{ color: connMeta.color }} />
                          <span className="text-[10px] font-medium">{connection.displayName}</span>
                          <div className={`w-1.5 h-1.5 rounded-full ${connection.healthStatus === "healthy" ? "bg-emerald-400" : connection.healthStatus === "degraded" ? "bg-amber-400" : "bg-red-400"}`} />
                        </div>
                        {dests.map((dest) => (
                          <button
                            key={dest.id}
                            onClick={() => toggleDestination(dest)}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                              selectedIds.has(dest.id)
                                ? "bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30"
                                : "hover:bg-muted/15 border border-transparent"
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              selectedIds.has(dest.id) ? "bg-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]" : "border-border/50"
                            }`}>
                              {selectedIds.has(dest.id) && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{dest.displayName}</p>
                              <p className="text-[10px] text-muted-foreground capitalize">{dest.destinationType.replace(/_/g, " ")}</p>
                            </div>
                            {dest.isActive && <Wifi className="w-3 h-3 text-emerald-400/60" />}
                          </button>
                        ))}
                      </div>
                    );
                  })}

                  {ungrouped.map((dest) => {
                    const meta = getPlatformMeta(dest.platform);
                    return (
                      <button
                        key={dest.id}
                        onClick={() => toggleDestination(dest)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                          selectedIds.has(dest.id)
                            ? "bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30"
                            : "hover:bg-muted/15 border border-transparent"
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          selectedIds.has(dest.id) ? "bg-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]" : "border-border/50"
                        }`}>
                          {selectedIds.has(dest.id) && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <meta.icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{dest.displayName}</p>
                          <p className="text-[10px] text-muted-foreground capitalize">{dest.platform}</p>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
