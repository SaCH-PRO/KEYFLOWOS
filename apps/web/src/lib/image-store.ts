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
