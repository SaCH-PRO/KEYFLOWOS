"use client";

import { useId, useState } from "react";
import { Ticket, Save, X } from "lucide-react";
import { Button } from "@/components/ui-v2";
import type { CreateTicketTypeBody, EventTicketType } from "@/lib/api/events";

interface TicketTypeFormProps {
  eventId: string;
  businessCurrency: string;
  initialData?: EventTicketType;
  onSubmit: (body: CreateTicketTypeBody) => Promise<{ error?: string | null }>;
  onCancel: () => void;
}

function toDatetimeLocalValue(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TicketTypeForm({ businessCurrency, initialData, onSubmit, onCancel }: TicketTypeFormProps) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [price, setPrice] = useState(initialData?.price ?? "");
  const [currency, setCurrency] = useState(initialData?.currency ?? businessCurrency);
  const [quantity, setQuantity] = useState<string>(String(initialData?.quantity ?? ""));
  const [salesStartAt, setSalesStartAt] = useState(toDatetimeLocalValue(initialData?.salesStartAt));
  const [salesEndAt, setSalesEndAt] = useState(toDatetimeLocalValue(initialData?.salesEndAt));
  const [isActive, setIsActive] = useState(initialData?.isActive ?? true);

  const nameId = `${id}-name`;
  const descriptionId = `${id}-description`;
  const priceId = `${id}-price`;
  const currencyId = `${id}-currency`;
  const quantityId = `${id}-quantity`;
  const isActiveId = `${id}-is-active`;
  const salesStartId = `${id}-sales-start`;
  const salesEndId = `${id}-sales-end`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Ticket name is required");
      return;
    }

    const priceNum = parseFloat(price);
    if (Number.isNaN(priceNum) || priceNum < 0) {
      setError("Price must be a valid number");
      return;
    }

    const quantityNum = quantity ? parseInt(String(quantity), 10) : undefined;
    if (quantity && (Number.isNaN(quantityNum) || (quantityNum ?? 0) < 0)) {
      setError("Quantity must be a valid number");
      return;
    }

    const salesStartIso = salesStartAt ? new Date(salesStartAt).toISOString() : null;
    const salesEndIso = salesEndAt ? new Date(salesEndAt).toISOString() : null;

    if (salesStartIso && salesEndIso && new Date(salesEndIso) <= new Date(salesStartIso)) {
      setError("Sales end must be after sales start");
      return;
    }

    const body: CreateTicketTypeBody = {
      name: name.trim(),
      description: description.trim() || undefined,
      price: priceNum,
      currency: currency.trim() || businessCurrency,
      quantity: quantityNum,
      salesStartAt: salesStartIso,
      salesEndAt: salesEndIso,
      isActive,
    };

    setSaving(true);
    try {
      const result = await onSubmit(body);
      if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save ticket type");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-heading font-semibold text-foreground flex items-center gap-2">
          <Ticket className="w-4 h-4 text-primary" />
          {initialData ? "Edit ticket type" : "New ticket type"}
        </h3>
        <button type="button" onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="Cancel">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {error && <div className="rounded-xl bg-rose-50 text-rose-800 text-sm px-3 py-2 border border-rose-200">{error}</div>}

      <div className="space-y-1.5">
        <label htmlFor={nameId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Name *</label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. General Admission"
          className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={descriptionId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Description</label>
        <input
          id={descriptionId}
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's included?"
          className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor={priceId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Price *</label>
          <input
            id={priceId}
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={currencyId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Currency</label>
          <input
            id={currencyId}
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor={quantityId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Quantity</label>
          <input
            id={quantityId}
            type="number"
            min="0"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Unlimited"
            className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
        <div className="flex items-center gap-3 h-10 mt-5">
          <input
            type="checkbox"
            id={isActiveId}
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-5 w-5 rounded-md border-border text-primary focus:ring-primary"
          />
          <label htmlFor={isActiveId} className="text-body text-foreground font-medium cursor-pointer">
            Active
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor={salesStartId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Sales start</label>
          <input
            id={salesStartId}
            type="datetime-local"
            value={salesStartAt}
            onChange={(e) => setSalesStartAt(e.target.value)}
            className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={salesEndId} className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">Sales end</label>
          <input
            id={salesEndId}
            type="datetime-local"
            value={salesEndAt}
            onChange={(e) => setSalesEndAt(e.target.value)}
            className="w-full h-10 px-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isLoading={saving} leftIcon={<Save className="w-4 h-4" />}>
          Save
        </Button>
      </div>
    </form>
  );
}
