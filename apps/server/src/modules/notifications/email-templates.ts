export interface TemplateContext {
  businessName: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
  primaryColor?: string;
  secondaryColor?: string;
  customerName: string;
  [key: string]: any;
}

function baseLayout(ctx: TemplateContext, title: string, body: string): string {
  const primary = ctx.primaryColor || '#F97316';
  const secondary = ctx.secondaryColor || '#14B8A6';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#111113;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111113;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#1a1a1e;border-radius:12px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,${primary},${secondary});padding:24px 32px;">
<h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">${ctx.businessName}</h1>
</td></tr>
<tr><td style="padding:32px;">
${body}
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #2a2a2e;">
<p style="margin:0;color:#71717a;font-size:12px;line-height:1.5;">
${ctx.businessName}${ctx.businessAddress ? ` &middot; ${ctx.businessAddress}` : ''}${ctx.businessPhone ? ` &middot; ${ctx.businessPhone}` : ''}
</p>
<p style="margin:4px 0 0;color:#52525b;font-size:11px;">This is an automated message. Please do not reply directly to this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 16px;color:#fafafa;font-size:16px;font-weight:600;">${text}</h2>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;color:#d4d4d8;font-size:14px;line-height:1.6;">${text}</p>`;
}

function detailRow(label: string, value: string): string {
  return `<tr>
<td style="padding:8px 12px;color:#a1a1aa;font-size:13px;border-bottom:1px solid #27272a;">${label}</td>
<td style="padding:8px 12px;color:#fafafa;font-size:13px;font-weight:500;text-align:right;border-bottom:1px solid #27272a;">${value}</td>
</tr>`;
}

