// @keyflow:dormant — marketplace browsing, gated by featureFlags.marketplaceBrowsing (KEY-9 cleanup target).
"use client";

import { useEffect, useState, useCallback } from "react";
import { DormantRoute } from "@/components/dormant-route";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingBag,
  Package,
  Tag,
  ShoppingCart,
  Truck,
  Users,
  TrendingUp,
  Loader2,
  Lightbulb,
  X,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { Modal, FormField, inputClass, selectClass } from "./components/marketplace-utils";
import { CommerceCatalogTab } from "./components/commerce-catalog-tab";
import { CommerceListingsTab } from "./components/commerce-listings-tab";
import { CommerceOrdersTab } from "./components/commerce-orders-tab";
import { CommerceFulfillmentTab } from "./components/commerce-fulfillment-tab";
import { InventoryCommandCenter } from "./components/inventory-command-center";
import { CommerceSuppliersTab } from "./components/commerce-suppliers-tab";
import { CommerceInsightsTab } from "./components/commerce-insights-tab";
import { ProductEditorModal } from "./components/product-editor-modal";
import type {
  ProductDto,
  ListingDto,
  OrderDto,
  ShipmentDto,
  PurchaseOrderDto,
  WarehouseDto,
  InventoryStockDto,
} from "@/lib/types/marketplace";

type Tab = "catalog" | "listings" | "orders" | "fulfillment" | "inventory" | "suppliers" | "insights";

type FormState = Record<string, unknown>;

interface ApiListResponse<T> {
  data?: T[];
}

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "catalog", label: "Catalog", icon: Package },
  { key: "listings", label: "Listings", icon: Tag },
  { key: "orders", label: "Orders", icon: ShoppingCart },
  { key: "fulfillment", label: "Fulfillment", icon: Truck },
  { key: "suppliers", label: "Suppliers", icon: Users },
  { key: "insights", label: "Insights", icon: TrendingUp },
];

function unwrapList<T>(data: T[] | ApiListResponse<T> | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.data ?? [];
}

