"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Users, User, Link2, Settings, Palette } from "lucide-react";

const navItems = [
  { href: "/app/settings", label: "General", icon: Settings },
  { href: "/app/settings/business", label: "Business", icon: Building2 },
  { href: "/app/settings/team", label: "Team", icon: Users },
  { href: "/app/settings/profile", label: "Profile", icon: User },
  { href: "/app/settings/brand", label: "Brand & Theme", icon: Palette },
  { href: "/app/settings/connections", label: "Connections", icon: Link2 },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your workspace, team, and integrations.</p>
      </div>
      <div className="flex gap-2 border-b border-border/40 pb-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/app/settings" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-primary/20 text-primary border border-primary/40"
                  : "text-muted-foreground hover:bg-slate-800/50 hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div>{children}</div>
    </div>
  );
}
