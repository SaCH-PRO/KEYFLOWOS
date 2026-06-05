"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Plus,
  Send,
  Save,
  Loader2,
  User,
  Calendar,
  FileText,
  Calculator,
  Tag,
  MessageSquare,
  Trash2,
} from "lucide-react";
import {
  fetchContacts,
  fetchProducts,
  createInvoice,
  createProduct,
  Contact,
  Product,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { formatAmount } from "../../utils/commerce-utils";
import { InvoiceLineItem, generateItemId, getDueDateFromTerms, PAYMENT_TERMS } from "../../components/commerce-types";
import { useLineItemHandlers } from "../../hooks/use-line-item-handlers";

export default function NewInvoicePage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessCurrency, setBusinessCurrency] = useState("TTD");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [contactId, setContactId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<InvoiceLineItem[]>([{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }]);
  const [taxRate, setTaxRate] = useState("");
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [discountValue, setDiscountValue] = useState("");
  const [notes, setNotes] = useState("");
  const [templateId, setTemplateId] = useState("classic");

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    const init = async () => {
      const fresh = await refreshWorkspace();
      const id = fresh ?? getStoredBusinessId();
      if (!id) { setLoading(false); return; }
      setBusinessId(id);
      try {
        const [contactsRes, productsRes] = await Promise.all([fetchContacts(id), fetchProducts(id)]);
        if (!mountedRef.current) return;
        setContacts(contactsRes.data?.contacts ?? []);
        setProducts((productsRes.data ?? []).map(p => p as Product));
      } catch { toast.error("Failed to load data"); }
      finally { if (mountedRef.current) setLoading(false); }
    };
    void init();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dup = sessionStorage.getItem("invoice_duplicate");
    if (dup) {
      try {
        const data = JSON.parse(dup);
        setContactId(data.contactId || "");
        setItems(data.items.map((it: { description: string; quantity: number; unitPrice: number; productId?: string }) => ({ id: generateItemId(), productId: it.productId || "", description: it.description, quantity: String(it.quantity), unitPrice: String(it.unitPrice) })));
        setTaxRate(data.taxRate ? String(data.taxRate) : "");
        setDiscountType(data.discountType || "PERCENT");
        setDiscountValue(data.discountValue ? String(data.discountValue) : "");
        setNotes(data.notes || "");
        sessionStorage.removeItem("invoice_duplicate");
        toast.success("Invoice data copied. Edit and save.");
      } catch { /* ignore */ }
    }
  }, []);

  const { addItem, removeItem, updateItem, selectProduct } = useLineItemHandlers((updater) => setItems(prev => updater(prev)), products);

  const computed = useMemo(() => {
    const subtotal = items.reduce((sum, item) => { const qty = parseFloat(item.quantity) || 0; const price = parseFloat(item.unitPrice) || 0; return sum + qty * price; }, 0);
    const discVal = parseFloat(discountValue) || 0;
    const discountAmount = discountType === "PERCENT" ? subtotal * (discVal / 100) : discVal;
    const afterDiscount = Math.max(0, subtotal - discountAmount);
    const tax = parseFloat(taxRate) || 0;
    const taxAmount = afterDiscount * (tax / 100);
    return { subtotal, discountAmount, taxAmount, total: afterDiscount + taxAmount };
  }, [items, taxRate, discountType, discountValue]);

  const selectedContact = contacts.find(c => c.id === contactId);

  async function handleSave(send = false) {
    if (!businessId) return;
    setFormError(null);
    const validItems = items.filter(item => { const hasName = item.isNewItem ? (item.newItemName?.trim() || item.description.trim()) : item.description.trim(); return hasName && item.unitPrice; });
    if (validItems.length === 0) { setFormError("At least one item with description and price is required"); return; }

    const toCatalog = validItems.filter(item => item.isNewItem && item.addToCatalog);
    for (const item of toCatalog) {
      const name = item.newItemName || item.description;
      const { error: pe } = await createProduct({ businessId, name, price: parseFloat(item.unitPrice), category: item.newItemCategory || "SERVICE", description: item.description || "", isActive: true });
      if (pe) { setFormError(`Failed to add "${name}" to catalog: ${pe}`); return; }
    }

    send ? setSending(true) : setSaving(true);
    try {
      const { data, error } = await createInvoice({
        businessId, contactId: contactId || undefined,
        items: validItems.map(item => ({ description: item.isNewItem ? (item.newItemName || item.description) : item.description, quantity: parseInt(item.quantity) || 1, unitPrice: parseFloat(item.unitPrice) })),
        dueDate: dueDate || undefined, taxRate: taxRate ? parseFloat(taxRate) : undefined,
        discountType: discountValue ? discountType : undefined, discountValue: discountValue ? parseFloat(discountValue) : undefined,
        notes: notes || undefined,
      });
      if (error || !data) { setFormError(error ?? "Failed"); toast.error(error ?? "Failed"); }
      else {
        if (send) {
          const { updateInvoiceStatus } = await import("@/lib/client");
          await updateInvoiceStatus(data.id, "SENT");
          toast.success("Invoice created and sent!");
        } else toast.success("Draft saved");
        router.push(`/app/commerce/invoices/${data.id}`);
      }
    } catch (err) { setFormError(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(false); setSending(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto pb-12">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/app/commerce/invoices")} className="p-2 rounded-lg hover:bg-muted transition-colors"><ArrowLeft className="w-4 h-4 text-muted-foreground" /></button>
          <div><h1 className="text-2xl font-bold tracking-tight">New Invoice</h1><p className="text-sm text-muted-foreground">Create and send an invoice to your client</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handleSave(false)} disabled={saving || sending} className="inline-flex items-center gap-1.5 px-4 h-10 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save Draft
          </button>
          <button onClick={() => handleSave(true)} disabled={saving || sending} className="inline-flex items-center gap-1.5 px-4 h-10 text-sm font-semibold rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Save & Send
          </button>
        </div>
      </div>

      {formError && <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{formError}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — Editor */}
        <div className="lg:col-span-2 space-y-6">
          {/* Bill To + Dates */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><User className="w-3.5 h-3.5" />Bill to</label>
                <select value={contactId} onChange={e => setContactId(e.target.value)} className="w-full h-11 px-3 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20 focus:border-[hsl(var(--kf-accent1))]/30">
                  <option value="">Select a client...</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Due date</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full h-11 px-3 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20 focus:border-[hsl(var(--kf-accent1))]/30" />
              </div>
            </div>
            {selectedContact && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/60">
                <div className="w-10 h-10 rounded-full bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center text-sm font-bold text-[hsl(var(--kf-accent1))]">
                  {(selectedContact.firstName?.[0] ?? "") + (selectedContact.lastName?.[0] ?? "")}
                </div>
                <div>
                  <p className="text-sm font-semibold">{`${selectedContact.firstName ?? ""} ${selectedContact.lastName ?? ""}`.trim()}</p>
                  <p className="text-xs text-muted-foreground">{selectedContact.email}</p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {PAYMENT_TERMS.map(t => <button key={t.value} onClick={() => setDueDate(getDueDateFromTerms(t.value))} className="px-3 h-8 text-[11px] rounded-md border border-border bg-muted/30 hover:bg-muted transition-colors text-muted-foreground">{t.label}</button>)}
            </div>
          </div>

          {/* Line Items */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground" />Line Items</h3>
              <button onClick={addItem} className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--kf-accent1))] hover:underline"><Plus className="w-3.5 h-3.5" />Add item</button>
            </div>
            <div className="p-5">
              <div className="hidden sm:grid grid-cols-[1fr_80px_120px_100px_100px_40px] gap-3 mb-2 px-1">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Description</span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Qty</span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Unit Price</span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Tax</span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Total</span>
                <span></span>
              </div>
              <div className="space-y-3">
                {items.map((item, idx) => {
                  const qty = parseFloat(item.quantity) || 0;
                  const price = parseFloat(item.unitPrice) || 0;
                  const total = qty * price;
                  return (
                    <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[1fr_80px_120px_100px_100px_40px] gap-3 items-start p-3 rounded-lg bg-muted/20 border border-border/60">
                      <div className="space-y-1">
                        <label className="sm:hidden text-[10px] text-muted-foreground uppercase">Description</label>
                        <div className="flex gap-2">
                          <select value={item.productId ?? ""} onChange={e => selectProduct(item.id, e.target.value)} className="shrink-0 h-10 px-2 text-xs bg-background border border-border rounded-md focus:outline-none">
                            <option value="">Product...</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            <option value="__NEW__">+ New</option>
                          </select>
                          <input type="text" value={item.description} onChange={e => updateItem(item.id, "description", e.target.value)} placeholder="Item description" className="flex-1 h-10 px-3 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="sm:hidden text-[10px] text-muted-foreground uppercase">Qty</label>
                        <input type="number" min="1" value={item.quantity} onChange={e => updateItem(item.id, "quantity", e.target.value)} className="w-full h-10 px-2 text-sm text-center bg-background border border-border rounded-md focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="sm:hidden text-[10px] text-muted-foreground uppercase">Unit Price</label>
                        <input type="number" step="0.01" value={item.unitPrice} onChange={e => updateItem(item.id, "unitPrice", e.target.value)} className="w-full h-10 px-2 text-sm text-right bg-background border border-border rounded-md focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="sm:hidden text-[10px] text-muted-foreground uppercase">Tax</label>
                        <div className="h-10 flex items-center justify-end text-sm text-muted-foreground">{taxRate ? `${(total * (parseFloat(taxRate) / 100)).toFixed(2)}` : "—"}</div>
                      </div>
                      <div className="space-y-1">
                        <label className="sm:hidden text-[10px] text-muted-foreground uppercase">Total</label>
                        <div className="h-10 flex items-center justify-end text-sm font-semibold">{formatAmount(total, businessCurrency)}</div>
                      </div>
                      <div className="flex justify-end">
                        <button onClick={() => removeItem(item.id)} disabled={items.length <= 1} className="p-2 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
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
                  <select value={discountType} onChange={e => setDiscountType(e.target.value as "PERCENT" | "FIXED")} className="h-10 px-2 text-xs bg-background border border-border rounded-lg focus:outline-none">
                    <option value="PERCENT">%</option>
                    <option value="FIXED">Fixed</option>
                  </select>
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

          {/* Template */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-muted-foreground" />Template</h3>
            <div className="flex gap-2">
              {[{ id: "classic", name: "Classic" }, { id: "modern", name: "Modern" }, { id: "minimal", name: "Minimal" }].map(t => (
                <button key={t.id} onClick={() => setTemplateId(t.id)} className={`px-4 h-9 text-xs font-medium rounded-lg border transition-all ${templateId === t.id ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))]" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"}`}>{t.name}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Right — Summary */}
        <div className="space-y-6">
          <div className="lg:sticky lg:top-4 space-y-6">
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
              <div className="mt-5 space-y-2">
                <button onClick={() => handleSave(true)} disabled={saving || sending} className="w-full h-10 text-sm font-semibold rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save & Send"}
                </button>
                <button onClick={() => handleSave(false)} disabled={saving || sending} className="w-full h-10 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save as Draft"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
