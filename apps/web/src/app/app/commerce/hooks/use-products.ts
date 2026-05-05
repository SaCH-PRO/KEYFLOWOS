"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  Product,
} from "@/lib/client";
import {
  saveProductImage,
  deleteProductImage,
  fileToDataUrl,
} from "@/lib/image-store";
import { notifyProductsChanged } from "@/lib/product-sync";
import { moduleEvents } from "@/lib/module-events";
import { ProductForm } from "../components/commerce-types";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().positive("Price must be positive"),
  description: z.string().optional(),
});

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

function buildProductPayload(form: ProductForm, imageUrl: string | null) {
  const durationValue = form.duration ? parseInt(form.duration) : null;
  return {
    name: form.name,
    price: Number(form.price),
    description: form.description || undefined,
    category: form.category,
    duration: durationValue,
    imageUrl: imageUrl ?? undefined,
    sku: form.sku || undefined,
    isActive: form.isActive,
    inventoryMode: form.inventoryMode || undefined,
    outOfStockBehavior: form.outOfStockBehavior || undefined,
  };
}

export function useProducts(
  businessId: string | null,
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>,
  cachedImages: Record<string, string>,
  setCachedImages: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>({ ...DEFAULT_PRODUCT_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<"upload" | "url">("upload");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openAddProduct = useCallback(() => {
    setEditingProductId(null);
    setProductForm({ ...DEFAULT_PRODUCT_FORM });
    setImagePreview(null);
    setImageMode("upload");
    setFormError(null);
    setShowProductForm(true);
  }, []);

  const openEditProduct = useCallback(async (product: Product) => {
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
    const cached = cachedImages[product.id] ?? null;
    if (cached) {
      setImagePreview(cached);
      setImageMode("upload");
    } else if (product.imageUrl) {
      setImagePreview(product.imageUrl);
      setImageMode("url");
    } else {
      setImagePreview(null);
      setImageMode("upload");
    }
    setFormError(null);
    setShowProductForm(true);
  }, [cachedImages]);

  const closeProductForm = useCallback(() => {
    setShowProductForm(false);
    setEditingProductId(null);
    setProductForm({ ...DEFAULT_PRODUCT_FORM });
    setImagePreview(null);
    setImageMode("upload");
    setFormError(null);
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setImagePreview(dataUrl);
      setProductForm((f) => ({ ...f, imageUrl: "__local__" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load image");
    }
  }, []);

  const removeImage = useCallback(() => {
    setImagePreview(null);
    setProductForm((f) => ({ ...f, imageUrl: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const syncImageCache = useCallback(async (productId: string, localImage: string | null, hasImage: boolean) => {
    if (localImage) {
      await saveProductImage(productId, localImage);
      setCachedImages((prev) => ({ ...prev, [productId]: localImage }));
    } else if (!hasImage) {
      await deleteProductImage(productId);
      setCachedImages((prev) => { const n = { ...prev }; delete n[productId]; return n; });
    }
  }, [setCachedImages]);

  const handleSaveProduct = useCallback(async () => {
    setFormError(null);
    const parsed = productSchema.safeParse({
      name: productForm.name,
      price: Number(productForm.price),
      description: productForm.description || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    if (!businessId) return;
    setSaving(true);
    try {
      const isLocalImage = imagePreview?.startsWith("data:");
      const serverImageUrl = isLocalImage ? null : (productForm.imageUrl || null);
      const payload = buildProductPayload(productForm, serverImageUrl);

      if (editingProductId) {
        const { data, error } = await updateProduct({ businessId, productId: editingProductId, ...payload });
        if (error) { setFormError(error); toast.error("Failed to update product"); return; }
        if (data) {
          await syncImageCache(editingProductId, isLocalImage ? imagePreview : null, !!imagePreview);
          setProducts((prev) => prev.map((p) => (p.id === editingProductId ? { ...p, ...data } : p)));
          closeProductForm();
          toast.success("Product updated");
          notifyProductsChanged();
          moduleEvents.emit("commerce:product_updated", "commerce", { productId: editingProductId, name: data.name });
        }
      } else {
        const { data, error } = await createProduct({ businessId, ...payload });
        if (error) { setFormError(error); toast.error("Failed to create product"); return; }
        if (data) {
          if (isLocalImage && imagePreview) await syncImageCache(data.id, imagePreview, true);
          setProducts((prev) => [data, ...prev]);
          closeProductForm();
          toast.success("Product created");
          notifyProductsChanged();
          moduleEvents.emit("commerce:product_created", "commerce", { productId: data.id, name: data.name, price: data.price });
        }
      }
    } finally {
      setSaving(false);
    }
  }, [businessId, productForm, editingProductId, imagePreview, closeProductForm, setProducts, syncImageCache]);

  const handleSaveAndAddAnother = useCallback(async () => {
    setFormError(null);
    const parsed = productSchema.safeParse({
      name: productForm.name,
      price: Number(productForm.price),
      description: productForm.description || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    if (!businessId) return;
    setSaving(true);
    try {
      const isLocalImage = imagePreview?.startsWith("data:");
      const serverImageUrl = isLocalImage ? null : (productForm.imageUrl || null);
      const payload = buildProductPayload(productForm, serverImageUrl);
      const { data, error } = await createProduct({ businessId, ...payload });
      if (error) { setFormError(error); toast.error("Failed to create product"); return; }
      if (data) {
        if (isLocalImage && imagePreview) await syncImageCache(data.id, imagePreview, true);
        setProducts((prev) => [data, ...prev]);
        const prevCategory = productForm.category;
        setProductForm({ ...DEFAULT_PRODUCT_FORM, category: prevCategory });
        setImagePreview(null);
        setImageMode("upload");
        setFormError(null);
        toast.success(`"${data.name}" created — add another`);
        notifyProductsChanged();
        moduleEvents.emit("commerce:product_created", "commerce", { productId: data.id, name: data.name, price: data.price });
      }
    } finally {
      setSaving(false);
    }
  }, [businessId, productForm, imagePreview, setProducts, syncImageCache]);

  const handleDuplicateProduct = useCallback(async (product: Product) => {
    if (!businessId) return;
    const { data, error } = await createProduct({
      businessId,
      name: `${product.name} (Copy)`,
      price: product.price,
      description: product.description ?? undefined,
      category: product.category ?? "SERVICE",
      duration: product.duration ?? null,
      imageUrl: product.imageUrl ?? null,
      sku: product.sku ? `${product.sku}-COPY` : null,
      isActive: true,
    });
    if (error) { toast.error("Failed to duplicate product"); return; }
    if (data) {
      if (cachedImages[product.id]) {
        await saveProductImage(data.id, cachedImages[product.id]);
        setCachedImages((prev) => ({ ...prev, [data.id]: cachedImages[product.id] }));
      }
      setProducts((prev) => [data, ...prev]);
      toast.success("Product duplicated");
      notifyProductsChanged();
      moduleEvents.emit("commerce:product_created", "commerce", { productId: data.id, name: data.name, price: data.price });
    }
  }, [businessId, cachedImages, setProducts, setCachedImages]);

  const handleToggleProductActive = useCallback(async (product: Product) => {
    if (!businessId) return;
    const newActive = !product.isActive;
    const { data, error } = await updateProduct({
      businessId,
      productId: product.id,
      isActive: newActive,
    });
    if (error) { toast.error("Failed to update product status"); return; }
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
    const isLocalImage = imageFile != null;
    const serverImageUrl = isLocalImage ? null : (form.imageUrl || null);
    const payload = buildProductPayload(form, serverImageUrl);

    const { data, error } = await updateProduct({ businessId, productId, ...payload });
    if (error) { toast.error("Failed to update product"); throw new Error(error); }
    if (data) {
      if (isLocalImage && imageFile) {
        const dataUrl = await fileToDataUrl(imageFile);
        await syncImageCache(productId, dataUrl, true);
      } else {
        await syncImageCache(productId, null, !!form.imageUrl);
      }
      setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, ...data } : p)));
      toast.success("Product updated");
      notifyProductsChanged();
      moduleEvents.emit("commerce:product_updated", "commerce", { productId, name: data.name });
    }
  }, [businessId, setProducts, syncImageCache]);

  const handleDeleteProduct = useCallback(async (productId: string) => {
    if (!businessId) return;
    const { error } = await deleteProduct(productId, businessId);
    if (error) { toast.error("Failed to delete product"); return; }
    await deleteProductImage(productId).catch(() => {});
    setCachedImages((prev) => { const n = { ...prev }; delete n[productId]; return n; });
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setDeleteConfirm(null);
    toast.success("Product deleted");
    notifyProductsChanged();
    moduleEvents.emit("commerce:product_deleted", "commerce", { productId });
  }, [businessId, setProducts, setCachedImages]);

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
    imageMode,
    setImageMode,
    cachedImages,
    fileInputRef,
    openAddProduct,
    openEditProduct,
    closeProductForm,
    handleFileSelect,
    removeImage,
    handleSaveProduct,
    handleSaveAndAddAnother,
    handleDuplicateProduct,
    handleToggleProductActive,
    handleDeleteProduct,
    handleInlineSave,
  };
}
