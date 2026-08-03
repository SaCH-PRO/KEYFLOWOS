/**
 * Tools must not report actions they did not perform, and must not advertise
 * capabilities they cannot deliver.
 *
 * Two defects are pinned here, both invisible to typecheck, lint and diff
 * review because in each case the code was syntactically fine and called a real
 * method:
 *
 *  1. `marketing_send_campaign` called `markCampaignSent`, which flips the
 *     campaign to SENT and emits `recipientCount: 0` — it emails nobody. The
 *     tool's own pre-execution confirmation string promises "Send email
 *     campaign to all eligible contacts". The real sender, `sendCampaign`, was
 *     200 lines away in the same service and additionally honours
 *     doNotContact / marketingOptIn. KEY was telling users it had sent
 *     campaigns it had not sent.
 *
 *  2. Five `delegation_*` tools were declared in FLOW_TOOLS with no `case`
 *     clause, so they fell through to `default: throw new Error('Unknown
 *     tool')`. They are offered in the default role, so the model could and
 *     would call them. The implementations existed the entire time.
 *
 * The structural assertion at the end — every declared tool has a handler —
 * is the one that stops this whole class of defect recurring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const registry = readFileSync(join(__dirname, 'flow-tool-registry.ts'), 'utf8');

/** Tool names declared in FLOW_TOOLS. */
function declaredTools(): string[] {
  return [...new Set(Array.from(registry.matchAll(/name: '([a-z_0-9]+)'/g), (m) => m[1]))];
}

/** Tool names with a `case` clause in executeToolAction. */
function handledTools(): Set<string> {
  const start = orchestrator.indexOf('private async executeToolAction(');
  const body = orchestrator.slice(start);
  return new Set(Array.from(body.matchAll(/case '([a-z_0-9]+)':/g), (m) => m[1]));
}

describe('every declared tool has a handler', () => {
  it('no tool can be advertised to the model and then throw Unknown tool', () => {
    const declared = declaredTools();
    const handled = handledTools();

    expect(declared.length).toBeGreaterThan(100);

    const orphaned = declared.filter((t) => !handled.has(t));
    expect(orphaned, `declared with no case clause: ${orphaned.join(', ')}`).toEqual([]);
  });
});

/** Handler source with `//` comments removed — an assertion that matches the
 *  comment explaining the bug would pass against the bug itself. That has
 *  already happened once in this repo. */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('marketing_send_campaign actually sends', () => {
  const handler = codeOnly(
    (() => {
      const i = orchestrator.indexOf("case 'marketing_send_campaign':");
      return orchestrator.slice(i, orchestrator.indexOf('case ', i + 10));
    })(),
  );

  it('calls sendCampaign, the method that delivers', () => {
    expect(handler).toMatch(/sendCampaign\(/);
  });

  it('does NOT call markCampaignSent, which emails nobody', () => {
    // markCampaignSent sets status SENT and emits recipientCount: 0.
    expect(handler).not.toMatch(/markCampaignSent/);
  });

  it('surfaces the not-delivered warning instead of swallowing it', () => {
    // sendCampaign returns `warning` when Gmail is not connected: "Campaign
    // recorded but emails not delivered." If the tool drops that, KEY claims
    // delivery again by a different route.
    expect(handler).toMatch(/warning/);
  });

  it('reports real recipient counts rather than a bare success', () => {
    expect(handler).toMatch(/result\.sent/);
    expect(handler).toMatch(/result\.gmailDelivered/);
  });
});

describe('the five delegation loops are wired', () => {
  const LOOPS = [
    'payment_recovery',
    'lead_reactivation',
    'post_purchase',
    'booking_prep',
    'weekly_hygiene',
  ];

  for (const loop of LOOPS) {
    it(`delegation_${loop} has a handler`, () => {
      expect(handledTools().has(`delegation_${loop}`)).toBe(true);
    });
  }

  const handler = codeOnly(
    (() => {
      const i = orchestrator.indexOf("case 'delegation_payment_recovery':");
      return orchestrator.slice(i, i + 2000);
    })(),
  );

  it('ensures the loop rows exist before running', () => {
    // runLoop takes a DelegationLoop ROW id and throws NotFoundException if
    // the business has never had its loops created.
    expect(handler).toMatch(/ensureLoopsForBusiness\(businessId\)/);
  });

  it('resolves the row id rather than passing the loop type', () => {
    expect(handler).toMatch(/l\.loopType === loopType/);
    expect(handler).toMatch(/runLoop\(businessId, loop\.id\)/);
  });

  it('fails loudly when the loop is unavailable', () => {
    expect(handler).toMatch(/is not available for this business/);
  });
});
