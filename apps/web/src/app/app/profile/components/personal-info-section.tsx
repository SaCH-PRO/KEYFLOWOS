"use client";

import { useRef } from "react";
import { User, Mail, Phone, Sparkles, Camera, AlertCircle } from "lucide-react";
import { DataUsageHint } from "./ai-field-badge";
import { Button, Input } from "@keyflow/ui";
import { API_BASE, apiPatch } from "@/lib/api";
import { setCachedUser } from "@/lib/workspace";
import { useProfileSection } from "@/hooks/use-profile-section";
import { useUpload } from "@/hooks/use-upload";
import Image from "next/image";

interface PersonalInfoForm {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface IdentityMe {
  id: string;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

function isPersonalFormDirty(current: PersonalInfoForm, initial: PersonalInfoForm): boolean {
  return (
    current.name !== initial.name ||
    current.firstName !== initial.firstName ||
    current.lastName !== initial.lastName ||
    current.phone !== initial.phone
  );
}

interface PersonalInfoSectionProps {
  initialData: PersonalInfoForm;
  avatarUrl: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved: (form: PersonalInfoForm, avatarUrl: string | null) => void;
  onStatus: (status: { type: "success" | "error"; message: string } | null) => void;
}

export default function PersonalInfoSection({
  initialData,
  avatarUrl,
  onDirtyChange,
  onSaved,
  onStatus,
}: PersonalInfoSectionProps) {
  const { form, setForm, setInitialForm, isDirty, saving, setSaving } = useProfileSection<PersonalInfoForm>({
    initialState: initialData,
    isDirtyFn: isPersonalFormDirty,
    onDirtyChange,
  });

  const { uploadFile, isUploading: uploadingAvatar } = useUpload();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const initials = [form.firstName, form.lastName]
    .filter(Boolean)
    .map((n) => n.charAt(0).toUpperCase())
    .join("") || form.email?.charAt(0)?.toUpperCase() || "?";

  const resolvedAvatar = avatarUrl
    ? avatarUrl.startsWith("http") ? avatarUrl : `${API_BASE}${avatarUrl}`
    : null;

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onStatus(null);
    try {
      const uploaded = await uploadFile(file);
      if (!uploaded) throw new Error("Upload failed");
      const { objectPath } = uploaded;
      const { data } = await apiPatch<IdentityMe>("/identity/me", { avatarUrl: objectPath });
      if (data) {
        setCachedUser({ id: data.id, email: data.email, name: data.name, firstName: data.firstName, lastName: data.lastName, avatarUrl: objectPath });
        onSaved(form, objectPath);
        onStatus({ type: "success", message: "Avatar updated" });
      }
    } catch (err) {
      onStatus({ type: "error", message: err instanceof Error ? err.message : "Upload failed" });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    onStatus(null);
    try {
      const { data, error } = await apiPatch<IdentityMe>("/identity/me", {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        name: form.name,
      });
      if (error) {
        onStatus({ type: "error", message: error });
      } else if (data) {
        onStatus({ type: "success", message: "Profile updated" });
        setInitialForm({ ...form });
        onSaved({ ...form }, avatarUrl);
        setCachedUser({
          id: data.id, email: data.email, name: data.name,
          firstName: data.firstName, lastName: data.lastName, avatarUrl: data.avatarUrl,
        });
      }
    } catch (err) {
      onStatus({ type: "error", message: err instanceof Error ? err.message : "Network error" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-5">
        <div className="relative group">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-2xl font-bold overflow-hidden shadow-lg border-2 border-border/30">
            {resolvedAvatar ? (
              <Image src={resolvedAvatar} alt="Avatar" className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
            ) : (
              initials
            )}
          </div>
          <button
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            aria-label={uploadingAvatar ? "Uploading avatar..." : "Change profile picture"}
            className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer min-h-[44px]"
          >
            {uploadingAvatar ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            ) : (
              <Camera className="h-5 w-5 text-white" aria-hidden="true" />
            )}
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" aria-label="Upload profile picture" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">
            {form.firstName && form.lastName ? `${form.firstName} ${form.lastName}` : form.name || "Your Profile"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{form.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 mb-1.5 font-medium">
            <User className="h-3 w-3" aria-hidden="true" />
            First Name
            {!form.firstName && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
            )}
          </div>
          <Input
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            placeholder="John"
            style={!form.firstName ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 mb-1.5 font-medium">
            <User className="h-3 w-3" aria-hidden="true" />
            Last Name
            {!form.lastName && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
            )}
          </div>
          <Input
            value={form.lastName}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            placeholder="Doe"
            style={!form.lastName ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 mb-1.5 font-medium">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Display Name
            {!form.name && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
            )}
          </div>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Your display name"
            style={!form.name ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
          />
          <DataUsageHint text="Shown in the header, greeting, and community posts" />
        </label>
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 mb-1.5 font-medium">
            <Phone className="h-3 w-3" aria-hidden="true" />
            Phone Number
            {!form.phone && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
            )}
          </div>
          <Input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+1 868 123 4567"
            style={!form.phone ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
          />
          <DataUsageHint text="Used for booking confirmations and account recovery" />
        </label>
      </div>

      <label className="block text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 mb-1.5 font-medium">
          <Mail className="h-3 w-3" aria-hidden="true" />
          Email Address
        </div>
        <Input type="email" value={form.email} disabled placeholder="you@example.com" className="opacity-60" />
        <p className="text-[11px] mt-1">Managed by your authentication provider</p>
      </label>

      <div className="flex items-center justify-between pt-2 border-t border-border/30">
        {isDirty && (
          <p className="text-xs flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }} role="status">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            You have unsaved changes
          </p>
        )}
        <div className="ml-auto">
          <Button onClick={handleSave} disabled={saving || !isDirty} className="min-h-[44px]">
            {saving ? "Saving..." : "Save Profile"}
          </Button>
        </div>
      </div>
    </div>
  );
}
