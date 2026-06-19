import {
  Calendar,
  Facebook,
  FileText,
  Instagram,
  Mail,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";

export interface ChannelIconMeta {
  icon: LucideIcon;
  label: string;
  color: string;
}

const CHANNEL_ICON_REGISTRY: Record<string, ChannelIconMeta> = {
  gmail: { icon: Mail, label: "Email", color: "#EA4335" },
  email: { icon: Mail, label: "Email", color: "#EA4335" },
  whatsapp: { icon: MessageSquare, label: "WhatsApp", color: "#22C55E" },
  sms: { icon: MessageSquare, label: "SMS", color: "#94A3B8" },
  instagram: { icon: Instagram, label: "Instagram", color: "#E4405F" },
  messenger: { icon: Facebook, label: "Messenger", color: "#1877F2" },
  facebook: { icon: Facebook, label: "Facebook", color: "#1877F2" },
  forms: { icon: FileText, label: "Form", color: "#94A3B8" },
  calendar: { icon: Calendar, label: "Calendar", color: "#F59E0B" },
};

export function getChannelIcon(channel?: string | null): ChannelIconMeta {
  if (!channel) return { icon: MessageSquare, label: "Message", color: "#94A3B8" };
  const key = channel.toLowerCase();
  return CHANNEL_ICON_REGISTRY[key] ?? { icon: MessageSquare, label: channel, color: "#94A3B8" };
}

export function normalizeChannel(channel?: string | null): string {
  if (!channel) return "unknown";
  const key = channel.toLowerCase();
  if (key === "gmail" || key === "email") return "email";
  if (key === "facebook") return "messenger";
  return key;
}
