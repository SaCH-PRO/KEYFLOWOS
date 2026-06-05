"use client";

import { useCallback } from "react";
import { InvoiceLineItem } from "../components/commerce-types";
import { Product } from "@/lib/client";

let itemIdCounter = 0;
function generateItemId() {
  return `item-${Date.now()}-${++itemIdCounter}`;
}

export function useLineItemHandlers(
  updateItems: (updater: (prev: InvoiceLineItem[]) => InvoiceLineItem[]) => void,
  products: Product[] = [],
) {
  const addItem = useCallback(() => {
    updateItems((prev) => [
      ...prev,
      { id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" },
    ]);
  }, [updateItems]);

  const removeItem = useCallback(
    (itemId: string) => {
      updateItems((prev) => prev.filter((item) => item.id !== itemId));
    },
    [updateItems],
  );

  const updateItem = useCallback(
    (itemId: string, field: keyof InvoiceLineItem, value: string | boolean) => {
      updateItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, [field]: value } : item)),
      );
    },
    [updateItems],
  );

  const selectProduct = useCallback(
    (itemId: string, productId: string) => {
      if (productId === "__NEW__") {
        updateItems((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  productId: "__NEW__",
                  isNewItem: true,
                  newItemName: "",
                  newItemCategory: "SERVICE",
                  description: "",
                  unitPrice: "",
                  addToCatalog: false,
                }
              : item,
          ),
        );
        return;
      }

      const product = products.find((p) => p.id === productId);
      if (!product) return;

      updateItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId: product.id,
                description: product.name,
                unitPrice: String(product.price),
                isNewItem: false,
              }
            : item,
        ),
      );
    },
    [updateItems, products],
  );

  return { addItem, removeItem, updateItem, selectProduct };
}
