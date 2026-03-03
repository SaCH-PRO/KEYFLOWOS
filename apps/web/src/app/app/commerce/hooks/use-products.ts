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
    const durationValue = productForm.duration ? parseInt(productForm.duration) : null;
    const isLocalImage = imagePreview?.startsWith("data:");
    const serverImageUrl = isLocalImage ? null : (productForm.imageUrl || null);

    if (editingProductId) {
      const { data, error } = await updateProduct({
        businessId,
        productId: editingProductId,
        name: parsed.data.name,
        price: parsed.data.price,
        description: parsed.data.description ?? null,
        category: productForm.category,
        duration: durationValue,
        imageUrl: serverImageUrl,
        sku: productForm.sku || null,
        isActive: productForm.isActive,
      });
      if (error) { setFormError(error); toast.error("Failed to update product"); return; }
      if (data) {
        if (isLocalImage && imagePreview) {
          await saveProductImage(editingProductId, imagePreview);
          setCachedImages((prev) => ({ ...prev, [editingProductId]: imagePreview }));
        } else if (!imagePreview) {
          await deleteProductImage(editingProductId);
          setCachedImages((prev) => { const n = { ...prev }; delete n[editingProductId]; return n; });
        }
        setProducts((prev) => prev.map((p) => (p.id === editingProductId ? { ...p, ...data } : p)));
        closeProductForm();
        toast.success("Product updated");
        notifyProductsChanged();
      }
    } else {
      const { data, error } = await createProduct({
        businessId,
        name: parsed.data.name,
        price: parsed.data.price,
        description: parsed.data.description,
        category: productForm.category,
        duration: durationValue,
        imageUrl: serverImageUrl,
        sku: productForm.sku || null,
        isActive: productForm.isActive,
      });
      if (error) { setFormError(error); toast.error("Failed to create product"); return; }
      if (data) {
        if (isLocalImage && imagePreview) {
          await saveProductImage(data.id, imagePreview);
          setCachedImages((prev) => ({ ...prev, [data.id]: imagePreview }));
        }
        setProducts((prev) => [data, ...prev]);
        closeProductForm();
        toast.success("Product created");
        notifyProductsChanged();
      }
    }
  }, [businessId, productForm, editingProductId, imagePreview, closeProductForm, setProducts, setCachedImages]);

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
    }
  }, [businessId, setProducts]);

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
  }, [businessId, setProducts, setCachedImages]);

  return {
    showProductForm,
    editingProductId,
    productForm,
    setProductForm,
    formError,
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
    handleDuplicateProduct,
    handleToggleProductActive,
    handleDeleteProduct,
  };
}
