/**
 * KEY could not perform a single write action for any user.
 *
 * The web pins `role: "general"` on every chat request. The tool FILTER
 * deliberately skips filtering for that role, so all 118 tools are offered to
 * the model — but `AiOversightService.evaluate` checks
 * `roleEngine.isToolAllowed(role, toolName)` FIRST, and `general`'s allowlist
 * was reads-only. So 86 of 118 tools were advertised and then refused with
 * "I can't execute that action right now: Tool X is not available to the
 * general role". Creating an invoice, booking, task or message all failed.
 *
 * The design rule this restores:
 *
 *   the ROLE layer gates SCOPE   (what this role's job covers)
 *   the TIER layer gates RISK    (tier 2 -> confirm, 3 -> approve, 4 -> admin)
 *
 * Blocking writes at the role layer did not add safety — the tier system was
 * already there and fully built. It only made the tier system unreachable.
 *
 * A second defect fixed here: the `marketing` role's `'seo_*'` pattern matched
 * ZERO tools, because they are named `fetch_seo_*` and `sync_seo_pages`. The
 * role responsible for SEO could not reach a single SEO tool.
 */
import { describe, it, expect } from 'vitest';
import { RoleEngineService } from './role-engine.service';
import type { BusinessRole } from './role-engine.service';
import { getOpenAiToolDefinitions } from './flow-tool-registry';

const engine = new RoleEngineService(...([] as never[]));
const TOOLS = getOpenAiToolDefinitions().map((t) => t.function.name);
const ROLES: BusinessRole[] = [
  'sales',
  'finance',
  'support',
  'operations',
  'marketing',
  'general',
  'operator',
  'executive',
];

/**
 * Tools deliberately unreachable by every role. Irreversible data destruction
 * stays off the table for KEY entirely; a human does it in the UI. Listed
 * explicitly so a THIRD orphan cannot appear by accident — that is how the
 * previous 26 accumulated.
 */
const INTENTIONALLY_UNREACHABLE = ['commerce_delete_invoice', 'crm_delete_contact'];

describe('every tool is reachable by some role', () => {
  it('has the full tool surface', () => {
    expect(TOOLS.length).toBeGreaterThan(100);
  });

  it('no tool is advertised to the model and refused by every role', () => {
    const orphaned = TOOLS.filter(
      (t) =>
        !INTENTIONALLY_UNREACHABLE.includes(t) &&
        !ROLES.some((r) => engine.isToolAllowed(r, t)),
    );
    expect(orphaned, `unreachable by any role: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('the deliberate exceptions are still exactly the destructive two', () => {
    // If one of these becomes reachable, that is a real decision someone
    // should make on purpose, not a drive-by allowlist edit.
    for (const t of INTENTIONALLY_UNREACHABLE) {
      const reachable = ROLES.filter((r) => engine.isToolAllowed(r, t));
      expect(reachable, `${t} became reachable by ${reachable.join(', ')}`).toEqual([]);
    }
  });
});

describe('the general role can actually act', () => {
  // This is the role every user gets, on every message.
  const CORE_WRITES = [
    'crm_create_contact',
    'commerce_create_invoice',
    'bookings_create_booking',
    'create_task',
    'send_message_with_approval',
    'calendar_create_event',
    'projects_create_task',
    'expenses_create',
  ];

  for (const tool of CORE_WRITES) {
    it(`allows ${tool}`, () => {
      if (!TOOLS.includes(tool)) return; // tool renamed — covered by the orphan test
      expect(engine.isToolAllowed('general', tool)).toBe(true);
    });
  }

  it('still reaches the read family', () => {
    expect(engine.isToolAllowed('general', 'fetch_business_summary')).toBe(true);
  });

  it('still refuses irreversible destruction', () => {
    expect(engine.isToolAllowed('general', 'crm_delete_contact')).toBe(false);
    expect(engine.isToolAllowed('general', 'commerce_delete_invoice')).toBe(false);
  });
});

describe('roles can do their own job', () => {
  it('marketing can reach SEO tools — the seo_* pattern matched nothing', () => {
    const seo = TOOLS.filter((t) => t.includes('seo'));
    expect(seo.length).toBeGreaterThan(0);
    expect(seo.some((t) => engine.isToolAllowed('marketing', t))).toBe(true);
  });

  it('marketing can send a campaign and publish a post', () => {
    // Both were in marketing's OWN blockedTools — its two core actions.
    expect(engine.isToolAllowed('marketing', 'marketing_send_campaign')).toBe(true);
    expect(engine.isToolAllowed('marketing', 'social_publish_post')).toBe(true);
  });

  it('operations can run the delegation loops and deliver content', () => {
    expect(engine.isToolAllowed('operations', 'delegation_payment_recovery')).toBe(true);
    expect(engine.isToolAllowed('operations', 'content_deliver_request')).toBe(true);
  });

  it('executive can decide an approval', () => {
    expect(engine.isToolAllowed('executive', 'approval_decide_step')).toBe(true);
  });

  it('every role can read business state', () => {
    // A role blind to the business cannot answer a question about it.
    for (const r of ROLES) {
      expect(engine.isToolAllowed(r, 'fetch_business_summary'), `${r} is blind`).toBe(true);
    }
  });
});

describe('every role has a coherent baseline', () => {
  // Specialisation without a baseline produced roles that could not do their
  // own job. Measured before ROLE_BASELINE_TOOLS existed: finance could not
  // look up a contact, so it could not find the customer whose invoice it was
  // chasing. Operations and marketing were equally blind, and five of eight
  // roles could not open a document. Those gaps only surface once role
  // detection is switched on, which is why they are pinned here.
  const BASELINE = [
    'crm_search_contacts',
    'crm_list_contacts',
    'calendar_list_events',
    'calendar_check_conflicts',
    'documents_list',
    'documents_search',
    'keyflow_create_note',
    'create_task',
  ];

  for (const tool of BASELINE) {
    it(`every role can ${tool}`, () => {
      if (!TOOLS.includes(tool)) return;
      const missing = ROLES.filter((r) => !engine.isToolAllowed(r, tool));
      expect(missing, `${tool} missing for: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('a role can still deliberately opt out via blockedTools', () => {
    // blockedTools is checked before the baseline, so the escape hatch works.
    // executive blocks commerce_send_invoice and must stay blocked.
    expect(engine.isToolAllowed('executive', 'commerce_send_invoice')).toBe(false);
  });
});

describe('specialisation still means something', () => {
  it('a specialised role is narrower than general', () => {
    // Otherwise the role layer is decoration.
    const count = (r: BusinessRole) => TOOLS.filter((t) => engine.isToolAllowed(r, t)).length;
    expect(count('finance')).toBeLessThan(count('general'));
    expect(count('support')).toBeLessThan(count('general'));
  });

  it('executive stays advisory — no destructive or send actions', () => {
    expect(engine.isToolAllowed('executive', 'marketing_send_campaign')).toBe(false);
    expect(engine.isToolAllowed('executive', 'commerce_send_invoice')).toBe(false);
  });
});
