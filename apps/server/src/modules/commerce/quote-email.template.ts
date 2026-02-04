interface QuoteEmailData {
  businessName: string;
  businessLogo?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  businessAddress?: string | null;
  businessWebsite?: string | null;
  primaryColor?: string;
  contactName: string;
  quoteNumber: string;
  quoteDate: string;
  expiryDate?: string | null;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  subtotal: number;
  taxRate?: number | null;
  taxAmount?: number | null;
  discountType?: string | null;
  discountValue?: number | null;
  discountAmount?: number | null;
  total: number;
  currency: string;
  notes?: string | null;
  quoteUrl?: string;
  customMessage?: string;
}

export function buildQuoteEmailHtml(data: QuoteEmailData): string {
  const primaryColor = data.primaryColor || '#F97316';
  const currencySymbol = data.currency === 'TTD' ? 'TT$' : '$';

  const formatCurrency = (amount: number) => {
    return `${currencySymbol}${amount.toFixed(2)}`;
  };

  const itemsHtml = data.items.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.description}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.unitPrice)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.quantity * item.unitPrice)}</td>
    </tr>
  `).join('');

  const taxHtml = data.taxRate && data.taxAmount ? `
    <tr>
      <td colspan="3" style="padding: 8px 12px; text-align: right; color: #6b7280;">Tax (${data.taxRate}%)</td>
      <td style="padding: 8px 12px; text-align: right;">${formatCurrency(data.taxAmount)}</td>
    </tr>
  ` : '';

  const discountHtml = data.discountAmount && data.discountAmount > 0 ? `
    <tr>
      <td colspan="3" style="padding: 8px 12px; text-align: right; color: #6b7280;">
        Discount ${data.discountType === 'PERCENT' ? `(${data.discountValue}%)` : ''}
      </td>
      <td style="padding: 8px 12px; text-align: right; color: #16a34a;">-${formatCurrency(data.discountAmount)}</td>
    </tr>
  ` : '';

  const notesHtml = data.notes ? `
    <div style="margin-top: 24px; padding: 16px; background-color: #fef3c7; border-radius: 8px;">
      <p style="margin: 0; font-weight: 600; color: #92400e;">Notes:</p>
      <p style="margin: 8px 0 0 0; color: #78350f;">${data.notes.replace(/\n/g, '<br>')}</p>
    </div>
  ` : '';

  const customMessageHtml = data.customMessage ? `
    <div style="margin: 24px 0; padding: 16px; background-color: #f3f4f6; border-left: 4px solid ${primaryColor}; border-radius: 4px;">
      <p style="margin: 0; color: #374151; white-space: pre-wrap;">${data.customMessage.replace(/\n/g, '<br>')}</p>
    </div>
  ` : '';

  const logoHtml = data.businessLogo ? `
    <img src="${data.businessLogo}" alt="${data.businessName}" style="max-width: 150px; max-height: 60px; margin-bottom: 16px;" />
  ` : '';

  const viewQuoteButton = data.quoteUrl ? `
    <div style="text-align: center; margin: 32px 0;">
      <a href="${data.quoteUrl}" style="display: inline-block; padding: 14px 32px; background-color: ${primaryColor}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        View Quote Online
      </a>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote from ${data.businessName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px; border-bottom: 1px solid #e5e7eb;">
              ${logoHtml}
              <h1 style="margin: 0 0 8px 0; font-size: 24px; color: #111827;">${data.businessName}</h1>
              ${data.businessAddress ? `<p style="margin: 0; color: #6b7280; font-size: 14px;">${data.businessAddress}</p>` : ''}
              ${data.businessPhone ? `<p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px;">Phone: ${data.businessPhone}</p>` : ''}
              ${data.businessEmail ? `<p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px;">Email: ${data.businessEmail}</p>` : ''}
            </td>
          </tr>

          <!-- Quote Info -->
          <tr>
            <td style="padding: 32px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 24px;">
                <div>
                  <h2 style="margin: 0 0 16px 0; font-size: 28px; color: ${primaryColor};">QUOTE</h2>
                  <p style="margin: 0; color: #374151;"><strong>Quote #:</strong> ${data.quoteNumber}</p>
                  <p style="margin: 4px 0 0 0; color: #374151;"><strong>Date:</strong> ${data.quoteDate}</p>
                  ${data.expiryDate ? `<p style="margin: 4px 0 0 0; color: #374151;"><strong>Valid Until:</strong> ${data.expiryDate}</p>` : ''}
                </div>
              </div>

              <div style="margin-bottom: 24px; padding: 16px; background-color: #f9fafb; border-radius: 8px;">
                <p style="margin: 0; font-weight: 600; color: #374151;">Quote For:</p>
                <p style="margin: 8px 0 0 0; color: #111827; font-size: 18px;">${data.contactName}</p>
              </div>

              ${customMessageHtml}

              <!-- Items Table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: ${primaryColor};">
                    <th style="padding: 12px; text-align: left; color: white; font-weight: 600;">Description</th>
                    <th style="padding: 12px; text-align: center; color: white; font-weight: 600;">Qty</th>
                    <th style="padding: 12px; text-align: right; color: white; font-weight: 600;">Unit Price</th>
                    <th style="padding: 12px; text-align: right; color: white; font-weight: 600;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="3" style="padding: 8px 12px; text-align: right; color: #6b7280;">Subtotal</td>
                    <td style="padding: 8px 12px; text-align: right;">${formatCurrency(data.subtotal)}</td>
                  </tr>
                  ${taxHtml}
                  ${discountHtml}
                  <tr style="background-color: #f9fafb;">
                    <td colspan="3" style="padding: 12px; text-align: right; font-weight: 700; font-size: 18px;">Total</td>
                    <td style="padding: 12px; text-align: right; font-weight: 700; font-size: 18px; color: ${primaryColor};">${formatCurrency(data.total)}</td>
                  </tr>
                </tfoot>
              </table>

              ${notesHtml}

              ${viewQuoteButton}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                Thank you for your business!
              </p>
              ${data.businessWebsite ? `<p style="margin: 8px 0 0 0; color: #6b7280; font-size: 12px;"><a href="${data.businessWebsite}" style="color: ${primaryColor};">${data.businessWebsite}</a></p>` : ''}
              <p style="margin: 16px 0 0 0; color: #9ca3af; font-size: 12px;">
                Powered by KeyFlowOS
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
