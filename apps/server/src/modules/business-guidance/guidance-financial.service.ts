import { Injectable, Logger } from '@nestjs/common';

export interface FinancialMetrics {
  monthlyRevenueEstimate: number;
  revenueSource: 'actual' | 'projected';
  grossProfit: number;
  totalMonthlyOperatingCosts: number;
  netOperatingProfit: number;
  taxAdjustedProfit: number;
  contributionMarginPerUnit: number;
  contributionMarginPct: number;
  breakEvenVolume: number | null;
  breakEvenRevenue: number | null;
  breakEvenFlag: string | null;
  runwayMonths: number | null;
  runwayStatus: 'cash_positive' | 'limited' | 'critical' | 'unknown';
  repeatCustomerRate: number;
  leadConversionEstimate: number;
}

export interface FinanceData {
  pricePerUnit?: number | null;
  variableCostPerUnit?: number | null;
  fixedMonthlyCosts?: number | null;
  rent?: number | null;
  utilities?: number | null;
  salaries?: number | null;
  marketing?: number | null;
  software?: number | null;
  otherCosts?: number | null;
  taxRate?: number | null;
  cashOnHand?: number | null;
  actualMonthlyRevenue?: number | null;
  projectedMonthlyVolume?: number | null;
  projectedPrice?: number | null;
  monthlyTargetRevenue?: number | null;
  monthlyTargetVolume?: number | null;
  repeatCustomerPct?: number | null;
  leadCount?: number | null;
  conversionRate?: number | null;
}

@Injectable()
export class GuidanceFinancialService {
  private readonly logger = new Logger(GuidanceFinancialService.name);

  calculate(data: FinanceData): FinancialMetrics {
    const price = this.num(data.pricePerUnit);
    const variableCost = this.num(data.variableCostPerUnit);

    const itemizedCosts =
      this.num(data.rent) +
      this.num(data.utilities) +
      this.num(data.salaries) +
      this.num(data.marketing) +
      this.num(data.software) +
      this.num(data.otherCosts);

    const declaredFixed = this.num(data.fixedMonthlyCosts);
    const totalMonthlyOperatingCosts = Math.max(declaredFixed, itemizedCosts);

    const actualRevenue = this.num(data.actualMonthlyRevenue);
    const projVolume = this.intNum(data.projectedMonthlyVolume);
    const projPrice = this.num(data.projectedPrice) || price;

    let monthlyRevenueEstimate: number;
    let revenueSource: 'actual' | 'projected';

    if (actualRevenue > 0) {
      monthlyRevenueEstimate = actualRevenue;
      revenueSource = 'actual';
    } else if (projVolume > 0 && projPrice > 0) {
      monthlyRevenueEstimate = projVolume * projPrice;
      revenueSource = 'projected';
    } else {
      monthlyRevenueEstimate = 0;
      revenueSource = 'projected';
    }

    const estimatedVolume =
      projVolume > 0
        ? projVolume
        : price > 0
          ? Math.round(monthlyRevenueEstimate / price)
          : 0;

    const totalVariableCosts = variableCost * estimatedVolume;
    const grossProfit = monthlyRevenueEstimate - totalVariableCosts;

    const netOperatingProfit = grossProfit - totalMonthlyOperatingCosts;

    const taxRate = this.num(data.taxRate);
    const effectiveTax = taxRate > 0 && taxRate <= 100 ? taxRate / 100 : 0;
    const taxAdjustedProfit =
      netOperatingProfit > 0
        ? netOperatingProfit * (1 - effectiveTax)
        : netOperatingProfit;

    const contributionMarginPerUnit = price - variableCost;
    const contributionMarginPct =
      price > 0 ? (contributionMarginPerUnit / price) * 100 : 0;

    let breakEvenVolume: number | null = null;
    let breakEvenRevenue: number | null = null;
    let breakEvenFlag: string | null = null;

    if (contributionMarginPerUnit <= 0) {
      breakEvenFlag = 'Contribution margin is zero or negative — break-even cannot be computed';
    } else {
      breakEvenVolume = Math.ceil(totalMonthlyOperatingCosts / contributionMarginPerUnit);
      breakEvenRevenue = breakEvenVolume * price;

      if (
        data.projectedMonthlyVolume != null &&
        data.projectedMonthlyVolume > 0 &&
        breakEvenVolume > data.projectedMonthlyVolume
      ) {
        breakEvenFlag = 'Break-even volume exceeds projected monthly volume';
      }
    }

    const cashOnHand = this.num(data.cashOnHand);
    let runwayMonths: number | null = null;
    let runwayStatus: 'cash_positive' | 'limited' | 'critical' | 'unknown' = 'unknown';

    if (netOperatingProfit >= 0) {
      runwayStatus = 'cash_positive';
    } else if (cashOnHand > 0) {
      const monthlyBurn = Math.abs(netOperatingProfit);
      runwayMonths = Math.round((cashOnHand / monthlyBurn) * 10) / 10;
      runwayStatus = runwayMonths <= 3 ? 'critical' : 'limited';
    }

    const repeatCustomerRate = this.clamp(this.num(data.repeatCustomerPct), 0, 100);

    const leads = this.intNum(data.leadCount);
    const convRate = this.clamp(this.num(data.conversionRate), 0, 100);
    const leadConversionEstimate = leads > 0 && convRate > 0
      ? Math.round(leads * (convRate / 100))
      : 0;

    return {
      monthlyRevenueEstimate: this.round2(monthlyRevenueEstimate),
      revenueSource,
      grossProfit: this.round2(grossProfit),
      totalMonthlyOperatingCosts: this.round2(totalMonthlyOperatingCosts),
      netOperatingProfit: this.round2(netOperatingProfit),
      taxAdjustedProfit: this.round2(taxAdjustedProfit),
      contributionMarginPerUnit: this.round2(contributionMarginPerUnit),
      contributionMarginPct: this.round2(contributionMarginPct),
      breakEvenVolume,
      breakEvenRevenue: breakEvenRevenue != null ? this.round2(breakEvenRevenue) : null,
      breakEvenFlag,
      runwayMonths,
      runwayStatus,
      repeatCustomerRate: this.round2(repeatCustomerRate),
      leadConversionEstimate,
    };
  }

  private num(val: number | null | undefined): number {
    if (val == null || !Number.isFinite(val)) return 0;
    return val;
  }

  private intNum(val: number | null | undefined): number {
    const n = this.num(val);
    return Math.max(0, Math.round(n));
  }

  private clamp(val: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, val));
  }

  private round2(val: number): number {
    return Math.round(val * 100) / 100;
  }
}
