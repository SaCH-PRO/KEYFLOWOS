"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Package,
  ShoppingCart,
  Truck,
  FileCheck,
  Warehouse,
  Clock,
  ClipboardList,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { Modal, FormField, inputClass, selectClass } from "./components/marketplace-utils";
import { DashboardTab } from "./components/dashboard-tab";
import { CatalogTab } from "./components/catalog-tab";
import { OrdersTab } from "./components/orders-tab";
import { ShipmentsTab } from "./components/shipments-tab";
import { CustomsTab } from "./components/customs-tab";
import { WarehousingTab } from "./components/warehousing-tab";
import { PreOrdersTab } from "./components/pre-orders-tab";
import { PurchaseOrdersTab } from "./components/purchase-orders-tab";

type Tab = "dashboard" | "catalog" | "orders" | "shipments" | "customs" | "warehousing" | "preorders" | "purchase-orders";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: TrendingUp },
  { key: "catalog", label: "Catalog", icon: Package },
  { key: "orders", label: "Orders", icon: ShoppingCart },
  { key: "shipments", label: "Shipments", icon: Truck },
  { key: "customs", label: "Customs", icon: FileCheck },
  { key: "warehousing", label: "Warehousing", icon: Warehouse },
  { key: "preorders", label: "Pre-Orders", icon: Clock },
  { key: "purchase-orders", label: "Purchase Orders", icon: ClipboardList },
];

