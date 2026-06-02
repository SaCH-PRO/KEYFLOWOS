import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ProfitScore {
  score: number; // 0-100
  revenuePotential: number;
  conversionProbability: number;
  urgencyBonus: number;
  riskPenalty: number;
  currency: string;
  explanation: string;
}

/**
 * Scores interactions by their profit-positive business outcome potential.
 *
 * This is a heuristic scoring engine. It uses:
 * - intent type (booking/quote = high, complaint = negative)
 * - customer history (repeat customer = higher LTV)
 * - urgency signals (time-sensitive = higher)
 * - risk signals (complaint/dispute = lower)
 */
@Injectable()
export class ProfitTrajectoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async scoreInteraction(
    businessId: string,
    contactId: string | null,
    intentType: string,
    body: string,
  ): Promise<ProfitScore> {
    const text = body.toLowerCase();
    const currency = 'TTD';

    // Base revenue potential by intent
    let revenuePotential = 0;
    switch (intentType) {
      case 'booking_request':
        revenuePotential = 500;
        break;
      case 'quote_request':
        revenuePotential = 2000;
        break;
      case 'payment_question':
        revenuePotential = 1500;
        break;
      case 'new_lead':
        revenuePotential = 1000;
        break;
      case 'complaint':
        revenuePotential = -500; // risk of refund/churn
        break;
      case 'review':
        revenuePotential = 300; // social proof value
        break;
      case 'referral':
        revenuePotential = 800;
        break;
      default:
        revenuePotential = 200;
    }

    // Urgency bonus
    let urgencyBonus = 0;
    if (text.includes('urgent') || text.includes('asap') || text.includes('today')) {
      urgencyBonus = 20;
    } else if (text.includes('tomorrow') || text.includes('this week')) {
      urgencyBonus = 10;
    }

    // Risk penalty
    let riskPenalty = 0;
    if (intentType === 'complaint') {
      riskPenalty = 40;
    } else if (text.includes('refund') || text.includes('cancel')) {
      riskPenalty = 30;
    } else if (text.includes('lawyer') || text.includes('legal')) {
      riskPenalty = 50;
    }

    // Contact history adjustment
    let conversionProbability = 50;
    if (contactId) {
      const history = await this.getContactHistory(businessId, contactId);
      if (history.totalBookings > 0) conversionProbability += 20;
      if (history.totalInvoices > 0) conversionProbability += 15;
      if (history.totalPayments > 0) conversionProbability += 10;
      if (history.daysSinceLastInteraction < 30) conversionProbability += 10;
      if (history.daysSinceLastInteraction > 180) conversionProbability -= 10;
    }

    conversionProbability = Math.min(95, Math.max(5, conversionProbability));

    // Calculate final score
    const expectedValue = revenuePotential * (conversionProbability / 100);
    const score = Math.round(
      Math.max(0, Math.min(100, expectedValue / 20 + urgencyBonus - riskPenalty + 50)),
    );

    return {
      score,
      revenuePotential,
      conversionProbability,
      urgencyBonus,
      riskPenalty,
      currency,
      explanation: this.buildExplanation(intentType, revenuePotential, conversionProbability, urgencyBonus, riskPenalty),
    };
  }

  private async getContactHistory(businessId: string, contactId: string) {
    const [bookings, invoices, payments, lastInteraction] = await Promise.all([
      this.prisma.client.booking.count({ where: { businessId, contactId } }),
      this.prisma.client.invoice.count({ where: { businessId, contactId } }),
      this.prisma.client.payment.count({ where: { businessId, invoice: { contactId } } }),
      this.prisma.client.contactEvent.findFirst({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const daysSinceLastInteraction = lastInteraction
      ? Math.floor((Date.now() - new Date(lastInteraction.createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    return {
      totalBookings: bookings,
      totalInvoices: invoices,
      totalPayments: payments,
      daysSinceLastInteraction,
    };
  }

  private buildExplanation(
    intentType: string,
    revenuePotential: number,
    conversionProbability: number,
    urgencyBonus: number,
    riskPenalty: number,
  ): string {
    const parts: string[] = [];
    parts.push(`Intent: ${intentType.replace(/_/g, ' ')}`);
    parts.push(`Revenue potential: TTD ${revenuePotential}`);
    parts.push(`Conversion probability: ${conversionProbability}%`);
    if (urgencyBonus > 0) parts.push(`Urgency bonus: +${urgencyBonus}`);
    if (riskPenalty > 0) parts.push(`Risk penalty: -${riskPenalty}`);
    return parts.join('. ');
  }
}
