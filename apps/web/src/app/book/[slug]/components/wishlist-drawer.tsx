"use client";

import { Heart, X, ShoppingBag, Trash2 } from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { WishlistItem } from "./use-wishlist";
import type { CatalogItem } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  items: WishlistItem[];
  onRemove: (itemId: string) => void;
  onAddToCart?: (item: CatalogItem) => void;
  primaryColor: string;
};

export function WishlistDrawer({ open, onClose, items, onRemove, onAddToCart, primaryColor }: Props) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white/95 backdrop-blur-xl border-l border-gray-200 z-50 flex flex-col animate-slideInRight">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
              <Heart className="w-4.5 h-4.5" style={{ color: primaryColor }} fill={primaryColor} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Wishlist</h3>
              <p className="text-xs text-gray-400">{items.length} saved item{items.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-200/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-16">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                <Heart className="w-8 h-8 text-gray-900/15" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-500">Your wishlist is empty</p>
                <p className="text-xs text-gray-400">Tap the heart icon on any item to save it for later</p>
              </div>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex gap-3 p-3 rounded-xl border border-gray-200 bg-white/[0.02] group hover:bg-gray-50 transition-colors"
              >
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div
                    className="w-16 h-16 rounded-lg flex items-center justify-center text-lg font-bold flex-shrink-0"
                    style={{ backgroundColor: `${primaryColor}10`, color: `${primaryColor}50` }}
                  >
                    {item.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-900 truncate">{item.name}</h4>
                  <p className="text-sm font-semibold mt-1" style={{ color: primaryColor }}>
                    {formatPrice(item.price, item.currency)}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    {onAddToCart && (
                      <button
                        onClick={() =>
                          onAddToCart({
                            id: item.id,
                            name: item.name,
                            price: item.price,
                            currency: item.currency,
                            imageUrl: item.imageUrl,
                            itemType: item.itemType as any,
                            description: null,
                            duration: null,
                            requiresBooking: false,
                          })
                        }
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
                        style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}
                      >
                        <ShoppingBag className="w-3 h-3" /> Add to Cart
                      </button>
                    )}
                    <button
                      onClick={() => onRemove(item.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-red-400/70 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <style jsx>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
          .animate-slideInRight {
            animation: slideInRight 0.3s ease-out;
          }
        `}</style>
      </div>
    </>
  );
}
