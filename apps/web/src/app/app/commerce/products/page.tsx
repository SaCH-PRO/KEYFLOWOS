"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Package, Plus, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { fetchProducts, type Product } from "@/lib/client";
import { apiGet } from "@/lib/api";
import { refreshWorkspace, getStoredBusinessId, getCachedBusiness } from "@/lib/workspace";
import { useProducts } from "../hooks/use-products";
import { ProductsPanel } from "./products-panel";
import { ProductFormModal } from "./product-form-modal";

/**
 * Sales > Products (CATALOG-1, BUG-005; journey B1, B5, B6).
 *
 * The products panel (presentational) lost its host in 6ad9b1c8 and nothing mounted it again, so this route was a
 * 404 while Settings > Catalog's 'Manage products', Your page > Catalog and the command palette's 'Add product'
 * (?action=add) pointed here. It is mounted again through useProducts for create, edit and archive only:
 *   - a product is created in the business currency (Business.currency), and its price shows in it;
 *   - its photo is the link stored with it (no photo kept in this browser only; lib/image-store.ts is not a store);
 *   - Archive is the server's soft delete: the product leaves this list, the line pickers and the store, documents
 *     that used it keep their lines, and Trash restores it.
 * Services and deposits stay in Schedule > Services; 'Add to store' / 'Remove from store' stay on Your page.
 */

function businessCurrencyOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function ProductsPageInner() {
  const searchParams = useSearchParams();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [archiving, setArchiving] = useState(false);
  const actionHandled = useRef(false);

  const actions = useProducts(businessId, setProducts, { currency });

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError(null);
    const cached = getCachedBusiness();
    const cachedCurrency = cached?.id === id ? businessCurrencyOf(cached.currency) : null;
    if (cachedCurrency) setCurrency(cachedCurrency);
    const [productsRes, bizRes] = await Promise.all([
      fetchProducts(id),
      apiGet<{ currency?: string | null }>(`/identity/businesses/${encodeURIComponent(id)}`),
    ]);
    const serverCurrency = businessCurrencyOf(bizRes.data?.currency);
    if (serverCurrency) setCurrency(serverCurrency);
    if (productsRes.error) setLoadError(productsRes.error);
    // A product is created and priced in the business currency; without it nothing is created (no TTD guess).
    else if (!serverCurrency && !cachedCurrency) setLoadError(bizRes.error ?? "Your business's currency could not be read.");
    else setProducts((productsRes.data ?? []) as Product[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const init = async () => {
      const id = (await refreshWorkspace().catch(() => null)) ?? getStoredBusinessId();
      if (!id) {
        setLoadError("Could not find your workspace. Please sign in again.");
        setLoading(false);
        return;
      }
      setBusinessId(id);
      await load(id);
    };
    void init();
  }, [load]);

  // The command palette's 'Add product' (and any other door) opens New product with ?action=add.
  const { openAddProduct } = actions;
  useEffect(() => {
    if (actionHandled.current || !businessId || !currency || loading || loadError) return;
    if (searchParams.get("action") === "add") {
      actionHandled.current = true;
      openAddProduct();
    }
  }, [businessId, currency, loading, loadError, searchParams, openAddProduct]);

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

  const confirmArchive = useCallback(async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const done = await actions.handleArchiveProduct(archiveTarget.id);
      if (done) setArchiveTarget(null);
    } finally {
      setArchiving(false);
    }
  }, [archiveTarget, actions]);

  // Until the business currency is known, prices show in each product's own currency and nothing can be created.
  const shownCurrency = currency ?? undefined;
  const canCreate = !!businessId && !!currency;
  const openAdd = canCreate ? actions.openAddProduct : undefined;

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
            if (p) setArchiveTarget(p);
          }}
          onToggleActive={actions.handleToggleProductActive}
          onAdd={openAdd ?? (() => {})}
          deleteConfirm={actions.deleteConfirm}
          setDeleteConfirm={actions.setDeleteConfirm}
          businessId={businessId}
          onBulkAction={() => { if (businessId) void load(businessId); }}
          currency={shownCurrency}
          onOpenProduct={actions.openEditProduct}
          onArchive={setArchiveTarget}
        />
      )}

      <ProductFormModal
        open={actions.showProductForm}
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
        currency={shownCurrency}
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
