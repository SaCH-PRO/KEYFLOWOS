"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { X, User, Mail, Phone, Building2, Tag, Briefcase, MessageSquare, FileText, MapPin } from "lucide-react";

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"] as const;
const CHANNELS = ["WhatsApp", "Email", "SMS", "Call", "Instagram DM"] as const;

interface ContactFormProps {
  onSubmit: (data: ContactFormData) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  initialValues?: Partial<ContactFormData>;
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
}

export function ContactForm({ onSubmit, onCancel, loading, initialValues }: ContactFormProps) {
  const isEditing = !!initialValues;
  const [form, setForm] = useState<ContactFormData>({
    firstName: initialValues?.firstName || "",
    lastName: initialValues?.lastName || "",
    email: initialValues?.email || "",
    phone: initialValues?.phone || "",
    status: initialValues?.status || "LEAD",
    source: initialValues?.source || "",
    tags: initialValues?.tags || "",
    companyName: initialValues?.companyName || "",
    jobTitle: initialValues?.jobTitle || "",
    preferredChannel: initialValues?.preferredChannel || "WhatsApp",
    lifecycleStage: initialValues?.lifecycleStage || "",
    initialNote: "",
    addressLine1: initialValues?.addressLine1 || "",
    city: initialValues?.city || "",
    country: initialValues?.country || "Trinidad",
  });

  const handleSubmit = async () => {
    await onSubmit(form);
    setForm({
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
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-form-title"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden my-auto"
      >
      <div className="p-5 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
        <h3 id="contact-form-title" className="text-lg font-semibold flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          {isEditing ? "Edit Contact" : "Add New Contact"}
        </h3>
        <button onClick={onCancel} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      <div className="p-5 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <User className="w-3 h-3" /> First Name *
          </label>
          <input
            type="text"
            placeholder="John"
            value={form.firstName}
            onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
            className="kf-input w-full"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <User className="w-3 h-3" /> Last Name
          </label>
          <input
            type="text"
            placeholder="Doe"
            value={form.lastName}
            onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
            className="kf-input w-full"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <Mail className="w-3 h-3" /> Email
          </label>
          <input
            type="email"
            placeholder="john@example.com"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            className="kf-input w-full"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <Phone className="w-3 h-3" /> Phone
          </label>
          <input
            type="tel"
            placeholder="+1 868 123 4567"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            className="kf-input w-full"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Company
          </label>
          <input
            type="text"
            placeholder="Acme Inc"
            value={form.companyName}
            onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))}
            className="kf-input w-full"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <Briefcase className="w-3 h-3" /> Job Title
          </label>
          <input
            type="text"
            placeholder="Marketing Manager"
            value={form.jobTitle}
            onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))}
            className="kf-input w-full"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground flex items-center gap-1">
          <MapPin className="w-3 h-3" /> Address
        </label>
        <input
          type="text"
          placeholder="123 Main Street, Apt 4B"
          value={form.addressLine1}
          onChange={(e) => setForm((p) => ({ ...p, addressLine1: e.target.value }))}
          className="kf-input w-full"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3" /> City
          </label>
          <input
            type="text"
            placeholder="Port of Spain"
            value={form.city}
            onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
            className="kf-input w-full"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Country
          </label>
          <input
            type="text"
            placeholder="Trinidad"
            value={form.country}
            onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
            className="kf-input w-full"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <MessageSquare className="w-3 h-3" /> Source
          </label>
          <input
            type="text"
            placeholder="Instagram, Website, Referral..."
            value={form.source}
            onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))}
            className="kf-input w-full"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <Tag className="w-3 h-3" /> Tags
          </label>
          <input
            type="text"
            placeholder="VIP, Wedding, Corporate..."
            value={form.tags}
            onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
            className="kf-input w-full"
          />
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
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
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

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Status</label>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setForm((p) => ({ ...p, status: s }))}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                form.status === s
                  ? "kf-btn-primary"
                  : "kf-btn-secondary"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

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

      </div>

      <div className="p-5 border-t border-border flex gap-3 sticky bottom-0 bg-card z-10">
        <button
          onClick={handleSubmit}
          disabled={loading || !form.firstName.trim()}
          className="kf-btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : isEditing ? "Update Contact" : "Save Contact"}
        </button>
        <button onClick={onCancel} disabled={loading} className="kf-btn-secondary disabled:opacity-50">
          Cancel
        </button>
      </div>
      </motion.div>
    </motion.div>
  );
}
