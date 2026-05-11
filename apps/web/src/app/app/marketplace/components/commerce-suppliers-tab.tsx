// @keyflow:dormant
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Plus,
  Pencil,
  Mail,
  Globe,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Package,
  Link2,
} from "lucide-react";
import { formatDate, EmptyState } from "./marketplace-utils";
import type { PurchaseOrderDto, ProductDto } from "@/lib/types/marketplace";

type SupplierSection = "connections" | "catalog" | "mapping";

type PurchaseOrderExt = PurchaseOrderDto & {
  supplierEmail?: string | null;
  quantity?: number | string;
  updatedAt?: string;
};

function SupplierHealthBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; border: string; icon: React.ElementType }> = {
    ACTIVE: { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: CheckCircle2 },
    SYNCING: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", icon: RefreshCw },
    ERROR: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", icon: AlertCircle },
    INACTIVE: { color: "text-muted-foreground", bg: "bg-muted/10", border: "border-border/30", icon: AlertCircle },
  };
  const s = map[status] ?? map["INACTIVE"];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${s.bg} ${s.color} border ${s.border}`}>
      <Icon className="w-2.5 h-2.5" />
      {status}
    </span>
  );
}

export function CommerceSuppliersTab({
  purchaseOrders,
  products,
  onCreatePO,
  onEditPO,
}: {
  purchaseOrders: PurchaseOrderExt[];
  products: ProductDto[];
  onCreatePO: () => void;
  onEditPO: (item: PurchaseOrderExt) => void;
}) {
  const [section, setSection] = useState<SupplierSection>("connections");

  const supplierMap: Record<string, { name: string; email?: string | null; pos: PurchaseOrderExt[] }> = {};
  for (const po of purchaseOrders) {
    const key = po.supplierName || "Unknown Supplier";
    if (!supplierMap[key]) supplierMap[key] = { name: key, email: po.supplierEmail, pos: [] };
    supplierMap[key].pos.push(po);
  }
  const suppliers = Object.values(supplierMap);

  const sectionTabs: { key: SupplierSection; label: string; icon: React.ElementType }[] = [
    { key: "connections", label: "Connections", icon: Users },
    { key: "catalog", label: "Catalog Imports", icon: Package },
    { key: "mapping", label: "Product Mapping", icon: Link2 },
  ];

  const productsWithSource = products.filter((p) => p.supplierName || p.sourceUrl);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        {sectionTabs.map((t) => {
          const Icon = t.icon;
          const isActive = section === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                isActive
                  ? "bg-orange-500/15 text-orange-400 border border-orange-500/25"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
        <div className="ml-auto">
          <button
            onClick={onCreatePO}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New PO
          </button>
        </div>
      </div>

      {section === "connections" && (
        <div className="space-y-3">
          {suppliers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No Supplier Connections"
              description="Create purchase orders to establish supplier connections and track health status."
            />
          ) : (
            suppliers.map((supplier) => {
              const activePOs = supplier.pos.filter((p) => !["CANCELLED", "RECEIVED"].includes(p.status || ""));
              const lastSync = supplier.pos[0]?.updatedAt || supplier.pos[0]?.createdAt;
              const health = activePOs.length > 0 ? "ACTIVE" : "INACTIVE";

              return (
                <motion.div
                  key={supplier.name}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white/5 border border-white/10 rounded-2xl p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-sm font-bold text-muted-foreground">
                        {supplier.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{supplier.name}</p>
                          <SupplierHealthBadge status={health} />
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                          {supplier.email && (
                            <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{supplier.email}</span>
                          )}
                          <span>{supplier.pos.length} PO{supplier.pos.length !== 1 ? "s" : ""}</span>
                          {lastSync && <span>Last activity: {formatDate(lastSync)}</span>}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => onEditPO(supplier.pos[0])}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {activePOs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Active Orders</p>
                      <div className="flex flex-wrap gap-1.5">
                        {activePOs.slice(0, 4).map((po) => (
                          <span
                            key={po.id}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20"
                          >
                            {po.status} — {po.quantity ?? "?"} units
                          </span>
                        ))}
                        {activePOs.length > 4 && (
                          <span className="text-[10px] text-muted-foreground">+{activePOs.length - 4} more</span>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      )}

      {section === "catalog" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px]">
            <Globe className="w-4 h-4 shrink-0" />
            <span>Supplier catalog imports will appear here when external supplier connectors are configured. This feature is coming in a future release.</span>
          </div>
          {purchaseOrders.slice(0, 3).map((po) => (
            <motion.div
              key={po.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 border border-white/10 rounded-2xl p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{po.supplierName || "Supplier"}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {po.quantity ?? "?"} units · {po.status}
                  </p>
                </div>
                <button
                  onClick={() => onEditPO(po)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          ))}
          {purchaseOrders.length === 0 && (
            <EmptyState
              icon={Package}
              title="No Catalog Imports"
              description="Once supplier connectors are configured, imported product catalogs will appear here."
            />
          )}
        </div>
      )}

      {section === "mapping" && (
        <div className="space-y-3">
          {productsWithSource.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="No Supplier Mappings"
              description="Link products to suppliers by setting a supplier name or source URL in the product editor."
            />
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="grid grid-cols-3 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-white/5">
                <span>Product</span>
                <span>Supplier</span>
                <span>Source</span>
              </div>
              <div className="divide-y divide-white/5">
                {productsWithSource.map((product) => (
                  <div key={product.id} className="grid grid-cols-3 px-4 py-3 items-center gap-2">
                    <p className="text-xs font-medium truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{String(product.supplierName ?? "—")}</p>
                    <div>
                      {product.sourceUrl ? (
                        <a
                          href={String(product.sourceUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-400 hover:underline flex items-center gap-1"
                        >
                          <Link2 className="w-3 h-3" /> View source
                        </a>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/50">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}