const PRODUCT_CHANGE_KEY = "kf_products_changed_at";
const PRODUCT_LAST_FETCH_KEY = "kf_products_last_fetch";

export function notifyProductsChanged() {
  if (typeof window === "undefined") return;
  const ts = Date.now().toString();
  localStorage.setItem(PRODUCT_CHANGE_KEY, ts);
  window.dispatchEvent(new CustomEvent("kf-products-changed"));
}

export function markProductsFetched() {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRODUCT_LAST_FETCH_KEY, Date.now().toString());
}

export function hasProductChangedSinceLastFetch(): boolean {
  if (typeof window === "undefined") return false;
  const changedAt = parseInt(localStorage.getItem(PRODUCT_CHANGE_KEY) ?? "0", 10);
  const lastFetch = parseInt(localStorage.getItem(PRODUCT_LAST_FETCH_KEY) ?? "0", 10);
  return changedAt > lastFetch;
}

export function onProductsChanged(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = () => callback();

  window.addEventListener("kf-products-changed", handler);

  const storageHandler = (e: StorageEvent) => {
    if (e.key === PRODUCT_CHANGE_KEY) handler();
  };
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener("kf-products-changed", handler);
    window.removeEventListener("storage", storageHandler);
  };
}
