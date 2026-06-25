"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  Shield,
  Linkedin,
  Instagram,
  Twitter,
  Link2,
  CalendarClock,
  Plus,
  Trash2,
  Users,
  Heart,
  Zap,
} from "lucide-react";
import { validateEmail, validatePhone } from "@/lib/validators";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { ContactCustomFields } from "./contact-custom-fields";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CONTACT_STATUSES,
  CONTACT_AGE_GROUPS,
  CONTACT_AGE_GROUP_LABELS,
  CONTACT_RELATIONSHIP_TYPES,
  CONTACT_RELATIONSHIP_TYPE_LABELS,
  CONTACT_PRIORITIES,
  CONTACT_PRIORITY_LABELS,
} from "@/lib/crm-constants";

const STATUSES = CONTACT_STATUSES;
const CHANNELS = ["WhatsApp", "Email", "SMS", "Call", "Instagram DM"] as const;

const contactFormSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string(),
  email: z.string().refine((v) => !v || !validateEmail(v), { message: "Invalid email" }),
  phone: z.string().refine((v) => !v || !validatePhone(v), { message: "Invalid phone" }),
  status: z.string(),
  source: z.string(),
  tags: z.string(),
  companyName: z.string(),
  jobTitle: z.string(),
  preferredChannel: z.string(),
  lifecycleStage: z.string(),
  initialNote: z.string(),
  addressLine1: z.string(),
  city: z.string(),
  country: z.string(),
  department: z.string(),
  industry: z.string(),
  segment: z.string(),
  secondaryEmail: z.string().refine((v) => !v || !validateEmail(v), { message: "Invalid email" }),
  secondaryPhone: z.string().refine((v) => !v || !validatePhone(v), { message: "Invalid phone" }),
  whatsappNumber: z.string(),
  displayName: z.string(),
  language: z.string(),
  addressLine2: z.string(),
  state: z.string(),
  postalCode: z.string(),
  timezone: z.string(),
  marketingOptIn: z.boolean(),
  doNotContact: z.boolean(),
  notesInternal: z.string(),
  ageGroup: z.string(),
  relationshipType: z.string(),
  priority: z.string(),
  linkedinUrl: z.string(),
  instagramUrl: z.string(),
  twitterUrl: z.string(),
  referredBy: z.string(),
  nextScheduledInteraction: z.string(),
  customFields: z.array(z.object({ key: z.string(), value: z.string() })),
});

export interface CustomFieldEntry {
  key: string;
  value: string;
}

export type ContactFormData = z.infer<typeof contactFormSchema>;

interface DuplicateContact {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}

interface ContactFormProps {
  onSubmit: (data: ContactFormData, customFieldValues?: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  initialValues?: Partial<ContactFormData>;
  initialCustomFieldValues?: Record<string, unknown>;
  checkDuplicates?: (data: ContactFormData) => Promise<DuplicateContact[]>;
}

function SectionHeader({ label, icon: Icon, open, onToggle }: { label: string; icon: React.ElementType; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 min-h-[44px] text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
    >
      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-xs text-destructive mt-1">{error}</p>;
}

function ContactFormInner({ onSubmit, onCancel, loading, initialValues, initialCustomFieldValues, checkDuplicates }: ContactFormProps) {
  const isEditing = !!initialValues;
  const isMobile = useIsMobile();
  const modalRef = useRef<HTMLDivElement>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>(initialCustomFieldValues ?? {});

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
    ageGroup: "",
    relationshipType: "",
    priority: "",
    linkedinUrl: "",
    instagramUrl: "",
    twitterUrl: "",
    referredBy: "",
    nextScheduledInteraction: "",
    customFields: [],
  };

  const {
    register,
    handleSubmit: rhfHandleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: defaults,
  });

  // Auto-fill WhatsApp from phone unless user has overridden it
  const phoneValue = watch("phone");
  const whatsappValue = watch("whatsappNumber");
  useEffect(() => {
    if (phoneValue && !whatsappValue) {
      setValue("whatsappNumber", phoneValue, { shouldDirty: false });
    }
  }, [phoneValue, whatsappValue, setValue]);

  const { fields, append, remove } = useFieldArray({ control, name: "customFields" });

  // Sync initialValues when they change (edit mode)
  useEffect(() => {
    reset({
      ...defaults,
      ...Object.fromEntries(Object.entries(initialValues || {}).filter(([, v]) => v !== undefined && v !== null)),
    });
  }, [initialValues, reset]);

  useUnsavedChanges(isDirty);

