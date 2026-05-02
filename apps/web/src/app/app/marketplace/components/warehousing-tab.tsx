"use client";

import { motion } from "framer-motion";
import { Warehouse, Building2, Pencil, Trash2, AlertCircle, Layers } from "lucide-react";
import { EmptyState } from "./marketplace-utils";

export function WarehousingTab({
  warehouses,
  inventory,
  onEdit,
  onDelete,
  onAddInventory,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  warehouses: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  inventory: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
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
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation */}
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
