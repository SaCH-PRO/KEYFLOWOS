"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiPatch, apiGet, getAuthHeaders, API_BASE } from "@/lib/api";
import { useThemeColors } from "@/lib/theme-context";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { toast } from "sonner";

export type Business = {
  id: string;
  name: string;
  slug: string | null;
  timezone: string;
  currency: string;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
  linkedin: string | null;
  tiktok: string | null;
  youtube: string | null;
  whatsapp: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  defaultTaxRate: number | null;
  invoiceTemplate: string | null;
  tagline: string | null;
  description: string | null;
  city: string | null;
  country: string | null;
};

export type FormState = {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  logoUrl: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  facebook: string;
  instagram: string;
  twitter: string;
  linkedin: string;
  tiktok: string;
  youtube: string;
  whatsapp: string;
  primaryColor: string;
  secondaryColor: string;
  defaultTaxRate: string;
  invoiceTemplate: string;
  tagline: string;
  description: string;
  city: string;
  country: string;
};

function businessToForm(data: Business): FormState {
  return {
    name: data.name || "",
    slug: data.slug || "",
    timezone: data.timezone || "America/Port_of_Spain",
    currency: data.currency || "TTD",
    logoUrl: data.logoUrl || "",
    address: data.address || "",
    phone: data.phone || "",
    email: data.email || "",
    website: data.website || "",
    facebook: data.facebook || "",
    instagram: data.instagram || "",
    twitter: data.twitter || "",
    linkedin: data.linkedin || "",
    tiktok: data.tiktok || "",
    youtube: data.youtube || "",
    whatsapp: data.whatsapp || "",
    primaryColor: data.primaryColor || "#F97316",
    secondaryColor: data.secondaryColor || "#14B8A6",
    defaultTaxRate: (data.defaultTaxRate ?? 12.5).toString(),
    invoiceTemplate: data.invoiceTemplate || "classic",
    tagline: data.tagline || "",
    description: data.description || "",
    city: data.city || "",
    country: data.country || "",
  };
}

const emptyForm: FormState = {
  name: "", slug: "", timezone: "", currency: "", logoUrl: "",
  address: "", phone: "", email: "", website: "",
  facebook: "", instagram: "", twitter: "", linkedin: "",
  tiktok: "", youtube: "", whatsapp: "",
  primaryColor: "#F97316", secondaryColor: "#14B8A6",
  defaultTaxRate: "12.5", invoiceTemplate: "classic",
  tagline: "", description: "",
  city: "", country: "",
};

export type ValidationErrors = Partial<Record<keyof FormState, string>>;

function validateEmail(email: string): boolean {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function useBusinessSettings() {
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setAccent1, setAccent2 } = useThemeColors();

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm]);

  useUnsavedChanges(isDirty);

  const validate = useCallback((): boolean => {
    const errors: ValidationErrors = {};
    if (!form.name.trim()) errors.name = "Business name is required";
    if (!form.email.trim()) errors.email = "Business email is required";
    else if (!validateEmail(form.email)) errors.email = "Please enter a valid email address";
    if (!form.currency.trim()) errors.currency = "Currency is required";
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form.name, form.email, form.currency]);

  const setField = (field: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  useEffect(() => {
    const load = async () => {
      const businessId = getStoredBusinessId();
      if (!businessId) {
        setLoading(false);
        return;
      }
      const res = await apiGet<Business>(`/identity/businesses/${businessId}`);
      if (res.data) {
        setBusiness(res.data);
        const f = businessToForm(res.data);
        setForm(f);
        setInitialForm(f);
        setAccent1(res.data.primaryColor || "#F97316");
        setAccent2(res.data.secondaryColor || "#14B8A6");
      }
      setLoading(false);
    };
    load();
  }, [setAccent1, setAccent2]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatus(null);
    try {
      const urlRes = await fetch(`${API_BASE}/uploads/request-url`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await urlRes.json();
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!uploadRes.ok) throw new Error("Failed to upload file");
      setForm((f) => ({ ...f, logoUrl: objectPath }));
      setStatus({ type: "success", message: "Logo uploaded successfully" });
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!business) return;
    if (!validate()) {
      toast.error("Please fix the validation errors before saving");
      return;
    }
    setSaving(true);
    setStatus(null);
    const payload = {
      ...form,
      defaultTaxRate: form.defaultTaxRate ? parseFloat(form.defaultTaxRate) : null,
    };
    const res = await apiPatch(`/identity/businesses/${business.id}`, payload);
    setSaving(false);
    if (res.error) {
      setStatus({ type: "error", message: res.error });
      toast.error(res.error);
    } else {
      setStatus({ type: "success", message: "Business settings saved" });
      toast.success("Settings saved");
      if (res.data) setBusiness(res.data as Business);
      setInitialForm({ ...form });
      setAccent1(form.primaryColor);
      setAccent2(form.secondaryColor);
    }
  };

  const logoUrl = form.logoUrl ? `${API_BASE}${form.logoUrl}` : null;

  return {
    form, setField, loading, saving, uploading, status,
    business, handleSave, handleLogoUpload, fileInputRef, logoUrl,
    isDirty, validationErrors,
  };
}
