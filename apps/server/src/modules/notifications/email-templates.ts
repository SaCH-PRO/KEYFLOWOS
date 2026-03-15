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
