import type { ElementType } from "react";
import {
  COMMERCE_WALKTHROUGH,
  CRM_WALKTHROUGH,
  BOOKINGS_WALKTHROUGH,
  MARKETING_WALKTHROUGH,
  REPORTS_WALKTHROUGH,
  EXPENSES_WALKTHROUGH,
  AUTOMATIONS_WALKTHROUGH,
  PROJECTS_WALKTHROUGH,
  STORE_WALKTHROUGH,
  LEARN_WALKTHROUGH,
  PAGE_OVERVIEWS,
  METRIC_DEFINITIONS,
} from "./walkthrough-definitions";
import {
  Gauge,
  Users,
  CreditCard,
  Calendar,
  Megaphone,
  BarChart3,
  Receipt,
  Zap,
  FolderKanban,
  Store,
  GraduationCap,
  Sparkles,
  HelpCircle,
} from "lucide-react";

export type NoteIcon = ElementType;

export interface NoteWalkthroughStep {
  title: string;
  description: string;
  target?: string;
  icon?: NoteIcon;
}

export interface NoteKeyTerm {
  term: string;
  definition: string;
  formula?: string;
  goodValue?: string;
}

export interface NoteRelated {
  pageKey: string;
  label: string;
}

export interface PageNote {
  /** Stable key — also used as URL hash & deep-link id. */
  key: string;
  title: string;
  /** Short subtitle shown under the title. */
  subtitle: string;
  /** Long-form briefing — HTML-safe markdown-ish text rendered as paragraphs. */
  briefing: string;
  /** Optional walkthrough showing the structure of the page. */
  walkthroughSteps: NoteWalkthroughStep[];
  /** Glossary of metrics, jargon, or first-time-user terms. */
  keyTerms: NoteKeyTerm[];
  /** Cross-links to other Notes entries. */
  relatedNotes: NoteRelated[];
  /** Path the page lives on (used by the "Get started" launcher). */
  href: string;
  icon: NoteIcon;
  iconColor: string;
}

function fromOverview(
  pageKey: string,
  href: string,
  icon: NoteIcon,
  iconColor: string,
  walkthrough: { title: string; description: string; target?: string; icon?: NoteIcon }[],
  keyTerms: NoteKeyTerm[] = [],
  relatedNotes: NoteRelated[] = [],
): PageNote {
  const overview = PAGE_OVERVIEWS[pageKey];
  const briefing = overview
    ? `${overview.description}\n\n${overview.concepts
        .map((c) => `${c.step}. ${c.title} — ${c.desc}`)
        .join("\n")}`
    : "";
  return {
    key: pageKey,
    title: overview?.title ?? pageKey,
    subtitle: overview?.description ?? "",
    briefing,
    walkthroughSteps: walkthrough.map((w) => ({
      title: w.title,
      description: w.description,
      target: w.target,
      icon: w.icon,
    })),
    keyTerms,
    relatedNotes,
    href,
    icon,
    iconColor,
  };
}

const m = METRIC_DEFINITIONS;
const term = (k: keyof typeof m): NoteKeyTerm => ({
  term: m[k].label,
  definition: m[k].explanation,
  formula: m[k].formula,
  goodValue: m[k].goodValue,
});

