"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  Product,
} from "@/lib/client";
import { notifyProductsChanged } from "@/lib/product-sync";
import { getStoredBusinessId, BUSINESS_CHANGED_EVENT } from "@/lib/workspace";
import { moduleWriteRefusal } from "@/lib/module-scope-refusal";
import { moduleEvents } from "@/lib/module-events";
import { ProductForm } from "../components/commerce-types";

/** lib/workspace keeps the selected business under this localStorage key (another tab's change arrives as storage). */
const BUSINESS_ID_STORAGE_KEY = "kf_business_id";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().positive("Price must be positive"),
  description: z.string().optional(),
});

/**
 * CATALOG-1 (BUG-005): a product's photo is the link stored with it on the server (Product.imageUrl), so every
 * device and the store show the same one. A photo kept in this browser (a data: or blob: address, or the old
 * "__local__" marker of lib/image-store.ts) never reaches another device, so it is refused, not saved.
 */
export const LOCAL_IMAGE_REFUSAL = "That photo is only in this browser, so no other device would see it. Paste a full https:// link to a photo that is already online.";

function isBrowserOnlyImage(value: string | null | undefined): boolean {
  return !!value && (/^(data|blob):/i.test(value) || value === "__local__");
}

/**
 * SEC-CAT-3: an image link is an absolute https:// address, nothing else (no javascript:, http:, protocol-relative
 * "//host" or text that is not a link). The store and the line pickers draw it for every customer.
 */
export const IMAGE_LINK_RULE = "An image link must be a full https:// address, for example https://example.com/photo.jpg.";

