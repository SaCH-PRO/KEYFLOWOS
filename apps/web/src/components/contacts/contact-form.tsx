"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  X,
  User,
  Mail,
  Phone,
  Building2,
  Tag,
  Briefcase,
  MessageSquare,
  FileText,
  MapPin,
  ChevronDown,
  Globe,
  Shield,
  ToggleLeft,
  Linkedin,
  Instagram,
  Twitter,
  Link2,
  CalendarClock,
  Plus,
  Trash2,
} from "lucide-react";
import { validateEmail, validatePhone } from "@/lib/validators";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BusinessAddressAutocomplete } from "@/components/ui/business-address-autocomplete";
import { getStoredBusinessId } from "@/lib/workspace";
import { CONTACT_STATUSES } from "@/lib/crm-constants";
import type { AddressPlaceDetails } from "@keyflow/ui";

const STATUSES = CONTACT_STATUSES;
const CHANNELS = ["WhatsApp", "Email", "SMS", "Call", "Instagram DM"] as const;

interface ContactFormProps {
  onSubmit: (data: ContactFormData) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  initialValues?: Partial<ContactFormData>;
}

export interface CustomFieldEntry {
  key: string;
  value: string;
}

export interface ContactFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  source: string;
  tags: string;
  companyName: string;
  jobTitle: string;
  preferredChannel: string;
  lifecycleStage: string;
  initialNote: string;
  addressLine1: string;
  city: string;
  country: string;
  department: string;
  industry: string;
  segment: string;
  secondaryEmail: string;
  secondaryPhone: string;
  whatsappNumber: string;
  displayName: string;
  language: string;
  addressLine2: string;
  state: string;
  postalCode: string;
  timezone: string;
  marketingOptIn: boolean;
  doNotContact: boolean;
  notesInternal: string;
  linkedinUrl: string;
  instagramUrl: string;
  twitterUrl: string;
  referredBy: string;
  nextScheduledInteraction: string;
  customFields: CustomFieldEntry[];
}

type ValidationErrors = Partial<Record<keyof ContactFormData, string>>;

