import { describe, expect, it } from 'vitest';
import { MarketStrategyContextBuilder } from './market-strategy-context-builder.service';
import type { BlueprintData } from '../blueprint/blueprint.types';

function makeBlueprint(overrides: Partial<BlueprintData> = {}): BlueprintData {
  return {
    identity: { name: 'ClinicFlow T&T', industry: 'Healthcare technology', country: 'Trinidad and Tobago', archetype: 'Clinic management platform' },
    marketProfile: { targetGeography: 'Trinidad and Tobago' },
    operatingModel: { revenueModel: 'SaaS subscription', channels: ['website', 'social media'] },
    customerModel: { idealCustomer: 'Private general practitioners and small clinics' },
    offerArchitecture: { coreOffer: { name: 'ClinicFlow Platform', description: 'Appointment scheduling, records, and billing for clinics.' } },
    financials: { currency: 'TTD', pricingModel: 'monthly subscription tiers', monthlyTarget: 50000 },
    projectionProfile: { runwayMonths: 12 },
    marketingSystem: { channels: [{ channel: 'website' }, { channel: 'social media' }] },
    goals: { northStar: 'Acquire 50 clinic customers in year one', priorities: ['Launch', 'Retention'] },
    ...overrides,
  } as BlueprintData;
}

describe('MarketStrategyContextBuilder', () => {
  it('renders all context sections from blueprint', () => {
    const builder = new MarketStrategyContextBuilder();
    const context = builder.build(makeBlueprint());

    expect(context).toContain('Business: ClinicFlow T&T');
    expect(context).toContain('Industry: Healthcare technology');
    expect(context).toContain('Country: Trinidad and Tobago');
    expect(context).toContain('Target geography: Trinidad and Tobago');
    expect(context).toContain('Revenue model: SaaS subscription');
    expect(context).toContain('Primary channels: website, social media');
    expect(context).toContain('Ideal customer: Private general practitioners and small clinics');
    expect(context).toContain('ClinicFlow Platform');
    expect(context).toContain('Financial context: currency TTD');
    expect(context).toContain('Marketing channels: website, social media');
  });

  it('tolerates missing nested objects', () => {
    const builder = new MarketStrategyContextBuilder();
    const context = builder.build({} as BlueprintData);

    expect(context).toContain('Business:');
    expect(context).not.toContain('undefined');
  });

  it('extracts channel names from object-form marketing channels', () => {
    const builder = new MarketStrategyContextBuilder();
    const context = builder.build(makeBlueprint({ marketingSystem: { channels: [{ channel: 'email' }, { channel: 'events' }] } }));

    expect(context).toContain('Marketing channels: email, events');
  });
});
