const PRODUCT_CHANGE_KEY = "kf_products_changed_at";

export function notifyProductsChanged() {
  if (typeof window === "undefined") return;
  const ts = Date.now().toString();
  localStorage.setItem(PRODUCT_CHANGE_KEY, ts);
  window.dispatchEvent(new CustomEvent("kf-products-changed"));
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
