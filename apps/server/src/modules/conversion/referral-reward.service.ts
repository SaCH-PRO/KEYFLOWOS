import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InvoicePaidPayload, BookingCompletedPayload } from '../../core/event-bus/events.types';

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
    await this.checkAndAwardReward(payload.businessId, inv.contactId, inv.total ?? 0);
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

  private async checkAndAwardReward(businessId: string, contactId: string, orderValue: number) {
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