export function isHttpsImageLink(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

/** What the form says for a refused or failed write: the module refusal (403, revenue), else the server's words. */
function writeError(res: { error?: string | null; status?: number }, what: string, fallback: string): string {
  return moduleWriteRefusal(res, "revenue", what) ?? res.error ?? fallback;
}

const DEFAULT_PRODUCT_FORM: ProductForm = {
  name: "",
  description: "",
  price: "",
  category: "SERVICE",
  duration: "",
  imageUrl: "",
  sku: "",
  isActive: true,
};

function buildProductPayload(form: ProductForm, mode: "create" | "update" = "create") {
  const durationValue = form.duration ? parseInt(form.duration) : null;
  const imageUrl = form.imageUrl.trim();
  // COR-CAT-6: an edit that clears a field clears it on the server (null), not "leave as is" (undefined).
  const cleared = mode === "update" ? null : undefined;
  // Round 3 (COR-CAT-R2-1): a new product is created with what the form shows; its default is Untracked, so it is
  // shown on the store with no stock (Tracked with no stock and "hide" was hidden, with nothing saying why). The
  // out-of-stock behaviour goes with Tracked only. An edit sends only what the form holds, so a stored null mode
  // stays null unless the owner picks one.
  // Round 4 (COR-R3-3): the inventory fields belong to PRODUCT (the form shows them for a product only). A new
  // product of another category sends neither, whatever the form still holds from the Product card, so a PACKAGE is
  // not stored as explicitly untracked (resolveInventoryMode would then ignore stock added later).
  const createsProduct = mode === "create" && form.category === "PRODUCT";
  const createsOther = mode === "create" && form.category !== "PRODUCT";
  const shownMode = createsProduct ? (form.inventoryMode || "untracked") : createsOther ? undefined : (form.inventoryMode || undefined);
  const shownBehavior = createsProduct
    ? (shownMode === "tracked" ? (form.outOfStockBehavior || "hide") : undefined)
    : createsOther ? undefined : (form.outOfStockBehavior || undefined);
  return {
    name: form.name,
    price: Number(form.price),
    description: form.description.trim() ? form.description : cleared,
    category: form.category,
    duration: durationValue,
    imageUrl: imageUrl ? imageUrl : null,
    sku: form.sku.trim() ? form.sku.trim() : cleared,
    isActive: form.isActive,
    inventoryMode: shownMode,
    outOfStockBehavior: shownBehavior,
  };
}

export interface UseProductsOptions {
  /**
   * The business currency (Business.currency). A new product is created in it; without it the client's create
   * falls back to TTD whatever the business sells in.
   */
  currency?: string | null;
  /** COR-CAT-3: the category a new product starts in (Sales > Products: PRODUCT). */
  defaultCategory?: ProductForm["category"];
}

/** What an archive came to: done (or already archived), or refused with the reason to show. */
export type ArchiveOutcome = { ok: true; alreadyArchived?: boolean } | { ok: false; error: string };

export function useProducts(
  businessId: string | null,
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>,
  options: UseProductsOptions = {},
) {
  const currency = options.currency ?? undefined;
  const defaultCategory = options.defaultCategory ?? DEFAULT_PRODUCT_FORM.category;
  // A new PRODUCT starts Untracked (round 3), shown in the form and sent as shown.
  const blankForm = useCallback(
    (): ProductForm => ({ ...DEFAULT_PRODUCT_FORM, category: defaultCategory, ...(defaultCategory === "PRODUCT" ? { inventoryMode: "untracked" as const } : {}) }),
    [defaultCategory],
  );
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>({ ...DEFAULT_PRODUCT_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Round 2 (5): the image link the product had when the form opened; an unchanged one is kept as it is.
  const [originalImageUrl, setOriginalImageUrl] = useState("");
  // Round 2 (6): the business a write was asked for; an answer after the business changed is dropped.
  // Round 5 (SEC-CAT-R4-1): it also follows the selection itself (kf:business-changed, and the storage event from
  // another tab), so an answer that lands after the switch and before the page renders with the new business is
  // dropped too.
  const businessRef = useRef(businessId);
  useEffect(() => {
    businessRef.current = businessId;
  }, [businessId]);
  // Round 6 (SEC-R5-M2): only a storage event on the selection (kf_business_id, or null: localStorage cleared) is a
  // switch, as the page filters it; another key changes nothing.
  useEffect(() => {
    const follow = () => {
      const next = getStoredBusinessId();
      if (next && next !== businessRef.current) businessRef.current = next;
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== BUSINESS_ID_STORAGE_KEY && e.key !== null) return;
      follow();
    };
    window.addEventListener(BUSINESS_CHANGED_EVENT, follow);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BUSINESS_CHANGED_EVENT, follow);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openAddProduct = useCallback(() => {
    setEditingProductId(null);
    setOriginalImageUrl("");
    setProductForm(blankForm());
    setImagePreview(null);
    setFormError(null);
    setShowProductForm(true);
  }, [blankForm]);

  const openEditProduct = useCallback((product: Product) => {
    setEditingProductId(product.id);
    setProductForm({
      name: product.name,
      description: product.description ?? "",
      price: String(product.price),
      category: (product.category as "SERVICE" | "PRODUCT" | "PACKAGE") ?? "SERVICE",
      duration: product.duration ? String(product.duration) : "",
      imageUrl: product.imageUrl || "",
      sku: product.sku || "",
      isActive: product.isActive ?? true,
      inventoryMode: ((product as { inventoryMode?: string }).inventoryMode as "tracked" | "untracked" | "virtual" | undefined) ?? undefined,
      outOfStockBehavior: ((product as { outOfStockBehavior?: string }).outOfStockBehavior as "hide" | "show_oos" | "allow_backorder" | undefined) ?? undefined,
    });
    setOriginalImageUrl(product.imageUrl || "");
    setImagePreview(product.imageUrl && isHttpsImageLink(product.imageUrl) ? product.imageUrl : null);
    setFormError(null);
    setShowProductForm(true);
  }, []);

  const closeProductForm = useCallback(() => {
    setShowProductForm(false);
    setEditingProductId(null);
    setProductForm(blankForm());
    setImagePreview(null);
    setFormError(null);
  }, [blankForm]);

  const removeImage = useCallback(() => {
    setImagePreview(null);
    setProductForm((f) => ({ ...f, imageUrl: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  /** The form's checks before any save: name and price, and no browser-only photo. */
  const validate = useCallback((): boolean => {
    setFormError(null);
    const parsed = productSchema.safeParse({
      name: productForm.name,
      price: Number(productForm.price),
      description: productForm.description || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? "Invalid input");
      return false;
    }
    if (isBrowserOnlyImage(productForm.imageUrl) || isBrowserOnlyImage(imagePreview)) {
      setFormError(LOCAL_IMAGE_REFUSAL);
      return false;
    }
    // Only a changed link is checked: a legacy http:// link the product already has may be kept as it is.
    const link = productForm.imageUrl.trim();
    if (link && link !== originalImageUrl.trim() && !isHttpsImageLink(link)) {
      setFormError(IMAGE_LINK_RULE);
      return false;
    }
    return true;
  }, [productForm, imagePreview, originalImageUrl]);

  const create = useCallback(async () => {
    if (!businessId) return null;
    const payload = buildProductPayload(productForm, "create");
    const askedFor = businessId;
    const res = await createProduct({ businessId, ...payload, description: payload.description ?? undefined, ...(currency ? { currency } : {}) });
    if (businessRef.current !== askedFor) return null;
    const data = res.data;
    if (res.error || !data) {
      const message = writeError(res as { error?: string | null; status?: number }, "add products", "Failed to create product");
      setFormError(message);
      toast.error(message);
      return null;
    }
    setProducts((prev) => [data, ...prev]);
    notifyProductsChanged();
    moduleEvents.emit("commerce:product_created", "commerce", { productId: data.id, name: data.name, price: data.price });
    return data;
  }, [businessId, productForm, currency, setProducts]);

  const handleSaveProduct = useCallback(async () => {
    if (!validate() || !businessId) return;
    setSaving(true);
    try {
      if (editingProductId) {
        const askedFor = businessId;
        const res = await updateProduct({ businessId, productId: editingProductId, ...buildProductPayload(productForm, "update") });
        if (businessRef.current !== askedFor) return;
        const data = res.data;
        if (res.error || !data) {
          const message = writeError(res, "change products", "Failed to update product");
          setFormError(message);
          toast.error(message);
          return;
        }
        setProducts((prev) => prev.map((p) => (p.id === editingProductId ? { ...p, ...data } : p)));
        closeProductForm();
        toast.success("Product updated");
        notifyProductsChanged();
        moduleEvents.emit("commerce:product_updated", "commerce", { productId: editingProductId, name: data.name });
      } else {
        const data = await create();
        if (!data) return;
        closeProductForm();
        toast.success("Product created");
      }
    } finally {
      setSaving(false);
    }
  }, [validate, businessId, editingProductId, productForm, setProducts, closeProductForm, create]);

  const handleSaveAndAddAnother = useCallback(async () => {
    if (!validate() || !businessId) return;
    setSaving(true);
    try {
      const data = await create();
      if (!data) return;
      const prevCategory = productForm.category;
      setProductForm({ ...blankForm(), category: prevCategory });
      setImagePreview(null);
      setFormError(null);
      toast.success(`"${data.name}" created — add another`);
    } finally {
      setSaving(false);
    }
  }, [validate, businessId, create, productForm.category, blankForm]);

  // Round 5 (SEC-CAT-R4-1): duplicate, toggle and the inline save drop an answer for a business no longer selected,
  // as create, update and archive do.
  const handleDuplicateProduct = useCallback(async (product: Product) => {
    if (!businessId) return;
    const askedFor = businessId;
    const { data, error } = await createProduct({
      businessId,
      name: `${product.name} (Copy)`,
      price: product.price,
      // The copy keeps the original's currency (it is the same product, priced the same way).
      currency: product.currency ?? currency,
      description: product.description ?? undefined,
      category: product.category ?? "SERVICE",
      duration: product.duration ?? null,
      imageUrl: isBrowserOnlyImage(product.imageUrl) ? null : product.imageUrl ?? null,
      sku: product.sku ? `${product.sku}-COPY` : null,
      isActive: true,
    });
    if (businessRef.current !== askedFor) return;
    if (error || !data) { toast.error("Failed to duplicate product"); return; }
    setProducts((prev) => [data, ...prev]);
    toast.success("Product duplicated");
    notifyProductsChanged();
    moduleEvents.emit("commerce:product_created", "commerce", { productId: data.id, name: data.name, price: data.price });
  }, [businessId, currency, setProducts]);

  const handleToggleProductActive = useCallback(async (product: Product) => {
    if (!businessId) return;
    const newActive = !product.isActive;
    const askedFor = businessId;
    const res = await updateProduct({
      businessId,
      productId: product.id,
      isActive: newActive,
    });
    if (businessRef.current !== askedFor) return;
    const { data, error } = res;
    if (error) { toast.error(writeError({ error, status: (res as { status?: number }).status }, "change products", "Failed to update product status")); return; }
    if (data) {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, isActive: newActive } : p)));
      toast.success(newActive ? "Product activated" : "Product deactivated");
      notifyProductsChanged();
      moduleEvents.emit("commerce:product_updated", "commerce", { productId: product.id, name: product.name });
    }
  }, [businessId, setProducts]);

  const handleInlineSave = useCallback(async (productId: string, form: ProductForm, imageFile?: File | null) => {
    if (!businessId) return;
    const price = Number(form.price);
    if (!form.name || isNaN(price) || price <= 0) {
      toast.error("Name and a valid price are required");
      throw new Error("Name and a valid price are required");
    }
    if (imageFile || isBrowserOnlyImage(form.imageUrl)) {
      toast.error(LOCAL_IMAGE_REFUSAL);
      throw new Error(LOCAL_IMAGE_REFUSAL);
    }
    if (form.imageUrl.trim() && !isHttpsImageLink(form.imageUrl)) {
      toast.error(IMAGE_LINK_RULE);
      throw new Error(IMAGE_LINK_RULE);
    }
    const askedFor = businessId;
    const res = await updateProduct({ businessId, productId, ...buildProductPayload(form, "update") });
    if (businessRef.current !== askedFor) return;
    const { data, error } = res;
    if (error) { const message = writeError(res, "change products", "Failed to update product"); toast.error(message); throw new Error(message); }
    if (data) {
      setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, ...data } : p)));
      toast.success("Product updated");
      notifyProductsChanged();
      moduleEvents.emit("commerce:product_updated", "commerce", { productId, name: data.name });
    }
  }, [businessId, setProducts]);

  /**
   * Archive (CATALOG-1, journey B1/B6): the server's product removal is a soft delete (deletedAt), so the product
   * leaves the product list, the line pickers and the store, invoices and quotes that used it keep their lines,
   * and the owner can restore it from Trash.
   */
  const handleDeleteProduct = useCallback(async (productId: string): Promise<ArchiveOutcome> => {
    if (!businessId) return { ok: false, error: "Could not find your workspace. Please sign in again." };
    const askedFor = businessId;
    const res = (await deleteProduct(productId, businessId)) as { error?: string | null; status?: number };
    if (businessRef.current !== askedFor) return { ok: true };
    // COR-CAT-12: a 404 is a product already archived (or gone): it leaves the list like an archive.
    const alreadyArchived = !!res.error && res.status === 404;
    if (res.error && !alreadyArchived) {
      const message = writeError(res, "archive products", "Failed to archive product");
      toast.error(message);
      return { ok: false, error: message };
    }
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setDeleteConfirm(null);
    toast.success(alreadyArchived ? "That product was already archived." : "Product archived. You can restore it from Trash.");
    notifyProductsChanged();
    if (!alreadyArchived) moduleEvents.emit("commerce:product_deleted", "commerce", { productId });
    return alreadyArchived ? { ok: true, alreadyArchived: true } : { ok: true };
  }, [businessId, setProducts]);

  return {
    showProductForm,
    editingProductId,
    productForm,
    setProductForm,
    formError,
    saving,
    productSearch,
    setProductSearch,
    deleteConfirm,
    setDeleteConfirm,
    imagePreview,
    setImagePreview,
    fileInputRef,
    openAddProduct,
    openEditProduct,
    closeProductForm,
    removeImage,
    handleSaveProduct,
    handleSaveAndAddAnother,
    handleDuplicateProduct,
    handleToggleProductActive,
    handleDeleteProduct,
    handleArchiveProduct: handleDeleteProduct,
    handleInlineSave,
  };
}