function SectionHeader({ label, icon: Icon, open, onToggle }: { label: string; icon: React.ElementType; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 min-h-[44px] text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-xs text-destructive mt-0.5">{error}</p>;
}

function pickComponent(
  components: Record<string, string> | undefined,
  keys: string[],
): string | undefined {
  if (!components) return undefined;
  for (const k of keys) {
    if (components[k]) return components[k];
  }
  return undefined;
}

function buildStreetLine(components: Record<string, string> | undefined): string | undefined {
  if (!components) return undefined;
  const num = components.street_number;
  const route = components.route;
  if (num && route) return `${num} ${route}`;
  return route || num || undefined;
}

export function ContactForm({ onSubmit, onCancel, loading, initialValues }: ContactFormProps) {
  const isEditing = !!initialValues;
  const isMobile = useIsMobile();
  const businessId = useMemo(() => getStoredBusinessId(), []);

  const defaults: ContactFormData = {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    status: "LEAD",
    source: "",
    tags: "",
    companyName: "",
    jobTitle: "",
    preferredChannel: "WhatsApp",
    lifecycleStage: "",
    initialNote: "",
    addressLine1: "",
    city: "",
    country: "Trinidad",
    department: "",
    industry: "",
    segment: "",
    secondaryEmail: "",
    secondaryPhone: "",
    whatsappNumber: "",
    displayName: "",
    language: "",
    addressLine2: "",
    state: "",
    postalCode: "",
    timezone: "",
    marketingOptIn: false,
    doNotContact: false,
    notesInternal: "",
    linkedinUrl: "",
    instagramUrl: "",
    twitterUrl: "",
    referredBy: "",
    nextScheduledInteraction: "",
    customFields: [],
  };

  const initial = useMemo(() => ({
    ...defaults,
    ...Object.fromEntries(
      Object.entries(initialValues || {}).filter(([, v]) => v !== undefined && v !== null)
    ),
  }), []);

  const [form, setForm] = useState<ContactFormData>(initial);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof ContactFormData, boolean>>>({});

  const isDirty = useMemo(() => {
    return (Object.keys(form) as (keyof ContactFormData)[]).some(
      (key) => form[key] !== initial[key]
    );
  }, [form, initial]);

  useUnsavedChanges(isDirty);

  const [sections, setSections] = useState({
    basic: true,
    professional: isEditing,
    contactDetails: isEditing,
    socialLinks: isEditing,
    address: isEditing,
    preferences: isEditing,
    customFieldsSection: isEditing,
    notes: true,
  });

  const toggle = (key: keyof typeof sections) =>
    setSections((s) => ({ ...s, [key]: !s[key] }));

  const validate = useCallback((data: ContactFormData): ValidationErrors => {
    const errs: ValidationErrors = {};
    const emailErr = validateEmail(data.email);
    if (emailErr) errs.email = emailErr;
    const phoneErr = validatePhone(data.phone);
    if (phoneErr) errs.phone = phoneErr;
    const secEmailErr = validateEmail(data.secondaryEmail);
    if (secEmailErr) errs.secondaryEmail = secEmailErr;
    const secPhoneErr = validatePhone(data.secondaryPhone);
    if (secPhoneErr) errs.secondaryPhone = secPhoneErr;
    return errs;
  }, []);

  const validateField = useCallback((key: keyof ContactFormData, value: string) => {
    let error: string | null = null;
    if (key === "email" || key === "secondaryEmail") {
      error = validateEmail(value);
    } else if (key === "phone" || key === "secondaryPhone") {
      error = validatePhone(value);
    }
    setErrors((prev) => {
      const next = { ...prev };
      if (error) {
        next[key] = error;
      } else {
        delete next[key];
      }
      return next;
    });
  }, []);

  const handleSubmit = async () => {
    const validationErrors = validate(form);
    setErrors(validationErrors);
    const allTouched: Partial<Record<keyof ContactFormData, boolean>> = {};
    for (const key of Object.keys(validationErrors) as (keyof ContactFormData)[]) {
      allTouched[key] = true;
    }
    setTouched((prev) => ({ ...prev, ...allTouched }));
    if (Object.keys(validationErrors).length > 0) return;
    await onSubmit(form);
    setForm({ ...defaults });
    setErrors({});
    setTouched({});
  };

  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const handleCancel = () => {
    if (isDirty) {
      setShowDiscardDialog(true);
      return;
    }
    onCancel();
  };

  const hasErrors = Object.keys(errors).length > 0;

  const field = (key: keyof ContactFormData) => ({
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const val = e.target.value;
      setForm((p) => ({ ...p, [key]: val }));
      if (touched[key]) {
        validateField(key, val);
      }
    },
    onBlur: () => {
      setTouched((p) => ({ ...p, [key]: true }));
      validateField(key, form[key] as string);
    },
  });

  const handleAddressSelect = useCallback((place: AddressPlaceDetails) => {
    const components = place.components;
    const street = buildStreetLine(components);
    const city = pickComponent(components, [
      "locality",
      "postal_town",
      "sublocality_level_1",
      "sublocality",
      "administrative_area_level_2",
    ]);
    const state = pickComponent(components, [
      "administrative_area_level_1",
      "administrative_area_level_2",
    ]);
    const country = pickComponent(components, ["country"]);
    const postalCode = pickComponent(components, ["postal_code"]);
    setForm((p) => ({
      ...p,
      addressLine1: street || place.formattedAddress || p.addressLine1,
      city: city ?? p.city,
      state: state ?? p.state,
      country: country ?? p.country,
      postalCode: postalCode ?? p.postalCode,
    }));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex ${isMobile ? "items-end" : "items-start justify-center p-4 pt-6 sm:pt-8"} overflow-y-auto`}
      onClick={(e) => e.target === e.currentTarget && handleCancel()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-form-title"
    >
      <motion.div
        initial={isMobile ? { y: "100%" } : { scale: 0.95, opacity: 0 }}
        animate={isMobile ? { y: 0 } : { scale: 1, opacity: 1 }}
        exit={isMobile ? { y: "100%" } : { scale: 0.95, opacity: 0 }}
        transition={isMobile ? { type: "spring", damping: 30, stiffness: 300 } : undefined}
        className={`w-full bg-card border border-border shadow-2xl flex flex-col ${isMobile ? "rounded-t-2xl max-h-[90vh]" : "max-w-lg rounded-2xl max-h-[85vh] mb-4"}`}
      >
      {isMobile && (
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>
      )}
      <div className="p-5 border-b border-border flex items-center justify-between shrink-0">
        <h3 id="contact-form-title" className="text-lg font-semibold flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          {isEditing ? "Edit Contact" : "Add New Contact"}
        </h3>
        <button onClick={handleCancel} className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-muted rounded-lg transition-colors">
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      <div className="p-5 space-y-3 overflow-y-auto flex-1 min-h-0">

        <SectionHeader label="Basic Info" icon={User} open={sections.basic} onToggle={() => toggle("basic")} />
        {sections.basic && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> First Name *
                </label>
                <input type="text" placeholder="John" {...field("firstName")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> Last Name
                </label>
                <input type="text" placeholder="Doe" {...field("lastName")} className="kf-input w-full" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Email
                </label>
                <input type="email" placeholder="john@example.com" {...field("email")} className={`kf-input w-full ${touched.email && errors.email ? "border-destructive ring-1 ring-destructive" : ""}`} />
                <FieldError error={touched.email ? errors.email : undefined} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Phone
                </label>
                <input type="tel" placeholder="+1 868 123 4567" {...field("phone")} className={`kf-input w-full ${touched.phone && errors.phone ? "border-destructive ring-1 ring-destructive" : ""}`} />
                <FieldError error={touched.phone ? errors.phone : undefined} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Source
                </label>
                <input type="text" placeholder="Instagram, Website, Referral..." {...field("source")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Tags
                </label>
                <input type="text" placeholder="VIP, Wedding, Corporate..." {...field("tags")} className="kf-input w-full" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Status</label>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, status: s }))}
                    className={`px-3 min-h-[44px] text-sm rounded-lg transition-all ${
                      form.status === s ? "kf-btn-primary" : "kf-btn-secondary"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> Preferred Channel
              </label>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, preferredChannel: ch }))}
                    className={`px-3 min-h-[44px] text-sm rounded-lg transition-all ${
                      form.preferredChannel === ch
                        ? "bg-[hsl(var(--kf-accent2))] text-white"
                        : "kf-btn-secondary"
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <SectionHeader label="Professional" icon={Briefcase} open={sections.professional} onToggle={() => toggle("professional")} />
        {sections.professional && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Company
                </label>
                <input type="text" placeholder="Acme Inc" {...field("companyName")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Briefcase className="w-3 h-3" /> Job Title
                </label>
                <input type="text" placeholder="Marketing Manager" {...field("jobTitle")} className="kf-input w-full" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Department
                </label>
                <input type="text" placeholder="Marketing" {...field("department")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Industry
                </label>
                <input type="text" placeholder="Technology, Finance..." {...field("industry")} className="kf-input w-full" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Tag className="w-3 h-3" /> Segment
              </label>
              <input type="text" placeholder="Enterprise, SMB, Startup..." {...field("segment")} className="kf-input w-full" />
            </div>
          </div>
        )}

        <SectionHeader label="Contact Details" icon={Phone} open={sections.contactDetails} onToggle={() => toggle("contactDetails")} />
        {sections.contactDetails && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Secondary Email
                </label>
                <input type="email" placeholder="alt@example.com" {...field("secondaryEmail")} className={`kf-input w-full ${touched.secondaryEmail && errors.secondaryEmail ? "border-destructive ring-1 ring-destructive" : ""}`} />
                <FieldError error={touched.secondaryEmail ? errors.secondaryEmail : undefined} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Secondary Phone
                </label>
                <input type="tel" placeholder="+1 868 765 4321" {...field("secondaryPhone")} className={`kf-input w-full ${touched.secondaryPhone && errors.secondaryPhone ? "border-destructive ring-1 ring-destructive" : ""}`} />
                <FieldError error={touched.secondaryPhone ? errors.secondaryPhone : undefined} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> WhatsApp Number
                </label>
                <input type="tel" placeholder="+1 868 123 4567" {...field("whatsappNumber")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> Display Name
                </label>
                <input type="text" placeholder="Johnny D" {...field("displayName")} className="kf-input w-full" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" /> Language
              </label>
              <input type="text" placeholder="English, Spanish..." {...field("language")} className="kf-input w-full" />
            </div>
          </div>
        )}

        <SectionHeader label="Social Links" icon={Link2} open={sections.socialLinks} onToggle={() => toggle("socialLinks")} />
        {sections.socialLinks && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Linkedin className="w-3 h-3" /> LinkedIn URL
              </label>
              <input type="url" placeholder="https://linkedin.com/in/username" {...field("linkedinUrl")} className="kf-input w-full" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Instagram className="w-3 h-3" /> Instagram URL
                </label>
                <input type="url" placeholder="https://instagram.com/username" {...field("instagramUrl")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Twitter className="w-3 h-3" /> Twitter URL
                </label>
                <input type="url" placeholder="https://twitter.com/username" {...field("twitterUrl")} className="kf-input w-full" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <User className="w-3 h-3" /> Referred By
              </label>
              <input type="text" placeholder="Name or source of referral" {...field("referredBy")} className="kf-input w-full" />
            </div>
          </div>
        )}

        <SectionHeader label="Address" icon={MapPin} open={sections.address} onToggle={() => toggle("address")} />
        {sections.address && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Address Line 1
              </label>
              <BusinessAddressAutocomplete
                businessId={businessId}
                value={form.addressLine1}
                onChange={(v) => setForm((p) => ({ ...p, addressLine1: v }))}
                onSelect={handleAddressSelect}
                placeholder="123 Main Street"
                inputClassName="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Address Line 2
              </label>
              <input type="text" placeholder="Apt 4B" {...field("addressLine2")} className="kf-input w-full" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> City
                </label>
                <input type="text" placeholder="Port of Spain" {...field("city")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> State / Region
                </label>
                <input type="text" placeholder="Western" {...field("state")} className="kf-input w-full" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Postal Code
                </label>
                <input type="text" placeholder="00000" {...field("postalCode")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Country
                </label>
                <input type="text" placeholder="Trinidad" {...field("country")} className="kf-input w-full" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" /> Timezone
              </label>
              <input type="text" placeholder="America/Port_of_Spain" {...field("timezone")} className="kf-input w-full" />
            </div>
          </div>
        )}

        <SectionHeader label="Preferences" icon={Shield} open={sections.preferences} onToggle={() => toggle("preferences")} />
        {sections.preferences && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <ToggleLeft className="w-3 h-3" /> Lifecycle Stage
                </label>
                <input type="text" placeholder="Onboarding, Active, Churned..." {...field("lifecycleStage")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" /> Next Scheduled Interaction
                </label>
                <input
                  type="datetime-local"
                  value={form.nextScheduledInteraction}
                  onChange={(e) => setForm((p) => ({ ...p, nextScheduledInteraction: e.target.value }))}
                  className="kf-input w-full"
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={form.marketingOptIn}
                  onChange={(e) => setForm((p) => ({ ...p, marketingOptIn: e.target.checked }))}
                  className="w-5 h-5 rounded border-border accent-primary"
                />
                Marketing Opt-In
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={form.doNotContact}
                  onChange={(e) => setForm((p) => ({ ...p, doNotContact: e.target.checked }))}
                  className="w-5 h-5 rounded border-border accent-destructive"
                />
                Do Not Contact
              </label>
            </div>
          </div>
        )}

        <SectionHeader label="Custom Fields" icon={Tag} open={sections.customFieldsSection} onToggle={() => toggle("customFieldsSection")} />
        {sections.customFieldsSection && (
          <div className="space-y-3">
            {form.customFields.map((cf, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Field name"
                  value={cf.key}
                  onChange={(e) => {
                    const updated = [...form.customFields];
                    updated[idx] = { ...updated[idx], key: e.target.value };
                    setForm((p) => ({ ...p, customFields: updated }));
                  }}
                  className="kf-input w-1/3"
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={cf.value}
                  onChange={(e) => {
                    const updated = [...form.customFields];
                    updated[idx] = { ...updated[idx], value: e.target.value };
                    setForm((p) => ({ ...p, customFields: updated }));
                  }}
                  className="kf-input flex-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    const updated = form.customFields.filter((_, i) => i !== idx);
                    setForm((p) => ({ ...p, customFields: updated }));
                  }}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-red-500/20 rounded-lg transition-colors text-red-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setForm((p) => ({ ...p, customFields: [...p.customFields, { key: "", value: "" }] }))}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 min-h-[44px] rounded-lg hover:bg-muted"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Custom Field
            </button>
          </div>
        )}

        <SectionHeader label="Notes" icon={FileText} open={sections.notes} onToggle={() => toggle("notes")} />
        {sections.notes && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="w-3 h-3" /> Initial Note
              </label>
              <textarea
                placeholder="Add any notes about this contact (e.g., 'Met at trade show', 'Referred by Sarah')..."
                value={form.initialNote}
                onChange={(e) => setForm((p) => ({ ...p, initialNote: e.target.value }))}
                className="kf-input w-full min-h-[80px] resize-none"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="w-3 h-3" /> Internal Notes
              </label>
              <textarea
                placeholder="Private notes visible only to your team..."
                value={form.notesInternal}
                onChange={(e) => setForm((p) => ({ ...p, notesInternal: e.target.value }))}
                className="kf-input w-full min-h-[80px] resize-none"
                rows={3}
              />
            </div>
          </div>
        )}

      </div>

      <div className="p-5 border-t border-border flex gap-3 shrink-0">
        <button
          onClick={handleSubmit}
          disabled={loading || !form.firstName.trim() || hasErrors}
          className="kf-btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : isEditing ? "Update Contact" : "Save Contact"}
        </button>
        <button onClick={handleCancel} disabled={loading} className="kf-btn-secondary disabled:opacity-50">
          Cancel
        </button>
      </div>
      </motion.div>
      <ConfirmDialog
        open={showDiscardDialog}
        title="Unsaved Changes"
        message="You have unsaved changes. Discard?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        variant="danger"
        onConfirm={() => {
          setShowDiscardDialog(false);
          onCancel();
        }}
        onCancel={() => setShowDiscardDialog(false)}
      />
    </motion.div>
  );
}
