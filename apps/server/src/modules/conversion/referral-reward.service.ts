import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InvoicePaidPayload, BookingCompletedPayload, InvoiceStatusPayload } from '../../core/event-bus/events.types';

/**
 * W10-REOPEN-REVERSALS (owner ruling D-102): the keys the award writes on the
 * referred contact's custom besides referralRewardEarned / referralRewardAmount:
 * the invoice that earned it, the referrer credited and the credit given, so a
 * reopen of that invoice reverses exactly that award, once. An award earned by
 * a booking, or written before this packet, names no invoice and is never
 * reversed by a reopen.
 */
const REWARD_INVOICE_KEY = 'referralRewardInvoiceId';
const REWARD_REFERRER_KEY = 'referralRewardReferrerId';
const REWARD_REFERRER_AMOUNT_KEY = 'referralRewardReferrerAmount';

export interface ReferralRewardConfig {
  enabled: boolean;
  referrerReward: number; // e.g., 10 = $10 credit
  referredReward: number; // e.g., 10 = $10 off first purchase
  currency: string;
  minOrderValue: number;
}

export interface ReferralRewardLedger {
  referrerContactId: string;
  referredContactId: string;
  rewardAmount: number;
  currency: string;
  status: 'pending' | 'earned' | 'redeemed' | 'expired';
  earnedAt?: string;
  redeemedAt?: string;
}

@Injectable()
export class ReferralRewardService {
  private readonly logger = new Logger(ReferralRewardService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private getConfig(businessId: string): ReferralRewardConfig | null {
    // In production this would read from Business.metaData or a dedicated config table
    // Default: enabled with $10/$10 TTD rewards
    return {
      enabled: true,
      referrerReward: 10,
      referredReward: 10,
      currency: 'TTD',
      minOrderValue: 50,
    };
  }

  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: InvoicePaidPayload) {
    const inv = payload.invoice as any;
    if (!inv.contactId) return;
    await this.checkAndAwardReward(payload.businessId, inv.contactId, inv.total ?? 0, inv.id);
  }

  /**
   * W10-REOPEN-REVERSALS (owner ruling D-102): a refund's reopen of the invoice
   * that earned the referral reward reverses it: the referrer's
   * referralRewardBalance and referralRewardsEarned go back by what that award
   * gave, and the referred contact loses its referralRewardEarned mark (so a
   * later payment may earn it again). The referral itself (referralSourceId)
   * stays, and nobody is messaged. The mark is claimed by a compare-and-set on
   * the invoice it names, so a re-delivered or concurrent reopen reverses it
   * once; an invoice that earned nothing (a second purchase, an order under the
   * minimum, an award from a booking) reverses nothing. If the invoice is PAID
   * again by the time this ran, its award is earned again (as on invoice.paid).
   */
  @OnEvent('invoice.reopened', { async: true })
  async onInvoiceReopened(payload: InvoiceStatusPayload) {
    const businessId = payload?.businessId;
    const invoiceId = payload?.invoice?.id;
    if (!businessId || !invoiceId) return;
    try {
      const reversed = await this.reverseRewardOfInvoice(businessId, invoiceId);
      if (!reversed) return;
      const now = await this.prisma.client.invoice.findFirst({
        where: { id: invoiceId, businessId },
        select: { status: true, total: true },
      });
      if (now?.status === 'PAID') {
        await this.checkAndAwardReward(businessId, reversed.contactId, now.total ?? 0, invoiceId);
      }
    } catch (err) {
      this.logger.warn(`D-102 referral reward reversal failed for invoice ${invoiceId}: ${(err as Error).message}`);
    }
  }

