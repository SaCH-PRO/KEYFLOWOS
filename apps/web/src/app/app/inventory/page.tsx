"use client";

/**
 * Inventory finally has its own door.
 *
 * The 2,032-line InventoryCommandCenter — stock levels, adjustments with reason
 * codes, warehouse transfers, movement history, low-stock alerts, purchase
 * orders, Drive sheet sync, Excel import/export — was mounted inside
 * /app/marketplace at page.tsx:488 and could never render.
 *
 * marketplace/page.tsx:70-76 held:
 *
 *   if (params.get("tab") === "inventory" || activeTab === "inventory") {
 *     window.location.replace("/app/commerce?tab=inventory");
 *   }
 *
 * A migration to Commerce that was started and abandoned. /app/commerce has
 * tabs snapshot | invoices | quotes | products | recurring — no inventory — so
 * the redirect landed on a page that ignored the parameter. And because the
 * condition also fired on `activeTab === "inventory"`, clicking the Inventory
 * tab inside Marketplace bounced you straight back out.
 *
 * So: ten Prisma models, ~19 continental-ops service methods, a full REST
 * surface, and a command centre nobody could open. CommerceInventoryTab (262
 * lines) was written for the destination and imported by nothing.
 *
 * The migration is completed here rather than reverted — inventory is its own
 * concern, not a tab inside a dormant-flagged marketplace page, and one door
 * per room is the rule already applied to contacts and the inbox.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { InventoryCommandCenter } from "../marketplace/components/inventory-command-center";
import type {
  ProductDto,
  PurchaseOrderDto,
  WarehouseDto,
  InventoryStockDto,
} from "@/lib/types/marketplace";

type ApiListResponse<T> = { data?: T[] };

function unwrapList<T>(data: T[] | ApiListResponse<T> | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.data ?? [];
}

export default function InventoryPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [inventory, setInventory] = useState<InventoryStockDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderDto[]>([]);

  useEffect(() => {
    setBusinessId(getStoredBusinessId() ?? null);
  }, []);

  const basePath = `/marketplace/businesses/${businessId}`;
  const commercePath = `/commerce/businesses/${businessId}`;

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    const [whRes, invRes, prodRes, poRes] = await Promise.all([
      apiGet<WarehouseDto[]>(`${basePath}/warehouses`),
      apiGet<InventoryStockDto[]>(`${basePath}/inventory`),
      apiGet<ApiListResponse<ProductDto> | ProductDto[]>(`${commercePath}/products`),
      apiGet<ApiListResponse<PurchaseOrderDto> | PurchaseOrderDto[]>(`${basePath}/purchase-orders`),
    ]);

    const failure = whRes.error ?? invRes.error ?? prodRes.error ?? poRes.error;
    if (failure) toast.error(failure);

    if (whRes.data) setWarehouses(whRes.data);
    if (invRes.data) setInventory(invRes.data);
    if (prodRes.data) setProducts(unwrapList(prodRes.data));
    if (poRes.data) setPurchaseOrders(unwrapList(poRes.data));
    setLoading(false);
  }, [businessId, basePath, commercePath]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Warehouse and PO editing are prompt-driven rather than modal-driven.
   *
   * The command centre owns every screen its own tabs need — adjustments,
   * transfers, movements, alerts, sheet sync — and asks the container only for
   * these six. Marketplace answered them with a shared modal harness that also
   * served listings, shipments and products; lifting that whole harness across
   * would be copying a page to reuse a component.
   *
   * These are the create/rename/delete edges, not the daily work, and they call
   * the same endpoints the modals did. When inventory earns richer editing it
   * should get its own modals here rather than borrow marketplace's.
   */
  const createWarehouse = useCallback(async () => {
    const name = window.prompt("Warehouse name");
    if (!name?.trim()) return;
    const { error } = await apiPost({ path: `${basePath}/warehouses`, body: { name: name.trim() } });
    if (error) return toast.error(error);
    toast.success(`Warehouse "${name.trim()}" created`);
    await load();
  }, [basePath, load]);

  const editWarehouse = useCallback(async (wh: WarehouseDto) => {
    const name = window.prompt("Warehouse name", wh.name);
    if (!name?.trim() || name === wh.name) return;
    const { error } = await apiPatch(`${basePath}/warehouses/${wh.id}`, { name: name.trim() });
    if (error) return toast.error(error);
    toast.success("Warehouse renamed");
    await load();
  }, [basePath, load]);

  const deleteWarehouse = useCallback(async (id: string) => {
    const wh = warehouses.find((w) => w.id === id);
    if (!window.confirm(`Delete warehouse "${wh?.name ?? id}"? Stock held there must be moved first.`)) return;
    const { error } = await apiDelete(`${basePath}/warehouses/${id}`);
    if (error) return toast.error(error);
    toast.success("Warehouse deleted");
    await load();
  }, [basePath, warehouses, load]);

  const addInventory = useCallback(async () => {
    // Seeding a product into a warehouse. Adjustments after that go through the
    // command centre's own reason-coded flow, which writes a StockMovement.
    if (!products.length) return toast.error("Create a product first");
    if (!warehouses.length) return toast.error("Create a warehouse first");

    const named = products.filter((p) => !!p.name);
    const productName = window.prompt(`Product name (one of: ${named.slice(0, 8).map((p) => p.name).join(", ")})`);
    const product = named.find((p) => p.name?.toLowerCase() === productName?.trim().toLowerCase());
    if (!product) return productName ? toast.error("No product with that name") : undefined;

    const warehouseName = window.prompt(`Warehouse (one of: ${warehouses.map((w) => w.name).join(", ")})`, warehouses[0]?.name);
    const warehouse = warehouses.find((w) => w.name.toLowerCase() === warehouseName?.trim().toLowerCase());
    if (!warehouse) return warehouseName ? toast.error("No warehouse with that name") : undefined;

    const qty = Number(window.prompt("Opening quantity", "0"));
    if (!Number.isFinite(qty)) return toast.error("Quantity must be a number");

    const { error } = await apiPost({
      path: `${basePath}/inventory`,
      body: { productId: product.id, warehouseId: warehouse.id, quantity: qty },
    });
    if (error) return toast.error(error);
    toast.success(`${product.name} stocked at ${warehouse.name}`);
    await load();
  }, [basePath, products, warehouses, load]);

  const createPurchaseOrder = useCallback(async () => {
    const supplierName = window.prompt("Supplier name");
    if (!supplierName?.trim()) return;
    const { error } = await apiPost({
      path: `${basePath}/purchase-orders`,
      body: { supplierName: supplierName.trim(), items: [] },
    });
    if (error) return toast.error(error);
    toast.success("Purchase order drafted — add lines from the Purchase Orders tab");
    await load();
  }, [basePath, load]);

  const editPurchaseOrder = useCallback(async (po: PurchaseOrderDto) => {
    const notes = window.prompt(`Notes for ${po.poNumber}`, po.notes ?? "");
    if (notes === null) return;
    const { error } = await apiPatch(`${basePath}/purchase-orders/${po.id}`, { notes });
    if (error) return toast.error(error);
    toast.success("Purchase order updated");
    await load();
  }, [basePath, load]);

  if (!businessId) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Select a workspace to see your stock.
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading inventory…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Stock levels, adjustments, transfers and purchase orders.
        </p>
      </div>

      <InventoryCommandCenter
        businessId={businessId}
        basePath={basePath}
        warehouses={warehouses}
        inventory={inventory}
        products={products}
        purchaseOrders={purchaseOrders}
        onCreateWarehouse={createWarehouse}
        onEditWarehouse={editWarehouse}
        onDeleteWarehouse={deleteWarehouse}
        onAddInventory={addInventory}
        onCreatePO={createPurchaseOrder}
        onEditPO={editPurchaseOrder}
        onRefresh={load}
      />
    </div>
  );
}
