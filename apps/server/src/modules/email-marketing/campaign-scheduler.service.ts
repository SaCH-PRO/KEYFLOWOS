import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EmailMarketingService } from './email-marketing.service';

@Injectable()
export class CampaignSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailMarketingService) private readonly emailMarketing: EmailMarketingService,
  ) {}

  onModuleInit() {
    this.intervalRef = setInterval(() => this.tick(), 60_000);
    this.logger.log('Campaign scheduler started (60s interval)');
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async tick() {
    try {
      const dueCampaigns = await this.prisma.client.emailCampaign.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { lte: new Date() },
          deletedAt: null,
        },
      });

      for (const campaign of dueCampaigns) {
        this.logger.log(`Executing scheduled campaign ${campaign.id} (${campaign.name})`);
        try {
          await this.prisma.client.emailCampaign.update({
            where: { id: campaign.id },
            data: { status: 'SENDING' },
          });

          await this.emailMarketing.sendCampaign(campaign.businessId, campaign.id);
          this.logger.log(`Scheduled campaign ${campaign.id} sent successfully`);
        } catch (err) {
          this.logger.error(`Failed to send scheduled campaign ${campaign.id}`, err);
          await this.prisma.client.emailCampaign.update({
            where: { id: campaign.id },
            data: { status: 'DRAFT' },
          }).catch(() => {});
        }
      }
    } catch (err) {
      this.logger.error('Campaign scheduler tick failed', err);
    }
  }
}
