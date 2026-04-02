"use client";

import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import {
  Building2,
  Globe,
  Clock,
  DollarSign,
  Phone,
  Mail,
  MapPin,
  Link as LinkIcon,
  CreditCard,
  Facebook,
  Instagram,
  Twitter,
  Linkedin,
  MessageCircle,
} from "lucide-react";
import { Input } from "@keyflow/ui";
import { InfoBadge } from "@/components/ui/info-badge";
import { FormState } from "./use-business-settings";

const TIMEZONES = [
  "America/Port_of_Spain",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const CURRENCIES = SUPPORTED_CURRENCIES.map((c) => c.code);

type Props = {
  form: FormState;
  setField: (field: keyof FormState, value: string) => void;
  logoUrl?: string;
};

function CallCard({ form, logoUrl }: { form: FormState; logoUrl?: string }) {
  const primary = form.primaryColor || "#F97316";
  const secondary = form.secondaryColor || "#14B8A6";
  const hasLocation = form.city || form.country;
  const locationText = [form.city, form.country].filter(Boolean).join(", ");

  const socials = [
    { key: "facebook", icon: Facebook, value: form.facebook, color: "#1877F2" },
    { key: "instagram", icon: Instagram, value: form.instagram, color: "#E4405F" },
    { key: "twitter", icon: Twitter, value: form.twitter, color: "#1DA1F2" },
    { key: "linkedin", icon: Linkedin, value: form.linkedin, color: "#0A66C2" },
    { key: "whatsapp", icon: MessageCircle, value: form.whatsapp, color: "#25D366" },
  ].filter((s) => s.value);

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Your Call Card</h3>
        <span className="text-[10px] text-muted-foreground bg-slate-800/60 px-2 py-0.5 rounded-full">Auto-generated</span>
      </div>

      <div
        className="relative overflow-hidden rounded-2xl border border-border/40 shadow-xl"
        style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
      >

        <div className="relative p-6">
          <div className="flex items-start gap-4 mb-5">
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg flex-shrink-0 overflow-hidden bg-white/20 backdrop-blur-sm"
            >
              {logoUrl ? (
                <img src={logoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                form.name?.charAt(0)?.toUpperCase() || "K"
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-lg font-bold text-white truncate">
                {form.name || "Your Business Name"}
              </h4>
              {form.tagline && (
                <p className="text-xs text-white/70 mt-0.5 truncate">
                  {form.tagline}
                </p>
              )}
              {hasLocation && (
                <p className="text-[11px] text-white/60 mt-1 flex items-center gap-1">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{locationText}</span>
                </p>
              )}
            </div>
          </div>

          <div className="h-px w-full mb-4 bg-white/20" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {form.phone && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/15">
                  <Phone className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="truncate text-xs text-white/90">{form.phone}</span>
              </div>
            )}
            {form.email && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/15">
                  <Mail className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="truncate text-xs text-white/90">{form.email}</span>
              </div>
            )}
            {form.website && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/15">
                  <Globe className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="truncate text-xs text-white/90">{form.website.replace(/^https?:\/\//, "")}</span>
              </div>
            )}
            {form.whatsapp && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/15">
                  <MessageCircle className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="truncate text-xs text-white/90">{form.whatsapp}</span>
              </div>
            )}
            {form.address && (
              <div className="flex items-center gap-2.5 sm:col-span-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/15">
                  <MapPin className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="truncate text-xs text-white/90">{form.address}</span>
              </div>
            )}
          </div>

          {!form.phone && !form.email && !form.website && (
            <p className="text-xs text-white/40 italic mb-4">
              Fill in your contact details above to see them here.
            </p>
          )}

          {socials.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              {socials.map((s) => {
                const Icon = s.icon;
                return (
                  <div
                    key={s.key}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-transform hover:scale-110 bg-white/15"
                    title={s.value}
                  >
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BasicInfoTab({ form, setField, logoUrl }: Props) {
  return (
    <div className="space-y-4">
      <CallCard form={form} logoUrl={logoUrl} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Building2 className="h-3 w-3" />
            Business Name
          </div>
          <Input
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="My Business"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Globe className="h-3 w-3" />
            Public URL Slug
            <InfoBadge title="URL Slug" body="This creates your store and booking page URL. Use lowercase letters and hyphens only." side="right" iconSize={11} />
          </div>
          <Input
            value={form.slug}
            onChange={(e) => setField("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="my-business"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Building2 className="h-3 w-3" />
            Tagline
          </div>
          <Input
            value={form.tagline}
            onChange={(e) => setField("tagline", e.target.value)}
            placeholder="Your catchy one-liner"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Mail className="h-3 w-3" />
            Business Email
          </div>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            placeholder="contact@mybusiness.com"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Phone className="h-3 w-3" />
            Business Phone
          </div>
          <Input
            type="tel"
            value={form.phone}
            onChange={(e) => setField("phone", e.target.value)}
            placeholder="+1 (868) 555-0123"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <LinkIcon className="h-3 w-3" />
            Website
          </div>
          <Input
            type="url"
            value={form.website}
            onChange={(e) => setField("website", e.target.value)}
            placeholder="https://mybusiness.com"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Phone className="h-3 w-3" />
            WhatsApp Number
          </div>
          <Input
            type="tel"
            value={form.whatsapp}
            onChange={(e) => setField("whatsapp", e.target.value)}
            placeholder="+1 (868) 555-0123"
          />
        </label>
      </div>

      <label className="block text-xs text-muted-foreground">
        <div className="flex items-center gap-1 mb-1">
          <Building2 className="h-3 w-3" />
          Description
        </div>
        <textarea
          className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm min-h-[80px] resize-none"
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
          placeholder="Tell your customers what you do..."
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <MapPin className="h-3 w-3" />
            City
          </div>
          <Input
            value={form.city}
            onChange={(e) => setField("city", e.target.value)}
            placeholder="Port of Spain"
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Globe className="h-3 w-3" />
            Country
          </div>
          <Input
            value={form.country}
            onChange={(e) => setField("country", e.target.value)}
            placeholder="Trinidad and Tobago"
          />
        </label>
      </div>

      <label className="block text-xs text-muted-foreground">
        <div className="flex items-center gap-1 mb-1">
          <MapPin className="h-3 w-3" />
          Business Address
        </div>
        <textarea
          className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm min-h-[80px] resize-none"
          value={form.address}
          onChange={(e) => setField("address", e.target.value)}
          placeholder="123 Main Street, Port of Spain, Trinidad"
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Clock className="h-3 w-3" />
            Timezone
            <InfoBadge title="Timezone" body="Controls date/time display across all modules. Bookings and reminders use this timezone." side="right" iconSize={11} />
          </div>
          <select
            className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
            value={form.timezone}
            onChange={(e) => setField("timezone", e.target.value)}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <DollarSign className="h-3 w-3" />
            Default Currency
            <InfoBadge title="Default Currency" body="Used across invoices, quotes, store pricing, and expense tracking. TTD is the default for Trinidad businesses." side="right" iconSize={11} />
          </div>
          <select
            className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
            value={form.currency}
            onChange={(e) => setField("currency", e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