export default function MarketplacePage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);

  const [dashboard, setDashboard] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [customs, setCustoms] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [preOrders, setPreOrders] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<string>("");
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const basePath = `/marketplace/businesses/${businessId}`;

  const loadTab = useCallback(async (tab: Tab) => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      switch (tab) {
        case "dashboard": {
          const { data } = await apiGet<any>(`${basePath}/dashboard`);
          if (data) setDashboard(data);
          break;
        }
        case "catalog": {
          const [listRes, prodRes] = await Promise.all([
            apiGet<any[]>(`${basePath}/listings`),
            apiGet<any[]>(`/commerce/businesses/${businessId}/products`),
          ]);
          if (listRes.data) setListings(listRes.data);
          if (prodRes.data) setProducts(prodRes.data);
          break;
        }
        case "orders": {
          const [ordRes, prodRes] = await Promise.all([
            apiGet<any[]>(`${basePath}/orders`),
            apiGet<any[]>(`/commerce/businesses/${businessId}/products`),
          ]);
          if (ordRes.data) setOrders(ordRes.data);
          if (prodRes.data) setProducts(prodRes.data);
          break;
        }
        case "shipments": {
          const { data } = await apiGet<any[]>(`${basePath}/shipments`);
          if (data) setShipments(data);
          break;
        }
        case "customs": {
          const { data } = await apiGet<any[]>(`${basePath}/customs`);
          if (data) setCustoms(data);
          break;
        }
        case "warehousing": {
          const [whRes, invRes] = await Promise.all([
            apiGet<any[]>(`${basePath}/warehouses`),
            apiGet<any[]>(`${basePath}/inventory`),
          ]);
          if (whRes.data) setWarehouses(whRes.data);
          if (invRes.data) setInventory(invRes.data);
          break;
        }
        case "preorders": {
          const { data } = await apiGet<any[]>(`${basePath}/pre-orders`);
          if (data) setPreOrders(data);
          break;
        }
        case "purchase-orders": {
          const { data } = await apiGet<any[]>(`${basePath}/purchase-orders`);
          if (data) setPurchaseOrders(data);
          break;
        }
      }
    } catch {}
    setLoading(false);
  }, [businessId, basePath]);

  useEffect(() => {
    void loadTab(activeTab);
  }, [activeTab, loadTab]);

  const openCreate = (type: string, defaults: Record<string, any> = {}) => {
    setModalType(type);
    setEditingItem(null);
    setFormData(defaults);
    setShowModal(true);
  };

  const openEdit = (type: string, item: any) => {
    setModalType(type);
    setEditingItem(item);
    setFormData({ ...item });
    setShowModal(true);
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
          if (res.data) await loadTab("catalog");
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
          if (res.data) await loadTab("shipments");
          break;
        case "customs":
          if (editingItem) {
            res = await apiPatch(`${basePath}/customs/${editingItem.id}`, formData);
          } else {
            res = await apiPost({ path: `${basePath}/customs`, body: formData });
          }
          if (res.data) await loadTab("customs");
          break;
        case "warehouse":
          if (editingItem) {
            res = await apiPatch(`${basePath}/warehouses/${editingItem.id}`, formData);
          } else {
            res = await apiPost({ path: `${basePath}/warehouses`, body: formData });
          }
          if (res.data) await loadTab("warehousing");
          break;
        case "inventory":
          res = await apiPost({ path: `${basePath}/inventory`, body: formData });
          if (res.data) await loadTab("warehousing");
          break;
        case "preorder":
          if (editingItem) {
            res = await apiPatch(`${basePath}/pre-orders/${editingItem.id}`, formData);
          } else {
            res = await apiPost({ path: `${basePath}/pre-orders`, body: formData });
          }
          if (res.data) await loadTab("preorders");
          break;
        case "purchase-order":
          if (editingItem) {
            res = await apiPatch(`${basePath}/purchase-orders/${editingItem.id}`, formData);
          } else {
            res = await apiPost({ path: `${basePath}/purchase-orders`, body: formData });
          }
          if (res.data) await loadTab("purchase-orders");
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
          await loadTab("catalog");
          break;
        case "warehouse":
          await apiDelete(`${basePath}/warehouses/${id}`);
          await loadTab("warehousing");
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

  const updateForm = (key: string, value: any) => setFormData((prev) => ({ ...prev, [key]: value }));

  const getActionLabel = (): string => {
    switch (activeTab) {
      case "catalog": return "New Listing";
      case "orders": return "New Order";
      case "shipments": return "New Shipment";
      case "customs": return "New Declaration";
      case "warehousing": return "Add Warehouse";
      case "preorders": return "New Pre-Order";
      case "purchase-orders": return "New PO";
      default: return "";
    }
  };

  const handleAction = () => {
    switch (activeTab) {
      case "catalog":
        openCreate("listing", { marketReach: "LOCAL", countries: "", hsCode: "", weight: "", shippingEnabled: true });
        break;
      case "orders":
        openCreate("order", { customerName: "", customerEmail: "", customerPhone: "", shippingAddress: "", items: [], status: "PENDING" });
        break;
      case "shipments":
        openCreate("shipment", { carrier: "", trackingNumber: "", status: "PREPARING", estimatedDelivery: "" });
        break;
      case "customs":
        openCreate("customs", { type: "EXPORT", hsCode: "", declaredValue: "", dutyAmount: "", status: "DRAFT", description: "" });
        break;
      case "warehousing":
        openCreate("warehouse", { name: "", address: "", city: "", country: "", capacity: "" });
        break;
      case "preorders":
        openCreate("preorder", { depositAmount: "", expectedDate: "", status: "PENDING" });
        break;
      case "purchase-orders":
        openCreate("purchase-order", { supplierName: "", supplierEmail: "", items: [], expectedDelivery: "", status: "DRAFT" });
        break;
    }
  };

  if (loading && !dashboard && activeTab === "dashboard") return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Globe}
        title="Global Commerce"
        subtitle="Manage your marketplace, shipments, customs & warehousing"
        actionLabel={activeTab !== "dashboard" ? getActionLabel() : undefined}
        onAction={activeTab !== "dashboard" ? handleAction : undefined}
      />

      <FeatureGuide
        featureKey="marketplace"
        title="Getting Started with Global Commerce"
        description="Expand your business reach with marketplace listings, international shipping, customs management, and warehousing."
        steps={[
          { title: "List Products", description: "Publish products to the marketplace with local, regional, or international reach." },
          { title: "Manage Orders", description: "Process customer orders from confirmation through delivery." },
          { title: "Track Shipments", description: "Monitor shipments with carrier tracking and status updates." },
          { title: "Handle Customs", description: "File customs declarations for international trade with HS codes." },
          { title: "Warehouse Stock", description: "Manage warehouse locations and inventory levels across regions." },
        ]}
      />

      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl whitespace-nowrap transition-all ${
                isActive ? "text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="marketplace-tab"
                  className="absolute inset-0 bg-orange-500/20 border border-orange-500/30 rounded-xl"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "dashboard" && <DashboardTab data={dashboard} />}
            {activeTab === "catalog" && (
              <CatalogTab listings={listings} onEdit={(item) => openEdit("listing", item)} onDelete={(id) => handleDelete("listing", id)} />
            )}
            {activeTab === "orders" && (
              <OrdersTab orders={orders} onStatusUpdate={handleStatusUpdate} />
            )}
            {activeTab === "shipments" && (
              <ShipmentsTab shipments={shipments} onEdit={(item) => openEdit("shipment", item)} />
            )}
            {activeTab === "customs" && (
              <CustomsTab declarations={customs} onEdit={(item) => openEdit("customs", item)} />
            )}
            {activeTab === "warehousing" && (
              <WarehousingTab
                warehouses={warehouses}
                inventory={inventory}
                onEdit={(item) => openEdit("warehouse", item)}
                onDelete={(id) => handleDelete("warehouse", id)}
                onAddInventory={() => openCreate("inventory", { warehouseId: "", productId: "", quantity: "", reorderLevel: "" })}
              />
            )}
            {activeTab === "preorders" && (
              <PreOrdersTab preOrders={preOrders} onEdit={(item) => openEdit("preorder", item)} />
            )}
            {activeTab === "purchase-orders" && (
              <PurchaseOrdersTab purchaseOrders={purchaseOrders} onEdit={(item) => openEdit("purchase-order", item)} />
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingItem ? `Edit ${modalType}` : `Create ${modalType}`}>
        {modalType === "listing" && (
          <>
            <FormField label="Product">
              <select value={formData.productId || ""} onChange={(e) => updateForm("productId", e.target.value)} className={selectClass}>
                <option value="">Select a product...</option>
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Market Reach">
              <select value={formData.marketReach || "LOCAL"} onChange={(e) => updateForm("marketReach", e.target.value)} className={selectClass}>
                <option value="LOCAL">Local</option>
                <option value="REGIONAL">Regional</option>
                <option value="INTERNATIONAL">International</option>
              </select>
            </FormField>
            <FormField label="Countries (comma-separated)">
              <input value={formData.countries || ""} onChange={(e) => updateForm("countries", e.target.value)} className={inputClass} placeholder="TT, JM, BB..." />
            </FormField>
            <FormField label="HS Code">
              <input value={formData.hsCode || ""} onChange={(e) => updateForm("hsCode", e.target.value)} className={inputClass} placeholder="8471.30" />
            </FormField>
            <FormField label="Weight (kg)">
              <input type="number" value={formData.weight || ""} onChange={(e) => updateForm("weight", e.target.value)} className={inputClass} placeholder="0.5" />
            </FormField>
            <FormField label="Shipping Enabled">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formData.shippingEnabled ?? true} onChange={(e) => updateForm("shippingEnabled", e.target.checked)} className="rounded" />
                <span className="text-sm">Enable shipping for this listing</span>
              </label>
            </FormField>
          </>
        )}

        {modalType === "order" && (
          <>
            <FormField label="Customer Name">
              <input value={formData.customerName || ""} onChange={(e) => updateForm("customerName", e.target.value)} className={inputClass} placeholder="John Doe" />
            </FormField>
            <FormField label="Customer Email">
              <input value={formData.customerEmail || ""} onChange={(e) => updateForm("customerEmail", e.target.value)} className={inputClass} placeholder="john@example.com" />
            </FormField>
            <FormField label="Customer Phone">
              <input value={formData.customerPhone || ""} onChange={(e) => updateForm("customerPhone", e.target.value)} className={inputClass} placeholder="+1 868 555 0123" />
            </FormField>
            <FormField label="Shipping Address">
              <textarea value={formData.shippingAddress || ""} onChange={(e) => updateForm("shippingAddress", e.target.value)} className={inputClass} rows={2} placeholder="123 Main St, Port of Spain, Trinidad" />
            </FormField>
            <FormField label="Product">
              <select value={formData.productId || ""} onChange={(e) => updateForm("productId", e.target.value)} className={selectClass}>
                <option value="">Select a product...</option>
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Quantity">
              <input type="number" value={formData.quantity || ""} onChange={(e) => updateForm("quantity", e.target.value)} className={inputClass} placeholder="1" />
            </FormField>
          </>
        )}

        {modalType === "shipment" && (
          <>
            <FormField label="Order ID">
              <input value={formData.orderId || ""} onChange={(e) => updateForm("orderId", e.target.value)} className={inputClass} placeholder="Order ID" />
            </FormField>
            <FormField label="Carrier">
              <input value={formData.carrier || ""} onChange={(e) => updateForm("carrier", e.target.value)} className={inputClass} placeholder="FedEx, DHL, UPS..." />
            </FormField>
            <FormField label="Tracking Number">
              <input value={formData.trackingNumber || ""} onChange={(e) => updateForm("trackingNumber", e.target.value)} className={inputClass} placeholder="1Z999AA10123456784" />
            </FormField>
            <FormField label="Status">
              <select value={formData.status || "PREPARING"} onChange={(e) => updateForm("status", e.target.value)} className={selectClass}>
                {["PREPARING", "PICKED_UP", "IN_TRANSIT", "CUSTOMS", "DELIVERED"].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Estimated Delivery">
              <input type="date" value={formData.estimatedDelivery || ""} onChange={(e) => updateForm("estimatedDelivery", e.target.value)} className={inputClass} />
            </FormField>
          </>
        )}

        {modalType === "customs" && (
          <>
            <FormField label="Type">
              <select value={formData.type || "EXPORT"} onChange={(e) => updateForm("type", e.target.value)} className={selectClass}>
                <option value="EXPORT">Export</option>
                <option value="IMPORT">Import</option>
              </select>
            </FormField>
            <FormField label="Description">
              <input value={formData.description || ""} onChange={(e) => updateForm("description", e.target.value)} className={inputClass} placeholder="Goods description" />
            </FormField>
            <FormField label="HS Code">
              <input value={formData.hsCode || ""} onChange={(e) => updateForm("hsCode", e.target.value)} className={inputClass} placeholder="8471.30" />
            </FormField>
            <FormField label="Declared Value (TTD)">
              <input type="number" value={formData.declaredValue || ""} onChange={(e) => updateForm("declaredValue", e.target.value)} className={inputClass} placeholder="1000.00" />
            </FormField>
            <FormField label="Duty Amount (TTD)">
              <input type="number" value={formData.dutyAmount || ""} onChange={(e) => updateForm("dutyAmount", e.target.value)} className={inputClass} placeholder="150.00" />
            </FormField>
            <FormField label="Status">
              <select value={formData.status || "DRAFT"} onChange={(e) => updateForm("status", e.target.value)} className={selectClass}>
                {["DRAFT", "FILED", "UNDER_REVIEW", "CLEARED", "REJECTED"].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </FormField>
          </>
        )}

        {modalType === "warehouse" && (
          <>
            <FormField label="Warehouse Name">
              <input value={formData.name || ""} onChange={(e) => updateForm("name", e.target.value)} className={inputClass} placeholder="Main Warehouse" />
            </FormField>
            <FormField label="Address">
              <input value={formData.address || ""} onChange={(e) => updateForm("address", e.target.value)} className={inputClass} placeholder="123 Industrial Dr" />
            </FormField>
            <FormField label="City">
              <input value={formData.city || ""} onChange={(e) => updateForm("city", e.target.value)} className={inputClass} placeholder="Port of Spain" />
            </FormField>
            <FormField label="Country">
              <input value={formData.country || ""} onChange={(e) => updateForm("country", e.target.value)} className={inputClass} placeholder="Trinidad & Tobago" />
            </FormField>
            <FormField label="Capacity">
              <input type="number" value={formData.capacity || ""} onChange={(e) => updateForm("capacity", e.target.value)} className={inputClass} placeholder="1000" />
            </FormField>
          </>
        )}

        {modalType === "inventory" && (
          <>
            <FormField label="Warehouse">
              <select value={formData.warehouseId || ""} onChange={(e) => updateForm("warehouseId", e.target.value)} className={selectClass}>
                <option value="">Select warehouse...</option>
                {warehouses.map((w: any) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Product">
              <select value={formData.productId || ""} onChange={(e) => updateForm("productId", e.target.value)} className={selectClass}>
                <option value="">Select product...</option>
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Quantity">
              <input type="number" value={formData.quantity || ""} onChange={(e) => updateForm("quantity", e.target.value)} className={inputClass} placeholder="100" />
            </FormField>
            <FormField label="Reorder Level">
              <input type="number" value={formData.reorderLevel || ""} onChange={(e) => updateForm("reorderLevel", e.target.value)} className={inputClass} placeholder="10" />
            </FormField>
          </>
        )}

        {modalType === "preorder" && (
          <>
            <FormField label="Product">
              <select value={formData.productId || ""} onChange={(e) => updateForm("productId", e.target.value)} className={selectClass}>
                <option value="">Select product...</option>
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Customer Name">
              <input value={formData.customerName || ""} onChange={(e) => updateForm("customerName", e.target.value)} className={inputClass} placeholder="Customer name" />
            </FormField>
            <FormField label="Customer Email">
              <input value={formData.customerEmail || ""} onChange={(e) => updateForm("customerEmail", e.target.value)} className={inputClass} placeholder="customer@email.com" />
            </FormField>
            <FormField label="Deposit Amount (TTD)">
              <input type="number" value={formData.depositAmount || ""} onChange={(e) => updateForm("depositAmount", e.target.value)} className={inputClass} placeholder="500.00" />
            </FormField>
            <FormField label="Expected Date">
              <input type="date" value={formData.expectedDate || ""} onChange={(e) => updateForm("expectedDate", e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="Status">
              <select value={formData.status || "PENDING"} onChange={(e) => updateForm("status", e.target.value)} className={selectClass}>
                {["PENDING", "CONFIRMED", "FULFILLED", "CANCELLED"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </FormField>
          </>
        )}

        {modalType === "purchase-order" && (
          <>
            <FormField label="Supplier Name">
              <input value={formData.supplierName || ""} onChange={(e) => updateForm("supplierName", e.target.value)} className={inputClass} placeholder="Supplier Co." />
            </FormField>
            <FormField label="Supplier Email">
              <input value={formData.supplierEmail || ""} onChange={(e) => updateForm("supplierEmail", e.target.value)} className={inputClass} placeholder="supplier@co.com" />
            </FormField>
            <FormField label="Product">
              <select value={formData.productId || ""} onChange={(e) => updateForm("productId", e.target.value)} className={selectClass}>
                <option value="">Select product...</option>
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Quantity">
              <input type="number" value={formData.quantity || ""} onChange={(e) => updateForm("quantity", e.target.value)} className={inputClass} placeholder="100" />
            </FormField>
            <FormField label="Unit Cost (TTD)">
              <input type="number" value={formData.unitCost || ""} onChange={(e) => updateForm("unitCost", e.target.value)} className={inputClass} placeholder="25.00" />
            </FormField>
            <FormField label="Expected Delivery">
              <input type="date" value={formData.expectedDelivery || ""} onChange={(e) => updateForm("expectedDelivery", e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="Status">
              <select value={formData.status || "DRAFT"} onChange={(e) => updateForm("status", e.target.value)} className={selectClass}>
                {["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </FormField>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {editingItem ? "Update" : "Create"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
