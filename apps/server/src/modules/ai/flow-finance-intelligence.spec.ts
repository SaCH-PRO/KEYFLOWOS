import { describe, expect, it } from 'vitest';
import { FLOW_TOOLS } from './flow-tool-registry';

describe('canonical finance intelligence capability contracts', () => {
  it.each([
    'finance_safe_to_spend',
    'finance_cashflow_forecast',
    'finance_money_moves',
  ])('%s is a low-risk canonical read capability', (name) => {
    const tool = FLOW_TOOLS.find((candidate) => candidate.name === name);
    expect(tool).toBeDefined();
    expect(tool?.family).toBe('read');
    expect(tool?.riskTier).toBe(1);
    expect(tool?.manualEquivalentRoute).toBe('/app/finance');
  });

  it('keeps historical cashflow and forward forecast as different capabilities', () => {
    const historical = FLOW_TOOLS.find((tool) => tool.name === 'finance_cashflow');
    const forecast = FLOW_TOOLS.find((tool) => tool.name === 'finance_cashflow_forecast');

    expect(historical).toBeDefined();
    expect(forecast).toBeDefined();
    expect(historical?.parameters.required).toEqual(expect.arrayContaining(['from', 'to']));
    expect(forecast?.parameters.required).toEqual([]);
    expect(forecast?.description.toLowerCase()).toContain('projection');
  });

  it('does not describe money-move recommendations as execution authority', () => {
    const tool = FLOW_TOOLS.find((candidate) => candidate.name === 'finance_money_moves');
    expect(tool?.description.toLowerCase()).toContain('not execution authority');
  });
});
