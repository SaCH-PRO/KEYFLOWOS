"use client";

/**
 * NAV-A2 (journey F; D-105, D-138): Settings' own page, the index of the v1 Settings.
 *
 * It used to replace itself with /app/settings/billing. Getting paid opens the payments page (/app/settings/business,
 * which holds only payments-tab.tsx); cash, bank transfer and WiPay come first, PayPal and Stripe take the business's
 * own keys. Developers and Webhooks are not listed (HIDE-DEV-WEBHOOKS hides them). KEY is offered only once
 * /identity/me has said KEY is on (useKeyEnabled, SWP-KEY-SHELL-SMOKE): never under the server's KEY_DISABLED (journey
 * K1 "Settings > KEY is not offered"), and not while that read is in flight. The layout above draws the Settings heading.
 */
import { Settings, BrainCircuit, Wallet, Users, FileText, Bell, CreditCard, Bot, UserRound } from "lucide-react";
import { HubIndex, type HubIndexEntry } from "@/components/layout/hub-index";
import { useKeyEnabled } from "@/hooks/use-key-enabled";

const KEY_HREF = "/app/settings/ai";

const ENTRIES: HubIndexEntry[] = [
  { name: "Business profile", href: "/app/profile", description: "Your business's name, brand and details", icon: BrainCircuit, module: "settings" },
  { name: "Getting paid", href: "/app/settings/business", description: "Cash, bank transfer and WiPay; PayPal and Stripe with your own keys", icon: Wallet, module: "settings" },
  { name: "Team", href: "/app/settings/team", description: "Invite people and choose what they can open", icon: Users, module: "team" },
  { name: "Documents & messages", href: "/app/settings/templates", description: "Invoice, quote and message templates", icon: FileText, module: "settings" },
  { name: "Notifications", href: "/app/settings/notifications", description: "The emails your customers get", icon: Bell, module: "settings" },
  { name: "Plan & billing", href: "/app/settings/billing", description: "Your plan, usage and invoices", icon: CreditCard, module: "settings" },
  // As the nav's Settings > AI entry: its reads need operations.
  { name: "KEY", href: KEY_HREF, description: "What KEY may do for you", icon: Bot, module: "operations" },
  { name: "My account", href: "/app/settings/profile", description: "Your own name, photo, phone and push notifications", icon: UserRound },
];

const ENTRIES_WITHOUT_KEY = ENTRIES.filter((e) => e.href !== KEY_HREF);

export default function SettingsIndexPage() {
  const { enabled: keyEnabled } = useKeyEnabled();
  const entries = keyEnabled ? ENTRIES : ENTRIES_WITHOUT_KEY;
  return <HubIndex title="Settings" subtitle="Business, payments, team and your account" icon={Settings} entries={entries} showHeading={false} />;
}
