"use client";

import { useEffect, useState, useCallback } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiPatch, apiGet } from "@/lib/api";
import { toast } from "sonner";

type BillingSettingsData = {
  defaultTaxRate: string;
  invoiceTemplate: string;
  primaryColor: string;
  secondaryColor: string;
  name: string;
  logoUrl: string | null;
};

export function useBillingSettings() {
  const [data, setData] = useState<BillingSettingsData>({
    defaultTaxRate: "12.5",
    invoiceTemplate: "classic",
    primaryColor: "#F97316",
    secondaryColor: "#14B8A6",
    name: "",
    logoUrl: null,
  });
  const [initialData, setInitialData] = useState<BillingSettingsData>(data);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const id = getStoredBusinessId();
      if (!id) {
        setLoading(false);
        return;
      }
      setBusinessId(id);
      try {
        const res = await apiGet<any>(`/identity/businesses/${id}`);
        if (res.data) {
          const d: BillingSettingsData = {
            defaultTaxRate: (res.data.defaultTaxRate ?? 12.5).toString(),
            invoiceTemplate: res.data.invoiceTemplate || "classic",
            primaryColor: res.data.primaryColor || "#F97316",
            secondaryColor: res.data.secondaryColor || "#14B8A6",
            name: res.data.name || "",
            logoUrl: res.data.logoUrl || null,
          };
          setData(d);
          setInitialData(d);
        }
      } catch {
        // fall through with defaults
      }
      setLoading(false);
    };
    load();
  }, []);

  const setField = useCallback((field: keyof BillingSettingsData, value: string) => {
    setData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const isDirty = JSON.stringify(data) !== JSON.stringify(initialData);

  const save = useCallback(async () => {
    if (!businessId) return;
    setSaving(true);
    const payload = {
      defaultTaxRate: data.defaultTaxRate ? parseFloat(data.defaultTaxRate) : null,
      invoiceTemplate: data.invoiceTemplate,
    };
    const res = await apiPatch(`/identity/businesses/${businessId}`, payload);
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Billing settings saved");
      setInitialData({ ...data });
    }
  }, [businessId, data]);

  return { data, setField, loading, saving, save, isDirty };
}
