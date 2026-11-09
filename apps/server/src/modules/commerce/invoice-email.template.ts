import { fromCents, lineAmount, toCents } from './money';

/**
 * FOLLOW3-B5-EMAIL-LINE-TOTALS (VL-09; owner ruling D-13: cents at every
 * boundary): one line of a customer document as the emails print it.
 *
 * `total` is the line total the document stores (InvoiceItem.total,
 * QuoteItem.total): V1-22 writes it as lineAmount(quantity, unitPrice), the
 * exact decimal product rounded half away from zero to cents, and the
 * subtotal is the sum of those stored lines. The templates print it, so the
 * printed lines add up to the printed Subtotal and agree with the public
 * invoice page. They used to print the binary float product toFixed(2)
 * (7 x 0.145 read TT$1.01 and 3 x 1.115 read TT$3.34 above a Subtotal of
 * TT$4.37). A line without a stored total is printed as lineAmount(quantity,
 * unitPrice).
 */
export interface DocumentEmailItem {
  description: string;
  quantity: number;
  unitPrice: number;
  /** The stored line total; absent, the line is lineAmount(quantity, unitPrice). */
  total?: number | null;
}

/** A stored document line as the loaders return it (Prisma Float columns, or a slim projection). */
export interface StoredDocumentLine {
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  total?: number | string | null;
}

/**
 * The lines handed to an email template: every builder (the invoice, reminder
 * and resend-receipt emails, the invoice.paid receipt, the quote email) maps
 * the stored rows through here, so each line carries its stored total.
 */
export function emailLineItems(items: ReadonlyArray<StoredDocumentLine> | null | undefined): DocumentEmailItem[] {
  return (items ?? []).map((it) => ({
    description: it.description,
    quantity: Number(it.quantity),
    unitPrice: Number(it.unitPrice),
    ...(it.total != null ? { total: Number(it.total) } : {}),
  }));
}

/** The line total an email prints: the stored total, or lineAmount(quantity, unitPrice) when there is none. */
export function emailLineTotal(item: DocumentEmailItem): number {
  if (item.total != null && Number.isFinite(item.total)) return item.total;
  return lineAmount(item.quantity, item.unitPrice);
}

/**
 * An amount's digits as the emails print them: its decimal value rounded half
 * away from zero to cents (toCents / fromCents, money.ts), the rule the public
 * invoice page's Intl formatting matches. A unit price of 0.145 reads 0.15 and
 * a legacy stored total of 1.015 reads 1.02 (toFixed(2) on the binary value
 * read 0.14 and 1.01). An absent or non-finite amount reads 0.00, as before.
 */
export function emailMoneyDigits(amount: number | null | undefined): string {
  const cents = toCents(Number(amount) || 0);
  return fromCents(Number.isFinite(cents) ? cents : 0).toFixed(2);
}

export interface InvoiceEmailData {
  businessName: string;
  businessLogo?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  primaryColor?: string;
  contactName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  items: DocumentEmailItem[];
  subtotal: number;
  taxRate?: number | null;
  taxAmount?: number | null;
  discountType?: string | null;
  discountValue?: number | null;
  discountAmount?: number | null;
  total: number;
  amountPaid?: number;
  amountRemaining?: number;
  currency: string;
  notes?: string | null;
  invoiceUrl?: string | null;
  paymentUrl?: string | null;
  customMessage?: string | null;
  variant?: 'invoice' | 'reminder' | 'receipt';
}

function fmt(amount: number, currency: string) {
  const sym = currency === 'TTD' ? 'TT$' : currency === 'USD' ? '$' : `${currency} `;
  return `${sym}${emailMoneyDigits(amount)}`;
}

