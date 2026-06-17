import { Injectable } from '@nestjs/common';
import type { BlueprintData } from '../blueprint/blueprint.types';

function render(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}

@Injectable()
export class MarketStrategyContextBuilder {
  build(blueprint: BlueprintData): string {
    const identity = blueprint.identity || {};
    const marketProfile = blueprint.marketProfile || {};
    const operatingModel = blueprint.operatingModel || {};
    const customerModel = blueprint.customerModel || {};
    const offerArchitecture = blueprint.offerArchitecture || {};
    const financials = blueprint.financials || {};
    const projectionProfile = blueprint.projectionProfile || {};
    const marketingSystem = blueprint.marketingSystem || {};
    const goals = blueprint.goals || {};

    const marketingChannels = (marketingSystem.channels || [])
      .map((c) => (typeof c === 'object' ? c.channel : c))
      .filter((c): c is string => typeof c === 'string')
      .join(', ');

    const lines = [
      `Business: ${render(identity.name)}`,
      `Industry: ${render(identity.industry)}`,
      `Country: ${render(identity.country)}`,
      `Target geography: ${render(marketProfile.targetGeography)}`,
      `Archetype: ${render(identity.archetype)}`,
      `Revenue model: ${render(operatingModel.revenueModel)}`,
      `Pricing model: ${render(financials.pricingModel)}`,
      `Primary channels: ${render(operatingModel.channels)}`,
      `Ideal customer: ${render(customerModel.idealCustomer)}`,
      `Core offer: ${render(offerArchitecture.coreOffer?.name)} — ${render(offerArchitecture.coreOffer?.description)}`,
      `Financial context: currency ${render(financials.currency)}, estimated monthly target ${render(financials.monthlyTarget)}, runway ${render(projectionProfile.runwayMonths)} months`,
      `Marketing channels: ${marketingChannels}`,
      `Goals: ${render(goals.northStar)} / ${render(goals.priorities)}`,
    ];

    return lines.join('\n');
  }
}
