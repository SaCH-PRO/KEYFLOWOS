"use client";

import { Shield, Palette, Globe, Bell } from "lucide-react";

const settings = [
  { icon: Shield, title: "Access Control", description: "Manage members, roles, and permissions." },
  { icon: Palette, title: "Brand & Theme", description: "Logo, colors, typography, and favicon." },
  { icon: Globe, title: "Domains", description: "Connect custom domains for public pages and studio." },
  { icon: Bell, title: "Notifications", description: "Email/WhatsApp/Push preferences." },
];

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Workspace settings, brand, domains, and notifications.</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {settings.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 flex gap-3">
              <div className="h-10 w-10 rounded-2xl bg-slate-900/70 border border-border/60 flex items-center justify-center text-primary">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">{item.title}</div>
                <div className="text-xs text-muted-foreground">{item.description}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
