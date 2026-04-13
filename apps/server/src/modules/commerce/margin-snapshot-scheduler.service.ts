import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LandedCostEngine } from './landed-cost-engine.service';

const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_REASON = 'periodic';

@Injectable()
export class MarginSnapshotSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarginSnapshotSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly landedCostEngine: LandedCostEngine,
  ) {}

  onModuleInit() {
    this.logger.log('[MarginSnapshotScheduler] Starting — capturing daily margin snapshots');
    this.intervalRef = setInterval(() => {
      void this.runSnapshots();
    }, SNAPSHOT_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
    this.logger.log('[MarginSnapshotScheduler] Stopped');
  }

  async captureSnapshotForProduct(productId: string, reason = SNAPSHOT_REASON): Promise<void> {
    const product = await this.prisma.client.product.findUnique({
      where: { id: productId },
      include: { costProfile: true },
    });
    if (!product || product.deletedAt) return;

    const costBreakdown = await this.landedCostEngine.calculateForProduct(productId, product.businessId);
    if (!costBreakdown || costBreakdown.landedCostEstimate <= 0) return;

    const sellingPrice = Number(product.price);
    const grossMargin = sellingPrice > 0
      ? Math.round(((sellingPrice - costBreakdown.landedCostEstimate) / sellingPrice) * 100 * 10) / 10
      : 0;
    const marginBand = this.landedCostEngine.classifyMarginBand(grossMargin);

    await this.prisma.client.marginSnapshot.create({
      data: {
        productId,
        sourceCost: costBreakdown.sourceCost,
        sellingPrice,
        landedCostEstimate: costBreakdown.landedCostEstimate,
        grossMargin,
        marginBand,
        currency: product.currency,
        snapshotReason: reason,
      },
    });
  }

  async captureSnapshotsForBusiness(businessId: string, reason = SNAPSHOT_REASON): Promise<{ captured: number; failed: number }> {
    const products = await this.prisma.client.product.findMany({
      where: { businessId, deletedAt: null, costProfile: { isNot: null } },
      select: { id: true },
    });

    let captured = 0;
    let failed = 0;
    for (const p of products) {
      try {
        await this.captureSnapshotForProduct(p.id, reason);
        captured++;
      } catch (err) {
        failed++;
        this.logger.error(`Failed to capture margin snapshot for product ${p.id}: ${(err as Error).message}`);
      }
    }
    return { captured, failed };
  }

  private async runSnapshots(): Promise<void> {
    this.logger.log('[MarginSnapshotScheduler] Running daily margin snapshots');
    const businesses = await this.prisma.client.business.findMany({
      select: { id: true },
    });
    let totalCaptured = 0;
    let totalFailed = 0;
    for (const biz of businesses) {
      const result = await this.captureSnapshotsForBusiness(biz.id).catch(err => {
        this.logger.error(`Snapshot run failed for business ${biz.id}: ${(err as Error).message}`);
        return { captured: 0, failed: 1 };
      });
      totalCaptured += result.captured;
      totalFailed += result.failed;
    }
    this.logger.log(`[MarginSnapshotScheduler] Completed: ${totalCaptured} captured, ${totalFailed} failed`);
  }
}
