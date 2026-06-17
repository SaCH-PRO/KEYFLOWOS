import {
  Bell,
  Receipt,
  Calendar,
  Users,
  Megaphone,
  FolderKanban,
  Zap,
  Award,
  Plug,
} from "lucide-react";

export interface AppNotification {
  id: string;
  title?: string;
  body?: string;
  type?: string;
  category?: string;
  read?: boolean;
  createdAt: string;
  link?: string;
  href?: string;
  data?: { link?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function getNotificationIcon(n: AppNotification): typeof Bell {
  const type = (n.type || n.category || "").toLowerCase();
  const title = (n.title || "").toLowerCase();
  if (type.includes("invoice") || title.includes("invoice") || title.includes("payment")) return Receipt;
  if (type.includes("booking") || title.includes("booking") || title.includes("appointment")) return Calendar;
  if (type.includes("contact") || title.includes("contact") || title.includes("lead")) return Users;
  if (type.includes("campaign") || title.includes("campaign") || title.includes("marketing")) return Megaphone;
  if (type.includes("project") || title.includes("project") || title.includes("task")) return FolderKanban;
  if (type.includes("expense") || title.includes("expense")) return Receipt;
  if (type.includes("automation") || title.includes("automation") || title.includes("playbook")) return Zap;
  if (type.includes("endorsement") || title.includes("endorsed")) return Award;
  if (type.includes("connector") || title.includes("reconnect")) return Plug;
  if (type.includes("command") || title.includes("command")) return Zap;
  if (type.includes("inbox") || title.includes("message") || title.includes("whatsapp")) return Bell;
  return Bell;
}

export function getNotificationLink(n: AppNotification): string | null {
  const type = (n.type || n.category || "").toLowerCase();
  const title = (n.title || "").toLowerCase();
  if (type.includes("invoice") || title.includes("invoice")) return "/app/commerce?tab=invoices";
  if (type.includes("payment") || title.includes("payment")) return "/app/commerce?tab=payments";
  if (type.includes("booking") || title.includes("booking") || title.includes("appointment")) return "/app/bookings";
  if (type.includes("contact") || title.includes("contact") || title.includes("lead")) return "/app/crm/contacts";
  if (type.includes("campaign") || title.includes("campaign")) return "/app/marketing";
  if (type.includes("project") || title.includes("project")) return "/app/projects";
  if (type.includes("expense") || title.includes("expense")) return "/app/expenses";
  if (type.includes("automation") || title.includes("automation")) return "/app/automations";
  if (type.includes("endorsement") && n.data?.link) return n.data.link;
  if (type.includes("connector") || title.includes("reconnect")) return "/app/key-connect";
  if (type.includes("command") || title.includes("command")) return "/app/command-center";
  if (type.includes("inbox") || title.includes("message") || title.includes("whatsapp")) return "/app/inbox";
  if (n.data?.link) return n.data.link;
  return n.link || n.href || null;
}