export function buildInvoiceEmailHtml(data: InvoiceEmailData): string {
  const variant = data.variant ?? 'invoice';
  const primary = data.primaryColor || '#F97316';

  const heading =
    variant === 'reminder'
      ? `Friendly reminder: Invoice #${data.invoiceNumber}`
      : variant === 'receipt'
        ? `Payment received — Receipt for Invoice #${data.invoiceNumber}`
        : `Invoice #${data.invoiceNumber} from ${data.businessName}`;

  const intro =
    variant === 'reminder'
      ? `Hi ${data.contactName}, this is a friendly reminder that invoice <strong>#${data.invoiceNumber}</strong> for ${fmt(data.amountRemaining ?? data.total, data.currency)} is awaiting payment${data.dueDate ? ` (due ${data.dueDate})` : ''}.`
      : variant === 'receipt'
        ? `Hi ${data.contactName}, thank you! We've received your payment of ${fmt(data.amountPaid ?? data.total, data.currency)} for invoice <strong>#${data.invoiceNumber}</strong>. This email is your receipt.`
        : `Hi ${data.contactName}, please find your invoice <strong>#${data.invoiceNumber}</strong> for ${fmt(data.total, data.currency)} below${data.dueDate ? `. Payment due ${data.dueDate}` : ''}.`;

  const items = data.items
    .map(
      (it) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">${it.description}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${it.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(it.unitPrice, data.currency)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(emailLineTotal(it), data.currency)}</td>
    </tr>`,
    )
    .join('');

  const taxRow =
    data.taxRate && data.taxAmount
      ? `<tr><td colspan="3" style="padding:6px 12px;text-align:right;color:#6b7280">Tax (${data.taxRate}%)</td><td style="padding:6px 12px;text-align:right">${fmt(data.taxAmount, data.currency)}</td></tr>`
      : '';
  const discountRow =
    data.discountAmount && data.discountAmount > 0
      ? `<tr><td colspan="3" style="padding:6px 12px;text-align:right;color:#6b7280">Discount${data.discountType === 'PERCENT' ? ` (${data.discountValue}%)` : ''}</td><td style="padding:6px 12px;text-align:right;color:#16a34a">-${fmt(data.discountAmount, data.currency)}</td></tr>`
      : '';

  const paidLine =
    variant !== 'invoice' && (data.amountPaid ?? 0) > 0
      ? `<tr><td colspan="3" style="padding:6px 12px;text-align:right;color:#16a34a">Paid</td><td style="padding:6px 12px;text-align:right;color:#16a34a">${fmt(data.amountPaid ?? 0, data.currency)}</td></tr>`
      : '';
  const remainingLine =
    variant === 'reminder' && (data.amountRemaining ?? 0) > 0
      ? `<tr><td colspan="3" style="padding:6px 12px;text-align:right;color:#92400e;font-weight:600">Balance due</td><td style="padding:6px 12px;text-align:right;color:#92400e;font-weight:600">${fmt(data.amountRemaining ?? 0, data.currency)}</td></tr>`
      : '';

  const cta =
    variant !== 'receipt' && data.paymentUrl
      ? `<div style="text-align:center;margin:24px 0"><a href="${data.paymentUrl}" style="display:inline-block;background:${primary};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">${variant === 'reminder' ? 'Pay now' : 'View & pay invoice'}</a></div>`
      : '';

  const footer = data.customMessage
    ? `<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0">${data.customMessage}</p>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <tr><td style="padding:24px;border-bottom:3px solid ${primary}">
          ${data.businessLogo ? `<img src="${data.businessLogo}" alt="${data.businessName}" style="max-height:48px;margin-bottom:8px"/>` : ''}
          <h1 style="margin:0;font-size:18px;color:#111827">${data.businessName}</h1>
          ${data.businessEmail || data.businessPhone ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280">${[data.businessEmail, data.businessPhone].filter(Boolean).join(' · ')}</p>` : ''}
        </td></tr>
        <tr><td style="padding:24px">
          <h2 style="margin:0 0 8px;font-size:20px;color:#111827">${heading}</h2>
          <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6">${intro}</p>
          ${cta}
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
            <thead><tr style="background:#f3f4f6">
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase">Item</th>
              <th style="padding:10px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase">Qty</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase">Price</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase">Total</th>
            </tr></thead>
            <tbody>${items}</tbody>
            <tfoot>
              <tr><td colspan="3" style="padding:6px 12px;text-align:right;color:#6b7280">Subtotal</td><td style="padding:6px 12px;text-align:right">${fmt(data.subtotal, data.currency)}</td></tr>
              ${discountRow}${taxRow}
              <tr><td colspan="3" style="padding:10px 12px;text-align:right;font-weight:700;border-top:1px solid #e5e7eb">Total</td><td style="padding:10px 12px;text-align:right;font-weight:700;border-top:1px solid #e5e7eb;color:${primary}">${fmt(data.total, data.currency)}</td></tr>
              ${paidLine}${remainingLine}
            </tfoot>
          </table>
          ${data.notes ? `<div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:8px;color:#374151;font-size:13px;white-space:pre-wrap">${data.notes}</div>` : ''}
          ${footer}
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f9fafb;color:#9ca3af;font-size:12px;text-align:center">
          Issued ${data.invoiceDate}${data.invoiceUrl ? ` · <a href="${data.invoiceUrl}" style="color:${primary}">View online</a>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