  private async reverseRewardOfInvoice(businessId: string, invoiceId: string): Promise<{ contactId: string } | null> {
    const referred = await this.prisma.client.contact.findFirst({
      where: { businessId, custom: { path: [REWARD_INVOICE_KEY], equals: invoiceId } },
      select: { id: true, custom: true },
    });
    if (!referred) return null;
    const custom: Prisma.JsonObject = { ...((referred.custom as Prisma.JsonObject | null) ?? {}) };
    const referrerId = custom[REWARD_REFERRER_KEY] as string | undefined;
    const credit = Number(custom[REWARD_REFERRER_AMOUNT_KEY] ?? 0);
    delete custom.referralRewardEarned;
    delete custom.referralRewardAmount;
    delete custom[REWARD_INVOICE_KEY];
    delete custom[REWARD_REFERRER_KEY];
    delete custom[REWARD_REFERRER_AMOUNT_KEY];
    // The claim: only the reversal that still finds this invoice on the mark writes.
    const claimed = await this.prisma.client.contact.updateMany({
      where: { id: referred.id, businessId, custom: { path: [REWARD_INVOICE_KEY], equals: invoiceId } },
      data: { custom },
    });
    if (claimed.count !== 1) return null;

    if (referrerId) {
      const referrer = await this.prisma.client.contact.findFirst({
        where: { id: referrerId, businessId },
        select: { id: true, custom: true },
      });
      if (referrer) {
        const referrerCustom = (referrer.custom as Prisma.JsonObject | null) ?? {};
        const balance = Number(referrerCustom.referralRewardBalance ?? 0);
        const earned = Number(referrerCustom.referralRewardsEarned ?? 0);
        await this.prisma.client.contact.update({
          where: { id: referrer.id },
          data: {
            custom: {
              ...referrerCustom,
              // A credit already spent is not clawed back below zero.
              referralRewardBalance: Math.max(0, Math.round((balance - credit) * 100) / 100),
              referralRewardsEarned: Math.max(0, earned - 1),
            },
          },
        });
      }
    }
    this.logger.log(`D-102: reversed the referral reward earned by invoice ${invoiceId}`);
    return { contactId: referred.id };
  }

  @OnEvent('booking.completed')
  async onBookingCompleted(payload: BookingCompletedPayload) {
    const booking = payload.booking as any;
    if (!booking.contactId) return;
    // Use service price as proxy for order value
    const service = await this.prisma.client.service.findUnique({
      where: { id: booking.serviceId },
      select: { price: true },
    }).catch(() => null);
    await this.checkAndAwardReward(payload.businessId, booking.contactId, service?.price ?? 0);
  }

  private async checkAndAwardReward(businessId: string, contactId: string, orderValue: number, invoiceId?: string) {
    const config = this.getConfig(businessId);
    if (!config?.enabled || orderValue < config.minOrderValue) return;

    const contact = await this.prisma.client.contact.findUnique({
      where: { id: contactId },
      select: { custom: true, firstName: true, lastName: true, email: true },
    });
    if (!contact) return;

    const custom = (contact.custom as Record<string, any>) ?? {};
    const referralSourceId = custom.referralSourceId as string | undefined;
    const rewardAlreadyEarned = custom.referralRewardEarned as boolean | undefined;
    if (!referralSourceId || rewardAlreadyEarned) return;

    // Award reward to referrer
    const referrer = await this.prisma.client.contact.findUnique({
      where: { id: referralSourceId, businessId },
      select: { id: true, custom: true, email: true },
    });
    if (!referrer) return;

    const referrerCustom = (referrer.custom as Record<string, any>) ?? {};
    const referrerBalance = (referrerCustom.referralRewardBalance as number) ?? 0;

    await this.prisma.client.contact.update({
      where: { id: referrer.id },
      data: {
        custom: {
          ...referrerCustom,
          referralRewardBalance: referrerBalance + config.referrerReward,
          referralRewardsEarned: (referrerCustom.referralRewardsEarned ?? 0) + 1,
        },
      },
    });

    // Mark referred contact as rewarded
    await this.prisma.client.contact.update({
      where: { id: contactId },
      data: {
        custom: {
          ...custom,
          referralRewardEarned: true,
          referralRewardAmount: config.referredReward,
          // W10-REOPEN-REVERSALS (D-102): what a reopen of this invoice reverses.
          ...(invoiceId
            ? { [REWARD_INVOICE_KEY]: invoiceId, [REWARD_REFERRER_KEY]: referrer.id, [REWARD_REFERRER_AMOUNT_KEY]: config.referrerReward }
            : {}),
        },
      },
    });

    this.logger.log(`Awarded ${config.currency} ${config.referrerReward} referral reward to ${referrer.email}`);
  }

  async getReferralStats(businessId: string, contactId: string) {
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: contactId, businessId },
      select: { custom: true },
    });
    if (!contact) return null;

    const custom = (contact.custom as Record<string, any>) ?? {};
    const referredCount = await this.prisma.client.contact.count({
      where: {
        businessId,
        custom: { path: ['referralSourceId'], equals: contactId },
      },
    });

    return {
      referralCode: custom.referralCode as string | undefined,
      rewardsEarned: custom.referralRewardsEarned ?? 0,
      rewardBalance: custom.referralRewardBalance ?? 0,
      referredCount,
      currency: 'TTD',
    };
  }
}
