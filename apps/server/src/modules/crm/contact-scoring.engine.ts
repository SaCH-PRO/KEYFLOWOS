export interface ContactScoreInput {
  totalPaid: number;
  invoiceCount: number;
  unpaidInvoiceCount: number;
  bookingCount: number;
  cancelledBookingCount: number;
  daysSinceLastInteraction: number;
  quoteSentCount: number;
  quoteAcceptedCount: number;
  messageResponseRate?: number;
}

export function calculateLeadScore(input: ContactScoreInput): number {
  let score = 50;
  score += Math.min(input.totalPaid / 100, 20);
  score += Math.min(input.bookingCount * 3, 15);
  score += Math.min(input.quoteAcceptedCount * 5, 15);
  if (input.unpaidInvoiceCount > 0) score -= 10;
  if (input.cancelledBookingCount > 0) score -= Math.min(input.cancelledBookingCount * 5, 20);
  if (input.daysSinceLastInteraction > 30) score -= 10;
  if (input.daysSinceLastInteraction > 90) score -= 20;
  const quoteConversion =
    input.quoteSentCount > 0 ? input.quoteAcceptedCount / input.quoteSentCount : 0;
  score += quoteConversion * 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function calculatePaymentReliability(
  paidInvoices: number,
  totalInvoices: number,
  avgDaysToPay: number,
): number {
  if (totalInvoices === 0) return 50;
  let score = 50;
  const paymentRate = paidInvoices / totalInvoices;
  score += paymentRate * 30;
  if (avgDaysToPay <= 7) score += 20;
  else if (avgDaysToPay <= 14) score += 10;
  else if (avgDaysToPay <= 30) score += 0;
  else score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function calculateCancellationRisk(
  cancelledBookings: number,
  totalBookings: number,
): number {
  if (totalBookings === 0) return 0;
  const rate = cancelledBookings / totalBookings;
  return Math.round(rate * 100);
}

export function calculateFollowUpPriority(input: {
  leadScore: number;
  daysSinceLastInteraction: number;
  unpaidInvoiceCount: number;
  quotePendingCount: number;
}): 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' {
  if (input.unpaidInvoiceCount > 0) return 'URGENT';
  if (input.leadScore >= 80 && input.daysSinceLastInteraction > 7) return 'HIGH';
  if (input.quotePendingCount > 0) return 'HIGH';
  if (input.leadScore >= 60 && input.daysSinceLastInteraction > 14) return 'NORMAL';
  if (input.daysSinceLastInteraction > 60) return 'NORMAL';
  return 'LOW';
}

export function generateNextBestAction(input: {
  leadScore: number;
  daysSinceLastInteraction: number;
  unpaidInvoiceCount: number;
  quotePendingCount: number;
  bookingCount: number;
  lastBookingDays?: number;
}): string {
  if (input.unpaidInvoiceCount > 0) return 'Send invoice reminder';
  if (input.quotePendingCount > 0) return 'Follow up on pending quote';
  if (input.leadScore >= 80 && input.daysSinceLastInteraction > 7) return 'High-value lead — personal outreach';
  if (input.bookingCount > 0 && (input.lastBookingDays ?? 999) > 45) return 'Re-engage — offer repeat booking discount';
  if (input.leadScore >= 60 && input.daysSinceLastInteraction > 14) return 'Send nurturing message';
  if (input.daysSinceLastInteraction > 60) return 'Win-back campaign';
  return 'Monitor for signals';
}
