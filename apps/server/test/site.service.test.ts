import { describe, expect, it } from 'vitest';
import { SiteService } from '../src/modules/site/site.service';

function getMethods(source: unknown) {
  return SiteService.prototype.getConfiguredCheckoutMethods.call(
    {} as SiteService,
    source as Record<string, unknown>,
  );
}

describe('SiteService.getConfiguredCheckoutMethods', () => {
  it('returns default methods when gateways are missing', () => {
    expect(getMethods(undefined)).toEqual(['WIPAY', 'PAYPAL', 'CASH']);
    expect(getMethods({})).toEqual(['WIPAY', 'PAYPAL', 'CASH']);
  });

  it('maps blueprint gateways to checkout methods', () => {
    expect(
      getMethods({
        paymentAndClosing: {
          enabledGateways: ['wipay', 'paypal', 'manual'],
        },
      }),
    ).toEqual(['WIPAY', 'PAYPAL', 'CASH']);
  });

  it('supports wrapped blueprint payloads and cash-like gateways', () => {
    expect(
      getMethods({
        blueprint: {
          paymentAndClosing: {
            enabledGateways: ['bank_transfer'],
          },
        },
      }),
    ).toEqual(['CASH']);
  });
});
