"use client";

import { useState, useEffect } from "react";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import {
  ShoppingCart,
  X,
  Plus,
  Minus,
  Trash2,
  ArrowRight,
  AlertTriangle,
  Package,
  ShieldCheck,
  Tag,
  Loader2,
  ShoppingBag,
  Lock,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { CartItem, PromoCode } from "./types";
import { typeBadge, calculateDiscount } from "./utils";
import Image from "next/image";

type Props = {
  cart: CartItem[];
  cartOpen: boolean;
  cartCount: number;
  cartTotal: number;
  cartCurrency: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  promoCode: PromoCode | null;
  slug: string;
  taxRate?: number;
  onClose: () => void;
  onOpen: () => void;
  onUpdateQuantity: (itemId: string, itemType: string, delta: number) => void;
  onRemoveFromCart: (itemId: string, itemType: string) => void;
  onCheckout: () => void;
  onApplyPromo: (code: string) => Promise<{ success: boolean; error?: string }>;
  onRemovePromo: () => void;
};

export function CartDrawer({
  cart,
  cartOpen,
  cartCount,
  cartTotal,
  cartCurrency,
  primaryColor,
  secondaryColor,
  accentColor,
  promoCode,
  slug: _slug,
  taxRate,
  onClose,
  onOpen,
  onUpdateQuantity,
  onRemoveFromCart,
  onCheckout,
  onApplyPromo,
  onRemovePromo,
}: Props) {
  const [fabPulse, setFabPulse] = useState(false);
  const [removingItem, setRemovingItem] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  useEffect(() => {
    if (cartCount > 0) {
      setFabPulse(true);
      const t = setTimeout(() => setFabPulse(false), 600);
      return () => clearTimeout(t);
    }
  }, [cartCount]);

  useScrollLock(cartOpen);

  const handleRemove = (itemId: string, itemType: string) => {
    setRemovingItem(`${itemId}_${itemType}`);
    setTimeout(() => {
      onRemoveFromCart(itemId, itemType);
      setRemovingItem(null);
    }, 250);
  };

  const handleApplyPromo = async () => {
    if (!promoInput.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    const result = await onApplyPromo(promoInput.trim());
    if (!result.success) {
      setPromoError(result.error || "Invalid promo code");
    } else {
      setPromoInput("");
    }
    setPromoLoading(false);
  };

  const hasBookingItems = cart.some((c) => c.requiresBooking);
  const hasPhysicalItems = cart.some((c) => c.itemType === "product");
  const discount = calculateDiscount(cartTotal, promoCode);
  const effectiveTaxRate = taxRate ?? 0;
  const estimatedTax = effectiveTaxRate > 0 ? Math.round(cartTotal * (effectiveTaxRate / 100) * 100) / 100 : 0;
  const shippingEstimate = 0;
  const orderTotal = cartTotal - discount + estimatedTax + shippingEstimate;

  const serviceItems = cart.filter((c) => c.itemType === "service");
  const productItems = cart.filter((c) => c.itemType !== "service");

  return (
    <>
      {cartCount > 0 && (
        <button
          onClick={onOpen}
          className="fixed bottom-6 right-6 group"
          style={{ zIndex: "var(--kf-z-fab)" }}
          aria-label={`Open cart with ${cartCount} items`}
        >
          <span
            className="absolute inset-0 rounded-full opacity-30 blur-xl transition-all duration-500"
            style={{
              backgroundColor: primaryColor,
              transform: fabPulse ? "scale(1.8)" : "scale(1)",
            }}
          />
          <span
            className="relative w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-active:scale-95"
            style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}50` }}
          >
            <ShoppingCart className="w-6 h-6 text-foreground transition-transform duration-300 group-hover:rotate-[-8deg]" />
          </span>
          <span
            className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-background text-xs font-bold flex items-center justify-center shadow-lg transition-transform duration-300"
            style={{
              color: primaryColor,
              transform: fabPulse ? "scale(1.3)" : "scale(1)",
            }}
          >
            {cartCount}
          </span>
        </button>
      )}

      {cartOpen && (
        <div className="fixed inset-0 flex items-end sm:items-stretch sm:justify-end" role="dialog" aria-label="Shopping cart" aria-modal="true" style={{ zIndex: "var(--kf-z-drawer)" }}>
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity duration-300"
            onClick={onClose}
            role="button"
            aria-label="Close cart"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClose(); }}
            style={{ animation: "fadeIn 200ms ease-out" }}
          />

          <div
            className="relative w-full sm:w-[420px] max-h-[90vh] sm:max-h-full flex flex-col rounded-t-3xl sm:rounded-t-none overflow-hidden"
            style={{
              background: "linear-gradient(180deg, hsl(var(--background, 0 0% 100%)) 0%, hsl(var(--muted, 0 0% 97%)) 100%)",
              borderTop: "1px solid hsl(var(--border, 0 0% 90%))",
              borderLeft: "none",
              animation: "slideUp 300ms cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none opacity-30"
              style={{
                background: `radial-gradient(ellipse at top right, ${primaryColor}15 0%, transparent 60%)`,
              }}
            />

            <div className="relative flex items-center justify-between p-5 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <ShoppingCart className="w-4.5 h-4.5" style={{ color: primaryColor }} />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-foreground">Your Cart</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {cartCount} {cartCount === 1 ? "item" : "items"}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-xl bg-muted hover:bg-muted/80 flex items-center justify-center transition-all duration-200 hover:rotate-90"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="relative flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}10` }}
                >
                  <ShoppingBag className="w-8 h-8" style={{ color: primaryColor, opacity: 0.5 }} />
                </div>
                <div>
                  <h4 className="text-base font-medium text-foreground/70">Your cart is empty</h4>
                  <p className="text-xs text-muted-foreground mt-1">Browse our products and services to get started</p>
                </div>
                <button
                  onClick={onClose}
                  className="px-6 py-3 rounded-xl text-sm font-medium text-foreground transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] min-h-[44px]"
                  style={{ backgroundColor: primaryColor }}
                >
                  Browse Products
                </button>
              </div>
            ) : (
              <>
                <div className="relative flex-1 overflow-y-auto p-4 space-y-2.5" style={{ scrollbarWidth: "thin" }}>
                  {serviceItems.length > 0 && productItems.length > 0 && (
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium px-1 pt-1">
                      Services
                    </div>
                  )}
                  {serviceItems.map((item, idx) => renderCartItem(item, idx))}

                  {serviceItems.length > 0 && productItems.length > 0 && (
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium px-1 pt-2">
                      Products
                    </div>
                  )}
                  {productItems.map((item, idx) => renderCartItem(item, idx + serviceItems.length))}
                </div>

                <div
                  className="relative border-t border-border/50 p-5 space-y-4"
                  style={{
                    background: "linear-gradient(180deg, hsl(var(--border) / 0.05) 0%, transparent 100%)",
                  }}
                >
                  {hasBookingItems && (
                    <div className="flex items-center gap-2 text-[11px] text-amber-400/70 bg-amber-400/[0.06] rounded-lg px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>Some items require booking a time slot at checkout</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    {promoCode ? (
                      <div
                        className="flex items-center justify-between rounded-xl px-3 py-2.5"
                        style={{ backgroundColor: `${primaryColor}08`, border: `1px solid ${primaryColor}20` }}
                      >
                        <div className="flex items-center gap-2">
                          <Tag className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                          <div>
                            <span className="text-xs font-medium" style={{ color: primaryColor }}>
                              {promoCode.code}
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-2">
                              {promoCode.discountType === "percentage"
                                ? `${promoCode.discountValue}% off`
                                : `${formatPrice(promoCode.discountValue, cartCurrency)} off`}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={onRemovePromo}
                          className="text-[10px] text-muted-foreground hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-muted/50"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={promoInput}
                          onChange={(e) => {
                            setPromoInput(e.target.value.toUpperCase());
                            setPromoError(null);
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") handleApplyPromo(); }}
                          placeholder="Promo code"
                          className="flex-1 rounded-xl border border-border/50 bg-background/50 px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none transition-all duration-200"
                          style={{ borderColor: promoError ? "rgba(239,68,68,0.4)" : undefined }}
                        />
                        <button
                          onClick={handleApplyPromo}
                          disabled={promoLoading || !promoInput.trim()}
                          className="px-4 py-2.5 rounded-xl text-xs font-medium text-foreground transition-all duration-200 disabled:opacity-30 min-h-[44px]"
                          style={{ backgroundColor: primaryColor }}
                        >
                          {promoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply"}
                        </button>
                      </div>
                    )}
                    {promoError && (
                      <p className="text-[10px] text-red-400/80 px-1">{promoError}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Subtotal ({cartCount} {cartCount === 1 ? "item" : "items"})</span>
                      <span className="text-foreground/70">{formatPrice(cartTotal, cartCurrency)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-emerald-400/70">Discount</span>
                        <span className="text-emerald-400/70">-{formatPrice(discount, cartCurrency)}</span>
                      </div>
                    )}
                    {estimatedTax > 0 && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-muted-foreground">Est. Tax ({effectiveTaxRate}%)</span>
                        <span className="text-muted-foreground">{formatPrice(estimatedTax, cartCurrency)}</span>
                      </div>
                    )}
                    {hasPhysicalItems && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-muted-foreground">Shipping</span>
                        <span className="text-muted-foreground">Calculated at checkout</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-1.5 border-t border-border/50">
                      <span className="text-base font-semibold text-foreground/80">Total</span>
                      <span className="text-xl font-bold tabular-nums" style={{ color: primaryColor }}>
                        {formatPrice(orderTotal, cartCurrency)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={onCheckout}
                    className="relative w-full py-3.5 rounded-2xl text-foreground font-semibold text-sm transition-all duration-300 hover:scale-[1.015] active:scale-[0.98] overflow-hidden group min-h-[44px]"
                    style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}35` }}
                  >
                    <span
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: `linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.06) 50%, transparent 100%)`,
                      }}
                    />
                    <span className="relative flex items-center justify-center gap-2">
                      Proceed to Checkout
                      <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </span>
                  </button>

                  <button
                    onClick={onClose}
                    className="w-full py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200 min-h-[44px]"
                  >
                    Continue Shopping
                  </button>

                  <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground/40">
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      Secure checkout
                    </span>
                    <span className="w-px h-3 bg-border/50" />
                    <span className="flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      SSL Encrypted
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.5; }
          to { transform: translateY(0); opacity: 1; }
        }
        @media (min-width: 640px) {
          @keyframes slideUp {
            from { transform: translateX(100%); opacity: 0.5; }
            to { transform: translateX(0); opacity: 1; }
          }
        }
      `}</style>
    </>
  );

  function renderCartItem(item: CartItem, idx: number) {
    const badge = typeBadge(item.itemType, primaryColor, secondaryColor, accentColor);
    const key = `${item.id}_${item.itemType}`;
    const isRemoving = removingItem === key;
    return (
      <div
        key={key}
        className="group rounded-2xl border border-border/40 p-3.5 transition-all duration-250"
        style={{
          background: "hsl(var(--muted) / 0.2)",
          opacity: isRemoving ? 0 : 1,
          transform: isRemoving ? "translateX(100px) scale(0.9)" : "translateX(0) scale(1)",
          animationDelay: `${idx * 50}ms`,
        }}
      >
        <div className="flex items-start gap-3">
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt={item.name}
              className="w-12 h-12 rounded-xl object-cover flex-shrink-0 ring-1 ring-white/10"
             width={48} height={48} unoptimized />
          ) : (
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${badge.color}12` }}
            >
              <Package className="w-5 h-5" style={{ color: badge.color, opacity: 0.6 }} />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold tracking-wide uppercase"
                style={{ backgroundColor: `${badge.color}15`, color: badge.color }}
              >
                {badge.label}
              </span>
              {item.requiresBooking && (
                <AlertTriangle className="w-3 h-3 text-amber-400/80" />
              )}
            </div>
            <h4 className="text-sm font-medium text-foreground truncate leading-tight">
              {item.name}
            </h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {formatPrice(item.price, item.currency)} each
              {item.duration ? ` · ${item.duration} min` : ""}
            </p>
          </div>

          <button
            onClick={() => handleRemove(item.id, item.itemType)}
            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all duration-200 text-muted-foreground/50 hover:text-red-400 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/40">
          {item.itemType === "service" ? (
            <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-1 rounded-lg">Qty: 1</span>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onUpdateQuantity(item.id, item.itemType, -1)}
                className="w-8 h-8 min-h-[44px] min-w-[44px] rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-all duration-200 active:scale-90"
              >
                <Minus className="w-3 h-3 text-muted-foreground" />
              </button>
              <span className="text-sm font-semibold w-8 text-center text-foreground tabular-nums">
                {item.quantity}
              </span>
              <button
                onClick={() => onUpdateQuantity(item.id, item.itemType, 1)}
                className="w-8 h-8 min-h-[44px] min-w-[44px] rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-all duration-200 active:scale-90"
              >
                <Plus className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
          )}
          <span className="text-sm font-bold tabular-nums" style={{ color: primaryColor }}>
            {formatPrice(item.price * item.quantity, item.currency)}
          </span>
        </div>
      </div>
    );
  }
}
