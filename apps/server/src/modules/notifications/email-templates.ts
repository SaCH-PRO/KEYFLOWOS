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

function referralCta(referUrl: string, businessName: string, primaryColor?: string): string {
  const accent = primaryColor || '#F97316';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;background-color:#0f172a;border:1px solid #1e293b;border-radius:12px;">
<tr><td style="padding:20px 20px 8px;">
<p style="margin:0 0 6px;color:#fafafa;font-size:15px;font-weight:600;">&#127873; Love ${escapeHtml(businessName)}? Refer a friend.</p>
<p style="margin:0 0 8px;color:#a1a1aa;font-size:13px;line-height:1.55;">Share your personal referral link &mdash; we&rsquo;ve already filled in your details, so it only takes a tap.</p>
</td></tr>
<tr><td style="padding:0 20px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td style="background-color:${accent};border-radius:8px;padding:10px 20px;">
<a href="${referUrl}" target="_blank" style="color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;display:inline-block;">Get my referral link</a>
</td></tr>
</table>
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function googleMapsUrl(opts: {
  text?: string | null;
  placeId?: string | null;
  latLng?: { lat: number; lng: number } | null;
}): string {
  const params = new URLSearchParams({ api: '1' });
  if (opts.latLng && Number.isFinite(opts.latLng.lat) && Number.isFinite(opts.latLng.lng)) {
    params.set('query', `${opts.latLng.lat},${opts.latLng.lng}`);
  } else if (opts.text && opts.text.trim()) {
    params.set('query', opts.text.trim());
  } else if (opts.placeId) {
    params.set('query', opts.placeId);
  }
  if (opts.placeId) params.set('query_place_id', opts.placeId);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function locationLine(opts: {
  text?: string | null;
  placeId?: string | null;
  latLng?: { lat: number; lng: number } | null;
  label?: string;
}): string {
  const text = opts.text?.trim();
  const hasCoords = opts.latLng && Number.isFinite(opts.latLng.lat) && Number.isFinite(opts.latLng.lng);
  if (!text && !opts.placeId && !hasCoords) return '';
  const display = text || (hasCoords ? `${opts.latLng!.lat.toFixed(5)}, ${opts.latLng!.lng.toFixed(5)}` : 'View location');
  const url = googleMapsUrl({ text, placeId: opts.placeId, latLng: opts.latLng });
  const label = opts.label ?? 'Location';
  return paragraph(
    `&#128205; <strong>${escapeHtml(label)}:</strong> ${escapeHtml(display)} &middot; <a href="${url}" target="_blank" style="color:#fafafa;text-decoration:underline;">Open in Google Maps</a>`,
  );
}

export function bookingConfirmedTemplate(ctx: TemplateContext & {
  serviceName: string;
  startTime: Date | string;
  endTime: Date | string;
  staffName?: string;
  bookingId: string;
  location?: string | null;
  locationPlaceId?: string | null;
  locationLatLng?: { lat: number; lng: number } | null;
  referUrl?: string;
}): { subject: string; html: string } {
  const subject = `Your booking with ${ctx.businessName} is confirmed`;
  const hasBookingLocation = !!(
    (ctx.location && ctx.location.trim()) ||
    ctx.locationPlaceId ||
    (ctx.locationLatLng && Number.isFinite(ctx.locationLatLng.lat) && Number.isFinite(ctx.locationLatLng.lng))
  );
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
    hasBookingLocation
      ? locationLine({
          text: ctx.location,
          placeId: ctx.locationPlaceId,
          latLng: ctx.locationLatLng,
          label: 'Service location',
        })
      : '',
    ctx.businessAddress
      ? locationLine({ text: ctx.businessAddress, label: hasBookingLocation ? 'Business' : 'Location' })
      : '',
    paragraph('We look forward to seeing you!'),
    ctx.referUrl ? referralCta(ctx.referUrl, ctx.businessName, ctx.primaryColor) : '',
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function bookingReminderTemplate(ctx: TemplateContext & {
  serviceName: string;
  startTime: Date | string;
  endTime: Date | string;
  staffName?: string;
  bookingId: string;
  location?: string | null;
  locationPlaceId?: string | null;
  locationLatLng?: { lat: number; lng: number } | null;
}): { subject: string; html: string } {
  const subject = `Reminder: Your appointment with ${ctx.businessName} is tomorrow`;
  const hasBookingLocation = !!(
    (ctx.location && ctx.location.trim()) ||
    ctx.locationPlaceId ||
    (ctx.locationLatLng && Number.isFinite(ctx.locationLatLng.lat) && Number.isFinite(ctx.locationLatLng.lng))
  );
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
    hasBookingLocation
      ? locationLine({
          text: ctx.location,
          placeId: ctx.locationPlaceId,
          latLng: ctx.locationLatLng,
          label: 'Service location',
        })
      : '',
    ctx.businessAddress
      ? locationLine({ text: ctx.businessAddress, label: hasBookingLocation ? 'Business' : 'Location' })
      : '',
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
  location?: string | null;
  locationPlaceId?: string | null;
  locationLatLng?: { lat: number; lng: number } | null;
}): { subject: string; html: string } {
  const subject = `Your appointment with ${ctx.businessName} has been rescheduled`;
  const hasBookingLocation = !!(
    (ctx.location && ctx.location.trim()) ||
    ctx.locationPlaceId ||
    (ctx.locationLatLng && Number.isFinite(ctx.locationLatLng.lat) && Number.isFinite(ctx.locationLatLng.lng))
  );
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
    hasBookingLocation
      ? locationLine({
          text: ctx.location,
          placeId: ctx.locationPlaceId,
          latLng: ctx.locationLatLng,
          label: 'Service location',
        })
      : '',
    ctx.businessAddress
      ? locationLine({ text: ctx.businessAddress, label: hasBookingLocation ? 'Business' : 'Location' })
      : '',
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
  referUrl?: string;
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
    ctx.referUrl ? referralCta(ctx.referUrl, ctx.businessName, ctx.primaryColor) : '',
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

export function reviewRequestTemplate(ctx: TemplateContext & {
  orderNumber: string;
  productNames?: string[];
}): { subject: string; html: string } {
  const subject = `How was your order from ${ctx.businessName}?`;

  const productList = ctx.productNames && ctx.productNames.length > 0
    ? `<ul style="margin:8px 0 16px;padding-left:20px;color:#d4d4d8;font-size:14px;">
${ctx.productNames.map((n) => `<li style="margin:4px 0;">${n}</li>`).join('')}
</ul>`
    : '';

  const body = [
    heading(`Your Review Matters`),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`We hope you're enjoying your recent purchase from <strong>${ctx.businessName}</strong>! We'd love to hear your thoughts on order <strong>#${ctx.orderNumber}</strong>.`),
    productList,
    paragraph(`Your feedback helps us improve and helps other customers make informed decisions. It only takes a minute!`),
    ctaButton('Leave a Review', '#'),
    paragraph(`Thank you for choosing ${ctx.businessName}. We look forward to hearing from you!`),
  ].join('');

  return { subject, html: baseLayout(ctx, subject, body) };
}

export function preorderDelayNoticeTemplate(ctx: TemplateContext & {
  productName: string;
  originalExpectedDate?: string;
  newExpectedDate: string;
  reason?: string;
}): { subject: string; html: string } {
  const subject = `Update on your pre-order: ${ctx.productName}`;

  const reasonRow = ctx.reason
    ? detailRow('Reason', ctx.reason)
    : '';

  const originalRow = ctx.originalExpectedDate
    ? detailRow('Original Date', ctx.originalExpectedDate)
    : '';

  const body = [
    heading(`Pre-order Update`),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`We wanted to keep you informed about an update to your pre-order for <strong>${ctx.productName}</strong>.`),
    paragraph(`We sincerely apologise for any inconvenience this may cause. Here are the updated details:`),
    detailTable([
      detailRow('Product', ctx.productName),
      originalRow,
      detailRow('New Expected Date', ctx.newExpectedDate),
      reasonRow,
    ].join('')),
    paragraph(`We are working hard to get your order to you as soon as possible. Your pre-order remains active and will be fulfilled on the new date.`),
    paragraph(`If you have any questions or concerns, please don't hesitate to contact us.`),
    paragraph(`Thank you for your patience and understanding.`),
  ].join('');

  return { subject, html: baseLayout(ctx, subject, body) };
}

export function reorderPromptTemplate(ctx: TemplateContext & {
  orderNumber: string;
  productNames?: string[];
  daysSincePurchase?: number;
}): { subject: string; html: string } {
  const subject = `Time to restock? Your ${ctx.businessName} favourites await`;

  const productList = ctx.productNames && ctx.productNames.length > 0
    ? `<ul style="margin:8px 0 16px;padding-left:20px;color:#d4d4d8;font-size:14px;">
${ctx.productNames.map((n) => `<li style="margin:4px 0;">${n}</li>`).join('')}
</ul>`
    : '';

  const timeframe = ctx.daysSincePurchase
    ? `It's been ${ctx.daysSincePurchase} days since your last order`
    : `It's been a while since your last order`;

  const body = [
    heading(`Ready to Reorder?`),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`${timeframe} (#${ctx.orderNumber}) from <strong>${ctx.businessName}</strong>. If you loved what you got, it might be time to stock up!`),
    productList,
    paragraph(`We make reordering easy — your items are just a click away.`),
    ctaButton('Shop Again', '#'),
    paragraph(`As always, thank you for being a valued customer.`),
  ].join('');

  return { subject, html: baseLayout(ctx, subject, body) };
}

