"use client";

import Link from "next/link";
import {
  Settings,
  User,
  Building2,
  Users,
  Shield,
  Link as LinkIcon,
  ChevronRight,
} from "lucide-react";
import { Card } from "@keyflow/ui";

const settingsSections = [
  {
    id: "profile",
    title: "Profile",
    description: "Your personal account settings and password",
    icon: User,
    href: "/app/settings/profile",
  },
  {
    id: "business",
    title: "Business",
    description: "Business info, logo, branding, social media, and tax settings",
    icon: Building2,
    href: "/app/settings/business",
  },
  {
    id: "team",
    title: "Team",
    description: "Invite team members and manage roles",
    icon: Users,
    href: "/app/settings/team",
  },
  {
    id: "connections",
    title: "Connections",
    description: "Connect payment processors, calendars, and social accounts",
    icon: LinkIcon,
    href: "/app/settings/connections",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <Settings className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account and business</p>
        </div>
      </div>

      <div className="space-y-3">
        {settingsSections.map((section) => (
          <Link key={section.id} href={section.href}>
            <Card className="p-4 hover:bg-slate-800/50 transition-colors cursor-pointer group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <section.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">{section.title}</h3>
                    <p className="text-xs text-muted-foreground">{section.description}</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
