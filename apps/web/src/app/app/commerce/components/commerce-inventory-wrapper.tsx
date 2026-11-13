"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { toast } from "sonner";
import { moduleWriteRefusal } from "@/lib/module-access";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InventoryCommandCenter } from "../../marketplace/components/inventory-command-center";
import type {
  ProductDto,
  WarehouseDto,
  InventoryStockDto,
  PurchaseOrderDto,
} from "@/lib/types/marketplace";

interface ApiListResponse<T> { data?: T[] }

function unwrap<T>(d: T[] | ApiListResponse<T> | null | undefined): T[] {
  if (!d) return [];
  if (Array.isArray(d)) return d;
  return d.data ?? [];
}

type FormState = Record<string, unknown>;
type ModalKind = null | "warehouse" | "inventory" | "purchase-order";

export function CommerceInventoryWrapper({ businessId }: { businessId: string }) {
  const basePath = `/marketplace/businesses/${businessId}`;
  const commercePath = `/commerce/businesses/${businessId}`;

  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [inventory, setInventory] = useState<InventoryStockDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderDto[]>([]);

  const [modal, setModal] = useState<ModalKind>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "warehouse"; id: string } | null>(null);
  /**
   * SWEEP-P0-SCOPES second review repair (CRV-3): the server's refusal of a save (shown in the open
   * form) or of a warehouse delete (shown above the command centre). Shown inline, so this file adds
   * no import beside pkt/PR195-JOURNAL-SCOPE's.
   */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    const [whRes, invRes, prodRes, poRes] = await Promise.all([
      apiGet<WarehouseDto[]>(`${basePath}/warehouses`),
      apiGet<InventoryStockDto[]>(`${basePath}/inventory`),
      apiGet<ApiListResponse<ProductDto> | ProductDto[]>(`${commercePath}/products`),
      apiGet<ApiListResponse<PurchaseOrderDto> | PurchaseOrderDto[]>(`${basePath}/purchase-orders`),
    ]);
    setWarehouses(Array.isArray(whRes.data) ? whRes.data : []);
    setInventory(Array.isArray(invRes.data) ? invRes.data : []);
    setProducts(unwrap(prodRes.data ?? undefined));
    setPurchaseOrders(unwrap(poRes.data ?? undefined));
  }, [businessId, basePath, commercePath]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs server data into local state on mount
    void load();
  }, [load]);

  const openModal = (kind: Exclude<ModalKind, null>, defaults: FormState = {}, id: string | null = null) => {
    setSaveError(null);
    setModal(kind);
    setEditingId(id);
    setForm(defaults);
  };

  const handleSave = async () => {
    if (!modal) return;
    setSaving(true);
    try {
      // SWEEP-P0-SCOPES second review repair (CRV-3): the api client answers a refusal (storefront
      // write) as { error } and does not throw; a refused warehouse or stock save keeps the form open
      // with the server's words. It closed the form and reloaded as if saved.
      let refusal: string | null = null;
      if (modal === "warehouse") {
        const res = editingId ? await apiPatch(`${basePath}/warehouses/${editingId}`, form) : await apiPost({ path: `${basePath}/warehouses`, body: form });
        refusal = res.error ?? null;
      } else if (modal === "inventory") {
        refusal = (await apiPost({ path: `${basePath}/inventory`, body: form })).error ?? null;
      } else if (modal === "purchase-order") {
        if (editingId) {
          // PR195-KEY-GATES (review finding CRR-P195BD-1): an edit can move the order (a status in the body), so it
          // needs expenses write on the server; a refusal is said and the form stays open, nothing claimed.
          const res = await apiPatch(`${basePath}/purchase-orders/${editingId}`, form);
          const refused = moduleWriteRefusal(res, "expenses", "change purchase orders");
          if (refused) {
            toast.error(refused);
            setSaving(false);
            return;
          }
        } else await apiPost({ path: `${basePath}/purchase-orders`, body: form });
      }

      if (refusal) {
        setSaveError(refusal);
        setSaving(false);
        return;
      }
      setModal(null);
      await load();
    } catch {}
    setSaving(false);
  };

  const handleDeleteWarehouse = async (id: string) => {
    setDeleteError(null);
    try {
      // SWEEP-P0-SCOPES second review repair (CRV-3): a refused delete says why (it reloaded with no word).
      const res = await apiDelete(`${basePath}/warehouses/${id}`);
      if (res.error) setDeleteError(res.error);
      else await load();
    } catch {}
    setConfirmDelete(null);
  };

  return (
    <>
      {deleteError && (
        <div role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {deleteError}
        </div>
      )}
      <InventoryCommandCenter
        businessId={businessId}
        basePath={basePath}
        warehouses={warehouses}
        inventory={inventory}
        products={products}
        purchaseOrders={purchaseOrders}
        onCreateWarehouse={() => openModal("warehouse", { name: "", code: "", location: "", isActive: true })}
        onEditWarehouse={(wh) =>
          openModal(
            "warehouse",
            { name: wh.name ?? "", code: wh.code ?? "", location: wh.location ?? "", isActive: wh.isActive ?? true },
            wh.id,
          )
        }
        onDeleteWarehouse={(id) => setConfirmDelete({ kind: "warehouse", id })}
        onAddInventory={() =>
          openModal("inventory", { productId: "", warehouseId: warehouses[0]?.id ?? "", quantity: 0, reorderLevel: 0 })
        }
        onCreatePO={() =>
          openModal("purchase-order", {
            warehouseId: warehouses[0]?.id ?? "",
            supplierName: "",
            status: "DRAFT",
            expectedAt: "",
          })
        }
        onEditPO={(po) =>
          openModal(
            "purchase-order",
            {
              warehouseId: po.warehouseId ?? "",
              supplierName: (po as { supplierName?: string }).supplierName ?? "",
              status: po.status ?? "DRAFT",
              expectedAt: (po as { expectedAt?: string }).expectedAt ?? "",
            },
            po.id,
          )
        }
        onRefresh={load}
      />

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold capitalize">
                {editingId ? "Edit" : "New"} {modal.replace("-", " ")}
              </h3>
              <button onClick={() => setModal(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {modal === "warehouse" && (
                <>
                  <Field label="Name" value={String(form.name ?? "")} onChange={(v) => setForm({ ...form, name: v })} />
                  <Field label="Code" value={String(form.code ?? "")} onChange={(v) => setForm({ ...form, code: v })} />
                  <Field label="Location" value={String(form.location ?? "")} onChange={(v) => setForm({ ...form, location: v })} />
                </>
              )}
              {modal === "inventory" && (
                <>
                  <Select
                    label="Product"
                    value={String(form.productId ?? "")}
                    onChange={(v) => setForm({ ...form, productId: v })}
                    options={products.map((p) => ({ value: p.id, label: p.name ?? p.id }))}
                  />
                  <Select
                    label="Warehouse"
                    value={String(form.warehouseId ?? "")}
                    onChange={(v) => setForm({ ...form, warehouseId: v })}
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                  />
                  <Field
                    label="Quantity"
                    type="number"
                    value={String(form.quantity ?? "")}
                    onChange={(v) => setForm({ ...form, quantity: Number(v) || 0 })}
                  />
                  <Field
                    label="Reorder Level"
                    type="number"
                    value={String(form.reorderLevel ?? "")}
                    onChange={(v) => setForm({ ...form, reorderLevel: Number(v) || 0 })}
                  />
                </>
              )}
              {modal === "purchase-order" && (
                <>
                  <Select
                    label="Warehouse"
                    value={String(form.warehouseId ?? "")}
                    onChange={(v) => setForm({ ...form, warehouseId: v })}
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                  />
                  <Field
                    label="Supplier"
                    value={String(form.supplierName ?? "")}
                    onChange={(v) => setForm({ ...form, supplierName: v })}
                  />
                  <Field
                    label="Expected (YYYY-MM-DD)"
                    value={String(form.expectedAt ?? "")}
                    onChange={(v) => setForm({ ...form, expectedAt: v })}
                  />
                </>
              )}
            </div>

            {saveError && (
              <p role="alert" className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
                {saveError}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setModal(null)}
                className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted/30"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDeleteWarehouse(confirmDelete.id)}
        title="Delete warehouse?"
        message="This cannot be undone. Inventory at this warehouse will become unassigned."
        confirmLabel="Delete"
        variant="danger"
      />
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      >
        <option value="">— select —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
