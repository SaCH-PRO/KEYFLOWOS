"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { X, User, Mail, Phone, Building2, Tag, Briefcase, MessageSquare, Camera, FileText, Upload } from "lucide-react";

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"] as const;
const CHANNELS = ["WhatsApp", "Email", "SMS", "Call", "Instagram DM"] as const;

interface ContactFormProps {
  onSubmit: (data: ContactFormData) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
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
  photoFile: File | null;
  photoPreview: string | null;
}

export function ContactForm({ onSubmit, onCancel, loading }: ContactFormProps) {
  const [form, setForm] = useState<ContactFormData>({
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
    photoFile: null,
    photoPreview: null,
  });

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      const url = URL.createObjectURL(file);
      setForm((p) => ({ ...p, photoFile: file, photoPreview: url }));
    }
  };

  const removePhoto = () => {
    if (form.photoPreview) {
      URL.revokeObjectURL(form.photoPreview);
    }
    setForm((p) => ({ ...p, photoFile: null, photoPreview: null }));
  };

  const handleSubmit = async () => {
    await onSubmit(form);
    if (form.photoPreview) {
      URL.revokeObjectURL(form.photoPreview);
    }
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
      photoFile: null,
      photoPreview: null,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Add New Contact</h3>
        <button onClick={onCancel} className="p-1 hover:bg-muted rounded-lg transition-colors">
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            {form.photoPreview ? (
              <img
                src={form.photoPreview}
                alt="Preview"
                className="h-20 w-20 rounded-full object-cover border-2 border-border"
              />
            ) : (
              <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center border-2 border-dashed border-border">
                <Camera className="w-6 h-6 text-muted-foreground" />
              </div>
            )}
            <label className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-[hsl(var(--kf-accent1))] flex items-center justify-center cursor-pointer hover:brightness-110 transition-all">
              <Upload className="w-3.5 h-3.5 text-white" />
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </label>
          </div>
          {form.photoPreview && (
            <button
              type="button"
              onClick={removePhoto}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Remove
            </button>
          )}
        </div>

        <div className="flex-1 grid gap-4 sm:grid-cols-2">
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

      <div className="flex gap-3 pt-2">
        <button
          onClick={handleSubmit}
          disabled={loading || !form.firstName.trim()}
          className="kf-btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : "Save Contact"}
        </button>
        <button onClick={onCancel} disabled={loading} className="kf-btn-secondary disabled:opacity-50">
          Cancel
        </button>
      </div>
    </motion.div>
  );
}
