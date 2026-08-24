import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EmailMarketingService } from './email-marketing.service';
import { CampaignIntelligenceService } from './campaign-intelligence.service';
import { safeInterval } from '../../core/scheduling/safe-interval';

@Injectable()
export class CampaignSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private briefingIntervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailMarketingService) private readonly emailMarketing: EmailMarketingService,
    @Inject(CampaignIntelligenceService) private readonly intelligence: CampaignIntelligenceService,
  ) {}

  onModuleInit() {
    this.intervalRef = safeInterval('CampaignSchedulerService', 60_000, () => this.tick(), this.logger);
    this.briefingIntervalRef = safeInterval('CampaignSchedulerService.briefing', 10 * 60_000, () => this.briefingTick(), this.logger);
    this.logger.log('Campaign scheduler started (60s interval, 10min briefing check)');
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
    if (this.briefingIntervalRef) {
      clearInterval(this.briefingIntervalRef);
      this.briefingIntervalRef = null;
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
        select: { id: true, businessId: true, name: true },
      });

      for (const campaign of dueCampaigns) {
        this.logger.log(`Executing scheduled campaign ${campaign.id} (${campaign.name})`);
        try {
          await this.emailMarketing.sendCampaign(campaign.businessId, campaign.id);
          this.logger.log(`Scheduled campaign ${campaign.id} sent successfully`);
        } catch (err: any) {
          this.logger.error(`Failed to send scheduled campaign ${campaign.id}`, err);
        }
      }
    } catch (err: any) {
      this.logger.error('Campaign scheduler tick failed', err);
    }
  }

  private async briefingTick() {
    try {
      const generated = await this.intelligence.checkAndGenerateBriefings();
      if (generated > 0) {
        this.logger.log(`Auto-generated ${generated} campaign briefing(s)`);
      }
    } catch (err: any) {
      this.logger.error('Briefing scheduler tick failed', err);
    }
  }
}
