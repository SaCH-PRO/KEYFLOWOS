import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type SourceRiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface SourceRiskSignal {
  type: string;
  severity: SourceRiskLevel;
  message: string;
  detail?: string;
}

export interface ProductSourceRisk {
  productId: string;
  productName: string;
  riskLevel: SourceRiskLevel;
  riskScore: number;
  signals: SourceRiskSignal[];
  supplierCount: number;
  hasBackupSource: boolean;
  avgLeadTimeDays: number | null;
}

export interface SourceRiskReport {
  businessId: string;
  totalProducts: number;
  productsAtRisk: number;
  riskDistribution: Record<SourceRiskLevel, number>;
  products: ProductSourceRisk[];
}

const LEAD_TIME_HIGH_THRESHOLD = 30;
const LEAD_TIME_MEDIUM_THRESHOLD = 14;

@Injectable()
export class SourceRiskService {
  private readonly logger = new Logger(SourceRiskService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  private classifyRiskLevel(score: number): SourceRiskLevel {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 35) return 'medium';
    if (score >= 10) return 'low';
    return 'none';
  }

  async evaluateProduct(productId: string, businessId: string): Promise<ProductSourceRisk | null> {
    const product = await this.db.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      include: {
        sourceLinks: {
          where: { isActive: true },
          include: {
            supplierProduct: {
              select: { leadTimeDays: true, availability: true },
            },
          },
        },
      },
    });
    if (!product) return null;

    const signals: SourceRiskSignal[] = [];
    let riskScore = 0;

    const activeLinks = product.sourceLinks;
    const supplierCount = activeLinks.length;

    if (supplierCount === 0) {
      signals.push({
        type: 'no_source',
        severity: 'critical',
        message: 'No active supplier sources linked',
        detail: 'This product has no sourcing configured. Fulfillment is entirely manual.',
      });
      riskScore += 80;
    } else if (supplierCount === 1) {
      signals.push({
        type: 'single_supplier',
        severity: 'high',
        message: 'Single supplier dependency',
        detail: 'Having only one supplier creates concentration risk. Add a backup source.',
      });
      riskScore += 40;
    }

    const leadTimes = activeLinks
      .map(l => l.leadTimeDays ?? l.supplierProduct?.leadTimeDays)
      .filter((t): t is number => t !== null && t !== undefined);

    const avgLeadTime = leadTimes.length > 0 ? Math.round(leadTimes.reduce((s, t) => s + t, 0) / leadTimes.length) : null;

    if (avgLeadTime !== null) {
      if (avgLeadTime >= LEAD_TIME_HIGH_THRESHOLD) {
        signals.push({
          type: 'long_lead_time',
          severity: 'high',
          message: `Long lead time: avg ${avgLeadTime} days`,
          detail: 'Lead times over 30 days can cause stockouts. Consider stocking locally or pre-ordering.',
        });
        riskScore += 30;
      } else if (avgLeadTime >= LEAD_TIME_MEDIUM_THRESHOLD) {
        signals.push({
          type: 'moderate_lead_time',
          severity: 'medium',
          message: `Moderate lead time: avg ${avgLeadTime} days`,
          detail: 'Lead times over 14 days require careful inventory planning.',
        });
        riskScore += 15;
      }
    }

    const unavailableLinks = activeLinks.filter(l => {
      const avail = l.availabilityState;
      return avail === 'unavailable';
    });
    const limitedLinks = activeLinks.filter(l => l.availabilityState === 'limited');

    if (unavailableLinks.length > 0 && supplierCount > 0) {
      const unavailablePct = Math.round((unavailableLinks.length / supplierCount) * 100);
      signals.push({
        type: 'supplier_unavailable',
        severity: unavailablePct >= 50 ? 'critical' : 'high',
        message: `${unavailableLinks.length} of ${supplierCount} suppliers marked unavailable`,
        detail: 'Sourcing reliability is compromised. Activate backup suppliers or update availability.',
      });
      riskScore += unavailablePct >= 50 ? 35 : 20;
    }

    if (limitedLinks.length > 0) {
      signals.push({
        type: 'limited_availability',
        severity: 'medium',
        message: `${limitedLinks.length} supplier(s) have limited stock`,
        detail: 'Limited availability may constrain order fulfillment.',
      });
      riskScore += 10;
    }

    const hasBackupSource = supplierCount >= 2;
    const riskLevel = this.classifyRiskLevel(Math.min(riskScore, 100));

    return {
      productId: product.id,
      productName: product.name,
      riskLevel,
      riskScore: Math.min(riskScore, 100),
      signals,
      supplierCount,
      hasBackupSource,
      avgLeadTimeDays: avgLeadTime,
    };
  }

  async evaluateAllProducts(businessId: string): Promise<SourceRiskReport> {
    const products = await this.db.product.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true },
    });

    const results: ProductSourceRisk[] = [];
    for (const p of products) {
      const risk = await this.evaluateProduct(p.id, businessId);
      if (risk) results.push(risk);
    }

    const riskDistribution: Record<SourceRiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };
    let productsAtRisk = 0;
    for (const r of results) {
      riskDistribution[r.riskLevel]++;
      if (r.riskLevel !== 'none' && r.riskLevel !== 'low') productsAtRisk++;
    }

    return {
      businessId,
      totalProducts: products.length,
      productsAtRisk,
      riskDistribution,
      products: results.sort((a, b) => b.riskScore - a.riskScore),
    };
  }
}