  const [sections, setSections] = useState({
    basic: true,
    relationship: true,
    professional: isEditing,
    altContact: isEditing,
    address: isEditing,
    socialLinks: isEditing,
    preferences: isEditing,
    customFieldsSection: isEditing,
    typedCustomFields: isEditing,
    internalNotes: isEditing,
  });

  const toggle = (key: keyof typeof sections) => setSections((s) => ({ ...s, [key]: !s[key] }));

  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [duplicateDialog, setDuplicateDialog] = useState<{ open: boolean; duplicates: DuplicateContact[] }>({ open: false, duplicates: [] });
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);

  const handleCancel = () => {
    if (isDirty) {
      setShowDiscardDialog(true);
      return;
    }
    onCancel();
  };

  const doSubmit = async (data: ContactFormData) => {
    await onSubmit(data, customFieldValues);
    reset({ ...defaults });
    setCustomFieldValues({});
    setDuplicateDialog({ open: false, duplicates: [] });
  };

  const onFormSubmit = async (data: ContactFormData) => {
    if (!isEditing && checkDuplicates && (data.email.trim() || data.phone.trim())) {
      setCheckingDuplicates(true);
      try {
        const duplicates = await checkDuplicates(data);
        if (duplicates.length > 0) {
          setDuplicateDialog({ open: true, duplicates });
          return;
        }
      } finally {
        setCheckingDuplicates(false);
      }
    }
    await doSubmit(data);
  };

  const confirmDuplicateSubmit = async () => {
    setPendingSubmit(true);
    try {
      const data = watch();
      await doSubmit(data);
    } finally {
      setPendingSubmit(false);
      setDuplicateDialog({ open: false, duplicates: [] });
    }
  };

  // Focus trap + aria-hidden on body siblings
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    if (!modal) return;

    const focusable = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const siblings = Array.from(document.body.children).filter(
      (el) => el !== modal && !modal.contains(el as Node)
    );
    siblings.forEach((el) => el.setAttribute("aria-hidden", "true"));

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || focusable.length === 0) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      siblings.forEach((el) => el.removeAttribute("aria-hidden"));
      previouslyFocused?.focus();
    };
  }, []);

  const firstName = watch("firstName");
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <motion.div
      ref={modalRef}
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

        <form
          onSubmit={rhfHandleSubmit(onFormSubmit)}
          className="p-5 space-y-3 overflow-y-auto flex-1 min-h-0"
        >
          <SectionHeader label="Essentials" icon={User} open={sections.basic} onToggle={() => toggle("basic")} />
          {sections.basic && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="contact-form-firstName" className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="w-3 h-3" /> First Name *
                  </label>
                  <input id="contact-form-firstName" type="text" placeholder="John" {...register("firstName")} className="kf-input w-full" />
                  <FieldError error={errors.firstName?.message} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="contact-form-lastName" className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="w-3 h-3" /> Last Name
                  </label>
                  <input id="contact-form-lastName" type="text" placeholder="Doe" {...register("lastName")} className="kf-input w-full" />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="contact-form-email" className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Email
                  </label>
                  <input id="contact-form-email" type="email" placeholder="john@example.com" {...register("email")} className={`kf-input w-full ${errors.email ? "border-destructive ring-1 ring-destructive" : ""}`} />
                  <FieldError error={errors.email?.message} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="contact-form-phone" className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Phone
                  </label>
                  <input id="contact-form-phone" type="tel" placeholder="+1 868 123 4567" {...register("phone")} className={`kf-input w-full ${errors.phone ? "border-destructive ring-1 ring-destructive" : ""}`} />
                  <FieldError error={errors.phone?.message} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="contact-form-companyName" className="text-xs text-muted-foreground flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Company
                </label>
                <input id="contact-form-companyName" type="text" placeholder="Acme Inc" {...register("companyName")} className="kf-input w-full" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="contact-form-source" className="text-xs text-muted-foreground flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Source
                  </label>
                  <input id="contact-form-source" type="text" placeholder="Instagram, Website, Referral..." {...register("source")} className="kf-input w-full" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="contact-form-tags" className="text-xs text-muted-foreground flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Tags
                  </label>
                  <input id="contact-form-tags" type="text" placeholder="VIP, Wedding, Corporate..." {...register("tags")} className="kf-input w-full" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="contact-form-ageGroup" className="text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="w-3 h-3" /> Age Group
                  <span className="text-[10px] text-muted-foreground/60 ml-1">(optional)</span>
                </label>
                <Controller
                  name="ageGroup"
                  control={control}
                  render={({ field }) => (
                    <select id="contact-form-ageGroup" {...field} className="kf-input w-full">
                      <option value="">Not specified</option>
                      {CONTACT_AGE_GROUPS.map((g) => (
                        <option key={g} value={g}>{CONTACT_AGE_GROUP_LABELS[g]}</option>
                      ))}
                    </select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Status</label>
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-2">
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => field.onChange(s)}
                          className={`px-3 min-h-[44px] text-sm rounded-lg transition-all ${field.value === s ? "kf-btn-primary" : "kf-btn-secondary"}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="contact-form-initialNote" className="text-xs text-muted-foreground flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Initial Note
                </label>
                <textarea
                  id="contact-form-initialNote"
                  placeholder="Add any notes about this contact (e.g., 'Met at trade show', 'Referred by Sarah')..."
                  {...register("initialNote")}
                  className="kf-input w-full min-h-[80px] resize-none"
                  rows={3}
                />
              </div>
            </div>
          )}

          <SectionHeader label="Relationship" icon={Heart} open={sections.relationship} onToggle={() => toggle("relationship")} />
          {sections.relationship && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Heart className="w-3 h-3" /> Relationship Type
                  </label>
                  <Controller
                    name="relationshipType"
                    control={control}
                    render={({ field }) => (
                      <select {...field} className="kf-input w-full">
                        <option value="">Not specified</option>
                        {CONTACT_RELATIONSHIP_TYPES.map((t) => (
                          <option key={t} value={t}>{CONTACT_RELATIONSHIP_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Zap className="w-3 h-3" /> Priority
                  </label>
                  <Controller
                    name="priority"
                    control={control}
                    render={({ field }) => (
                      <select {...field} className="kf-input w-full">
                        <option value="">Not specified</option>
                        {CONTACT_PRIORITIES.map((p) => (
                          <option key={p} value={p}>{CONTACT_PRIORITY_LABELS[p]}</option>
                        ))}
                      </select>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" /> Next Scheduled Interaction
                </label>
                <input type="date" {...register("nextScheduledInteraction")} className="kf-input w-full" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> Referred By
                </label>
                <input type="text" placeholder="Contact name or email" {...register("referredBy")} className="kf-input w-full" />
              </div>
            </div>
          )}

          <SectionHeader label="Professional" icon={Briefcase} open={sections.professional} onToggle={() => toggle("professional")} />
          {sections.professional && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Briefcase className="w-3 h-3" /> Job Title
                  </label>
                  <input type="text" placeholder="e.g. Marketing Director" {...register("jobTitle")} className="kf-input w-full" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Department
                  </label>
                  <input type="text" placeholder="e.g. Sales" {...register("department")} className="kf-input w-full" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Industry
                  </label>
                  <input type="text" placeholder="e.g. Technology" {...register("industry")} className="kf-input w-full" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Segment
                  </label>
                  <input type="text" placeholder="e.g. Enterprise" {...register("segment")} className="kf-input w-full" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Lifecycle Stage
                </label>
                <input type="text" placeholder="e.g. onboarding" {...register("lifecycleStage")} className="kf-input w-full" />
              </div>
            </div>
          )}

          <SectionHeader label="Alternate Contact" icon={Phone} open={sections.altContact} onToggle={() => toggle("altContact")} />
          {sections.altContact && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Secondary Email
                  </label>
                  <input type="email" placeholder="alternate@example.com" {...register("secondaryEmail")} className={`kf-input w-full ${errors.secondaryEmail ? "border-destructive ring-1 ring-destructive" : ""}`} />
                  <FieldError error={errors.secondaryEmail?.message} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Secondary Phone
                  </label>
                  <input type="tel" placeholder="+1 868 123 4567" {...register("secondaryPhone")} className={`kf-input w-full ${errors.secondaryPhone ? "border-destructive ring-1 ring-destructive" : ""}`} />
                  <FieldError error={errors.secondaryPhone?.message} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> WhatsApp Number
                </label>
                <input type="tel" placeholder="+1 868 123 4567" {...register("whatsappNumber")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Preferred Channel
                </label>
                <Controller
                  name="preferredChannel"
                  control={control}
                  render={({ field }) => (
                    <select {...field} className="kf-input w-full">
                      {CHANNELS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                />
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
                <input type="text" placeholder="123 Main St" {...register("addressLine1")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Address Line 2
                </label>
                <input type="text" placeholder="Apt 4B" {...register("addressLine2")} className="kf-input w-full" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> City
                  </label>
                  <input type="text" placeholder="Port of Spain" {...register("city")} className="kf-input w-full" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> State / Province
                  </label>
                  <input type="text" placeholder="Trinidad" {...register("state")} className="kf-input w-full" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Postal Code
                  </label>
                  <input type="text" placeholder="00000" {...register("postalCode")} className="kf-input w-full" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Country
                  </label>
                  <input type="text" placeholder="Trinidad and Tobago" {...register("country")} className="kf-input w-full" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Timezone
                </label>
                <input type="text" placeholder="America/Port_of_Spain" {...register("timezone")} className="kf-input w-full" />
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
                <input type="url" placeholder="https://linkedin.com/in/..." {...register("linkedinUrl")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Instagram className="w-3 h-3" /> Instagram URL
                </label>
                <input type="url" placeholder="https://instagram.com/..." {...register("instagramUrl")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Twitter className="w-3 h-3" /> Twitter URL
                </label>
                <input type="url" placeholder="https://twitter.com/..." {...register("twitterUrl")} className="kf-input w-full" />
              </div>
            </div>
          )}

          <SectionHeader label="Preferences" icon={Users} open={sections.preferences} onToggle={() => toggle("preferences")} />
          {sections.preferences && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="w-3 h-3" /> Display Name
                </label>
                <input type="text" placeholder="How they prefer to be called" {...register("displayName")} className="kf-input w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="w-3 h-3" /> Language
                </label>
                <input type="text" placeholder="e.g. English, Spanish" {...register("language")} className="kf-input w-full" />
              </div>
              <div className="flex items-center gap-3">
                <Controller
                  name="marketingOptIn"
                  control={control}
                  render={({ field }) => (
                    <input
                      id="contact-form-marketingOptIn"
                      type="checkbox"
                      checked={field.value}
                      onChange={field.onChange}
                      className="h-4 w-4 rounded border-border"
                    />
                  )}
                />
                <label htmlFor="contact-form-marketingOptIn" className="text-sm text-muted-foreground">
                  Marketing opt-in
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Controller
                  name="doNotContact"
                  control={control}
                  render={({ field }) => (
                    <input
                      id="contact-form-doNotContact"
                      type="checkbox"
                      checked={field.value}
                      onChange={field.onChange}
                      className="h-4 w-4 rounded border-border"
                    />
                  )}
                />
                <label htmlFor="contact-form-doNotContact" className="text-sm text-muted-foreground">
                  Do not contact
                </label>
              </div>
            </div>
          )}

          <SectionHeader label="Structured Custom Fields" icon={Zap} open={sections.typedCustomFields} onToggle={() => toggle("typedCustomFields")} />
          {sections.typedCustomFields && (
            <ContactCustomFields
              onChange={setCustomFieldValues}
            />
          )}

          <SectionHeader label="Legacy Custom Fields" icon={Zap} open={sections.customFieldsSection} onToggle={() => toggle("customFieldsSection")} />
          {sections.customFieldsSection && (
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="flex gap-2">
                  <input
                    placeholder="Field name"
                    {...register(`customFields.${index}.key` as const)}
                    className="kf-input flex-1"
                  />
                  <input
                    placeholder="Value"
                    {...register(`customFields.${index}.value` as const)}
                    className="kf-input flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => append({ key: "", value: "" })}
                className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
              >
                <Plus className="h-3 w-3" /> Add custom field
              </button>
            </div>
          )}

          <SectionHeader label="Internal Notes" icon={FileText} open={sections.internalNotes} onToggle={() => toggle("internalNotes")} />
          {sections.internalNotes && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="w-3 h-3" /> Internal Notes
              </label>
              <textarea
                placeholder="Notes visible only to your team..."
                {...register("notesInternal")}
                className="kf-input w-full min-h-[80px] resize-none"
                rows={3}
              />
            </div>
          )}

          <div className="pt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={loading || checkingDuplicates || pendingSubmit || !firstName.trim() || hasErrors}
              className="kf-btn-primary flex-1 disabled:opacity-50"
            >
              {loading || checkingDuplicates || pendingSubmit ? "Saving..." : isEditing ? "Save Changes" : "Add Contact"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="kf-btn-secondary flex-1"
            >
              Cancel
            </button>
          </div>
        </form>
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

      <ConfirmDialog
        open={duplicateDialog.open}
        title="Possible duplicate contact"
        message={
          duplicateDialog.duplicates.length > 0
            ? `We found ${duplicateDialog.duplicates.length} similar contact(s): ${duplicateDialog.duplicates.map((d) => d.name).join(", ")}. Do you want to save anyway?`
            : ""
        }
        confirmLabel="Save Anyway"
        cancelLabel="Cancel"
        onConfirm={confirmDuplicateSubmit}
        onCancel={() => setDuplicateDialog({ open: false, duplicates: [] })}
      />
    </motion.div>
  );
}

export function ContactForm(props: ContactFormProps) {
  if (typeof document === "undefined") return null;
  return createPortal(<ContactFormInner {...props} />, document.body);
}
