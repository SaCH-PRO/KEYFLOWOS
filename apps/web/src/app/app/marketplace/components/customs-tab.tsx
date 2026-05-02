"use client";

import { motion } from "framer-motion";
import { FileCheck, Hash, Pencil } from "lucide-react";
import { formatCurrency, StatusBadge, EmptyState, usePagination, PaginationBar } from "./marketplace-utils";
import type { CustomsDeclaration } from "@/lib/marketplace-types";

type CustomsDeclarationRow = CustomsDeclaration & {
  type?: string;
  description?: string;
};

export function CustomsTab({
  declarations,
  onEdit,
}: {
  declarations: CustomsDeclarationRow[];
  onEdit: (item: CustomsDeclarationRow) => void;
}) {
  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(declarations);
  if (declarations.length === 0) {
    return <EmptyState icon={FileCheck} title="No Customs Declarations" description="File customs declarations here for international import/export shipments." />;
  }
  return (
    <div className="space-y-3">
      {paginated.map((decl) => (
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
                <span>Declared: {formatCurrency(parseFloat(String(decl.declaredValue ?? 0)) || 0)}</span>
                {decl.dutyAmount && <span>Duty: {formatCurrency(parseFloat(String(decl.dutyAmount)) || 0)}</span>}
              </div>
            </div>
            <button onClick={() => onEdit(decl)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors flex-shrink-0">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      ))}
      <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
    </div>
  );
}
