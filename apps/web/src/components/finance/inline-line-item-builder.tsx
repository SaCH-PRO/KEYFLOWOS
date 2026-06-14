"use client";

import { useCallback, useMemo } from "react";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface LineItem {
  id: string;
  accountId?: string;
  accountName?: string;
  productId?: string;
  productName?: string;
  description: string;
  quantity?: number;
  unitPrice?: number;
  debit?: number;
  credit?: number;
  memo?: string;
}

interface InlineLineItemBuilderProps {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  mode: "journal" | "product";
  accounts?: Array<{ id: string; name: string; code?: string | null }>;
  products?: Array<{ id: string; name: string; sku?: string | null; stock?: number }>;
  currency?: string;
  errors?: Record<string, string>;
  disabled?: boolean;
}

export function InlineLineItemBuilder({
  items,
  onChange,
  mode,
  accounts = [],
  products = [],
  currency = "TTD",
  errors = {},
  disabled = false,
}: InlineLineItemBuilderProps) {
  const generateId = () => `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const addRow = useCallback(() => {
    onChange([
      ...items,
      {
        id: generateId(),
        description: "",
        quantity: mode === "product" ? 1 : undefined,
        unitPrice: mode === "product" ? 0 : undefined,
        debit: mode === "journal" ? 0 : undefined,
        credit: mode === "journal" ? 0 : undefined,
        memo: "",
      },
    ]);
  }, [items, onChange, mode]);

  const removeRow = useCallback(
    (id: string) => {
      onChange(items.filter((item) => item.id !== id));
    },
    [items, onChange]
  );

  const updateRow = useCallback(
    (id: string, patch: Partial<LineItem>) => {
      onChange(
        items.map((item) => {
          if (item.id !== id) return item;
          const next = { ...item, ...patch };
          if (mode === "product") {
            const qty = Number(next.quantity ?? 0);
            const price = Number(next.unitPrice ?? 0);
            next.debit = qty * price;
          }
          return next;
        })
      );
    },
    [items, onChange, mode]
  );

  const { journalTotals, productTotal } = useMemo(() => {
    if (mode === "journal") {
      const debit = items.reduce((sum, i) => sum + (Number(i.debit) || 0), 0);
      const credit = items.reduce((sum, i) => sum + (Number(i.credit) || 0), 0);
      return { journalTotals: { debit, credit, balanced: Math.abs(debit - credit) < 0.001 }, productTotal: undefined };
    }
    const total = items.reduce((sum, i) => sum + (Number(i.debit) || 0), 0);
    return { journalTotals: undefined, productTotal: total };
  }, [items, mode]);

  const fmt = (n: number) =>
    `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              {mode === "journal" ? (
                <>
                  <th className="px-3 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-left font-medium w-32">Debit</th>
                  <th className="px-3 py-2 text-left font-medium w-32">Credit</th>
                  <th className="px-3 py-2 text-left font-medium">Memo</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">Description</th>
                  <th className="px-3 py-2 text-left font-medium w-24">Qty</th>
                  <th className="px-3 py-2 text-left font-medium w-32">Unit Price</th>
                  <th className="px-3 py-2 text-left font-medium w-32">Amount</th>
                </>
              )}
              <th className="px-3 py-2 text-right font-medium w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {items.map((item, idx) => (
              <tr key={item.id} className="group hover:bg-muted/20">
                {mode === "journal" ? (
                  <>
                    <td className="px-3 py-2">
                      <select
                        value={item.accountId ?? ""}
                        onChange={(e) => {
                          const account = accounts.find((a) => a.id === e.target.value);
                          updateRow(item.id, {
                            accountId: e.target.value,
                            accountName: account?.name,
                          });
                        }}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">Select account</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code ? `${account.code} — ` : ""}
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.debit ?? ""}
                        onChange={(e) => updateRow(item.id, { debit: parseFloat(e.target.value) || 0 })}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.credit ?? ""}
                        onChange={(e) => updateRow(item.id, { credit: parseFloat(e.target.value) || 0 })}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={item.memo ?? ""}
                        onChange={(e) => updateRow(item.id, { memo: e.target.value })}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="Memo"
                      />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2">
                      <select
                        value={item.productId ?? ""}
                        onChange={(e) => {
                          const product = products.find((p) => p.id === e.target.value);
                          updateRow(item.id, {
                            productId: e.target.value,
                            productName: product?.name,
                            description: product?.name ?? item.description,
                          });
                        }}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">Select product</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.sku ? `${product.sku} — ` : ""}
                            {product.name}
                            {product.stock != null ? ` (${product.stock})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateRow(item.id, { description: e.target.value })}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="Description"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={item.quantity ?? ""}
                        onChange={(e) => updateRow(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.unitPrice ?? ""}
                        onChange={(e) => updateRow(item.id, { unitPrice: parseFloat(e.target.value) || 0 })}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-sm font-medium tabular-nums">
                        {fmt(Number(item.debit) || 0)}
                      </span>
                    </td>
                  </>
                )}
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(item.id)}
                    disabled={disabled || items.length <= 1}
                    className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                    aria-label="Remove row"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No line items. Add one to get started.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={disabled}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add line
        </Button>

        {mode === "journal" && journalTotals ? (
          <div className="flex items-center gap-4 text-sm">
            <span className="tabular-nums">
              Debit: <strong>{fmt(journalTotals.debit)}</strong>
            </span>
            <span className="tabular-nums">
              Credit: <strong>{fmt(journalTotals.credit)}</strong>
            </span>
            {!journalTotals.balanced && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-500/10 px-2 py-1 rounded-md">
                <AlertCircle className="w-3.5 h-3.5" />
                Out of balance: {fmt(Math.abs(journalTotals.debit - journalTotals.credit))}
              </span>
            )}
            {journalTotals.balanced && items.length > 0 && (
              <span className="text-xs text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-md">Balanced</span>
            )}
          </div>
        ) : (
          <div className="text-sm tabular-nums">
            Total: <strong>{fmt(productTotal ?? 0)}</strong>
          </div>
        )}
      </div>

      {Object.keys(errors).length > 0 && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          <ul className="space-y-1">
            {Object.entries(errors).map(([key, msg]) => (
              <li key={key} className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                {msg}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
