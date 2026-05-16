"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const LABEL_MAP: Record<string, string> = {
  app: "Home",
  crm: "CRM",
  pipeline: "Clients",
  contacts: "Clients",
  dashboard: "Dashboard",
  commerce: "Revenue",
  invoices: "Invoices",
  quotes: "Quotes",
  products: "Products",
  payments: "Payments",
  recurring: "Recurring",
  billing: "Billing",
  bookings: "Calendar",
  calendar: "Calendar",
  marketing: "Content",
  expenses: "Expenses",
  projects: "Projects",
  automations: "Automations",
  reports: "Reports",
  store: "Presence",
  settings: "Studio",
  business: "Business",
  profile: "Profile",
  team: "Team",
  notifications: "Notifications",
  connections: "Connections",
  developers: "Developers",
  compliance: "Compliance",
  templates: "Templates",
  webhooks: "Webhooks",
  social: "Social",
  insights: "Insights",
  onboarding: "Onboarding",
  branding: "Branding",
  integrations: "Integrations",
  security: "Security",
  "api-keys": "API Keys",
  budgets: "Budgets",
  analytics: "Analytics",
  performance: "Performance",
  catalog: "Catalog",
  audiences: "Audiences",
  forms: "Forms",
  cohorts: "Cohorts",
  certificates: "Certificates",
  feed: "Feed",
  blueprint: "Blueprint",
  procurement: "Procurement",
  "keyflow-command": "Command",
  "control-tower": "Control Tower",
  suppliers: "Suppliers",
  overview: "Overview",
  timeline: "Timeline",
  money: "Money",
  "quotes-invoices": "Quotes & Invoices",
  tasks: "Tasks",
  notes: "Notes",
  "ai-insights": "AI Insights",
  recommendations: "Recommendations",
};

export function Breadcrumbs() {
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return null;

  const appIndex = segments.indexOf("app");
  if (appIndex === -1) return null;

  const crumbs = segments.slice(appIndex + 1);
  if (crumbs.length === 0) return null;

  const isUuid = (s: string) => /^[0-9a-f-]{20,}$/i.test(s);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground px-1 py-1.5">
      <Link href="/app" className="hover:text-foreground transition-colors">
        Home
      </Link>
      {crumbs.map((segment, idx) => {
        if (isUuid(segment)) return null;
        const href = "/app/" + crumbs.slice(0, idx + 1).join("/");
        const label = LABEL_MAP[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
        const isLast = idx === crumbs.length - 1 || (idx === crumbs.length - 2 && isUuid(crumbs[crumbs.length - 1]));

        return (
          <span key={href} className="flex items-center gap-1">
            <ChevronRight className="w-3 h-3 text-muted-foreground/60" />
            {isLast ? (
              <span className="text-foreground font-medium">{label}</span>
            ) : (
              <Link href={href} className="hover:text-foreground transition-colors">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
