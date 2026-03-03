"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  createProduct,
  fetchProducts,
  fetchInvoices,
  fetchContacts,
  listQuotes,
  updateProduct,
  deleteProduct,
  getGmailStatus,
  getGmailAuthUrl,
  disconnectGmail,
  Product,
  Invoice,
  Contact,
  Quote,
} from "@/lib/client";
import { apiGet } from "@/lib/api";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import {
  saveProductImage,
  deleteProductImage,
  fileToDataUrl,
  getAllProductImages,
} from "@/lib/image-store";
import { notifyProductsChanged } from "@/lib/product-sync";
import { Tab, ProductForm, InvoiceLineItem, generateItemId } from "../components/commerce-types";

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

const DEFAULT_LINE_ITEMS: InvoiceLineItem[] = [
  { id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" },
];

export function useCommerce() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showQuoteBuilder, setShowQuoteBuilder] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteForm, setQuoteForm] = useState({
    contactId: "",
    expiryDate: "",
    items: [...DEFAULT_LINE_ITEMS],
    taxRate: "12.5",
    discountType: "PERCENT" as "PERCENT" | "FIXED",
    discountValue: "",
    notes: "",
  });

  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [loadingGmail, setLoadingGmail] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);

  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>({ ...DEFAULT_PRODUCT_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<"upload" | "url">("upload");
  const [cachedImages, setCachedImages] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [confirmDisconnectGmail, setConfirmDisconnectGmail] = useState(false);
  const [paymentGateways, setPaymentGateways] = useState<{ wipay: boolean; paypal: boolean }>({ wipay: false, paypal: false });

  const [showGuide, setShowGuide] = useState(false);
  const [recurringTriggerNew, setRecurringTriggerNew] = useState(0);
  const [showInvoiceBuilder, setShowInvoiceBuilder] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({
    contactId: "",
    dueDate: "",
    items: [...DEFAULT_LINE_ITEMS],
    taxRate: "12.5",
    discountType: "PERCENT" as "PERCENT" | "FIXED",
    discountValue: "",
    notes: "",
  });

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) { setBusinessId(fresh); setWorkspaceLoading(false); return; }
      const stored = getStoredBusinessId();
      if (stored) { setBusinessId(stored); setWorkspaceLoading(false); return; }
      setWorkspaceError("Could not find your workspace. Please sign in again.");
      setWorkspaceLoading(false);
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      try {
        const [productsRes, invoicesRes, contactsRes, quotesRes, gmailRes, bizRes] = await Promise.all([
          fetchProducts(businessId),
          fetchInvoices(businessId),
          fetchContacts(businessId),
          listQuotes(businessId),
          getGmailStatus(businessId),
          apiGet<{ metaData: Record<string, any> }>(`/identity/businesses/${businessId}`),
        ]);
        setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
        setInvoices(invoicesRes.data ?? []);
        setContacts(contactsRes.data?.contacts ?? []);
        setQuotes(quotesRes.data ?? []);
        if (gmailRes.data) setGmailStatus(gmailRes.data);
        if (bizRes.data?.metaData) {
          const meta = bizRes.data.metaData;
          setPaymentGateways({
            wipay: Boolean(meta.wipayApiKey || meta.wipayAccountNumber),
            paypal: Boolean(meta.paypalClientId && meta.paypalClientSecret),
          });
        }
        if (productsRes.error) setError(productsRes.error);
        try { const imgs = await getAllProductImages(); setCachedImages(imgs); } catch {}
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && businessId) {
        const reload = async () => {
          const productsRes = await fetchProducts(businessId);
          setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
        };
        void reload();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [businessId]);

  const refreshProducts = useCallback(async () => {
    if (!businessId) return;
    const res = await fetchProducts(businessId);
    setProducts((res.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
  }, [businessId]);

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
  }, [businessId, productForm, editingProductId, imagePreview, closeProductForm]);

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
  }, [businessId, cachedImages]);

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
  }, [businessId]);

  const handleDeleteProduct = useCallback(async (productId: string) => {
    if (!businessId) return;
    const { error } = await deleteProduct(productId, businessId);
    if (error) { setError(error); toast.error("Failed to delete product"); return; }
    await deleteProductImage(productId).catch(() => {});
    setCachedImages((prev) => { const n = { ...prev }; delete n[productId]; return n; });
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setDeleteConfirm(null);
    toast.success("Product deleted");
    notifyProductsChanged();
  }, [businessId]);

  const resetQuoteForm = useCallback(() => {
    setQuoteForm({
      contactId: "",
      expiryDate: "",
      items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "",
      notes: "",
    });
    setEditingQuoteId(null);
  }, []);

  const resetInvoiceForm = useCallback(() => {
    setEditingInvoiceId(null);
    setInvoiceForm({
      contactId: "",
      dueDate: "",
      items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "",
      notes: "",
    });
  }, []);

  const handleToggleGuide = useCallback(() => setShowGuide((prev) => !prev), []);

  const handleTabChange = useCallback((t: string) => setTab(t as Tab), []);

  const handleConnectGmail = useCallback(async () => {
    if (!businessId) return;
    setLoadingGmail(true);
    const res = await getGmailAuthUrl(businessId);
    if (res.data?.url) window.location.href = res.data.url;
    setLoadingGmail(false);
  }, [businessId]);

  const handleDisconnectGmail = useCallback(async () => {
    if (!businessId) return;
    await disconnectGmail(businessId);
    setGmailStatus({ connected: false, email: null });
    toast.success("Gmail disconnected");
    setConfirmDisconnectGmail(false);
  }, [businessId]);

  const handleNewQuote = useCallback(() => {
    setEditingQuoteId(null);
    resetQuoteForm();
    setShowQuoteBuilder(true);
  }, [resetQuoteForm]);

  const handleNewInvoice = useCallback(() => {
    setShowInvoiceBuilder((prev) => !prev);
  }, []);

  const handleNewRecurring = useCallback(() => {
    setRecurringTriggerNew((n) => n + 1);
  }, []);

  const handleNewItem = useCallback(() => {
    if (tab === "products") openAddProduct();
    else if (tab === "quotes") handleNewQuote();
    else if (tab === "invoices") handleNewInvoice();
    else if (tab === "recurring") handleNewRecurring();
  }, [tab, openAddProduct, handleNewQuote, handleNewInvoice, handleNewRecurring]);

  return {
    businessId,
    workspaceLoading,
    workspaceError,
    tab,
    setTab,
    handleTabChange,
    products,
    setProducts,
    invoices,
    setInvoices,
    quotes,
    setQuotes,
    contacts,
    loading,
    error,

    showQuoteBuilder,
    setShowQuoteBuilder,
    editingQuoteId,
    setEditingQuoteId,
    quoteForm,
    setQuoteForm,
    resetQuoteForm,

    gmailStatus,
    loadingGmail,
    showContactPicker,
    setShowContactPicker,
    handleConnectGmail,
    handleDisconnectGmail,
    confirmDisconnectGmail,
    setConfirmDisconnectGmail,

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
    refreshProducts,

    paymentGateways,
    showGuide,
    handleToggleGuide,
    recurringTriggerNew,
    showInvoiceBuilder,
    setShowInvoiceBuilder,
    editingInvoiceId,
    setEditingInvoiceId,
    invoiceForm,
    setInvoiceForm,
    resetInvoiceForm,

    handleNewQuote,
    handleNewInvoice,
    handleNewRecurring,
    handleNewItem,
  };
}
