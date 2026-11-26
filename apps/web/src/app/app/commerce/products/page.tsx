"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Package, Plus, Loader2, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { fetchAllProducts, type Product } from "@/lib/client";
import { apiGet } from "@/lib/api";
import { refreshWorkspace, getStoredBusinessId, getCachedBusiness, BUSINESS_CHANGED_EVENT } from "@/lib/workspace";
import { useMemberModuleLevels } from "@/hooks/use-app-layout";
import { hadBrowserOnlyPhotos } from "@/lib/image-store";
import { useProducts } from "../hooks/use-products";
import { ProductsPanel } from "./products-panel";
import { ProductFormModal } from "./product-form-modal";

/**
 * Sales > Products (CATALOG-1, BUG-005; journey B1, B5, B6).
 *
 * The products panel (presentational) lost its host in 6ad9b1c8 and nothing mounted it again, so this route was a
 * 404 while Settings > Catalog's 'Manage products', Your page > Catalog and the command palette's 'Add product'
 * (?action=add) pointed here. It is mounted again through useProducts for create, edit and archive only:
 *   - a product is created in the business currency (Business.currency), and its price shows in it; an edit shows
 *     the product's own currency (COR-CAT-4);
 *   - its photo is an https:// link stored with it (no photo kept in this browser only; lib/image-store.ts is not a
 *     store, and a browser that kept photos is told so once: SEC-CAT-4);
 *   - Archive is the server's soft delete: the product leaves this list, the line pickers and the store, documents
 *     that used it keep their lines, and Trash restores it;
 *   - a member with revenue "read" sees the products and changes nothing (SEC-CAT-1);
 *   - every product is read (paged: COR-CAT-5), again when the business changes (SEC-CAT-5).
 * Services and deposits stay in Schedule > Services, so New product here makes a product or a package (COR-CAT-3);
 * 'Add to store' / 'Remove from store' stay on Your page.
 */

const PHOTO_NOTICE_DISMISSED = "kf-catalog-local-photos-notice-dismissed";

function businessCurrencyOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

type CategoryValue = "SERVICE" | "PRODUCT" | "PACKAGE";
const NEW_PRODUCT_CATEGORIES: readonly CategoryValue[] = ["PRODUCT", "PACKAGE"];

/** lib/workspace keeps the selected business under this localStorage key (another tab's change arrives as storage). */
const BUSINESS_ID_STORAGE_KEY = "kf_business_id";

