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
} from "lucide-react";
import { Input } from "@keyflow/ui";
import { InfoBadge } from "@/components/ui/info-badge";
import { FormState, ValidationErrors } from "../../settings/business/use-business-settings";

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
  validationErrors?: ValidationErrors;
};

export function BasicInfoTab({ form, setField, logoUrl: _logoUrl, validationErrors = {} }: Props) {
  return (
    <div className="space-y-4">

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Building2 className="h-3 w-3" />
            Business Name <span style={{ color: "hsl(var(--kf-error))" }}>*</span>
          </div>
          <Input
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="My Business"
            style={validationErrors.name ? { borderColor: "hsl(var(--kf-error))" } : undefined}
          />
          {validationErrors.name && (
            <p className="text-[11px] mt-1" style={{ color: "hsl(var(--kf-error))" }}>{validationErrors.name}</p>
          )}
        </div>

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
            <InfoBadge title="Tagline" body="A short one-liner shown on your public store page and customer-facing documents." side="right" iconSize={11} />
          </div>
          <Input
            value={form.tagline}
            onChange={(e) => setField("tagline", e.target.value)}
            placeholder="Your catchy one-liner"
          />
        </label>

        <div className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-1">
            <Mail className="h-3 w-3" />
            Business Email <span style={{ color: "hsl(var(--kf-error))" }}>*</span>
          </div>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            placeholder="contact@mybusiness.com"
            style={validationErrors.email ? { borderColor: "hsl(var(--kf-error))" } : undefined}
          />
          {validationErrors.email && (
            <p className="text-[11px] mt-1" style={{ color: "hsl(var(--kf-error))" }}>{validationErrors.email}</p>
          )}
        </div>

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

      <div className="block text-xs text-muted-foreground">
        <div className="flex items-center gap-1 mb-1">
          <MapPin className="h-3 w-3" />
          Business Address
        </div>
        <textarea
          value={form.address}
          onChange={(e) => setField("address", e.target.value)}
          placeholder="123 Main Street, Port of Spain, Trinidad"
          rows={3}
          className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
        />
      </div>

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
            style={validationErrors.currency ? { borderColor: "hsl(var(--kf-error))" } : undefined}
            value={form.currency}
            onChange={(e) => setField("currency", e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {validationErrors.currency && (
            <p className="text-[11px] mt-1" style={{ color: "hsl(var(--kf-error))" }}>{validationErrors.currency}</p>
          )}
        </label>
      </div>
    </div>
  );
}
