"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { CartItem } from "./types";
import { typeBadge } from "./utils";

type Props = {
  cart: CartItem[];
  cartOpen: boolean;
  cartCount: number;
  cartTotal: number;
  cartCurrency: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  onClose: () => void;
  onOpen: () => void;
  onUpdateQuantity: (itemId: string, itemType: string, delta: number) => void;
  onRemoveFromCart: (itemId: string, itemType: string) => void;
  onCheckout: () => void;
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
  onClose,
  onOpen,
  onUpdateQuantity,
  onRemoveFromCart,
  onCheckout,
}: Props) {
  const [fabPulse, setFabPulse] = useState(false);
  const [removingItem, setRemovingItem] = useState<string | null>(null);

  useEffect(() => {
    if (cartCount > 0) {
      setFabPulse(true);
      const t = setTimeout(() => setFabPulse(false), 600);
      return () => clearTimeout(t);
    }
  }, [cartCount]);

  useEffect(() => {
    if (cartOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [cartOpen]);

  const handleRemove = (itemId: string, itemType: string) => {
    setRemovingItem(`${itemId}_${itemType}`);
    setTimeout(() => {
      onRemoveFromCart(itemId, itemType);
      setRemovingItem(null);
    }, 250);
  };

  const hasBookingItems = cart.some((c) => c.requiresBooking);

  return (
    <>
      {cartCount > 0 && (
        <button
          onClick={onOpen}
          className="fixed bottom-6 right-6 z-40 group"
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
            <ShoppingCart className="w-6 h-6 text-white transition-transform duration-300 group-hover:rotate-[-8deg]" />
          </span>
          <span
            className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white text-xs font-bold flex items-center justify-center shadow-lg transition-transform duration-300"
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end" role="dialog" aria-label="Shopping cart" aria-modal="true">
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
              background: "linear-gradient(180deg, #16161e 0%, #0e0e14 100%)",
              borderTop: "1px solid rgba(255,255,255,0.08)",
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

            <div className="relative flex items-center justify-between p-5 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <ShoppingCart className="w-4.5 h-4.5" style={{ color: primaryColor }} />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-white">Your Cart</h3>
                  <p className="text-[11px] text-white/40">
                    {cartCount} {cartCount === 1 ? "item" : "items"}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all duration-200 hover:rotate-90"
              >
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>

            <div className="relative flex-1 overflow-y-auto p-4 space-y-2.5" style={{ scrollbarWidth: "thin" }}>
              {cart.map((item, idx) => {
                const badge = typeBadge(item.itemType, primaryColor, secondaryColor, accentColor);
                const key = `${item.id}_${item.itemType}`;
                const isRemoving = removingItem === key;
                return (
                  <div
                    key={key}
                    className="group rounded-2xl border border-white/[0.06] p-3.5 transition-all duration-250"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
                      opacity: isRemoving ? 0 : 1,
                      transform: isRemoving ? "translateX(100px) scale(0.9)" : "translateX(0) scale(1)",
                      animationDelay: `${idx * 50}ms`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-12 h-12 rounded-xl object-cover flex-shrink-0 ring-1 ring-white/10"
                        />
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
                        <h4 className="text-sm font-medium text-white/90 truncate leading-tight">
                          {item.name}
                        </h4>
                        <p className="text-[11px] text-white/35 mt-0.5">
                          {formatPrice(item.price, item.currency)} each
                          {item.duration ? ` · ${item.duration} min` : ""}
                        </p>
                      </div>

                      <button
                        onClick={() => handleRemove(item.id, item.itemType)}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all duration-200 text-white/20 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/[0.04]">
                      {item.itemType === "service" ? (
                        <span className="text-[10px] text-white/30 bg-white/[0.04] px-2 py-1 rounded-lg">Qty: 1</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onUpdateQuantity(item.id, item.itemType, -1)}
                            className="w-8 h-8 min-h-[44px] min-w-[44px] rounded-lg bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center transition-all duration-200 active:scale-90"
                          >
                            <Minus className="w-3 h-3 text-white/50" />
                          </button>
                          <span className="text-sm font-semibold w-8 text-center text-white/90 tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => onUpdateQuantity(item.id, item.itemType, 1)}
                            className="w-8 h-8 min-h-[44px] min-w-[44px] rounded-lg bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center transition-all duration-200 active:scale-90"
                          >
                            <Plus className="w-3 h-3 text-white/50" />
                          </button>
                        </div>
                      )}
                      <span className="text-sm font-bold tabular-nums" style={{ color: primaryColor }}>
                        {formatPrice(item.price * item.quantity, item.currency)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              className="relative border-t border-white/[0.06] p-5 space-y-4"
              style={{
                background: "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)",
              }}
            >
              {hasBookingItems && (
                <div className="flex items-center gap-2 text-[11px] text-amber-400/70 bg-amber-400/[0.06] rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Some items require booking a time slot at checkout</span>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/50">Subtotal ({cartCount} {cartCount === 1 ? "item" : "items"})</span>
                  <span className="text-white/70">{formatPrice(cartTotal, cartCurrency)}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-white/30">Tax</span>
                  <span className="text-white/30">Calculated at checkout</span>
                </div>
                <div className="flex justify-between items-center pt-1.5 border-t border-white/[0.04]">
                  <span className="text-base font-semibold text-white/80">Total</span>
                  <span className="text-xl font-bold tabular-nums" style={{ color: primaryColor }}>
                    {formatPrice(cartTotal, cartCurrency)}
                  </span>
                </div>
              </div>

              <button
                onClick={onCheckout}
                className="relative w-full py-3.5 rounded-2xl text-white font-semibold text-sm transition-all duration-300 hover:scale-[1.015] active:scale-[0.98] overflow-hidden group min-h-[44px]"
                style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}35` }}
              >
                <span
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)`,
                  }}
                />
                <span className="relative flex items-center justify-center gap-2">
                  Proceed to Checkout
                  <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </button>

              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl text-xs font-medium text-white/40 hover:text-white/60 hover:bg-white/[0.03] transition-all duration-200 min-h-[44px]"
              >
                Continue Shopping
              </button>

              <div className="flex items-center justify-center gap-4 text-[10px] text-white/25">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Secure checkout
                </span>
                <span className="w-px h-3 bg-white/10" />
                <span>SSL Encrypted</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
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
}
