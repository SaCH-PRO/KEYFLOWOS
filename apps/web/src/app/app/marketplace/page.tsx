"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Plus,
  Package,
  ShoppingCart,
  Truck,
  FileCheck,
  Warehouse,
  Clock,
  ClipboardList,
  X,
  DollarSign,
  TrendingUp,
  MapPin,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  CircleDot,
  ArrowRight,
  Hash,
  Weight,
  Calendar,
  User,
  Building2,
  Phone,
  Mail,
  Navigation,
  Layers,
  PackageCheck,
  PackageX,
  RefreshCw,
  Filter,
  Loader2,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { StatCards } from "@/components/ui/stat-cards";
import { FeatureGuide } from "@/components/ui/feature-guide";

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

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TTD`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function ReachBadge({ reach }: { reach: string }) {
  const colors: Record<string, string> = {
    LOCAL: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    REGIONAL: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    INTERNATIONAL: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${colors[reach] || "bg-white/10 text-white/60 border-white/20"}`}>
      {reach}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-emerald-500",
    PENDING: "bg-yellow-500",
    CONFIRMED: "bg-blue-500",
    PROCESSING: "bg-orange-500",
    SHIPPED: "bg-cyan-500",
    DELIVERED: "bg-emerald-500",
    CANCELLED: "bg-red-500",
    PREPARING: "bg-yellow-500",
    PICKED_UP: "bg-blue-500",
    IN_TRANSIT: "bg-cyan-500",
    CUSTOMS: "bg-purple-500",
    DRAFT: "bg-gray-500",
    FILED: "bg-blue-500",
    UNDER_REVIEW: "bg-yellow-500",
    CLEARED: "bg-emerald-500",
    REJECTED: "bg-red-500",
    FULFILLED: "bg-emerald-500",
    PARTIAL: "bg-orange-500",
    RECEIVED: "bg-emerald-500",
    ORDERED: "bg-blue-500",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`w-2 h-2 rounded-full ${colors[status] || "bg-gray-500"}`} />
      {status.replace(/_/g, " ")}
    </span>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-white/30" />
      </div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-xs">{description}</p>
    </div>
  );
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="relative bg-[#0a0a0f]/95 border border-white/10 rounded-2xl backdrop-blur-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-3">{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground font-medium">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/20";
const selectClass = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 transition-colors appearance-none";

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

  if (loading && !dashboard && activeTab === "dashboard") {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Globe className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
            Global Commerce
          </h1>
          <p className="text-sm text-muted-foreground">Loading marketplace data...</p>
        </div>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4 h-24 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

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

function DashboardTab({ data }: { data: any }) {
  const stats = data || {};
  return (
    <div className="space-y-6">
      <StatCards
        columns={3}
        items={[
          { label: "Active Listings", value: String(stats.activeListings ?? 0), sub: "In marketplace", icon: Package, color: "#22c55e" },
          { label: "Pending Orders", value: String(stats.pendingOrders ?? 0), sub: "Awaiting action", icon: ShoppingCart, color: "#f59e0b" },
          { label: "In-Transit", value: String(stats.inTransitShipments ?? 0), sub: "Shipments", icon: Truck, color: "#06b6d4" },
          { label: "Monthly Revenue", value: formatCurrency(stats.monthlyRevenue ?? 0), sub: "This month", icon: DollarSign, color: "#8b5cf6" },
          { label: "Pre-Orders", value: String(stats.preOrders ?? 0), sub: "Pending fulfillment", icon: Clock, color: "#f97316" },
          { label: "Warehouses", value: String(stats.warehouses ?? 0), sub: "Active locations", icon: Warehouse, color: "#ec4899" },
        ]}
      />

      {stats.marketReach && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-5"
        >
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Globe className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Market Reach Breakdown
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(["LOCAL", "REGIONAL", "INTERNATIONAL"] as const).map((reach) => {
              const count = stats.marketReach?.[reach] ?? 0;
              const colors: Record<string, { bg: string; border: string; text: string }> = {
                LOCAL: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400" },
                REGIONAL: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400" },
                INTERNATIONAL: { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-400" },
              };
              const c = colors[reach];
              return (
                <div key={reach} className={`${c.bg} border ${c.border} rounded-xl p-4 text-center`}>
                  <p className={`text-2xl font-bold ${c.text}`}>{count}</p>
                  <p className="text-xs text-muted-foreground mt-1">{reach} Listings</p>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {stats.recentOrders?.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden"
        >
          <div className="p-4 border-b border-white/10">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              Recent Orders
            </h3>
          </div>
          <div className="divide-y divide-white/5">
            {stats.recentOrders.slice(0, 5).map((order: any) => (
              <div key={order.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{order.customerName || "Customer"}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={order.status} />
                  <span className="text-sm font-semibold">{formatCurrency(order.total ?? 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {!stats.activeListings && !stats.pendingOrders && (
        <EmptyState
          icon={Globe}
          title="Welcome to Global Commerce"
          description="Start by listing your products in the Catalog tab to begin selling on the marketplace."
        />
      )}
    </div>
  );
}

function CatalogTab({ listings, onEdit, onDelete }: { listings: any[]; onEdit: (item: any) => void; onDelete: (id: string) => void }) {
  if (listings.length === 0) {
    return <EmptyState icon={Package} title="No Listings Yet" description="Create your first marketplace listing to start selling products globally." />;
  }
  return (
    <div className="space-y-3">
      {listings.map((listing) => (
        <motion.div
          key={listing.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                <Package className="w-5 h-5 text-white/40" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{listing.product?.name || listing.productName || "Product"}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <ReachBadge reach={listing.marketReach || "LOCAL"} />
                  {listing.countries && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {listing.countries}
                    </span>
                  )}
                  {listing.hsCode && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      HS: {listing.hsCode}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <StatusBadge status={listing.status || "ACTIVE"} />
              {listing.shippingEnabled && (
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  Shipping ✓
                </span>
              )}
              <button onClick={() => onEdit(listing)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onDelete(listing.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function OrdersTab({ orders, onStatusUpdate }: { orders: any[]; onStatusUpdate: (id: string, status: string) => void }) {
  const statuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];

  if (orders.length === 0) {
    return <EmptyState icon={ShoppingCart} title="No Orders Yet" description="Orders will appear here when customers purchase from your marketplace listings." />;
  }
  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <motion.div
          key={order.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{order.customerName || "Customer"}</p>
                <StatusBadge status={order.status || "PENDING"} />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                {order.customerEmail && (
                  <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{order.customerEmail}</span>
                )}
                {order.customerPhone && (
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{order.customerPhone}</span>
                )}
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(order.createdAt)}</span>
              </div>
              {order.shippingAddress && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Navigation className="w-3 h-3" />{order.shippingAddress}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <p className="text-lg font-bold">{formatCurrency(order.total ?? 0)}</p>
              <select
                value={order.status || "PENDING"}
                onChange={(e) => onStatusUpdate(order.id, e.target.value)}
                className="text-[10px] bg-white/5 border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:border-orange-500/50"
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function ShipmentsTab({ shipments, onEdit }: { shipments: any[]; onEdit: (item: any) => void }) {
  const timeline = ["PREPARING", "PICKED_UP", "IN_TRANSIT", "CUSTOMS", "DELIVERED"];

  if (shipments.length === 0) {
    return <EmptyState icon={Truck} title="No Shipments Yet" description="Shipments will be tracked here once you start fulfilling orders." />;
  }
  return (
    <div className="space-y-3">
      {shipments.map((shipment) => {
        const currentIdx = timeline.indexOf(shipment.status || "PREPARING");
        return (
          <motion.div
            key={shipment.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4 space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-cyan-400" />
                  <p className="text-sm font-semibold">{shipment.carrier || "Carrier"}</p>
                  <StatusBadge status={shipment.status || "PREPARING"} />
                </div>
                <p className="text-xs text-muted-foreground">Tracking: {shipment.trackingNumber || "—"}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {shipment.estimatedDelivery && (
                  <span className="text-xs text-muted-foreground">ETA: {formatDate(shipment.estimatedDelivery)}</span>
                )}
                <button onClick={() => onEdit(shipment)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {timeline.map((step, idx) => (
                <div key={step} className="flex items-center flex-1">
                  <div className={`w-full h-1.5 rounded-full ${idx <= currentIdx ? "bg-cyan-500" : "bg-white/10"}`} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground">
              {timeline.map((step) => (
                <span key={step}>{step.replace(/_/g, " ")}</span>
              ))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function CustomsTab({ declarations, onEdit }: { declarations: any[]; onEdit: (item: any) => void }) {
  if (declarations.length === 0) {
    return <EmptyState icon={FileCheck} title="No Customs Declarations" description="File customs declarations here for international import/export shipments." />;
  }
  return (
    <div className="space-y-3">
      {declarations.map((decl) => (
        <motion.div
          key={decl.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                  decl.type === "EXPORT" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                }`}>
                  {decl.type}
                </span>
                <p className="text-sm font-semibold">{decl.description || "Declaration"}</p>
                <StatusBadge status={decl.status || "DRAFT"} />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                {decl.hsCode && <span className="flex items-center gap-1"><Hash className="w-3 h-3" />HS: {decl.hsCode}</span>}
                <span>Declared: {formatCurrency(parseFloat(decl.declaredValue) || 0)}</span>
                {decl.dutyAmount && <span>Duty: {formatCurrency(parseFloat(decl.dutyAmount) || 0)}</span>}
              </div>
            </div>
            <button onClick={() => onEdit(decl)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors flex-shrink-0">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function WarehousingTab({
  warehouses,
  inventory,
  onEdit,
  onDelete,
  onAddInventory,
}: {
  warehouses: any[];
  inventory: any[];
  onEdit: (item: any) => void;
  onDelete: (id: string) => void;
  onAddInventory: () => void;
}) {
  if (warehouses.length === 0 && inventory.length === 0) {
    return <EmptyState icon={Warehouse} title="No Warehouses Yet" description="Add warehouse locations to manage your inventory and stock levels." />;
  }
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {warehouses.map((wh) => {
          const whInventory = inventory.filter((inv: any) => inv.warehouseId === wh.id);
          return (
            <motion.div
              key={wh.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden"
            >
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-white/40" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{wh.name}</p>
                    <p className="text-xs text-muted-foreground">{[wh.address, wh.city, wh.country].filter(Boolean).join(", ")}</p>
                    {wh.capacity && <p className="text-xs text-muted-foreground">Capacity: {wh.capacity}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => onEdit(wh)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onDelete(wh.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {whInventory.length > 0 && (
                <div className="border-t border-white/5">
                  <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Inventory</div>
                  <div className="divide-y divide-white/5">
                    {whInventory.map((inv: any) => {
                      const isLow = inv.reorderLevel && inv.quantity <= inv.reorderLevel;
                      return (
                        <div key={inv.id} className="px-4 py-2 flex items-center justify-between">
                          <span className="text-xs">{inv.product?.name || inv.productName || "Product"}</span>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-medium ${isLow ? "text-red-400" : ""}`}>
                              {inv.quantity} units
                            </span>
                            {isLow && (
                              <span className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />Reorder
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <button
        onClick={onAddInventory}
        className="w-full py-3 border border-dashed border-white/20 rounded-2xl text-sm text-muted-foreground hover:text-white hover:border-white/40 transition-colors flex items-center justify-center gap-2"
      >
        <Layers className="w-4 h-4" />
        Add Inventory
      </button>
    </div>
  );
}

function PreOrdersTab({ preOrders, onEdit }: { preOrders: any[]; onEdit: (item: any) => void }) {
  if (preOrders.length === 0) {
    return <EmptyState icon={Clock} title="No Pre-Orders" description="Manage pre-orders with deposit tracking and expected delivery dates." />;
  }
  return (
    <div className="space-y-3">
      {preOrders.map((po) => (
        <motion.div
          key={po.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{po.product?.name || po.productName || "Product"}</p>
                <StatusBadge status={po.status || "PENDING"} />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                {po.customerName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{po.customerName}</span>}
                {po.customerEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{po.customerEmail}</span>}
                {po.expectedDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Expected: {formatDate(po.expectedDate)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {po.depositAmount && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Deposit</p>
                  <p className="text-sm font-semibold">{formatCurrency(parseFloat(po.depositAmount) || 0)}</p>
                </div>
              )}
              <button onClick={() => onEdit(po)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function PurchaseOrdersTab({ purchaseOrders, onEdit }: { purchaseOrders: any[]; onEdit: (item: any) => void }) {
  if (purchaseOrders.length === 0) {
    return <EmptyState icon={ClipboardList} title="No Purchase Orders" description="Create purchase orders to track supplier orders, deliveries, and costs." />;
  }
  return (
    <div className="space-y-3">
      {purchaseOrders.map((po) => (
        <motion.div
          key={po.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{po.supplierName || "Supplier"}</p>
                <StatusBadge status={po.status || "DRAFT"} />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                {po.supplierEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{po.supplierEmail}</span>}
                {po.expectedDelivery && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Delivery: {formatDate(po.expectedDelivery)}</span>}
                {po.quantity && <span>{po.quantity} units</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {po.unitCost && po.quantity && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-sm font-semibold">{formatCurrency((parseFloat(po.unitCost) || 0) * (parseInt(po.quantity) || 0))}</p>
                </div>
              )}
              <button onClick={() => onEdit(po)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