export const NOTES_CATALOG: Record<string, PageNote> = {
  today: fromOverview("today", "/app", Gauge, "var(--kf-accent1)", [], [
    term("momentum_score"),
    term("cash_flow_forecast"),
  ], [
    { pageKey: "commerce", label: "Revenue" },
    { pageKey: "crm", label: "Clients" },
  ]),
  crm: fromOverview("crm", "/app/network/contacts", Users, "var(--kf-accent1)", CRM_WALKTHROUGH, [
    term("conversion_rate"),
    term("lead_score"),
    term("momentum_score"),
    term("customer_lifetime_value"),
  ], [
    { pageKey: "marketing", label: "Marketing" },
    { pageKey: "commerce", label: "Revenue" },
    { pageKey: "automations", label: "Flows" },
  ]),
  commerce: fromOverview("commerce", "/app/commerce", CreditCard, "var(--kf-success)", COMMERCE_WALKTHROUGH, [
    term("outstanding"),
    term("overdue"),
    term("collected_this_month"),
    term("cash_flow_forecast"),
  ], [
    { pageKey: "expenses", label: "Expenses" },
    { pageKey: "reports", label: "Reports" },
    { pageKey: "automations", label: "Flows" },
  ]),
  bookings: fromOverview("bookings", "/app/bookings", Calendar, "var(--kf-accent2)", BOOKINGS_WALKTHROUGH, [
    term("utilization_rate"),
    term("schedule_health"),
    term("completion_rate"),
  ], [
    { pageKey: "store", label: "Store" },
    { pageKey: "crm", label: "Clients" },
  ]),
  marketing: fromOverview("marketing", "/app/marketing", Megaphone, "hsl(270 70% 60%)", MARKETING_WALKTHROUGH, [
    term("open_rate"),
    term("click_rate"),
  ], [
    { pageKey: "crm", label: "Clients" },
    { pageKey: "store", label: "Store" },
  ]),
  reports: fromOverview("reports", "/app/reports", BarChart3, "var(--kf-accent1)", REPORTS_WALKTHROUGH, [
    term("net_profit"),
    term("customer_lifetime_value"),
    term("cash_flow_forecast"),
  ], [
    { pageKey: "commerce", label: "Revenue" },
    { pageKey: "expenses", label: "Expenses" },
  ]),
  expenses: fromOverview("expenses", "/app/expenses", Receipt, "var(--kf-warning)", EXPENSES_WALKTHROUGH, [
    term("budget_utilization"),
    term("net_profit"),
  ], [
    { pageKey: "commerce", label: "Revenue" },
    { pageKey: "reports", label: "Reports" },
  ]),
  automations: fromOverview("automations", "/app/automations", Zap, "hsl(45 93% 47%)", AUTOMATIONS_WALKTHROUGH, [], [
    { pageKey: "crm", label: "Clients" },
    { pageKey: "marketing", label: "Marketing" },
    { pageKey: "commerce", label: "Revenue" },
  ]),
  projects: fromOverview("projects", "/app/projects", FolderKanban, "var(--kf-accent2)", PROJECTS_WALKTHROUGH, [], [
    { pageKey: "crm", label: "Clients" },
    { pageKey: "bookings", label: "Bookings" },
  ]),
  store: fromOverview("store", "/app/store", Store, "hsl(200 80% 55%)", STORE_WALKTHROUGH, [], [
    { pageKey: "marketing", label: "Marketing" },
    { pageKey: "bookings", label: "Bookings" },
  ]),
  learn: fromOverview("learn", "/app/learn", GraduationCap, "var(--kf-accent2)", LEARN_WALKTHROUGH, [], []),
  "get-started": {
    key: "get-started",
    title: "Get started with Keyflow",
    subtitle: "Set up your business and learn the essentials.",
    briefing:
      "Welcome to Keyflow! Use this guide to set up your workspace and discover what each module does.\n\n" +
      "1. Tell us about your business — pick a template (Salon, Fitness, Photography, Consulting, Food, Retail) so we can pre-configure modules.\n" +
      "2. Add your first contact, service, or product.\n" +
      "3. Send your first invoice or accept your first booking.\n" +
      "4. Connect your calendar, email, and storefront.\n" +
      "5. Explore Flows to automate repeating work.",
    walkthroughSteps: [
      { title: "Welcome", description: "Meet Keyflow — the operating system for your service business.", icon: Sparkles },
      { title: "Pick a template", description: "Choose an industry template so Keyflow can pre-configure modules for you.", icon: Sparkles },
      { title: "Configure your business", description: "Set your business name, branding, and the services you offer.", icon: Sparkles },
      { title: "Add a contact or service", description: "Get value in 60 seconds by capturing your first lead or listing.", icon: Sparkles },
      { title: "Send your first invoice", description: "Or take your first booking — the fastest path to revenue.", icon: Sparkles },
    ],
    keyTerms: [],
    relatedNotes: [
      { pageKey: "today", label: "KEY Dashboard" },
      { pageKey: "crm", label: "Clients" },
      { pageKey: "commerce", label: "Revenue" },
      { pageKey: "bookings", label: "Bookings" },
    ],
    href: "/app",
    icon: HelpCircle,
    iconColor: "var(--kf-accent1)",
  },
};

export function getPageNote(pageKey: string): PageNote | undefined {
  return NOTES_CATALOG[pageKey];
}

/** Resolve a page note from the current pathname. */
export function resolvePageNoteByPath(pathname: string): PageNote | undefined {
  if (!pathname) return undefined;
  // Order matters — most specific first.
  if (pathname.startsWith("/app/crm")) return NOTES_CATALOG.crm;
  if (pathname.startsWith("/app/commerce")) return NOTES_CATALOG.commerce;
  if (pathname.startsWith("/app/bookings")) return NOTES_CATALOG.bookings;
  if (pathname.startsWith("/app/marketing")) return NOTES_CATALOG.marketing;
  if (pathname.startsWith("/app/reports")) return NOTES_CATALOG.reports;
  if (pathname.startsWith("/app/expenses")) return NOTES_CATALOG.expenses;
  if (pathname.startsWith("/app/automations")) return NOTES_CATALOG.automations;
  if (pathname.startsWith("/app/projects")) return NOTES_CATALOG.projects;
  if (pathname.startsWith("/app/store")) return NOTES_CATALOG.store;
  if (pathname.startsWith("/app/learn")) return NOTES_CATALOG.learn;
  if (pathname.startsWith("/app/onboarding")) return NOTES_CATALOG["get-started"];
  if (pathname === "/app" || pathname.startsWith("/app/keyflow-command") || pathname.startsWith("/app/control-tower")) {
    return NOTES_CATALOG.today;
  }
  return undefined;
}
