"use client";

import { useEffect, useState, useCallback } from "react";
import { CreditCard, MessageSquare, Instagram, Calendar, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Button, Card, Badge } from "@keyflow/ui";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type CalendarStatus = { connected: boolean; email?: string };

export default function ConnectionsSettingsPage() {
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const fetchCalendarStatus = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
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

  useEffect(() => {
    fetchCalendarStatus();
  }, [fetchCalendarStatus]);

  const handleConnect = async () => {
    if (!businessId) return;
    setConnecting(true);
    setError(null);
    const res = await apiGet<{ url: string }>(`/bookings/businesses/${businessId}/calendar/auth-url`);
    if (res.error) {
      setError(res.error);
      setConnecting(false);
      return;
    }
    if (res.data?.url) {
      window.location.href = res.data.url;
    }
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

  const comingSoonItems = [
    {
      id: "stripe",
      name: "Stripe",
      description: "Accept online payments with credit cards",
      icon: CreditCard,
      category: "Payments",
    },
    {
      id: "whatsapp",
      name: "WhatsApp Business",
      description: "Send automated messages and reminders",
      icon: MessageSquare,
      category: "Messaging",
    },
    {
      id: "instagram",
      name: "Instagram",
      description: "Schedule and publish posts",
      icon: Instagram,
      category: "Social Media",
    },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Connect your accounts to unlock automations and streamline your workflow.
      </p>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Calendar</h3>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Google Calendar</span>
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  ) : calendarStatus?.connected ? (
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {calendarStatus?.connected && calendarStatus.email
                    ? calendarStatus.email
                    : "Sync bookings with your calendar"}
                </p>
              </div>
            </div>
            {!loading && (
              calendarStatus?.connected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  aria-label="Disconnect Google Calendar"
                >
                  {disconnecting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
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
                  {connecting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Connect
                </Button>
              )
            )}
          </div>
        </Card>
      </div>

      {comingSoonItems.map((item) => (
        <div key={item.id} className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">{item.category}</h3>
          <Card className="p-4 opacity-60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.name}</span>
                    <Badge className="text-xs text-muted-foreground border-muted-foreground/30">
                      Coming Soon
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" disabled>
                Connect
              </Button>
            </div>
          </Card>
        </div>
      ))}

      <Card className="p-4 bg-slate-900/50 border-dashed">
        <div className="text-center text-sm text-muted-foreground">
          More integrations coming soon. Have a request?{" "}
          <a href="mailto:support@keyflow.app" className="text-primary hover:underline">
            Let us know
          </a>
        </div>
      </Card>
    </div>
  );
}
