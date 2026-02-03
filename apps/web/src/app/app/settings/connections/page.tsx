"use client";

import { CreditCard, MessageSquare, Instagram, Calendar, CheckCircle2 } from "lucide-react";
import { Button, Card, Badge } from "@keyflow/ui";

type Connection = {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  connected: boolean;
  category: "payments" | "social" | "calendar" | "messaging";
};

const connections: Connection[] = [
  {
    id: "stripe",
    name: "Stripe",
    description: "Accept online payments with credit cards",
    icon: CreditCard,
    connected: false,
    category: "payments",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Send automated messages and reminders",
    icon: MessageSquare,
    connected: false,
    category: "messaging",
  },
  {
    id: "instagram",
    name: "Instagram",
    description: "Schedule and publish posts",
    icon: Instagram,
    connected: false,
    category: "social",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Sync bookings with your calendar",
    icon: Calendar,
    connected: false,
    category: "calendar",
  },
];

export default function ConnectionsSettingsPage() {
  const handleConnect = (connectionId: string) => {
    console.log("Connect:", connectionId);
  };

  const categories = [
    { key: "payments", label: "Payments" },
    { key: "messaging", label: "Messaging" },
    { key: "social", label: "Social Media" },
    { key: "calendar", label: "Calendar" },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Connect your accounts to unlock automations and streamline your workflow.
      </p>

      {categories.map((category) => {
        const categoryConnections = connections.filter((c) => c.category === category.key);
        if (categoryConnections.length === 0) return null;

        return (
          <div key={category.key} className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">{category.label}</h3>
            <div className="space-y-2">
              {categoryConnections.map((connection) => (
                <Card key={connection.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <connection.icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{connection.name}</span>
                          {connection.connected && (
                            <Badge variant="default" className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Connected
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{connection.description}</p>
                      </div>
                    </div>
                    <Button
                      variant={connection.connected ? "outline" : "default"}
                      size="sm"
                      onClick={() => handleConnect(connection.id)}
                    >
                      {connection.connected ? "Manage" : "Connect"}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

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
