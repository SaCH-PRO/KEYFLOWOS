"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Palette, X } from "lucide-react";
import { toast } from "sonner";
import { ExpenseCategory, createExpenseCategory, deleteExpenseCategory } from "@/lib/client";
import { CATEGORY_COLORS } from "./expense-utils";

interface ExpenseCategoriesTabProps {
  businessId: string;
  categories: ExpenseCategory[];
  setCategories: React.Dispatch<React.SetStateAction<ExpenseCategory[]>>;
}

export function ExpenseCategoriesTab({ businessId, categories, setCategories }: ExpenseCategoriesTabProps) {
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[0]);

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      const res = await createExpenseCategory(businessId, { name: newCatName.trim(), color: newCatColor });
      if (res.data) setCategories(prev => [...prev, res.data!]);
      setNewCatName(""); setNewCatColor(CATEGORY_COLORS[0]);
      toast.success("Category created");
    } catch (err) { toast.error("Failed to create category"); }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    try { await deleteExpenseCategory(businessId, categoryId); setCategories(prev => prev.filter(c => c.id !== categoryId)); toast.success("Category deleted"); } catch (err) { toast.error("Failed to delete category"); }
  };

  return (
    <motion.div key="categories" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
      <div className="kf-card rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Palette className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />Expense Categories</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input placeholder="Category name..." value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddCategory()} className="flex-1 min-w-[140px] bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
          <div className="flex items-center gap-1">
            {CATEGORY_COLORS.map(c => (
              <button key={c} onClick={() => setNewCatColor(c)} className="w-5 h-5 rounded-full transition-transform" style={{ background: c, transform: newCatColor === c ? "scale(1.3)" : "scale(1)", boxShadow: newCatColor === c ? `0 0 0 2px ${c}40` : "none" }} />
            ))}
          </div>
          <button onClick={handleAddCategory} disabled={!newCatName.trim()} className="kf-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"><Plus className="w-4 h-4" /></button>
        </div>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 group">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ background: cat.color || "#6366f1" }} /><span className="text-sm">{cat.name}</span>{cat._count && <span className="text-xs text-muted-foreground">({cat._count.expenses})</span>}</div>
              <button onClick={() => handleDeleteCategory(cat.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          {categories.length === 0 && <p className="text-xs text-muted-foreground col-span-full">No categories yet. Add one above.</p>}
        </div>
      </div>
    </motion.div>
  );
}
