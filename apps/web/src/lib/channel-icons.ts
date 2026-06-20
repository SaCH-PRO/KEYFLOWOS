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
  // Canonical KEYInbox channels
  email: { icon: Mail, label: "Email", color: "#EA4335" },
  whatsapp: { icon: MessageSquare, label: "WhatsApp", color: "#22C55E" },
  sms: { icon: MessageSquare, label: "SMS", color: "#94A3B8" },
  google_forms: { icon: FileText, label: "Google Forms", color: "#94A3B8" },
  instagram_dm: { icon: Instagram, label: "Instagram DM", color: "#E4405F" },
  facebook_messenger: { icon: Facebook, label: "Messenger", color: "#1877F2" },
  facebook_page_comment: { icon: Facebook, label: "Facebook Comments", color: "#1877F2" },
  instagram_comment: { icon: Instagram, label: "Instagram Comments", color: "#E4405F" },
  meta_lead_form: { icon: FileText, label: "Meta Lead Forms", color: "#1877F2" },
  website_form: { icon: FileText, label: "Website Forms", color: "#94A3B8" },
  website_chat: { icon: MessageSquare, label: "Website Chat", color: "#22C55E" },
  calendar: { icon: Calendar, label: "Calendar", color: "#F59E0B" },
  manual: { icon: MessageSquare, label: "Manual", color: "#94A3B8" },

  // Legacy aliases kept for backward compatibility
  gmail: { icon: Mail, label: "Email", color: "#EA4335" },
  instagram: { icon: Instagram, label: "Instagram DM", color: "#E4405F" },
  messenger: { icon: Facebook, label: "Messenger", color: "#1877F2" },
  facebook: { icon: Facebook, label: "Facebook", color: "#1877F2" },
  forms: { icon: FileText, label: "Form", color: "#94A3B8" },
};

export function getChannelIcon(channel?: string | null): ChannelIconMeta {
  if (!channel) return { icon: MessageSquare, label: "Message", color: "#94A3B8" };
  const key = normalizeChannel(channel);
  return CHANNEL_ICON_REGISTRY[key] ?? { icon: MessageSquare, label: channel, color: "#94A3B8" };
}

export function normalizeChannel(channel?: string | null): string {
  if (!channel) return "unknown";
  const key = channel.toLowerCase().trim();

  if (key === "gmail" || key === "email") return "email";
  if (key === "forms" || key === "google_form") return "google_forms";
  if (key === "instagram" || key === "instagram_dm") return "instagram_dm";
  if (key === "messenger" || key === "meta_messenger" || key === "facebook_messenger") return "facebook_messenger";
  if (key === "facebook" || key === "facebook_comment" || key === "facebook_page_comment") return "facebook_page_comment";
  if (key === "instagram_comment") return "instagram_comment";
  if (key === "meta_lead" || key === "meta_lead_form") return "meta_lead_form";
  if (key === "website_form") return "website_form";
  if (key === "website_chat") return "website_chat";
  if (key === "whatsapp") return "whatsapp";
  if (key === "sms") return "sms";
  if (key === "calendar") return "calendar";

  return key;
}
