"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  CreditCard, MessageSquare, Instagram, Calendar,
  CheckCircle2, Loader2, AlertCircle, Link2, Zap, ArrowRight,
  Mail,
} from "lucide-react";
import { Button, Badge } from "@keyflow/ui";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type CalendarStatus = { connected: boolean; email?: string };

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

const comingSoonItems = [
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Send automated messages, booking confirmations, and payment reminders",
    icon: MessageSquare,
    category: "Messaging",
    color: "#25D366",
    gradient: "from-green-500/15 to-emerald-500/15",
  },
  {
    id: "instagram",
    name: "Instagram",
    description: "Schedule and publish posts, sync your feed to your store",
    icon: Instagram,
    category: "Social Media",
    color: "#E4405F",
    gradient: "from-pink-500/15 to-purple-500/15",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Send quotes and invoices directly from your business email",
    icon: Mail,
    category: "Email",
    color: "#EA4335",
    gradient: "from-red-500/15 to-orange-500/15",
  },
];

function SkeletonConnections() {
  return (
    <div className="space-y-6 max-w-2xl animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-24 rounded-xl border border-border/30 bg-muted/10" />
      ))}
    </div>
  );
}

export default function ConnectionsSettingsPage() {
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const fetchCalendarStatus = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    const res = await apiGet<CalendarStatus>(`/bookings/businesses/${businessId}/calendar/status`);
    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setCalendarStatus(res.data);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => { fetchCalendarStatus(); }, [fetchCalendarStatus]);

  const handleConnect = async () => {
    if (!businessId) return;
    setConnecting(true);
    setError(null);
    const res = await apiGet<{ url: string }>(`/bookings/businesses/${businessId}/calendar/auth-url`);
    if (res.error) { setError(res.error); setConnecting(false); return; }
    if (res.data?.url) window.location.href = res.data.url;
  };

  const handleDisconnect = async () => {
    if (!businessId) return;
    setDisconnecting(true);
    setError(null);
    const res = await apiPostSimple<{ success: boolean }>(`/bookings/businesses/${businessId}/calendar/disconnect`, {});
    if (res.error) {
      setError(res.error);
    } else {
      setCalendarStatus({ connected: false });
    }
    setDisconnecting(false);
  };

  if (loading) return <SkeletonConnections />;

  return (
    <motion.div
      variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-6 max-w-2xl"
    >
      <motion.div variants={fadeUp}>
        <p className="text-sm text-muted-foreground">
          Connect your accounts to unlock automations and streamline your workflow.
        </p>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-900/20 border border-red-500/20 text-red-300 text-sm"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap className="h-3 w-3" /> Active Integrations
        </h3>

        <div className={`rounded-xl border p-4 transition-all ${
          calendarStatus?.connected
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-border/40"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-sky-500/20 border border-blue-500/20 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Google Calendar</span>
                  {calendarStatus?.connected && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {calendarStatus?.connected && calendarStatus.email
                    ? calendarStatus.email
                    : "Sync bookings with your Google Calendar automatically"}
                </p>
              </div>
            </div>
            {calendarStatus?.connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                aria-label="Disconnect Google Calendar"
              >
                {disconnecting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                Disconnect
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleConnect}
                disabled={connecting}
                aria-label="Connect Google Calendar"
              >
                {connecting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                Connect
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <ArrowRight className="h-3 w-3" /> Coming Soon
        </h3>

        <div className="space-y-2">
          {comingSoonItems.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-border/30 p-4 opacity-70 hover:opacity-90 transition-opacity"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-11 w-11 rounded-xl bg-gradient-to-br ${item.gradient} border flex items-center justify-center`}
                    style={{ borderColor: `${item.color}30` }}
                  >
                    <item.icon className="h-5 w-5" style={{ color: item.color }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{item.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-border/40">
                        Coming Soon
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" disabled className="opacity-50">
                  Connect
                </Button>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card p-4 border-dashed">
        <div className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Link2 className="h-4 w-4" />
          More integrations coming soon.{" "}
          <a href="mailto:support@keyflow.app" className="text-[hsl(var(--kf-accent1))] hover:underline font-medium">
            Request one
          </a>
        </div>
      </motion.div>
    </motion.div>
  );
}