export function quoteViewedOwnerTemplate(ctx: TemplateContext & {
  quoteNumber: string;
  contactDisplayName: string;
  total: number;
  currency: string;
  viewedAt: Date | string;
  quoteUrl?: string;
}): { subject: string; html: string } {
  const subject = `Quote ${ctx.quoteNumber} was viewed by ${ctx.contactDisplayName}`;
  const body = [
    heading('Quote Viewed &#128065;'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Good news — <strong>${escapeHtml(ctx.contactDisplayName)}</strong> just opened the quote you sent.`),
    detailTable([
      detailRow('Quote #', escapeHtml(ctx.quoteNumber)),
      detailRow('Customer', escapeHtml(ctx.contactDisplayName)),
      detailRow('Amount', formatCurrency(ctx.total, ctx.currency)),
      detailRow('Viewed at', `${formatDate(ctx.viewedAt)} ${formatTime(ctx.viewedAt)}`),
    ].join('')),
    ctx.quoteUrl ? ctaButton('Open Quote', ctx.quoteUrl) : '',
    paragraph(`Now is a great time to follow up while it's fresh in their mind.`),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function quoteAcceptedOwnerTemplate(ctx: TemplateContext & {
  quoteNumber: string;
  contactDisplayName: string;
  total: number;
  currency: string;
  acceptedAt: Date | string;
  quoteUrl?: string;
}): { subject: string; html: string } {
  const subject = `Quote ${ctx.quoteNumber} accepted by ${ctx.contactDisplayName}`;
  const body = [
    heading('Quote Accepted &#127881;'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`<strong>${escapeHtml(ctx.contactDisplayName)}</strong> just accepted your quote. Time to deliver!`),
    detailTable([
      detailRow('Quote #', escapeHtml(ctx.quoteNumber)),
      detailRow('Customer', escapeHtml(ctx.contactDisplayName)),
      detailRow('Amount', formatCurrency(ctx.total, ctx.currency)),
      detailRow('Accepted at', `${formatDate(ctx.acceptedAt)} ${formatTime(ctx.acceptedAt)}`),
    ].join('')),
    ctx.quoteUrl ? ctaButton('Open Quote', ctx.quoteUrl) : '',
    paragraph(`You can now convert this quote into an invoice and kick off the work.`),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function quoteRejectedOwnerTemplate(ctx: TemplateContext & {
  quoteNumber: string;
  contactDisplayName: string;
  total: number;
  currency: string;
  rejectedAt: Date | string;
  reason?: string | null;
  quoteUrl?: string;
}): { subject: string; html: string } {
  const subject = `Quote ${ctx.quoteNumber} declined by ${ctx.contactDisplayName}`;
  const body = [
    heading('Quote Declined'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`<strong>${escapeHtml(ctx.contactDisplayName)}</strong> declined the quote you sent.`),
    detailTable([
      detailRow('Quote #', escapeHtml(ctx.quoteNumber)),
      detailRow('Customer', escapeHtml(ctx.contactDisplayName)),
      detailRow('Amount', formatCurrency(ctx.total, ctx.currency)),
      detailRow('Declined at', `${formatDate(ctx.rejectedAt)} ${formatTime(ctx.rejectedAt)}`),
      ctx.reason ? detailRow('Reason', escapeHtml(ctx.reason)) : '',
    ].join('')),
    ctx.quoteUrl ? ctaButton('Open Quote', ctx.quoteUrl) : '',
    paragraph(`Consider following up to understand why and explore another option.`),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function quoteAcceptedCustomerTemplate(ctx: TemplateContext & {
  quoteNumber: string;
  total: number;
  currency: string;
  acceptedAt: Date | string;
  quoteUrl?: string;
}): { subject: string; html: string } {
  const subject = `Thanks for accepting Quote ${ctx.quoteNumber}`;
  const body = [
    heading('Quote Accepted &#10003;'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`Thanks for accepting Quote <strong>${escapeHtml(ctx.quoteNumber)}</strong> from ${escapeHtml(ctx.businessName)}. We'll be in touch shortly with next steps.`),
    detailTable([
      detailRow('Quote #', escapeHtml(ctx.quoteNumber)),
      detailRow('Total', `<strong>${formatCurrency(ctx.total, ctx.currency)}</strong>`),
      detailRow('Accepted on', `${formatDate(ctx.acceptedAt)} ${formatTime(ctx.acceptedAt)}`),
    ].join('')),
    ctx.quoteUrl ? ctaButton('View Quote', ctx.quoteUrl) : '',
    paragraph(`If you have any questions, just reply to this email.`),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export function quoteRejectedCustomerTemplate(ctx: TemplateContext & {
  quoteNumber: string;
  total: number;
  currency: string;
  rejectedAt: Date | string;
  reason?: string | null;
  quoteUrl?: string;
}): { subject: string; html: string } {
  const subject = `We received your response to Quote ${ctx.quoteNumber}`;
  const body = [
    heading('Quote Response Received'),
    paragraph(`Hi ${ctx.customerName},`),
    paragraph(`We've recorded that you declined Quote <strong>${escapeHtml(ctx.quoteNumber)}</strong> from ${escapeHtml(ctx.businessName)}.`),
    detailTable([
      detailRow('Quote #', escapeHtml(ctx.quoteNumber)),
      detailRow('Total', formatCurrency(ctx.total, ctx.currency)),
      detailRow('Declined on', `${formatDate(ctx.rejectedAt)} ${formatTime(ctx.rejectedAt)}`),
      ctx.reason ? detailRow('Reason', escapeHtml(ctx.reason)) : '',
    ].join('')),
    ctx.quoteUrl ? ctaButton('View Quote', ctx.quoteUrl) : '',
    paragraph(`If this was a mistake or you'd like to revisit, please reply to this email and we'll be happy to help.`),
  ].join('');
  return { subject, html: baseLayout(ctx, subject, body) };
}

export interface VerificationEmailContext {
  recipientName?: string;
  recipientEmail: string;
  confirmationUrl: string;
  productName?: string;
  supportEmail?: string;
}

/**
 * System-level signup verification email — branded for Keyflow itself,
 * NOT for any individual tenant business. Used by the new `/identity/signup`
 * flow, sent through `SystemEmailService` (Resend).
 */
export function verificationEmailTemplate(ctx: VerificationEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const productName = ctx.productName || "Keyflow";
  const greetingName = ctx.recipientName?.trim() || ctx.recipientEmail;
  const subject = `Confirm your ${productName} email`;
  const support = ctx.supportEmail
    ? `If you did not create a ${productName} account, you can safely ignore this email or contact us at ${ctx.supportEmail}.`
    : `If you did not create a ${productName} account, you can safely ignore this email.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#0c0a09;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0c0a09;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#1a1a1e;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#F97316,#14B8A6);padding:28px 32px;">
<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.01em;">${productName}</h1>
</td></tr>
<tr><td style="padding:32px;">
<h2 style="margin:0 0 16px;color:#fafafa;font-size:18px;font-weight:600;">Confirm your email</h2>
<p style="margin:0 0 12px;color:#d4d4d8;font-size:14px;line-height:1.6;">Hi ${greetingName},</p>
<p style="margin:0 0 20px;color:#d4d4d8;font-size:14px;line-height:1.6;">Welcome to ${productName}. Tap the button below to verify your email address and finish setting up your account.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
<tr><td style="border-radius:10px;background:linear-gradient(135deg,#F97316,#ea580c);">
<a href="${ctx.confirmationUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;">Verify my email</a>
</td></tr>
</table>
<p style="margin:0 0 12px;color:#a1a1aa;font-size:13px;line-height:1.6;">Or copy and paste this link into your browser:</p>
<p style="margin:0 0 24px;word-break:break-all;"><a href="${ctx.confirmationUrl}" style="color:#F97316;font-size:13px;text-decoration:underline;">${ctx.confirmationUrl}</a></p>
<p style="margin:0;color:#71717a;font-size:12px;line-height:1.5;">${support}</p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #2a2a2e;">
<p style="margin:0;color:#52525b;font-size:11px;">This is an automated message from ${productName}. Please do not reply directly to this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Hi ${greetingName},`,
    "",
    `Welcome to ${productName}. Confirm your email to finish setting up your account by visiting:`,
    "",
    ctx.confirmationUrl,
    "",
    support,
  ].join("\n");

  return { subject, html, text };
}