function detailTable(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#27272a;border-radius:8px;overflow:hidden;">
${rows}
</table>`;
}

function ctaButton(text: string, url: string, color?: string): string {
  const bg = color || '#F97316';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="background-color:${bg};border-radius:8px;padding:12px 24px;">
<a href="${url}" target="_blank" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;">${text}</a>
</td></tr>
</table>`;
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-TT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleTimeString('en-TT', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatCurrency(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export function bookingConfirmedTemplate(ctx: TemplateContext & {
  serviceName: string;
  startTime: Date | string;
  endTime: Date | string;
  staffName?: string;
  bookingId: string;
}): { subject: string; html: string } {
  const subject = `Your booking with ${ctx.businessName} is confirmed`;
  const body = [
    heading('Booking Confirmed &#10003;'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Your appointment has been confirmed. Here are the details:`),
    detailTable([
      detailRow('Service', ctx.serviceName),
      detailRow('Date', formatDate(ctx.startTime)),
      detailRow('Time', `${formatTime(ctx.startTime)} &ndash; ${formatTime(ctx.endTime)}`),
      ctx.staffName ? detailRow('With', ctx.staffName) : '',
      detailRow('Reference', ctx.bookingId.slice(-8).toUpperCase()),
    ].join('')),
    ctx.businessAddress ? paragraph(`&#128205; ${ctx.businessAddress}`) : '',
    paragraph('We look forward to seeing you!'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function bookingReminderTemplate(ctx: TemplateContext & {
  serviceName: string;
  startTime: Date | string;
  endTime: Date | string;
  staffName?: string;
  bookingId: string;
}): { subject: string; html: string } {
  const subject = `Reminder: Your appointment with ${ctx.businessName} is tomorrow`;
  const body = [
    heading('Appointment Reminder'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`This is a friendly reminder that your appointment is coming up tomorrow.`),
    detailTable([
      detailRow('Service', ctx.serviceName),
      detailRow('Date', formatDate(ctx.startTime)),
      detailRow('Time', `${formatTime(ctx.startTime)} &ndash; ${formatTime(ctx.endTime)}`),
      ctx.staffName ? detailRow('With', ctx.staffName) : '',
    ].join('')),
    ctx.businessAddress ? paragraph(`&#128205; ${ctx.businessAddress}`) : '',
    paragraph('If you need to reschedule, please contact us as soon as possible.'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function invoiceSentTemplate(ctx: TemplateContext & {
  invoiceNumber: string;
  total: number;
  currency: string;
  dueDate?: Date | string | null;
  invoiceUrl?: string;
  items?: { description: string; quantity: number; unitPrice: number; total: number }[];
}): { subject: string; html: string } {
  const subject = `Invoice ${ctx.invoiceNumber} from ${ctx.businessName}`;
  const itemRows = ctx.items?.map(item =>
    detailRow(
      `${item.description} &times; ${item.quantity}`,
      formatCurrency(item.total, ctx.currency),
    ),
  ).join('') ?? '';
  const body = [
    heading('New Invoice'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`You have a new invoice from ${ctx.businessName}.`),
    detailTable([
      detailRow('Invoice #', ctx.invoiceNumber),
      itemRows,
      detailRow('Total Due', `<strong>${formatCurrency(ctx.total, ctx.currency)}</strong>`),
      ctx.dueDate ? detailRow('Due Date', formatDate(ctx.dueDate)) : '',
    ].join('')),
    ctx.invoiceUrl ? ctaButton('View Invoice', ctx.invoiceUrl) : '',
    paragraph('Thank you for your business.'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function paymentReceiptTemplate(ctx: TemplateContext & {
  invoiceNumber: string;
  total: number;
  currency: string;
  paidAt: Date | string;
  invoiceUrl?: string;
}): { subject: string; html: string } {
  const subject = `Payment receipt from ${ctx.businessName}`;
  const body = [
    heading('Payment Received &#10003;'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`We have received your payment. Here is your receipt.`),
    detailTable([
      detailRow('Invoice #', ctx.invoiceNumber),
      detailRow('Amount Paid', formatCurrency(ctx.total, ctx.currency)),
      detailRow('Paid On', formatDate(ctx.paidAt)),
    ].join('')),
    ctx.invoiceUrl ? ctaButton('View Receipt', ctx.invoiceUrl) : '',
    paragraph('Thank you for your payment!'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function bookingRescheduledTemplate(ctx: TemplateContext & {
  serviceName: string;
  newStartTime: Date | string;
  newEndTime: Date | string;
  previousStartTime: Date | string;
  staffName?: string;
}): { subject: string; html: string } {
  const subject = `Your appointment with ${ctx.businessName} has been rescheduled`;
  const body = [
    heading('Appointment Rescheduled'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Your appointment has been rescheduled. Here are the updated details:`),
    detailTable([
      detailRow('Service', ctx.serviceName),
      detailRow('New Date', formatDate(ctx.newStartTime)),
      detailRow('New Time', `${formatTime(ctx.newStartTime)} &ndash; ${formatTime(ctx.newEndTime)}`),
      ctx.staffName ? detailRow('With', ctx.staffName) : '',
    ].join('')),
    paragraph(`<span style="color:#71717a;">Previous: ${formatDate(ctx.previousStartTime)} at ${formatTime(ctx.previousStartTime)}</span>`),
    ctx.businessAddress ? paragraph(`&#128205; ${ctx.businessAddress}`) : '',
    paragraph('If you have any questions, please contact us.'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function bookingCancelledTemplate(ctx: TemplateContext & {
  serviceName: string;
  startTime: Date | string;
}): { subject: string; html: string } {
  const subject = `Your appointment with ${ctx.businessName} has been cancelled`;
  const body = [
    heading('Appointment Cancelled'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Your appointment has been cancelled.`),
    detailTable([
      detailRow('Service', ctx.serviceName),
      detailRow('Date', formatDate(ctx.startTime)),
      detailRow('Time', formatTime(ctx.startTime)),
    ].join('')),
    paragraph('If you would like to rebook, please visit our booking page or contact us directly.'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function orderConfirmedTemplate(ctx: TemplateContext & {
  orderNumber: string;
  items: { name: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  shippingFee: number;
  total: number;
  currency: string;
  estimatedDelivery?: string;
  orderStatusUrl?: string;
}): { subject: string; html: string } {
  const subject = `Order ${ctx.orderNumber} confirmed — ${ctx.businessName}`;
  const itemRows = ctx.items.map(item =>
    detailRow(`${item.name} &times; ${item.quantity}`, formatCurrency(item.total, ctx.currency)),
  ).join('');
  const body = [
    heading('Order Confirmed &#10003;'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Thank you for your order! We've received it and will begin processing shortly.`),
    detailTable([
      detailRow('Order #', ctx.orderNumber),
      itemRows,
      detailRow('Subtotal', formatCurrency(ctx.subtotal, ctx.currency)),
      ctx.shippingFee > 0 ? detailRow('Shipping', formatCurrency(ctx.shippingFee, ctx.currency)) : '',
      detailRow('Total', `<strong>${formatCurrency(ctx.total, ctx.currency)}</strong>`),
      ctx.estimatedDelivery ? detailRow('Estimated Delivery', ctx.estimatedDelivery) : '',
    ].join('')),
    ctx.orderStatusUrl ? ctaButton('Track Your Order', ctx.orderStatusUrl) : '',
    paragraph('We\'ll send you updates as your order progresses.'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function orderShippedTemplate(ctx: TemplateContext & {
  orderNumber: string;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  orderStatusUrl?: string;
}): { subject: string; html: string } {
  const subject = `Your order ${ctx.orderNumber} has shipped — ${ctx.businessName}`;
  const body = [
    heading('Order Shipped &#128230;'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Great news! Your order has been shipped and is on its way to you.`),
    detailTable([
      detailRow('Order #', ctx.orderNumber),
      ctx.carrier ? detailRow('Carrier', ctx.carrier) : '',
      ctx.trackingNumber ? detailRow('Tracking #', ctx.trackingNumber) : '',
      ctx.estimatedDelivery ? detailRow('Estimated Delivery', ctx.estimatedDelivery) : '',
    ].join('')),
    ctx.trackingUrl ? ctaButton('Track Shipment', ctx.trackingUrl) : '',
    ctx.orderStatusUrl && !ctx.trackingUrl ? ctaButton('View Order Status', ctx.orderStatusUrl) : '',
    paragraph('Thank you for shopping with us!'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function orderDeliveredTemplate(ctx: TemplateContext & {
  orderNumber: string;
  deliveredAt: Date | string;
  orderStatusUrl?: string;
}): { subject: string; html: string } {
  const subject = `Your order ${ctx.orderNumber} has been delivered — ${ctx.businessName}`;
  const body = [
    heading('Order Delivered &#127881;'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Your order has been delivered! We hope you love it.`),
    detailTable([
      detailRow('Order #', ctx.orderNumber),
      detailRow('Delivered On', formatDate(ctx.deliveredAt)),
    ].join('')),
    ctx.orderStatusUrl ? ctaButton('View Order Details', ctx.orderStatusUrl) : '',
    paragraph('Thank you for your purchase. We appreciate your business!'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function orderRefundedTemplate(ctx: TemplateContext & {
  orderNumber: string;
  refundAmount: number;
  currency: string;
  reason?: string;
  orderStatusUrl?: string;
}): { subject: string; html: string } {
  const subject = `Refund processed for order ${ctx.orderNumber} — ${ctx.businessName}`;
  const body = [
    heading('Refund Processed'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`A refund has been processed for your order. Here are the details:`),
    detailTable([
      detailRow('Order #', ctx.orderNumber),
      detailRow('Refund Amount', formatCurrency(ctx.refundAmount, ctx.currency)),
      ctx.reason ? detailRow('Reason', ctx.reason) : '',
    ].join('')),
    paragraph('The refund should appear in your account within 5-10 business days, depending on your payment method.'),
    ctx.orderStatusUrl ? ctaButton('View Order Details', ctx.orderStatusUrl) : '',
    paragraph('If you have any questions, please don\'t hesitate to contact us.'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function orderCancelledTemplate(ctx: TemplateContext & {
  orderNumber: string;
  reason?: string;
  orderStatusUrl?: string;
}): { subject: string; html: string } {
  const subject = `Order ${ctx.orderNumber} has been cancelled — ${ctx.businessName}`;
  const body = [
    heading('Order Cancelled'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Your order has been cancelled.`),
    detailTable([
      detailRow('Order #', ctx.orderNumber),
      ctx.reason ? detailRow('Reason', ctx.reason) : '',
    ].join('')),
    paragraph('If a payment was made, a refund will be processed shortly.'),
    ctx.orderStatusUrl ? ctaButton('View Order Details', ctx.orderStatusUrl) : '',
    paragraph('If you have any questions, please contact us.'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function sellerNewOrderTemplate(ctx: TemplateContext & {
  orderNumber: string;
  customerName: string;
  itemCount: number;
  total: number;
  currency: string;
}): { subject: string; html: string } {
  const subject = `New order ${ctx.orderNumber} received`;
  const body = [
    heading('New Order Received &#128276;'),
    paragraph(`You have a new order!`),
    detailTable([
      detailRow('Order #', ctx.orderNumber),
      detailRow('Customer', ctx.customerName),
      detailRow('Items', String(ctx.itemCount)),
      detailRow('Total', formatCurrency(ctx.total, ctx.currency)),
    ].join('')),
    paragraph('Log in to your dashboard to review and fulfill this order.'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function sellerLowStockTemplate(ctx: TemplateContext & {
  productName: string;
  currentStock: number;
  reorderLevel: number;
}): { subject: string; html: string } {
  const subject = `Low stock alert: ${ctx.productName}`;
  const body = [
    heading('Low Stock Alert &#9888;'),
    paragraph(`A product in your inventory is running low.`),
    detailTable([
      detailRow('Product', ctx.productName),
      detailRow('Current Stock', String(ctx.currentStock)),
      detailRow('Reorder Level', String(ctx.reorderLevel)),
    ].join('')),
    paragraph('Consider restocking to avoid running out.'),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

function keyflowSignature(opts: {
  documentId: string;
  version: number;
  riskTier: string;
  generatedAt: string;
}): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
<tr><td style="padding:0;">
  <div style="height:3px;background:linear-gradient(90deg,#F97316,#14B8A6);border-radius:2px;"></div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
  <tr>
    <td style="vertical-align:middle;">
      <span style="font-size:13px;font-weight:700;color:#F97316;">&#9670;</span>
      <span style="font-size:13px;font-weight:600;color:#fafafa;margin-left:4px;">Prepared with KEYFLOWOS</span>
    </td>
  </tr>
  <tr>
    <td style="padding-top:4px;">
      <span style="font-size:11px;color:#71717a;">
        Doc ${opts.documentId.slice(-8).toUpperCase()}
        &middot; v${opts.version}
        &middot; Generated ${opts.generatedAt}
        &middot; Risk: ${opts.riskTier}
        &middot; Status: DRAFT
      </span>
    </td>
  </tr>
  <tr>
    <td style="padding-top:2px;">
      <span style="font-size:10px;color:#52525b;">AI-Assisted &middot; Review before use</span>
    </td>
  </tr>
  </table>
</td></tr>
</table>`;
}

export function documentGeneratedTemplate(ctx: TemplateContext & {
  documentTitle: string;
  documentTypeName: string;
  categoryName: string;
  riskTier: string;
  documentId: string;
  version: number;
  sections: Array<{ name: string; content: string }>;
  documentUrl: string;
}): { subject: string; html: string } {
  const subject = `Your ${ctx.documentTypeName} is ready — ${ctx.businessName}`;

  const sectionBlocks = ctx.sections.map((s) =>
    `<div style="margin-bottom:16px;">
      <h3 style="margin:0 0 6px;color:#fafafa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${s.name}</h3>
      <div style="color:#d4d4d8;font-size:13px;line-height:1.7;white-space:pre-wrap;">${s.content.length > 600 ? s.content.slice(0, 600) + '...' : s.content}</div>
    </div>`
  ).join('');

  const riskColors: Record<string, string> = {
    RED: '#ef4444',
    YELLOW: '#f59e0b',
    GREEN: '#22c55e',
  };
  const riskColor = riskColors[ctx.riskTier] || riskColors.GREEN;

  const now = new Date();
  const generatedAt = now.toLocaleDateString('en-TT', { year: 'numeric', month: 'short', day: 'numeric' });

  const body = [
    heading(`${ctx.documentTitle}`),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Your <strong>${ctx.documentTypeName}</strong> has been generated and is ready for review.`),
    detailTable([
      detailRow('Document', ctx.documentTitle),
      detailRow('Category', ctx.categoryName),
      detailRow('Risk Tier', `<span style="color:${riskColor};font-weight:600;">${ctx.riskTier}</span>`),
      detailRow('Version', `v${ctx.version}`),
    ].join('')),
    `<div style="margin:20px 0;padding:20px;background-color:#111113;border-radius:10px;border:1px solid #27272a;">`,
    `<h3 style="margin:0 0 12px;color:#a1a1aa;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Document Preview</h3>`,
    sectionBlocks,
    `</div>`,
    ctaButton('View & Edit in KEYFLOWOS', ctx.documentUrl),
    ctx.riskTier === 'RED'
      ? paragraph(`<span style="color:${riskColor};">&#9888; This is a high-risk document. Please review carefully before use.</span>`)
      : '',
    keyflowSignature({
      documentId: ctx.documentId,
      version: ctx.version,
      riskTier: ctx.riskTier,
      generatedAt,
    }),
  ].join('');

  return { subject, html: baseLayout(ctx, subject, body) };
}
