"use client";

import {
  ShoppingCart,
  X,
  Plus,
  Minus,
  Trash2,
  ArrowRight,
  AlertTriangle,
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
  onClose,
  onOpen,
  onUpdateQuantity,
  onRemoveFromCart,
  onCheckout,
}: Props) {
  return (
    <>
      {cartCount > 0 && (
        <button
          onClick={onOpen}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 z-40"
          style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}40` }}
        >
          <ShoppingCart className="w-6 h-6 text-white" />
          <span
            className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white text-xs font-bold flex items-center justify-center"
            style={{ color: primaryColor }}
          >
            {cartCount}
          </span>
        </button>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <div className="relative w-full sm:w-[400px] max-h-[85vh] sm:max-h-full bg-[#12121a] border-t sm:border-t-0 sm:border-l border-white/10 rounded-t-3xl sm:rounded-t-none flex flex-col animate-in slide-in-from-bottom sm:slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" style={{ color: primaryColor }} />
                Cart ({cartCount})
              </h3>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ scrollbarWidth: "thin" }}>
              {cart.map((item) => {
                const badge = typeBadge(item.itemType, primaryColor, secondaryColor);
                return (
                  <div
                    key={`${item.id}_${item.itemType}`}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                            style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
                          >
                            {badge.label}
                          </span>
                          {item.requiresBooking && (
                            <AlertTriangle className="w-3 h-3 text-amber-400" />
                          )}
                        </div>
                        <h4 className="text-sm font-medium truncate">{item.name}</h4>
                        <p className="text-xs text-white/40">{formatPrice(item.price, item.currency)}</p>
                      </div>
                      <button
                        onClick={() => onRemoveFromCart(item.id, item.itemType)}
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors text-white/30 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onUpdateQuantity(item.id, item.itemType, -1)}
                          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                        <button
                          onClick={() => onUpdateQuantity(item.id, item.itemType, 1)}
                          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <span className="text-sm font-semibold" style={{ color: primaryColor }}>
                        {formatPrice(item.price * item.quantity, item.currency)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-white/10 p-5 space-y-4">
              <div className="flex justify-between items-center">
                <span className="font-medium text-white/60">Subtotal</span>
                <span className="text-lg font-bold" style={{ color: primaryColor }}>
                  {formatPrice(cartTotal, cartCurrency)}
                </span>
              </div>
              <button
                onClick={onCheckout}
                className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all hover:scale-[1.01]"
                style={{ backgroundColor: primaryColor, boxShadow: `0 4px 20px ${primaryColor}30` }}
              >
                Proceed to Checkout
                <ArrowRight className="w-4 h-4 inline ml-2" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
