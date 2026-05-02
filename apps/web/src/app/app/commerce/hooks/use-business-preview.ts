"use client";

import { useEffect, useState, useCallback } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPatch } from "@/lib/api";
import { toast } from "sonner";
import type { BusinessDataForPreview } from "../components/billing-detail-modal";

export function useBusinessPreview() {
  const [businessData, setBusinessData] = useState<BusinessDataForPreview | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const id = getStoredBusinessId();
      if (!id) return;
      try {
        const res = await apiGet<{
          name?: string;
          logoUrl?: string | null;
          address?: string | null;
          city?: string | null;
          country?: string | null;
          phone?: string | null;
          email?: string | null;
          website?: string | null;
          tagline?: string | null;
          primaryColor?: string | null;
          secondaryColor?: string | null;
          invoiceTemplate?: string | null;
        }>(`/identity/businesses/${id}`);
        if (res.data) {
          setBusinessData({
            name: res.data.name || "",
            logoUrl: res.data.logoUrl || null,
            address: res.data.address || null,
            city: res.data.city || null,
            country: res.data.country || null,
            phone: res.data.phone || null,
            email: res.data.email || null,
            website: res.data.website || null,
            tagline: res.data.tagline || null,
            primaryColor: res.data.primaryColor || "#F97316",
            secondaryColor: res.data.secondaryColor || "#14B8A6",
            invoiceTemplate: res.data.invoiceTemplate || "classic",
          });
        }
      } catch {
        // silent
      }
    };
    load();
  }, []);

  const saveBranding = useCallback(async (overrides: Record<string, string>) => {
    const id = getStoredBusinessId();
    if (!id) return;
    setSaving(true);
    try {
      const res = await apiPatch(`/identity/businesses/${id}`, overrides);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Branding updated");
        setBusinessData((prev) => prev ? { ...prev, ...overrides } : prev);
      }
    } catch {
      toast.error("Failed to save branding");
    }
    setSaving(false);
  }, []);

  return { businessData, saveBranding, savingBranding: saving };
}
