"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Users, User, Link2 } from "lucide-react";

const navItems = [
  { href: "/app/settings/profile", label: "Profile", icon: User },
  { href: "/app/settings/business", label: "Business", icon: Building2 },
  { href: "/app/settings/team", label: "Team", icon: Users },
  { href: "/app/settings/connections", label: "Connections", icon: Link2 },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-border pb-3 overflow-x-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/app/settings" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors shrink-0 ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
