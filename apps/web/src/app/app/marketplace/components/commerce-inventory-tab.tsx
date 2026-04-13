"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Warehouse,
  Building2,
  Pencil,
  Trash2,
  AlertCircle,
  Layers,
  Plus,
  TrendingDown,
  Archive,
} from "lucide-react";
import { EmptyState, usePagination, PaginationBar } from "./marketplace-utils";

type InventoryMode = "warehouses" | "stock";

function InventoryModeTag({ quantity, reorderLevel }: { quantity: number; reorderLevel?: number }) {
  if (!reorderLevel) return null;
  if (quantity === 0) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
        <Archive className="w-3 h-3" /> Out of Stock
      </span>
    );
  }
  if (quantity <= reorderLevel) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
        <TrendingDown className="w-3 h-3" /> Low Stock
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
      In Stock
    </span>
  );
}

export function CommerceInventoryTab({
  warehouses,
  inventory,
  products,
  onEditWarehouse,
  onDeleteWarehouse,
  onAddInventory,
  onCreateWarehouse,
}: {
  warehouses: any[];
  inventory: any[];
  products: any[];
  onEditWarehouse: (item: any) => void;
  onDeleteWarehouse: (id: string) => void;
  onAddInventory: () => void;
  onCreateWarehouse: () => void;
}) {
  const [mode, setMode] = useState<InventoryMode>("warehouses");

  const reorderAlerts = inventory.filter(
    (inv) => inv.reorderLevel && inv.quantity <= inv.reorderLevel
  );

  const productsById: Record<string, any> = {};
  for (const p of products) productsById[p.id] = p;

  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(inventory, 20);

  if (warehouses.length === 0 && inventory.length === 0) {
    return (
      <div className="space-y-4">
        <button
          onClick={onCreateWarehouse}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Warehouse
        </button>
        <EmptyState
          icon={Warehouse}
          title="No Warehouses Yet"
          description="Add warehouse locations to manage your inventory and track stock levels."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reorderAlerts.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="font-medium">{reorderAlerts.length} product{reorderAlerts.length !== 1 ? "s" : ""} need reorder attention</span>
        </div>
      )}

      <div className="flex items-center gap-1">
        {(["warehouses", "stock"] as InventoryMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors capitalize ${
              mode === m
                ? "bg-orange-500/15 text-orange-400 border border-orange-500/25"
                : "text-muted-foreground hover:text-white hover:bg-white/5"
            }`}
          >
            {m === "warehouses" ? <Building2 className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}
            {m === "warehouses" ? "Warehouses" : "Stock Records"}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onCreateWarehouse}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Warehouse
          </button>
          <button
            onClick={onAddInventory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Stock Record
          </button>
        </div>
      </div>

      {mode === "warehouses" && (
        <div className="space-y-3">
          {warehouses.map((wh) => {
            const whInventory = inventory.filter((inv: any) => inv.warehouseId === wh.id);
            const totalUnits = whInventory.reduce((sum: number, inv: any) => sum + (inv.quantity || 0), 0);

            return (
              <motion.div
                key={wh.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
              >
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-white/40" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{wh.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[wh.address, wh.city, wh.country].filter(Boolean).join(", ")}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                        <span>{whInventory.length} SKUs</span>
                        <span>{totalUnits.toLocaleString()} units total</span>
                        {wh.capacity && <span>Cap: {wh.capacity}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onEditWarehouse(wh)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDeleteWarehouse(wh.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {whInventory.length > 0 && (
                  <div className="border-t border-white/5">
                    <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Inventory
                    </div>
                    <div className="divide-y divide-white/5">
                      {whInventory.map((inv: any) => {
                        const product = productsById[inv.productId];
                        const isLow = inv.reorderLevel && inv.quantity <= inv.reorderLevel;
                        return (
                          <div key={inv.id} className="px-4 py-2.5 flex items-center justify-between">
                            <span className="text-xs">{product?.name || inv.product?.name || "Product"}</span>
                            <div className="flex items-center gap-3">
                              {inv.reserved > 0 && (
                                <span className="text-[10px] text-muted-foreground">{inv.reserved} reserved</span>
                              )}
                              <span className={`text-sm font-semibold ${isLow ? "text-amber-400" : ""}`}>
                                {(inv.quantity || 0).toLocaleString()} units
                              </span>
                              <InventoryModeTag quantity={inv.quantity || 0} reorderLevel={inv.reorderLevel} />
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
      )}

      {mode === "stock" && (
        <div className="space-y-2">
          {inventory.length === 0 ? (
            <EmptyState icon={Layers} title="No Stock Records" description="Add stock records to track inventory levels across warehouses." />
          ) : (
            <>
              <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                <div className="grid grid-cols-5 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-white/5">
                  <span className="col-span-2">Product</span>
                  <span>Warehouse</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Status</span>
                </div>
                <div className="divide-y divide-white/5">
                  {paginated.map((inv: any) => {
                    const product = productsById[inv.productId];
                    const warehouse = warehouses.find((w) => w.id === inv.warehouseId);
                    const isLow = inv.reorderLevel && inv.quantity <= inv.reorderLevel;
                    return (
                      <div key={inv.id} className="grid grid-cols-5 px-4 py-3 items-center">
                        <div className="col-span-2">
                          <p className="text-xs font-medium">{product?.name || inv.product?.name || "Product"}</p>
                          {inv.reorderLevel && (
                            <p className="text-[10px] text-muted-foreground">Reorder at {inv.reorderLevel}</p>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{warehouse?.name || "—"}</p>
                        <div className="text-right">
                          <p className={`text-sm font-semibold ${isLow ? "text-amber-400" : ""}`}>
                            {(inv.quantity || 0).toLocaleString()}
                          </p>
                          {inv.reserved > 0 && (
                            <p className="text-[10px] text-muted-foreground">{inv.reserved} rsv</p>
                          )}
                        </div>
                        <div className="flex justify-end">
                          <InventoryModeTag quantity={inv.quantity || 0} reorderLevel={inv.reorderLevel} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