function MarketplacePageInner() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("catalog");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "inventory" || activeTab === "inventory") {
      window.location.replace("/app/commerce?tab=inventory");
    }
  }, [activeTab]);
  const [loading, setLoading] = useState(true);

  const [products, setProducts] = useState<ProductDto[]>([]);
  const [listings, setListings] = useState<ListingDto[]>([]);
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [shipments, setShipments] = useState<ShipmentDto[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderDto[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [inventory, setInventory] = useState<InventoryStockDto[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<string>("");
  const [editingItem, setEditingItem] = useState<{ id?: string } & FormState | null>(null);
  const [formData, setFormData] = useState<FormState>({});
  const [saving, setSaving] = useState(false);

  const [showProductEditor, setShowProductEditor] = useState(false);
  const [editingProduct, setEditingProduct] = useState<({ id?: string } & FormState) | null>(null);
  const [productForm, setProductForm] = useState<FormState>({});
  const [productSaving, setProductSaving] = useState(false);

  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (bid) setBusinessId(bid);
  }, []);

  const basePath = `/marketplace/businesses/${businessId}`;
  const commercePath = `/commerce/businesses/${businessId}`;

  const loadTab = useCallback(
    async (tab: Tab) => {
      if (!businessId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        switch (tab) {
          case "catalog": {
            const [prodRes, listRes] = await Promise.all([
              apiGet<ApiListResponse<ProductDto> | ProductDto[]>(`${commercePath}/products`),
              apiGet<ApiListResponse<ListingDto> | ListingDto[]>(`${basePath}/listings`),
            ]);
            if (prodRes.data) setProducts(unwrapList(prodRes.data));
            if (listRes.data) setListings(unwrapList(listRes.data));
            break;
          }
          case "listings": {
            const [listRes, prodRes] = await Promise.all([
              apiGet<ApiListResponse<ListingDto> | ListingDto[]>(`${basePath}/listings`),
              apiGet<ApiListResponse<ProductDto> | ProductDto[]>(`${commercePath}/products`),
            ]);
            if (listRes.data) setListings(unwrapList(listRes.data));
            if (prodRes.data) setProducts(unwrapList(prodRes.data));
            break;
          }
          case "orders": {
            const [ordRes, prodRes] = await Promise.all([
              apiGet<ApiListResponse<OrderDto> | OrderDto[]>(`${basePath}/orders`),
              apiGet<ApiListResponse<ProductDto> | ProductDto[]>(`${commercePath}/products`),
            ]);
            if (ordRes.data) setOrders(unwrapList(ordRes.data));
            if (prodRes.data) setProducts(unwrapList(prodRes.data));
            break;
          }
          case "fulfillment": {
            const [shipRes, poRes, prodRes] = await Promise.all([
              apiGet<ApiListResponse<ShipmentDto> | ShipmentDto[]>(`${basePath}/shipments`),
              apiGet<ApiListResponse<PurchaseOrderDto> | PurchaseOrderDto[]>(`${basePath}/purchase-orders`),
              apiGet<ApiListResponse<ProductDto> | ProductDto[]>(`${commercePath}/products`),
            ]);
            if (shipRes.data) setShipments(unwrapList(shipRes.data));
            if (poRes.data) setPurchaseOrders(unwrapList(poRes.data));
            if (prodRes.data) setProducts(unwrapList(prodRes.data));
            break;
          }
          case "inventory": {
            const [whRes, invRes, prodRes] = await Promise.all([
              apiGet<WarehouseDto[]>(`${basePath}/warehouses`),
              apiGet<InventoryStockDto[]>(`${basePath}/inventory`),
              apiGet<ApiListResponse<ProductDto> | ProductDto[]>(`${commercePath}/products`),
            ]);
            if (whRes.data) setWarehouses(whRes.data);
            if (invRes.data) setInventory(invRes.data);
            if (prodRes.data) setProducts(unwrapList(prodRes.data));
            break;
          }
          case "suppliers": {
            const [poRes, prodRes] = await Promise.all([
              apiGet<ApiListResponse<PurchaseOrderDto> | PurchaseOrderDto[]>(`${basePath}/purchase-orders`),
              apiGet<ApiListResponse<ProductDto> | ProductDto[]>(`${commercePath}/products`),
            ]);
            if (poRes.data) setPurchaseOrders(unwrapList(poRes.data));
            if (prodRes.data) setProducts(unwrapList(prodRes.data));
            break;
          }
          case "insights": {
            const [prodRes, listRes, ordRes, invRes] = await Promise.all([
              apiGet<ApiListResponse<ProductDto> | ProductDto[]>(`${commercePath}/products`),
              apiGet<ApiListResponse<ListingDto> | ListingDto[]>(`${basePath}/listings`),
              apiGet<ApiListResponse<OrderDto> | OrderDto[]>(`${basePath}/orders`),
              apiGet<InventoryStockDto[]>(`${basePath}/inventory`),
            ]);
            if (prodRes.data) setProducts(unwrapList(prodRes.data));
            if (listRes.data) setListings(unwrapList(listRes.data));
            if (ordRes.data) setOrders(unwrapList(ordRes.data));
            if (invRes.data) setInventory(invRes.data);
            break;
          }
        }
      } catch {}
      setLoading(false);
    },
    [businessId, basePath, commercePath]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    void loadTab(activeTab);
  }, [activeTab, loadTab]);

  const openCreate = (type: string, defaults: FormState = {}) => {
    setModalType(type);
    setEditingItem(null);
    setFormData(defaults);
    setShowModal(true);
  };

  const openEdit = (type: string, item: { id?: string } & FormState) => {
    setModalType(type);
    setEditingItem(item);
    setFormData({ ...item });
    setShowModal(true);
  };

  const openProductEditor = (product: (({ id?: string } & FormState) | null) = null) => {
    setEditingProduct(product);
    setProductForm(product ? { ...product } : {});
    setShowProductEditor(true);
  };

  const handleProductSave = async () => {
    if (!businessId) return;
    setProductSaving(true);
    try {
      if (editingProduct?.id) {
        await apiPatch(`${commercePath}/products/${editingProduct.id}`, productForm);
      } else {
        await apiPost({ path: `${commercePath}/products`, body: productForm });
      }
      setShowProductEditor(false);
      await loadTab("catalog");
    } catch {}
    setProductSaving(false);
  };

  const handleSave = async () => {
    if (!businessId) return;
    setSaving(true);
    try {
      let res;
      switch (modalType) {
        case "listing":
          if (editingItem) {
            res = await apiPatch(`${basePath}/listings/${editingItem.id}`, formData);
          } else {
            res = await apiPost({ path: `${basePath}/listings`, body: formData });
          }
          if (res.data) await loadTab("listings");
          break;
        case "order":
          res = await apiPost({ path: `${basePath}/orders`, body: formData });
          if (res.data) await loadTab("orders");
          break;
        case "shipment":
          if (editingItem) {
            res = await apiPatch(`${basePath}/shipments/${editingItem.id}`, formData);
          } else {
            res = await apiPost({ path: `${basePath}/shipments`, body: formData });
          }
          if (res.data) await loadTab("fulfillment");
          break;
        case "purchase-order":
          if (editingItem) {
            res = await apiPatch(`${basePath}/purchase-orders/${editingItem.id}`, formData);
          } else {
            res = await apiPost({ path: `${basePath}/purchase-orders`, body: formData });
          }
          if (res.data) await loadTab(activeTab === "suppliers" ? "suppliers" : "fulfillment");
          break;
        case "warehouse":
          if (editingItem) {
            res = await apiPatch(`${basePath}/warehouses/${editingItem.id}`, formData);
          } else {
            res = await apiPost({ path: `${basePath}/warehouses`, body: formData });
          }
          if (res.data) await loadTab("inventory");
          break;
        case "inventory":
          res = await apiPost({ path: `${basePath}/inventory`, body: formData });
          if (res.data) await loadTab("inventory");
          break;
      }
      setShowModal(false);
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (type: string, id: string) => {
    if (!businessId) return;
    try {
      switch (type) {
        case "listing":
          await apiDelete(`${basePath}/listings/${id}`);
          await loadTab("listings");
          break;
        case "warehouse":
          await apiDelete(`${basePath}/warehouses/${id}`);
          await loadTab("inventory");
          break;
      }
    } catch {}
  };

  const handleStatusUpdate = async (orderId: string, status: string) => {
    if (!businessId) return;
    try {
      await apiPatch(`${basePath}/orders/${orderId}/status`, { status });
      await loadTab("orders");
    } catch {}
  };

  const handleUpdateListing = async (id: string, data: Record<string, unknown>) => {
    if (!businessId) return;
    try {
      await apiPatch(`${basePath}/listings/${id}`, data);
      await loadTab("listings");
    } catch {}
  };

  const updateForm = (key: string, value: unknown) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  const fdString = (key: string): string => {
    const v = formData[key];
    return v == null ? "" : String(v);
  };

  if (loading && activeTab === "catalog" && products.length === 0) return <DashboardSkeleton />;

  return (
    <WorkspaceShell
      icon={ShoppingBag}
      title="Commerce"
      subtitle="Catalog, listings, orders, fulfillment, inventory, and supplier management"
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as Tab)}
      tabLayoutId="marketplace-tabs"
      enableSwipe
      enableSlideAnimation
      headerRight={
        <div className="relative">
          <button
            onClick={() => setShowGuide(!showGuide)}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
              showGuide
                ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
                : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
            }`}
            aria-label="Getting started guide"
            title="Getting started guide"
          >
            <Lightbulb className="w-3.5 h-3.5" />
          </button>
          <AnimatePresence>
            {showGuide && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowGuide(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[90vw] sm:max-w-[700px] max-h-[80vh] overflow-y-auto p-5"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 rounded-lg bg-amber-400/10">
                      <Lightbulb className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold">Commerce Workspace Guide</h4>
                      <p className="text-[11px] text-muted-foreground">Get started with your commerce workspace</p>
                    </div>
                    <button onClick={() => setShowGuide(false)} className="ml-auto p-1 rounded hover:bg-muted/50">
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { step: "1", title: "Build Your Catalog", desc: "Add products with variants, cost profiles, and source links." },
                      { step: "2", title: "Create Listings", desc: "Publish products with fulfillment strategies and pricing controls." },
                      { step: "3", title: "Manage Orders", desc: "Process customer orders with full status pipeline visibility." },
                      { step: "4", title: "Track Fulfillment", desc: "Monitor shipments, purchase orders, and fulfillment routes." },
                      { step: "5", title: "Control Inventory", desc: "Manage warehouse stock levels with reorder signals." },
                      { step: "6", title: "Connect Suppliers", desc: "Track supplier health and map products to sources." },
                    ].map((item) => (
                      <div key={item.step} className="flex gap-2.5 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                        <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                          {item.step}
                        </div>
                        <div>
                          <p className="text-xs font-medium">{item.title}</p>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      }
    >
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && (
        <>
            {activeTab === "catalog" && (
              <CommerceCatalogTab
                products={products}
                listings={listings}
                onCreateProduct={() => openProductEditor(null)}
                onEditProduct={(p) => openProductEditor(p as ({ id?: string } & FormState))}
              />
            )}
            {activeTab === "listings" && (
              <CommerceListingsTab
                listings={listings}
                products={products}
                onEdit={(item) => openEdit("listing", item)}
                onDelete={(id) => handleDelete("listing", id)}
                onUpdateListing={handleUpdateListing}
                onCreateListing={() =>
                  openCreate("listing", {
                    productId: "",
                    title: "",
                    price: "",
                    compareAtPrice: "",
                    fulfillmentStrategy: "",
                    marketReach: "LOCAL",
                    status: "ACTIVE",
                    countries: "",
                    hsCode: "",
                    weight: "",
                    shippingEnabled: true,
                  })
                }
              />
            )}
            {activeTab === "orders" && (
              <CommerceOrdersTab orders={orders} onStatusUpdate={handleStatusUpdate} />
            )}
            {activeTab === "fulfillment" && (
              <CommerceFulfillmentTab
                shipments={shipments}
                purchaseOrders={purchaseOrders}
                products={products}
                onEditShipment={(item) => openEdit("shipment", item)}
                onCreateShipment={() =>
                  openCreate("shipment", {
                    carrier: "",
                    trackingNumber: "",
                    status: "PREPARING",
                    estimatedDelivery: "",
                    orderId: "",
                  })
                }
                onEditPO={(item) => openEdit("purchase-order", item)}
                onCreatePO={() =>
                  openCreate("purchase-order", {
                    supplierName: "",
                    supplierEmail: "",
                    productId: "",
                    quantity: "",
                    unitCost: "",
                    expectedDelivery: "",
                    status: "DRAFT",
                  })
                }
              />
            )}
            {activeTab === "inventory" && businessId && (
              <InventoryCommandCenter
                businessId={businessId}
                basePath={basePath}
                warehouses={warehouses}
                inventory={inventory}
                products={products}
                purchaseOrders={purchaseOrders}
                onEditWarehouse={(item) => openEdit("warehouse", item)}
                onDeleteWarehouse={(id) => handleDelete("warehouse", id)}
                onAddInventory={() =>
                  openCreate("inventory", {
                    warehouseId: "",
                    productId: "",
                    quantity: "",
                    reserved: "",
                    reorderLevel: "",
                  })
                }
                onCreateWarehouse={() =>
                  openCreate("warehouse", {
                    name: "",
                    address: "",
                    city: "",
                    country: "",
                    capacity: "",
                  })
                }
                onCreatePO={() =>
                  openCreate("purchase-order", {
                    supplierName: "",
                    supplierEmail: "",
                    productId: "",
                    quantity: "",
                    unitCost: "",
                    expectedDelivery: "",
                    status: "DRAFT",
                  })
                }
                onEditPO={(po) => openEdit("purchase-order", po)}
                onRefresh={() => loadTab("inventory")}
              />
            )}
            {activeTab === "suppliers" && (
              <CommerceSuppliersTab
                purchaseOrders={purchaseOrders}
                products={products}
                onCreatePO={() =>
                  openCreate("purchase-order", {
                    supplierName: "",
                    supplierEmail: "",
                    productId: "",
                    quantity: "",
                    unitCost: "",
                    expectedDelivery: "",
                    status: "DRAFT",
                  })
                }
                onEditPO={(item) => openEdit("purchase-order", item)}
              />
            )}
            {activeTab === "insights" && (
              <CommerceInsightsTab
                products={products}
                listings={listings}
                orders={orders}
                inventory={inventory}
              />
            )}
        </>
      )}

      <ProductEditorModal
        open={showProductEditor}
        onClose={() => setShowProductEditor(false)}
        product={productForm}
        onChange={(key, value) => setProductForm((prev) => ({ ...prev, [key]: value }))}
        onSave={handleProductSave}
        saving={productSaving}
      />

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingItem ? `Edit ${modalType.replace("-", " ")}` : `Create ${modalType.replace("-", " ")}`}
      >
        {modalType === "listing" && (
          <>
            <FormField label="Product">
              <select
                value={fdString("productId")}
                onChange={(e) => updateForm("productId", e.target.value)}
                className={selectClass}
              >
                <option value="">Select a product...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Title (optional override)">
              <input
                value={fdString("title")}
                onChange={(e) => updateForm("title", e.target.value)}
                className={inputClass}
                placeholder="Custom listing title"
              />
            </FormField>
            <FormField label="Fulfillment Strategy">
              <select
                value={fdString("fulfillmentStrategy")}
                onChange={(e) => updateForm("fulfillmentStrategy", e.target.value)}
                className={selectClass}
              >
                <option value="">Select strategy...</option>
                <option value="local_stock">Local Stock</option>
                <option value="dropship">Dropship</option>
                <option value="preorder">Pre-Order</option>
                <option value="manual">Manual</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Price">
                <input
                  type="number"
                  value={fdString("price")}
                  onChange={(e) => updateForm("price", e.target.value)}
                  className={inputClass}
                  placeholder="25.00"
                />
              </FormField>
              <FormField label="Compare-at Price">
                <input
                  type="number"
                  value={fdString("compareAtPrice")}
                  onChange={(e) => updateForm("compareAtPrice", e.target.value)}
                  className={inputClass}
                  placeholder="30.00"
                />
              </FormField>
            </div>
            <FormField label="Market Reach">
              <select
                value={fdString("marketReach") || "LOCAL"}
                onChange={(e) => updateForm("marketReach", e.target.value)}
                className={selectClass}
              >
                <option value="LOCAL">Local</option>
                <option value="REGIONAL">Regional</option>
                <option value="INTERNATIONAL">International</option>
              </select>
            </FormField>
            <FormField label="Status">
              <select
                value={fdString("status") || "ACTIVE"}
                onChange={(e) => updateForm("status", e.target.value)}
                className={selectClass}
              >
                <option value="ACTIVE">Active (Visible)</option>
                <option value="INACTIVE">Inactive (Hidden)</option>
              </select>
            </FormField>
            <FormField label="Countries (comma-separated)">
              <input
                value={fdString("countries")}
                onChange={(e) => updateForm("countries", e.target.value)}
                className={inputClass}
                placeholder="TT, JM, BB..."
              />
            </FormField>
            <FormField label="HS Code">
              <input
                value={fdString("hsCode")}
                onChange={(e) => updateForm("hsCode", e.target.value)}
                className={inputClass}
                placeholder="8471.30"
              />
            </FormField>
          </>
        )}

        {modalType === "shipment" && (
          <>
            <FormField label="Order ID">
              <input
                value={fdString("orderId")}
                onChange={(e) => updateForm("orderId", e.target.value)}
                className={inputClass}
                placeholder="Order ID"
              />
            </FormField>
            <FormField label="Carrier">
              <input
                value={fdString("carrier")}
                onChange={(e) => updateForm("carrier", e.target.value)}
                className={inputClass}
                placeholder="FedEx, DHL, UPS..."
              />
            </FormField>
            <FormField label="Tracking Number">
              <input
                value={fdString("trackingNumber")}
                onChange={(e) => updateForm("trackingNumber", e.target.value)}
                className={inputClass}
                placeholder="1Z999AA10123456784"
              />
            </FormField>
            <FormField label="Status">
              <select
                value={fdString("status") || "PREPARING"}
                onChange={(e) => updateForm("status", e.target.value)}
                className={selectClass}
              >
                {["PREPARING", "PICKED_UP", "IN_TRANSIT", "CUSTOMS", "DELIVERED"].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Estimated Delivery">
              <input
                type="date"
                value={fdString("estimatedDelivery")}
                onChange={(e) => updateForm("estimatedDelivery", e.target.value)}
                className={inputClass}
              />
            </FormField>
          </>
        )}

        {modalType === "purchase-order" && (
          <>
            <FormField label="Supplier Name">
              <input
                value={fdString("supplierName")}
                onChange={(e) => updateForm("supplierName", e.target.value)}
                className={inputClass}
                placeholder="Supplier Co."
              />
            </FormField>
            <FormField label="Supplier Email">
              <input
                value={fdString("supplierEmail")}
                onChange={(e) => updateForm("supplierEmail", e.target.value)}
                className={inputClass}
                placeholder="supplier@co.com"
              />
            </FormField>
            <FormField label="Product">
              <select
                value={fdString("productId")}
                onChange={(e) => updateForm("productId", e.target.value)}
                className={selectClass}
              >
                <option value="">Select product...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Quantity">
                <input
                  type="number"
                  value={fdString("quantity")}
                  onChange={(e) => updateForm("quantity", e.target.value)}
                  className={inputClass}
                  placeholder="100"
                />
              </FormField>
              <FormField label="Unit Cost">
                <input
                  type="number"
                  value={fdString("unitCost")}
                  onChange={(e) => updateForm("unitCost", e.target.value)}
                  className={inputClass}
                  placeholder="25.00"
                />
              </FormField>
            </div>
            <FormField label="Expected Delivery">
              <input
                type="date"
                value={fdString("expectedDelivery")}
                onChange={(e) => updateForm("expectedDelivery", e.target.value)}
                className={inputClass}
              />
            </FormField>
            <FormField label="Status">
              <select
                value={fdString("status") || "DRAFT"}
                onChange={(e) => updateForm("status", e.target.value)}
                className={selectClass}
              >
                {["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </FormField>
          </>
        )}

        {modalType === "warehouse" && (
          <>
            <FormField label="Warehouse Name">
              <input
                value={fdString("name")}
                onChange={(e) => updateForm("name", e.target.value)}
                className={inputClass}
                placeholder="Main Warehouse"
              />
            </FormField>
            <FormField label="Address">
              <input
                value={fdString("address")}
                onChange={(e) => updateForm("address", e.target.value)}
                className={inputClass}
                placeholder="123 Industrial Dr"
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="City">
                <input
                  value={fdString("city")}
                  onChange={(e) => updateForm("city", e.target.value)}
                  className={inputClass}
                  placeholder="Port of Spain"
                />
              </FormField>
              <FormField label="Country">
                <input
                  value={fdString("country")}
                  onChange={(e) => updateForm("country", e.target.value)}
                  className={inputClass}
                  placeholder="Trinidad & Tobago"
                />
              </FormField>
            </div>
            <FormField label="Capacity">
              <input
                type="number"
                value={fdString("capacity")}
                onChange={(e) => updateForm("capacity", e.target.value)}
                className={inputClass}
                placeholder="1000"
              />
            </FormField>
          </>
        )}

        {modalType === "inventory" && (
          <>
            <FormField label="Warehouse">
              <select
                value={fdString("warehouseId")}
                onChange={(e) => updateForm("warehouseId", e.target.value)}
                className={selectClass}
              >
                <option value="">Select warehouse...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Product">
              <select
                value={fdString("productId")}
                onChange={(e) => updateForm("productId", e.target.value)}
                className={selectClass}
              >
                <option value="">Select product...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Quantity">
                <input
                  type="number"
                  value={fdString("quantity")}
                  onChange={(e) => updateForm("quantity", e.target.value)}
                  className={inputClass}
                  placeholder="100"
                />
              </FormField>
              <FormField label="Reserved">
                <input
                  type="number"
                  value={fdString("reserved")}
                  onChange={(e) => updateForm("reserved", e.target.value)}
                  className={inputClass}
                  placeholder="0"
                />
              </FormField>
              <FormField label="Reorder Level">
                <input
                  type="number"
                  value={fdString("reorderLevel")}
                  onChange={(e) => updateForm("reorderLevel", e.target.value)}
                  className={inputClass}
                  placeholder="10"
                />
              </FormField>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => setShowModal(false)}
            className="px-4 py-2 text-sm rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {editingItem ? "Update" : "Create"}
          </button>
        </div>
      </Modal>
    </WorkspaceShell>
  );
}

export default function MarketplacePage() {
  return (
    <DormantRoute featureKey="nav.public.marketplace" title="Marketplace">
      <MarketplacePageInner />
    </DormantRoute>
  );
}
