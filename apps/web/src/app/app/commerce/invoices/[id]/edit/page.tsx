"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Save,
  Loader2,
  User,
  Calendar,
  FileText,
  Calculator,
  MessageSquare,
  Trash2,
  Plus,
} from "lucide-react";
import {
  fetchContacts,
  fetchProducts,
  getInvoice,
  updateInvoice,
  createProduct,
  Contact,
  Product,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { formatAmount } from "../../../utils/commerce-utils";
import { documentAmountsFromForm, formNumber, lineAmount } from "@/lib/finance/document-amounts";
import { InvoiceLineItem, generateItemId } from "../../../components/commerce-types";
import { useLineItemHandlers } from "../../../hooks/use-line-item-handlers";

export default function EditInvoicePage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = params.id as string;

  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessCurrency, setBusinessCurrency] = useState("TTD");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // SWP-INV-FORM-UX (BUG-092): a missing or another business's invoice says so; there is nothing to edit.
  const [notFound, setNotFound] = useState<string | null>(null);
  // Any other failed load (a 500, a refusal, the network) is not "not found": it can be retried.
  const [loadError, setLoadError] = useState<string | null>(null);

  const [contactId, setContactId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<InvoiceLineItem[]>([]);
  const [taxRate, setTaxRate] = useState("");
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [discountValue, setDiscountValue] = useState("");
  const [notes, setNotes] = useState("");

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
      setLoading(true);
      setNotFound(null);
      setLoadError(null);
      const fresh = await refreshWorkspace();
      const id = fresh ?? getStoredBusinessId();
      if (!id) { setLoading(false); return; }
      setBusinessId(id);
      try {
        const [contactsRes, productsRes, invoiceRes] = await Promise.all([fetchContacts(id), fetchProducts(id), getInvoice(id, invoiceId)]);
        if (!mountedRef.current) return;
        setContacts(contactsRes.data?.contacts ?? []);
        setProducts((productsRes.data ?? []).map(p => p as Product));
        if (!invoiceRes.data) {
          if ((invoiceRes as { status?: number }).status === 404) setNotFound(invoiceRes.error ?? "This invoice may have been deleted.");
          else setLoadError(invoiceRes.error ?? "Please check your connection and try again.");
        } else {
          const inv = invoiceRes.data;
          setBusinessCurrency(inv.currency || "TTD");
          setContactId(inv.contactId || "");
          setDueDate(inv.dueDate ? inv.dueDate.split("T")[0] : "");
          setItems((inv.items ?? []).map(item => ({ id: item.id ?? generateItemId(), productId: item.productId ?? "", description: item.description || "", quantity: String(item.quantity), unitPrice: String(item.unitPrice) })));
          setTaxRate(inv.taxRate ? String(inv.taxRate) : "");
          setDiscountType(inv.discountType || "PERCENT");
          setDiscountValue(inv.discountValue ? String(inv.discountValue) : "");
          setNotes(inv.notes || "");
        }
      } catch { toast.error("Failed to load"); }
      finally { if (mountedRef.current) setLoading(false); }
  }, [invoiceId]);

  useEffect(() => { void load(); }, [load]);

  const { addItem, removeItem, updateItem, selectProduct } = useLineItemHandlers((updater) => setItems(prev => updater(prev)), products);

  const computed = useMemo(() => {
    // SWP-INV-MATH: the server's amounts, in cents, tax on the subtotal before the discount (D-164).
    return documentAmountsFromForm({ items, taxRate, discountType, discountValue });
  }, [items, taxRate, discountType, discountValue]);

  const selectedContact = contacts.find(c => c.id === contactId);

  async function handleSave() {
    if (!businessId || !invoiceId) return;
    setFormError(null);
    const validItems = items.filter(item => { const hasName = item.isNewItem ? (item.newItemName?.trim() || item.description.trim()) : item.description.trim(); return hasName && item.unitPrice; });
    if (validItems.length === 0) { setFormError("At least one item required"); return; }
    // SWP-INV-FORM-UX (BUG-090): an invoice is to someone; say so in plain words and send nothing.
    if (!contactId) { setFormError("Choose a client for this invoice."); return; }

    const toCatalog = validItems.filter(item => item.isNewItem && item.addToCatalog);
    for (const item of toCatalog) {
      const name = item.newItemName || item.description;
      const { error: pe } = await createProduct({ businessId, name, price: parseFloat(item.unitPrice), category: item.newItemCategory || "SERVICE", description: item.description || "", isActive: true });
      if (pe) { setFormError(`Failed to add "${name}" to catalog: ${pe}`); return; }
    }

    setSaving(true);
    try {
      const { data, error } = await updateInvoice({
        businessId, invoiceId, contactId: contactId || undefined,
        items: validItems.map(item => ({ description: item.isNewItem ? (item.newItemName || item.description) : item.description, quantity: parseInt(item.quantity) || 1, unitPrice: parseFloat(item.unitPrice) })),
        dueDate: dueDate || null,
        // BUG-019: a cleared rate is sent as 0, so the server removes the tax (undefined kept the old rate).
        taxRate: formNumber(taxRate),
        discountType: discountValue ? discountType : null, discountValue: discountValue ? parseFloat(discountValue) : null,
        notes: notes || null,
      });
      if (error || !data) { setFormError(error ?? "Failed"); toast.error(error ?? "Failed"); }
      else { toast.success("Invoice updated"); router.push(`/app/commerce/invoices/${invoiceId}`); }
    } catch (err) { setFormError(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  if (notFound) return (
    <div className="max-w-4xl mx-auto py-20 text-center">
      <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
      <h2 className="text-lg font-semibold mb-2">Invoice not found</h2>
      <p className="text-sm text-muted-foreground mb-4">{notFound}</p>
      <button onClick={() => router.push("/app/commerce/invoices")} className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 transition-colors">Back to invoices</button>
    </div>
  );

  if (loadError) return (
    <div className="max-w-4xl mx-auto py-20 text-center">
      <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
      <h2 className="text-lg font-semibold mb-2">Couldn&apos;t load this invoice</h2>
      <p className="text-sm text-muted-foreground mb-4">{loadError}</p>
      <div className="flex items-center justify-center gap-2">
        <button onClick={() => void load()} className="px-4 py-2 text-sm font-medium rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity">Try again</button>
        <button onClick={() => router.push("/app/commerce/invoices")} className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 transition-colors">Back to invoices</button>
      </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(`/app/commerce/invoices/${invoiceId}`)} className="p-2 rounded-lg hover:bg-muted transition-colors"><ArrowLeft className="w-4 h-4 text-muted-foreground" /></button>
          <div><h1 className="text-2xl font-bold tracking-tight">Edit Invoice</h1><p className="text-sm text-muted-foreground">Make changes to your invoice</p></div>
        </div>
        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 h-10 text-sm font-semibold rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save Changes
        </button>
      </div>

      {formError && <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{formError}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Details */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><User className="w-3.5 h-3.5" />Bill to</label>
                <select value={contactId} onChange={e => setContactId(e.target.value)} aria-invalid={formError === "Choose a client for this invoice." || undefined} className="w-full h-11 px-3 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20">
                  <option value="">Select a client...</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Due date</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full h-11 px-3 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20" />
              </div>
            </div>
            {selectedContact && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/60">
                <div className="w-10 h-10 rounded-full bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center text-sm font-bold text-[hsl(var(--kf-accent1))]">{(selectedContact.firstName?.[0] ?? "") + (selectedContact.lastName?.[0] ?? "")}</div>
                <div><p className="text-sm font-semibold">{`${selectedContact.firstName ?? ""} ${selectedContact.lastName ?? ""}`.trim()}</p><p className="text-xs text-muted-foreground">{selectedContact.email}</p></div>
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground" />Line Items</h3>
              <button onClick={addItem} className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--kf-accent1))] hover:underline"><Plus className="w-3.5 h-3.5" />Add item</button>
            </div>
            <div className="p-5 space-y-3">
              {items.map((item) => {
                const total = lineAmount(formNumber(item.quantity), formNumber(item.unitPrice));
                return (
                  <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[72px_112px_minmax(0,1fr)_40px] gap-x-3 gap-y-2 items-end p-3 rounded-lg bg-muted/20 border border-border/60">
                    <div className="space-y-1 min-w-0 sm:col-span-4">
                      <label className="text-[10px] text-muted-foreground uppercase">Description</label>
                      <div className="flex gap-2 min-w-0">
                        <select value={item.productId ?? ""} onChange={e => selectProduct(item.id, e.target.value)} className="shrink-0 w-24 h-10 px-2 text-xs bg-background border border-border rounded-md focus:outline-none">
                          <option value="">Product...</option>
                          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          <option value="__NEW__">+ New</option>
                        </select>
                        <input type="text" value={item.description} onChange={e => updateItem(item.id, "description", e.target.value)} placeholder="Description" className="flex-1 min-w-0 h-10 px-3 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20" />
                      </div>
                    </div>
                    <div className="space-y-1"><label className="text-[10px] text-muted-foreground uppercase">Qty</label><input type="number" min="1" value={item.quantity} onChange={e => updateItem(item.id, "quantity", e.target.value)} className="w-full h-10 px-2 text-sm text-center bg-background border border-border rounded-md focus:outline-none" /></div>
                    <div className="space-y-1"><label className="text-[10px] text-muted-foreground uppercase">Unit Price</label><input type="number" step="0.01" value={item.unitPrice} onChange={e => updateItem(item.id, "unitPrice", e.target.value)} className="w-full h-10 px-2 text-sm text-right bg-background border border-border rounded-md focus:outline-none" /></div>
                    <div className="space-y-1 min-w-0"><label className="block text-right text-[10px] text-muted-foreground uppercase">Total</label><div className="h-10 flex items-center justify-end text-sm font-semibold whitespace-nowrap" data-testid="invoice-line-total">{formatAmount(total, businessCurrency)}</div></div>
                    <div className="flex justify-end"><button onClick={() => removeItem(item.id)} disabled={items.length <= 1} aria-label="Remove line" className="p-2 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30"><Trash2 className="w-4 h-4" /></button></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tax & Discount */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Calculator className="w-4 h-4 text-muted-foreground" />Tax & Discount</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Tax Rate (%)</label>
                <input type="number" step="0.01" value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="0" className="w-full h-10 px-3 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Discount</label>
                <div className="flex gap-2">
                  <select value={discountType} onChange={e => setDiscountType(e.target.value as "PERCENT" | "FIXED")} className="h-10 px-2 text-xs bg-background border border-border rounded-lg focus:outline-none"><option value="PERCENT">%</option><option value="FIXED">Fixed</option></select>
                  <input type="number" step="0.01" value={discountValue} onChange={e => setDiscountValue(e.target.value)} placeholder="0" className="flex-1 h-10 px-3 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20" />
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4 text-muted-foreground" />Notes</h3>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Payment terms, thank you message, or any additional notes..." rows={3} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20 resize-none" />
          </div>
        </div>

        {/* Right Summary */}
        <div className="space-y-6">
          <div className="lg:sticky lg:top-4">
            <div className="rounded-xl border border-border bg-card shadow-sm p-5">
              <h3 className="text-sm font-semibold mb-4">Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span className="font-medium">{formatAmount(computed.subtotal, businessCurrency)}</span></div>
                {computed.discountAmount > 0 && <div className="flex justify-between text-sm text-emerald-600"><span>Discount</span><span>-{formatAmount(computed.discountAmount, businessCurrency)}</span></div>}
                {computed.taxAmount > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tax</span><span className="font-medium">{formatAmount(computed.taxAmount, businessCurrency)}</span></div>}
                <div className="border-t border-border pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold">Total due</span>
                    <span className="text-2xl font-extrabold text-[hsl(var(--kf-accent1))]">{formatAmount(computed.total, businessCurrency)}</span>
                  </div>
                </div>
              </div>
              <button onClick={handleSave} disabled={saving} className="w-full mt-5 h-10 text-sm font-semibold rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
