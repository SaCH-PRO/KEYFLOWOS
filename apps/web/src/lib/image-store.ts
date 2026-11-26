/**
 * CATALOG-1 (BUG-005): this module is no longer where product photos are kept.
 *
 * It used to keep each product's photo in this browser's IndexedDB ("keyflow-product-images"), keyed by product
 * id, and the products screens showed that copy over the product's stored image. No other device, and not the
 * public store, ever saw such a photo. A product's photo is now only the link stored with it on the server
 * (Product.imageUrl); the product form offers that link and refuses a browser-only photo.
 *
 * What is left is getAllProductImages, which answers an empty set without opening IndexedDB, so the Sales shell's
 * load (which still asks for it) shows the server's images only. A photo an owner saved here before stays in
 * their browser's storage untouched; nothing reads or writes it.
 */

/** @deprecated CATALOG-1: photos are not kept in this browser; always an empty set (IndexedDB is not opened). */
export async function getAllProductImages(): Promise<Record<string, string>> {
  return {};
}

/** The IndexedDB database the old photo store wrote ("keyflow-product-images"). */
export const LEGACY_PHOTO_DB = "keyflow-product-images";

/**
 * CATALOG-1 (SEC-CAT-4): whether this browser holds the old photo store, so Sales > Products can say once that
 * those photos are no longer shown. It asks the browser for its database names (indexedDB.databases()) and never
 * opens the database (opening would create it) or reads a photo. A browser without databases() answers false.
 */
export async function hadBrowserOnlyPhotos(): Promise<boolean> {
  try {
    if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return false;
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === LEGACY_PHOTO_DB);
  } catch {
    return false;
  }
}
