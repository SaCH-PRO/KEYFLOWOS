import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CommandGeneratorService } from './command-generator.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CommandSchedulerService {
  private readonly logger = new Logger(CommandSchedulerService.name);

  constructor(
    @Inject(CommandGeneratorService) private readonly generator: CommandGeneratorService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Interval(60 * 60 * 1000) // Every hour
  async scheduledScan() {
    this.logger.log('Starting scheduled command generation scan');
    try {
      const businesses = await (this.prisma.client as any).business.findMany({
        select: { id: true },
        take: 1000,
      });

      for (const business of businesses) {
        try {
          const result = await this.generator.generateForBusiness(business.id);
          if (result.created > 0 || result.skipped > 0) {
            this.logger.debug(`Business ${business.id}: created ${result.created}, skipped ${result.skipped}`);
          }
        } catch (err) {
          this.logger.warn(`Scheduled scan failed for business ${business.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Scheduled scan failed: ${(err as Error).message}`);
    }
  }

  async getLastScanTime(businessId: string): Promise<Date | null> {
    const latest = await (this.prisma.client as any).commandItem.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return latest?.createdAt ?? null;
  }

  async shouldAutoScan(businessId: string): Promise<boolean> {
    const lastScan = await this.getLastScanTime(businessId);
    if (!lastScan) return true;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return lastScan < oneHourAgo;
  }
}