function ProductsPageInner() {
  const searchParams = useSearchParams();
  const levels = useMemberModuleLevels();
  // Unknown (no answer yet, a failed read) hides nothing; the server still refuses (lib/nav-config canOpenModule).
  const readOnly = levels?.revenue === "read" || levels?.revenue === "none";

  const [businessId, setBusinessId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [photoNotice, setPhotoNotice] = useState(false);
  const actionHandled = useRef(false);
  const loadToken = useRef(0);

  const actions = useProducts(businessId, setProducts, { currency, defaultCategory: "PRODUCT" });
  const { closeProductForm } = actions;

  // The business this page shows now; a reload asked for another (a bulk change answered after a switch) is ignored.
  const currentId = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (currentId.current && currentId.current !== id) return;
    const token = ++loadToken.current;
    setLoading(true);
    setLoadError(null);
    setCurrencyError(null);
    const cached = getCachedBusiness();
    const cachedCurrency = cached?.id === id ? businessCurrencyOf(cached.currency) : null;
    if (cachedCurrency) setCurrency(cachedCurrency);

    // The list does not wait on the currency read (COR-CAT-7, COR-CAT-9): each lands on its own.
    void apiGet<{ currency?: string | null }>(`/identity/businesses/${encodeURIComponent(id)}`).then((bizRes) => {
      if (token !== loadToken.current) return;
      const serverCurrency = businessCurrencyOf(bizRes.data?.currency);
      if (serverCurrency) setCurrency(serverCurrency);
      else if (!cachedCurrency) setCurrencyError(bizRes.error ?? "no currency is set");
    });

    const productsRes = await fetchAllProducts(id);
    if (token !== loadToken.current) return;
    if (productsRes.error) setLoadError(productsRes.error);
    else setProducts((productsRes.data ?? []) as Product[]);
    setLoading(false);
  }, []);

  const start = useCallback(async () => {
    const id = (await refreshWorkspace().catch(() => null)) ?? getStoredBusinessId();
    if (!id) {
      setLoadError("Could not find your workspace. Please sign in again.");
      setLoading(false);
      return;
    }
    currentId.current = id;
    setBusinessId(id);
    await load(id);
  }, [load]);

  useEffect(() => {
    void start();
  }, [start]);

  // SEC-CAT-5: another business selected (here or in another part of the app): nothing of the previous one stays.
  useEffect(() => {
    const onChange = () => {
      loadToken.current += 1;
      closeProductForm();
      setArchiveTarget(null);
      setProducts([]);
      setCurrency(null);
      setCurrencyError(null);
      setBusinessId(null);
      // Until start() settles on it, the newly selected business is the current one (an old reload stays ignored).
      currentId.current = getStoredBusinessId();
      actionHandled.current = true;
      void start();
    };
    // Round 4: a business selected in another tab reaches this one as a storage event on kf_business_id (as Your
    // page and useMemberModuleLevels follow it); the same business, or another key, changes nothing.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== BUSINESS_ID_STORAGE_KEY && e.key !== null) return;
      const next = getStoredBusinessId();
      if (!next || next === currentId.current) return;
      onChange();
    };
    window.addEventListener(BUSINESS_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BUSINESS_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [start, closeProductForm]);

  // SEC-CAT-4: a browser that kept product photos (the old IndexedDB store) is told once; the store is not opened.
  useEffect(() => {
    let dismissed = false;
    try { dismissed = window.localStorage.getItem(PHOTO_NOTICE_DISMISSED) === "1"; } catch { /* private mode */ }
    if (dismissed) return;
    let live = true;
    void hadBrowserOnlyPhotos().then((had) => { if (live && had) setPhotoNotice(true); });
    return () => { live = false; };
  }, []);

  const dismissPhotoNotice = useCallback(() => {
    setPhotoNotice(false);
    try { window.localStorage.setItem(PHOTO_NOTICE_DISMISSED, "1"); } catch { /* private mode */ }
  }, []);

  // A product is created and priced in the business currency, so New product waits for it; never while the page
  // could not load (SEC-CAT-6) or for a member who cannot change products (SEC-CAT-1).
  const canCreate = !!businessId && !!currency && !loading && !loadError && !readOnly;
  const openAdd = canCreate ? actions.openAddProduct : undefined;

  // The command palette's 'Add product' (and any other door) opens New product with ?action=add.
  const { openAddProduct } = actions;
  useEffect(() => {
    if (actionHandled.current || !canCreate) return;
    if (searchParams.get("action") === "add") {
      actionHandled.current = true;
      openAddProduct();
    }
  }, [canCreate, searchParams, openAddProduct]);

  const confirmArchive = useCallback(async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const outcome = await actions.handleArchiveProduct(archiveTarget.id);
      if (outcome.ok) setArchiveTarget(null);
      else setArchiveError(outcome.error);
    } finally {
      setArchiving(false);
    }
  }, [archiveTarget, actions]);

  const askArchive = useCallback((p: Product) => {
    setArchiveError(null);
    setArchiveTarget(p);
  }, []);

  // Escape cancels the Archive confirmation and goes no further (the app's Escape shortcut would leave the page).
  useEffect(() => {
    if (!archiveTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!archiving) setArchiveTarget(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [archiveTarget, archiving]);

  // COR-CAT-4: an edit shows the product's own currency; a new product, the business's.
  const editing = useMemo(
    () => (actions.editingProductId ? products.find((p) => p.id === actions.editingProductId) ?? null : null),
    [actions.editingProductId, products],
  );
  const formCurrency = (editing?.currency ?? currency) ?? undefined;
  // COR-CAT-3: a new product is a product or a package; an edit keeps the card of the category it has.
  const formCategories = useMemo<readonly CategoryValue[]>(() => {
    const own = editing?.category as CategoryValue | undefined;
    return own && !NEW_PRODUCT_CATEGORIES.includes(own) ? [own, ...NEW_PRODUCT_CATEGORIES] : NEW_PRODUCT_CATEGORIES;
  }, [editing]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Package}
        title="Products"
        subtitle={
          <>
            What you sell: create, edit and archive products. Services and deposits are in{" "}
            <Link href="/app/bookings?tab=catalog" className="underline underline-offset-2">Schedule &gt; Services</Link>; what shows on your
            store is chosen on <Link href="/app/store?tab=catalog" className="underline underline-offset-2">Your page</Link>.
          </>
        }
        actionLabel={openAdd ? "New product" : undefined}
        actionIcon={Plus}
        onAction={openAdd}
      />

      {photoNotice && (
        <div role="status" aria-label="Photos kept in this browser" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p className="flex-1">
            Photos you added to products earlier were kept only in this browser, so no other device or customer saw
            them, and they are no longer shown. Add a photo&apos;s https:// link to each product to show it everywhere.
          </p>
          <button type="button" onClick={dismissPhotoNotice} aria-label="Dismiss" className="p-1 rounded-lg hover:bg-muted/50">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {readOnly && !loadError && (
        <p className="text-sm text-muted-foreground">You can see the products. Changing products needs revenue write access.</p>
      )}

      {!loadError && currencyError && !readOnly && (
        <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          Your business&apos;s currency could not be read ({currencyError}), so New product is off until it is: a
          product is priced in that currency.
          {businessId && (
            <button type="button" onClick={() => void load(businessId)} className="ml-2 text-xs font-medium underline underline-offset-2">
              Try again
            </button>
          )}
        </div>
      )}

      {loadError ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm">
          <p className="font-medium text-red-400">Your products could not be loaded.</p>
          <p className="text-muted-foreground mt-1">{loadError}</p>
          {businessId && (
            <button type="button" onClick={() => void load(businessId)} className="mt-3 text-xs font-medium underline underline-offset-2">
              Try again
            </button>
          )}
        </div>
      ) : (
        <ProductsPanel
          products={products}
          loading={loading}
          productSearch={actions.productSearch}
          setProductSearch={actions.setProductSearch}
          onEdit={actions.openEditProduct}
          onDelete={(id) => {
            const p = products.find((x) => x.id === id);
            if (p) askArchive(p);
          }}
          onToggleActive={readOnly ? undefined : actions.handleToggleProductActive}
          onAdd={openAdd ?? (() => {})}
          canAdd={canCreate}
          readOnly={readOnly}
          deleteConfirm={actions.deleteConfirm}
          setDeleteConfirm={actions.setDeleteConfirm}
          businessId={businessId}
          onBulkAction={() => { if (businessId) void load(businessId); }}
          currency={currency ?? undefined}
          onOpenProduct={actions.openEditProduct}
          onArchive={askArchive}
        />
      )}

      <ProductFormModal
        open={actions.showProductForm && !readOnly}
        editingProductId={actions.editingProductId}
        productForm={actions.productForm}
        setProductForm={actions.setProductForm}
        formError={actions.formError}
        saving={actions.saving}
        imagePreview={actions.imagePreview}
        setImagePreview={actions.setImagePreview}
        onClose={actions.closeProductForm}
        onSave={actions.handleSaveProduct}
        onSaveAndAddAnother={actions.handleSaveAndAddAnother}
        onRemoveImage={actions.removeImage}
        currency={formCurrency}
        categories={formCategories}
        categoryHint={<>Bookable services are made in <Link href="/app/bookings?tab=catalog" className="underline underline-offset-2">Schedule &gt; Services</Link>.</>}
      />

      {archiveTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !archiving) setArchiveTarget(null); }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="archive-product-title"
            aria-describedby="archive-product-desc"
            className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-5 shadow-2xl"
          >
            <h2 id="archive-product-title" className="text-base font-semibold">
              Archive &ldquo;{archiveTarget.name}&rdquo;?
            </h2>
            <p id="archive-product-desc" className="text-sm text-muted-foreground mt-2">
              It leaves your products, new quotes and invoices, and your store. Quotes and invoices that already use it
              keep it. You can restore it from <Link href="/app/trash" className="underline underline-offset-2">Trash</Link>.
            </p>
            {archiveError && <p role="alert" className="mt-3 text-sm text-red-400">{archiveError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setArchiveTarget(null)}
                disabled={archiving}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmArchive()}
                disabled={archiving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors disabled:opacity-50"
              >
                {archiving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsPageInner />
    </Suspense>
  );
}
