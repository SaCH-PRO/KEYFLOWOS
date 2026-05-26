/**
 * Financial utilities — normalization, calculations, formatting.
 */

import type { Invoice, Quote } from "@/lib/client";
import type { FinancialRecord, PipelineMetrics, CashPosition } from "./types";

export function normalizeInvoice(inv: Invoice): FinancialRecord {
  return {
    id: inv.id,
    type: "invoice",
    number: inv.invoiceNumber ?? inv.id.slice(0, 6),
    status: inv.status,
    contact: inv.contact ?? null,
    total: Number(inv.total) ?? 0,
    currency: inv.currency,
    items: (inv.items ?? []).map((i) => ({
      id: i.id ?? `item-${Math.random().toString(36).slice(2)}`,
      description: i.description,
      quantity: i.quantity ?? 1,
      unitPrice: i.unitPrice ?? 0,
      total: i.total ?? 0,
      productId: i.productId,
    })),
    issueDate: inv.issueDate ?? new Date().toISOString(),
    dueDate: inv.dueDate,
    paidAt: inv.paidAt,
    taxRate: inv.taxRate,
    discountType: inv.discountType,
    discountValue: inv.discountValue,
    notes: inv.notes,
    payments: (inv.payments ?? []).map((p) => ({ amount: p.amount, createdAt: p.createdAt })),
    _source: inv,
  };
}

export function normalizeQuote(q: Quote): FinancialRecord {
  return {
    id: q.id,
    type: "quote",
    number: q.quoteNumber ?? q.id.slice(0, 6),
    status: q.status,
    contact: q.contact ?? null,
    total: q.total ?? 0,
    currency: q.currency,
    items: (q.items ?? []).map((i) => ({
      id: i.id ?? `item-${Math.random().toString(36).slice(2)}`,
      description: i.description,
      quantity: i.quantity ?? 1,
      unitPrice: i.unitPrice ?? 0,
      total: i.total ?? 0,
      productId: i.productId,
    })),
    issueDate: q.issueDate ?? q.createdAt ?? new Date().toISOString(),
    dueDate: q.expiryDate,
    convertedToInvoiceId: q.invoiceId,
    notes: q.notes,
    _source: q,
  };
}

export function getPipelineStage(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "draft",
    SENT: "sent",
    VIEWED: "viewed",
    OVERDUE: "action_needed",
    PARTIALLY_PAID: "action_needed",
    ACCEPTED: "accepted",
    PAID: "paid",
    REJECTED: "lost",
    EXPIRED: "lost",
    VOID: "lost",
  };
  return map[status] ?? "draft";
}

export function computePipelineMetrics(records: FinancialRecord[]): PipelineMetrics {
  const m: PipelineMetrics = {
    totalRecords: records.length,
    totalValue: 0,
    draftCount: 0,
    draftValue: 0,
    sentCount: 0,
    sentValue: 0,
    actionCount: 0,
    actionValue: 0,
    wonCount: 0,
    wonValue: 0,
    lostCount: 0,
    lostValue: 0,
  };

  for (const r of records) {
    m.totalValue += r.total;
    const stage = getPipelineStage(r.status);
    if (stage === "draft") { m.draftCount++; m.draftValue += r.total; }
    else if (stage === "sent" || stage === "viewed") { m.sentCount++; m.sentValue += r.total; }
    else if (stage === "action_needed") { m.actionCount++; m.actionValue += r.total; }
    else if (stage === "accepted" || stage === "paid") { m.wonCount++; m.wonValue += r.total; }
    else if (stage === "lost") { m.lostCount++; m.lostValue += r.total; }
  }

  return m;
}

export function computeCashPosition(
  invoices: Invoice[],
  quotes: Quote[],
  currency: string,
): CashPosition {
  const collected = invoices
    .filter((i) => i.status === "PAID")
    .reduce((s, i) => s + Number(i.total), 0);

  const outstanding = invoices
    .filter((i) => i.status === "SENT" || i.status === "OVERDUE")
    .reduce((s, i) => s + Number(i.total), 0);

  const overdue = invoices
    .filter((i) => i.status === "OVERDUE")
    .reduce((s, i) => s + Number(i.total), 0);

  const pipeline = quotes
    .filter((q) => q.status === "ACCEPTED")
    .reduce((s, q) => s + (q.total ?? 0), 0);

  // Simple burn rate: average monthly outgoing (approximate from overdue + void as proxy)
  const voidTotal = invoices.filter((i) => i.status === "VOID").reduce((s, i) => s + Number(i.total), 0);
  const burnRate = (outstanding + voidTotal) / 12;
  const runwayMonths = burnRate > 0 ? collected / burnRate : 999;

  return {
    cashOnHand: collected,
    outstanding,
    overdue,
    pipeline,
    burnRate,
    runwayMonths: Math.round(runwayMonths),
    currency,
  };
}

export function getContactName(contact: { firstName?: string | null; lastName?: string | null } | null): string {
  if (!contact) return "Unknown";
  return `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown";
}
