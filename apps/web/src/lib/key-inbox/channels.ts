export interface ChannelOption {
  value: string;
  label: string;
  aliases?: string[];
}

export const KEY_INBOX_CHANNEL_OPTIONS: ChannelOption[] = [
  { value: "", label: "All channels" },
  { value: "email", label: "Email", aliases: ["gmail"] },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "google_forms", label: "Google Forms", aliases: ["forms"] },
  { value: "instagram_dm", label: "Instagram DM", aliases: ["instagram"] },
  { value: "facebook_messenger", label: "Messenger", aliases: ["messenger", "meta_messenger"] },
  { value: "facebook_page_comment", label: "Facebook Comments" },
  { value: "instagram_comment", label: "Instagram Comments" },
  { value: "meta_lead_form", label: "Meta Lead Forms" },
  { value: "website_form", label: "Website Forms" },
  { value: "website_chat", label: "Website Chat" },
  { value: "manual", label: "Manual" },
];

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const option of KEY_INBOX_CHANNEL_OPTIONS) {
  if (!option.value) continue;
  ALIAS_TO_CANONICAL.set(option.value.toLowerCase(), option.value);
  for (const alias of option.aliases ?? []) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), option.value);
  }
}

export function normalizeFrontendChannel(input?: string | null): string {
  if (!input) return "";
  const key = input.toLowerCase().trim();
  return ALIAS_TO_CANONICAL.get(key) ?? key;
}

export function getChannelLabel(value?: string | null): string {
  if (!value) return "Message";
  const canonical = normalizeFrontendChannel(value);
  return KEY_INBOX_CHANNEL_OPTIONS.find((o) => o.value === canonical)?.label ?? value;
}
