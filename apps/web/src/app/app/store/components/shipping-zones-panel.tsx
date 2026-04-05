"use client";

import { useState, useEffect, useCallback } from "react";
import { Globe, Plus, Pencil, Trash2, Save, Loader2, X } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

type ShippingZone = {
  id: string;
  name: string;
  countries: string[];
  regions: string[];
  baseFee: number;
  perKgRate: number;
  freeAbove: number | null;
  currency: string;
  estimatedDays: number | null;
  carrier: string | null;
  isActive: boolean;
};

type ZoneFormData = {
  name: string;
  countries: string;
  regions: string;
  baseFee: string;
  perKgRate: string;
  freeAbove: string;
  estimatedDays: string;
  carrier: string;
};

const EMPTY_FORM: ZoneFormData = {
  name: "",
  countries: "",
  regions: "",
  baseFee: "0",
  perKgRate: "0",
  freeAbove: "",
  estimatedDays: "",
  carrier: "",
};

export function ShippingZonesPanel({ businessId }: { businessId: string }) {
  const [zones, setZones] = useState<ShippingZone[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<ZoneFormData>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadZones = useCallback(async () => {
    const { data } = await apiGet<ShippingZone[]>(
      `/marketplace/businesses/${businessId}/shipping-zones`,
    );
    if (data) setZones(data);
  }, [businessId]);

  useEffect(() => {
    if (businessId) loadZones();
  }, [businessId, loadZones]);

  const handleSave = async () => {
    setSaving(true);
    const body = {
      name: form.name,
      countries: form.countries ? form.countries.split(",").map((s) => s.trim()) : [],
      regions: form.regions ? form.regions.split(",").map((s) => s.trim()) : [],
      baseFee: parseFloat(form.baseFee) || 0,
      perKgRate: parseFloat(form.perKgRate) || 0,
      freeAbove: form.freeAbove ? parseFloat(form.freeAbove) : null,
      estimatedDays: form.estimatedDays ? parseInt(form.estimatedDays) : null,
      carrier: form.carrier || null,
    };

    if (editing) {
      await apiPatch(
        `/marketplace/businesses/${businessId}/shipping-zones/${editing}`,
        body,
      );
    } else {
      await apiPost({
        path: `/marketplace/businesses/${businessId}/shipping-zones`,
        body,
      });
    }

    await loadZones();
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setSaving(false);
  };

  const handleEdit = (zone: ShippingZone) => {
    setEditing(zone.id);
    setForm({
      name: zone.name,
      countries: zone.countries.join(", "),
      regions: zone.regions.join(", "),
      baseFee: String(zone.baseFee),
      perKgRate: String(zone.perKgRate),
      freeAbove: zone.freeAbove ? String(zone.freeAbove) : "",
      estimatedDays: zone.estimatedDays ? String(zone.estimatedDays) : "",
      carrier: zone.carrier || "",
    });
    setShowForm(true);
  };

  const handleDelete = async (zoneId: string) => {
    await apiDelete(
      `/marketplace/businesses/${businessId}/shipping-zones/${zoneId}`,
    );
    await loadZones();
  };

  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border))" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          <h3 className="text-sm font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>
            Shipping Zones
          </h3>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setForm(EMPTY_FORM);
            setShowForm(true);
          }}
          className="kf-btn-primary min-h-[44px] px-4 text-sm flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Zone
        </button>
      </div>

      {zones.length === 0 && !showForm && (
        <div
          className="text-center py-8 rounded-xl"
          style={{ background: "hsl(var(--kf-muted) / 0.1)" }}
        >
          <Globe
            className="w-8 h-8 mx-auto mb-2"
            style={{ color: "hsl(var(--kf-muted-foreground))" }}
          />
          <p className="text-sm" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            No shipping zones configured
          </p>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Add zones to define shipping rates by region
          </p>
        </div>
      )}

      {zones.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid hsl(var(--kf-border))" }}>
                {["Zone", "Countries", "Base Fee", "Per Kg", "Est. Days", "Carrier", ""].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left py-2 px-2 text-xs font-medium"
                      style={{ color: "hsl(var(--kf-muted-foreground))" }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr
                  key={zone.id}
                  style={{ borderBottom: "1px solid hsl(var(--kf-border) / 0.5)" }}
                >
                  <td className="py-2 px-2 font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>
                    {zone.name}
                  </td>
                  <td className="py-2 px-2 text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                    {zone.countries.join(", ") || "All"}
                  </td>
                  <td className="py-2 px-2" style={{ color: "hsl(var(--kf-foreground))" }}>
                    ${zone.baseFee.toFixed(2)}
                  </td>
                  <td className="py-2 px-2" style={{ color: "hsl(var(--kf-foreground))" }}>
                    {zone.perKgRate > 0 ? `$${zone.perKgRate.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2 px-2" style={{ color: "hsl(var(--kf-foreground))" }}>
                    {zone.estimatedDays ? `${zone.estimatedDays}d` : "—"}
                  </td>
                  <td className="py-2 px-2 text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                    {zone.carrier || "—"}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(zone)}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        aria-label="Edit zone"
                      >
                        <Pencil className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                      </button>
                      <button
                        onClick={() => handleDelete(zone.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                        aria-label="Delete zone"
                      >
                        <Trash2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-danger) / 0.7)" }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: "hsl(var(--kf-muted) / 0.1)", border: "1px solid hsl(var(--kf-border))" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>
              {editing ? "Edit Zone" : "New Shipping Zone"}
            </p>
            <button
              onClick={() => { setShowForm(false); setEditing(null); }}
              className="p-1 rounded-lg hover:bg-white/5"
            >
              <X className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: "Zone Name", key: "name" as const, placeholder: "e.g., Caribbean Region", type: "text" },
              { label: "Countries (comma-separated)", key: "countries" as const, placeholder: "TT, JM, BB", type: "text" },
              { label: "Regions (comma-separated)", key: "regions" as const, placeholder: "e.g., Port of Spain, Kingston", type: "text" },
              { label: "Base Fee (TTD)", key: "baseFee" as const, placeholder: "25.00", type: "number" },
              { label: "Per Kg Rate (TTD)", key: "perKgRate" as const, placeholder: "5.00", type: "number" },
              { label: "Free Shipping Above (TTD)", key: "freeAbove" as const, placeholder: "500", type: "number" },
              { label: "Estimated Delivery Days", key: "estimatedDays" as const, placeholder: "3", type: "number" },
              { label: "Carrier Name", key: "carrier" as const, placeholder: "e.g., TTPost, FedEx", type: "text" },
            ].map(({ label, key, placeholder, type }) => (
              <div key={key}>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: "hsl(var(--kf-muted-foreground))" }}
                >
                  {label}
                </label>
                <input
                  type={type}
                  value={form[key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full rounded-lg px-3 py-2 text-sm min-h-[44px]"
                  style={{
                    background: "hsl(var(--kf-muted) / 0.3)",
                    border: "1px solid hsl(var(--kf-border))",
                    color: "hsl(var(--kf-foreground))",
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); setEditing(null); }}
              className="kf-btn-secondary min-h-[44px] px-4 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.name}
              className="kf-btn-primary min-h-[44px] px-4 text-sm flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving..." : editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
