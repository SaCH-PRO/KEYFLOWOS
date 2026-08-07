/**
 * KEY could take money and never know whether it arrived.
 *
 * It could raise an invoice, email it for real, and mark it paid. It could not
 * see a single transaction, send a payment link, or refund anything — a 792-line
 * operations console over three gateways with zero tools and no nav entry until
 * 2026-08-07.
 *
 * That gap has a particular shape. Chasing an unpaid invoice is one of the most
 * common things anyone would ask a business assistant to do, and KEY could
 * perform every step of it except the one that says whether it worked.
 *
 * These assertions concentrate on the refund, because it is the only tool in the
 * entire arsenal that moves money OUT of the business to a third party.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';

const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const tools = FLOW_TOOLS.filter((t) => t.name.startsWith('payments_'));

describe('KEY can follow the money', () => {
  it('covers gateways, transactions, search, links and refunds', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const verb of [
      'payments_list_gateways',
      'payments_list_transactions',
      'payments_search_transactions',
      'payments_list_links',
      'payments_create_link',
      'payments_revoke_link',
      'payments_refund_charge',
    ]) {
      expect(names.has(verb), `${verb} is missing`).toBe(true);
    }
  });

  it('every payments tool has a handler and points at the console', () => {
    for (const tool of tools) {
      expect(orchestrator.includes(`case '${tool.name}':`), `${tool.name} has no handler`).toBe(true);
      expect(tool.manualEquivalentRoute).toBe('/app/payments');
    }
  });

  it('the gateway enum is exactly the three that are registered', () => {
    // payments-ops.service.ts:17 — 'stripe' | 'paypal' | 'wipay'. getGateway
    // throws BadRequest for anything else, so a wider enum here is a tool that
    // fails on a value it advertised.
    for (const name of ['payments_create_link', 'payments_revoke_link', 'payments_refund_charge']) {
      expect(getToolByName(name)?.parameters.properties.gateway?.enum).toEqual([
        'stripe',
        'paypal',
        'wipay',
      ]);
    }
  });
});

describe('the refund is treated as what it is', () => {
  const refund = getToolByName('payments_refund_charge');

  it('is tier 3, the approval tier', () => {
    // The only tool that sends money to a third party. Tier 3 routes it to
    // formal approval for every role except operator, and operator is the only
    // role that can act at that tier at all.
    expect(refund?.riskTier).toBe(3);
    expect(refund?.riskLevel).toBe('high');
  });

  it('says plainly that it cannot be undone', () => {
    // There is no compensating action for a refund and there cannot be — money
    // that has left cannot be pulled back, only re-charged, which needs the
    // customer to pay again. The description has to carry that, because the
    // saga layer cannot.
    expect(refund?.description).toMatch(/cannot be undone/i);
  });

  it('has no compensating action registered, deliberately', () => {
    const compensation = readFileSync(
      join(__dirname, '..', 'key-cortex', 'key-cortex-compensation.service.ts'),
      'utf8',
    );
    expect(
      compensation.includes('payments_refund_charge'),
      'a compensating action for a refund would be a lie — there is no way to un-send money',
    ).toBe(false);
  });

  it('tells the model how to find a real charge id', () => {
    // Without this the model invents a charge id, the gateway rejects it, and
    // the user is told their refund failed for a reason that is not the reason.
    expect(refund?.description).toMatch(/payments_search_transactions/);
  });

  it('reports the gateway result rather than the request', () => {
    // A partial refund can come back at a different amount than was asked for,
    // and the gateway is the authority on what actually happened. Echoing the
    // request would tell the owner they refunded $50 when the gateway refunded
    // $30 — the seven-handler defect, with money attached.
    const at = orchestrator.indexOf("case 'payments_refund_charge':");
    const body = orchestrator.slice(at, orchestrator.indexOf('      case ', at + 10));

    expect(body).toMatch(/const refund = await this\.getPaymentsOps\(\)\.refundCharge/);
    expect(body).toMatch(/return \{ refund \}/);
  });
});

describe('gateways are checked before they are used', () => {
  it('payments_list_gateways reports capability, not just presence', () => {
    // Gateways differ: not all support links or refunds. getGatewayStatuses
    // returns { connected, supports: { transactions, paymentLinks, refunds } },
    // so the model can tell "not connected" from "cannot do this" — two
    // different sentences for the user.
    const desc = getToolByName('payments_list_gateways')?.description ?? '';
    expect(desc).toMatch(/connected/i);
    expect(desc).toMatch(/refund/i);
  });

  it('the write tools point at it', () => {
    expect(getToolByName('payments_list_gateways')?.description).toMatch(/before creating a link or issuing a refund/i);
  });
});

describe('who can touch the money', () => {
  const roleEngine = readFileSync(join(__dirname, 'role-engine.service.ts'), 'utf8');
  const block = (name: string, next: string) =>
    roleEngine.slice(roleEngine.indexOf(`  ${name}: {`), roleEngine.indexOf(`  ${next}: {`));

  it('finance gets the full set', () => {
    expect(block('finance', 'support')).toMatch(/'payments_\*'/);
  });

  it('sales and support can look but not refund', () => {
    // Both need to answer "did it go through" and "were they charged twice".
    // Neither should be able to send money back on their own judgement.
    for (const [role, next] of [['sales', 'finance'], ['support', 'operations']] as const) {
      const b = block(role, next);
      expect(b, `${role} should be able to find a charge`).toMatch(/'payments_search_transactions'/);
      expect(b, `${role} must not have blanket payments access`).not.toMatch(/'payments_\*'/);
    }
  });

  it('executive sees money in, and nothing that moves it', () => {
    const exec = roleEngine.slice(roleEngine.indexOf('  executive: {'));
    expect(exec).toMatch(/'payments_list_transactions'/);
    expect(exec).not.toMatch(/'payments_\*'/);
  });
});
