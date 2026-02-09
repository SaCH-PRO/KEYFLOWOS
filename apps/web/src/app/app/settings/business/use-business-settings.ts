"use client";

import { useEffect, useState, useRef } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiPatch, apiGet, getAuthHeaders, API_BASE } from "@/lib/api";
import { useThemeColors } from "@/lib/theme-context";

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
  tagline: string;
  description: string;
  city: string;
  country: string;
};

export function useBusinessSettings() {
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    slug: "",
    timezone: "",
    currency: "",
    logoUrl: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    facebook: "",
    instagram: "",
    twitter: "",
    linkedin: "",
    tiktok: "",
    youtube: "",
    whatsapp: "",
    primaryColor: "#F97316",
    secondaryColor: "#14B8A6",
    defaultTaxRate: "12.5",
    tagline: "",
    description: "",
    city: "",
    country: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setAccent1, setAccent2 } = useThemeColors();

  const setField = (field: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
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
        setForm({
          name: res.data.name || "",
          slug: res.data.slug || "",
          timezone: res.data.timezone || "America/Port_of_Spain",
          currency: res.data.currency || "TTD",
          logoUrl: res.data.logoUrl || "",
          address: res.data.address || "",
          phone: res.data.phone || "",
          email: res.data.email || "",
          website: res.data.website || "",
          facebook: res.data.facebook || "",
          instagram: res.data.instagram || "",
          twitter: res.data.twitter || "",
          linkedin: res.data.linkedin || "",
          tiktok: res.data.tiktok || "",
          youtube: res.data.youtube || "",
          whatsapp: res.data.whatsapp || "",
          primaryColor: res.data.primaryColor || "#F97316",
          secondaryColor: res.data.secondaryColor || "#14B8A6",
          defaultTaxRate: (res.data.defaultTaxRate ?? 12.5).toString(),
          tagline: res.data.tagline || "",
          description: res.data.description || "",
          city: res.data.city || "",
          country: res.data.country || "",
        });
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
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type,
        }),
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
    } else {
      setStatus({ type: "success", message: "Business settings saved" });
      if (res.data) setBusiness(res.data as Business);
      setAccent1(form.primaryColor);
      setAccent2(form.secondaryColor);
    }
  };

  const logoUrl = form.logoUrl ? `${API_BASE}${form.logoUrl}` : null;

  return {
    form,
    setField,
    loading,
    saving,
    uploading,
    status,
    business,
    handleSave,
    handleLogoUpload,
    fileInputRef,
    logoUrl,
  };
}
