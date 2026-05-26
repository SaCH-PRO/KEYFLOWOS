"use client";

import { Package } from "lucide-react";
import { InfoBadge } from "@/components/ui/info-badge";
import { formatAmount } from "../../utils/commerce-utils";

interface LineItem {
  id?: string;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  total?: number | null;
  productId?: string | null;
}

interface DetailLineItemsProps {
  items: LineItem[];
  currency: string;
  accentColor: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  discountType: string | null | undefined;
  discountValue: number | null | undefined;
  total: number;
  onSelectProduct?: (id: string) => void;
  showBreakdown?: boolean;
  compact?: boolean;
}

export function DetailLineItems({
  items,
  currency,
  accentColor,
  subtotal,
  taxRate,
  taxAmount,
  discountAmount,
  discountType,
  discountValue,
  total,
  onSelectProduct,
  showBreakdown = true,
  compact,
}: DetailLineItemsProps) {
  if (items.length === 0) return null;

  const py = compact ? "py-2.5" : "py-3";
  const headerPy = compact ? "py-2.5" : "py-3";
  const iconSize = compact ? "w-3.5 h-3.5" : "w-4 h-4";
  const headerText = compact ? "text-[10px]" : "text-xs";
  const totalSize = compact ? "text-base" : "text-lg";
  const metaSize = compact ? "text-[10px]" : "text-xs";

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-border/40 overflow-hidden">
      <div className={`flex items-center gap-2 px-4 ${headerPy} border-b border-border/30`}>
        <Package className={iconSize} style={{ color: accentColor, opacity: 0.85 }} />
        <h4 className={`${headerText} font-semibold uppercase tracking-wider text-muted-foreground`}>Line Items</h4>
      </div>
      <div className="divide-y divide-border/20">
        {items.map((item, idx) => (
          <div
            key={item.id ?? idx}
            className={`px-4 ${py} flex ${compact ? "items-center" : "items-start"} justify-between gap-3 hover:bg-white/[0.02] transition-colors`}
          >
            <div className="flex-1 min-w-0">
              {item.productId && onSelectProduct ? (
                <button
                  onClick={() => onSelectProduct(item.productId!)}
                  className="text-sm font-medium truncate text-[hsl(var(--kf-accent1))] hover:underline underline-offset-2 text-left block max-w-full"
                  title="View product details"
                >
                  {item.description || "Unnamed item"}
                </button>
              ) : (
                <p className="text-sm font-medium truncate">{item.description || "Unnamed item"}</p>
              )}
              <p className={`${metaSize} text-muted-foreground mt-0.5`}>
                {item.quantity} x {formatAmount(item.unitPrice ?? 0, currency)}
              </p>
            </div>
            <p className="text-sm font-semibold shrink-0">{formatAmount(item.total ?? 0, currency)}</p>
          </div>
        ))}
      </div>

      {showBreakdown ? (
        <div className="border-t border-border/30 px-4 py-3 space-y-2 bg-white/[0.02]">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatAmount(subtotal, currency)}</span>
          </div>
          {(taxRate || 0) > 0 && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                Tax ({taxRate}%)
                <InfoBadge title="Tax Calculation" body="Tax is applied to the subtotal after any discounts. The rate is set per invoice or in Settings > Payments. Trinidad default: 12.5% VAT." side="left" iconSize={10} />
              </span>
              <span>{formatAmount(taxAmount, currency)}</span>
            </div>
          )}
          {discountAmount > 0 && (
            <div className="flex justify-between text-xs text-emerald-400">
              <span>Discount {discountType === "PERCENT" ? `(${discountValue}%)` : ""}</span>
              <span>-{formatAmount(discountAmount, currency)}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-border/30">
            <span className="text-sm font-bold">Total</span>
            <span className={`${totalSize} font-extrabold`} style={{ color: accentColor }}>
              {formatAmount(total, currency)}
            </span>
          </div>
        </div>
      ) : (
        <div className="border-t border-border/30 px-4 py-2.5 bg-white/[0.02]">
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold">Total</span>
            <span className={`${totalSize} font-extrabold`} style={{ color: accentColor }}>
              {formatAmount(total, currency)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
