import { Injectable } from '@nestjs/common';
import type {
  BlueprintFinancials,
  BlueprintProjectionProfile,
  ProjectionMonth,
} from '../blueprint/blueprint.types';

@Injectable()
export class GenesisProjectionService {
  calculate(
    projectionProfile: BlueprintProjectionProfile,
    financials: BlueprintFinancials,
  ): BlueprintProjectionProfile {
    const avgTicket =
      typeof projectionProfile.avgTicket === 'number'
        ? projectionProfile.avgTicket
        : typeof financials.avgTicket === 'number'
          ? financials.avgTicket
          : undefined;

    const expectedMonthlyUnits = projectionProfile.expectedMonthlyUnits;
    const monthlyFixedCosts = projectionProfile.monthlyFixedCosts;
    const startupCapital = projectionProfile.startupCapital;
    const startupCosts = projectionProfile.startupCosts;
    const variableCostPercent = projectionProfile.variableCostPercent ?? 0;

    const result: BlueprintProjectionProfile = { ...projectionProfile };

    // JSON columns cannot store Infinity, so we use a large sentinel for
    // "indefinite" runway / break-even scenarios.
    const INFINITE_RUNWAY = 9999;

    if (typeof avgTicket === 'number') {
      result.avgTicket = avgTicket;
    }

    if (typeof avgTicket === 'number' && typeof expectedMonthlyUnits === 'number') {
      result.baseMonthlyRevenue = avgTicket * expectedMonthlyUnits;

      if (typeof result.conservativeMonthlyUnits !== 'number') {
        result.conservativeMonthlyUnits = Math.floor(expectedMonthlyUnits * 0.7);
      }
      if (typeof result.conservativeMonthlyRevenue !== 'number') {
        result.conservativeMonthlyRevenue = avgTicket * result.conservativeMonthlyUnits;
      }

      if (typeof result.aggressiveMonthlyUnits !== 'number') {
        result.aggressiveMonthlyUnits = Math.floor(expectedMonthlyUnits * 1.3);
      }
      if (typeof result.aggressiveMonthlyRevenue !== 'number') {
        result.aggressiveMonthlyRevenue = avgTicket * result.aggressiveMonthlyUnits;
      }
    }

    const grossMargin = 1 - variableCostPercent;
    if (
      typeof avgTicket === 'number' &&
      typeof monthlyFixedCosts === 'number' &&
      grossMargin > 0
    ) {
      result.breakEvenUnits = Math.ceil(monthlyFixedCosts / (avgTicket * grossMargin));
      result.breakEvenRevenue = result.breakEvenUnits * avgTicket;
    } else if (
      typeof avgTicket === 'number' &&
      typeof monthlyFixedCosts === 'number' &&
      grossMargin <= 0
    ) {
      result.breakEvenUnits = INFINITE_RUNWAY;
      result.breakEvenRevenue = INFINITE_RUNWAY * avgTicket;
    } else if (typeof monthlyFixedCosts === 'number' && monthlyFixedCosts <= 0) {
      result.breakEvenUnits = 0;
      result.breakEvenRevenue = 0;
    }

    const baseMonthlyRevenue = result.baseMonthlyRevenue;
    if (
      typeof baseMonthlyRevenue === 'number' &&
      typeof monthlyFixedCosts === 'number' &&
      typeof startupCapital === 'number' &&
      typeof startupCosts === 'number'
    ) {
      if (baseMonthlyRevenue >= monthlyFixedCosts) {
        result.runwayMonths = INFINITE_RUNWAY;
      } else if (startupCapital < startupCosts) {
        result.runwayMonths = 0;
      } else {
        result.runwayMonths = Math.floor(
          (startupCapital - startupCosts) / (monthlyFixedCosts - baseMonthlyRevenue),
        );
      }
    }

    result.monthByMonth = this.buildMonthByMonth(
      startupCapital,
      startupCosts,
      baseMonthlyRevenue,
      monthlyFixedCosts,
      variableCostPercent,
      projectionProfile.expectedMonthlyUnits,
    );

    return result;
  }

  private buildMonthByMonth(
    startupCapital: number | undefined,
    startupCosts: number | undefined,
    baseMonthlyRevenue: number | undefined,
    monthlyFixedCosts: number | undefined,
    variableCostPercent: number,
    expectedMonthlyUnits: number | undefined,
  ): ProjectionMonth[] {
    if (
      typeof startupCapital !== 'number' ||
      typeof startupCosts !== 'number' ||
      typeof baseMonthlyRevenue !== 'number' ||
      typeof monthlyFixedCosts !== 'number'
    ) {
      return [];
    }

    const months: ProjectionMonth[] = [];
    let cash = Math.max(0, startupCapital - startupCosts);
    const monthlyUnits =
      typeof expectedMonthlyUnits === 'number' ? expectedMonthlyUnits : 0;

    for (let i = 0; i < 12; i++) {
      const variableCosts = baseMonthlyRevenue * variableCostPercent;
      const netProfit = baseMonthlyRevenue - monthlyFixedCosts - variableCosts;
      cash += netProfit;

      months.push({
        month: `Month ${i + 1}`,
        revenue: baseMonthlyRevenue,
        units: monthlyUnits,
        expenses: monthlyFixedCosts + variableCosts,
        netProfit,
      });

      if (cash <= 0) break;
    }

    return months;
  }
}
