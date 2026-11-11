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

  /**
   * W10-REOPEN-REVERSALS review repair CR-REOPEN-1 (owner ruling D-102; the
   * SEC-A9-1 pattern of RevenueActionService): the invoice is read PAID before
   * the award and again after it. A stale delivery (the invoice reopened since)
   * awards nothing; an award written after the refund's reopen handler ran (and
   * found no mark to reverse) is reversed here, by the same claim, so it is
   * reversed once whichever of the two gets there first.
   */
  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: InvoicePaidPayload) {
    const inv = payload.invoice as any;
    if (!inv?.contactId || !inv?.id) return;
    const businessId = payload.businessId;
    try {
      if ((await this.invoiceStatus(businessId, inv.id)) !== 'PAID') return;
      const awarded = await this.checkAndAwardReward(businessId, inv.contactId, inv.total ?? 0, inv.id);
      if (awarded && (await this.invoiceStatus(businessId, inv.id)) !== 'PAID') {
        await this.reverseRewardOfInvoice(businessId, inv.id);
      }
    } catch (err) {
      this.logger.warn(`referral reward award failed for invoice ${inv.id}: ${(err as Error).message}`);
    }
  }

  private async invoiceStatus(businessId: string, invoiceId: string): Promise<string | null> {
    const row = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { status: true },
    });
    return row?.status ?? null;
  }

  /**
   * W10-REOPEN-REVERSALS review repair SEC-W10RR-1 (D-102): the contact row,
   * read under its row lock (FOR UPDATE) inside the caller's transaction. The
   * award and the reversal take the referred contact's lock, then the
   * referrer's, so the referrer's credit is never a read-modify-write another
   * award or reversal overwrites.
   */
  private async lockedContact(
    tx: Prisma.TransactionClient,
    businessId: string,
    contactId: string,
  ): Promise<{ id: string; custom: Prisma.JsonObject; email: string | null } | null> {
    const rows = await tx.$queryRaw<Array<{ id: string; custom: Prisma.JsonValue | null; email: string | null }>>`
      SELECT id, custom, email FROM contacts WHERE id = ${contactId} AND business_id = ${businessId} FOR UPDATE`;
    const row = rows[0];
    if (!row) return null;
    const custom = row.custom && typeof row.custom === 'object' && !Array.isArray(row.custom) ? (row.custom as Prisma.JsonObject) : {};
    return { id: row.id, custom: { ...custom }, email: row.email };
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

  /**
   * W10-REOPEN-REVERSALS review repair SEC-W10RR-1 (D-102): the claim and the
   * referrer's take-back run in one transaction under the row locks (the
   * referred contact's, then the referrer's): the mark is claimed only while it
   * still names this invoice, and the referrer's balance and count are read and
   * written under its lock, so concurrent reversals (and awards) of the same
   * referrer each take back their own credit.
   */
  private async reverseRewardOfInvoice(businessId: string, invoiceId: string): Promise<{ contactId: string } | null> {
    const found = await this.prisma.client.contact.findFirst({
      where: { businessId, custom: { path: [REWARD_INVOICE_KEY], equals: invoiceId } },
      select: { id: true },
    });
    if (!found) return null;
    const reversed = await this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      const referred = await this.lockedContact(tx, businessId, found.id);
      // The claim: only the reversal that still finds this invoice on the mark writes.
      if (!referred || referred.custom[REWARD_INVOICE_KEY] !== invoiceId) return null;
      const custom = referred.custom;
      const referrerId = custom[REWARD_REFERRER_KEY] as string | undefined;
      const credit = Number(custom[REWARD_REFERRER_AMOUNT_KEY] ?? 0);
      delete custom.referralRewardEarned;
      delete custom.referralRewardAmount;
      delete custom[REWARD_INVOICE_KEY];
      delete custom[REWARD_REFERRER_KEY];
      delete custom[REWARD_REFERRER_AMOUNT_KEY];
      await tx.contact.update({ where: { id: referred.id }, data: { custom } });

      const referrer = referrerId ? await this.lockedContact(tx, businessId, referrerId) : null;
      if (referrer) {
        const balance = Number(referrer.custom.referralRewardBalance ?? 0);
        const earned = Number(referrer.custom.referralRewardsEarned ?? 0);
        await tx.contact.update({
          where: { id: referrer.id },
          data: {
            custom: {
              ...referrer.custom,
              // A credit already spent is not clawed back below zero.
              referralRewardBalance: Math.max(0, Math.round((balance - credit) * 100) / 100),
              referralRewardsEarned: Math.max(0, earned - 1),
            },
          },
        });
      }
      return { contactId: referred.id };
    });
    if (reversed) this.logger.log(`D-102: reversed the referral reward earned by invoice ${invoiceId}`);
    return reversed;
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

  /**
   * Awards the referral reward once per referred contact. W10-REOPEN-REVERSALS
   * review repair SEC-W10RR-1 (D-102): the check and both writes run in one
   * transaction under the referred contact's row lock, then the referrer's (the
   * reversal's order), so concurrent awards of one referrer each add their
   * credit and a referred contact is awarded once. Returns whether it awarded.
   */
  private async checkAndAwardReward(businessId: string, contactId: string, orderValue: number, invoiceId?: string): Promise<boolean> {
    const config = this.getConfig(businessId);
    if (!config?.enabled || orderValue < config.minOrderValue) return false;

    const awardedTo = await this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      const contact = await this.lockedContact(tx, businessId, contactId);
      if (!contact) return null;

      const custom = contact.custom;
      const referralSourceId = custom.referralSourceId as string | undefined;
      const rewardAlreadyEarned = custom.referralRewardEarned as boolean | undefined;
      if (!referralSourceId || rewardAlreadyEarned) return null;

      // Award reward to referrer
      const referrer = await this.lockedContact(tx, businessId, referralSourceId);
      if (!referrer) return null;

      const referrerCustom = referrer.custom;
      const referrerBalance = Number(referrerCustom.referralRewardBalance ?? 0);

      await tx.contact.update({
        where: { id: referrer.id },
        data: {
          custom: {
            ...referrerCustom,
            referralRewardBalance: referrerBalance + config.referrerReward,
            referralRewardsEarned: Number(referrerCustom.referralRewardsEarned ?? 0) + 1,
          },
        },
      });

      // Mark referred contact as rewarded
      await tx.contact.update({
        where: { id: contact.id },
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
      return referrer.email;
    });
    if (awardedTo === null) return false;

    this.logger.log(`Awarded ${config.currency} ${config.referrerReward} referral reward to ${awardedTo}`);
    return true;
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
