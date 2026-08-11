/**
 * A limit a customer is sold must be a limit the product enforces.
 *
 * MEASURED 2026-08-11. PLANS declares 25 limits. They are priced, they are
 * rendered on the pricing page, and they appear in FEATURE_REGISTRY with a tier
 * for FREE / FLOW / KEYFLOW. Read off a plan and enforced anywhere:
 *
 *   aiCreditsPerMonth   ai-usage.service.ts
 *   bookingsPerMonth    bookings.controller.ts   (checkLimit + @RequirePlanLimit)
 *   products            commerce.controller.ts   (checkLimit + @RequirePlanLimit)
 *   contacts            @RequirePlanLimit
 *   invoicesPerMonth    @RequirePlanLimit
 *   automations         @RequirePlanLimit (3 routes)
 *
 * Six of twenty-five. The other nineteen are advertised and enforce nothing:
 * a FREE account may add unlimited staff, connect webhooks its plan forbids,
 * and run marketplace listings it is told it cannot have.
 *
 * THE COUNT WAS WRONG FOUR TIMES BEFORE IT WAS RIGHT, and that is the more
 * useful finding. Bare-word matching said 13. Direct `limits.X` reads said 1.
 * Adding the checkLimit indirection said 3. Finding @RequirePlanLimit said 6 —
 * but a regex pairing bug had mapped `warehouses -> automations`, dropping
 * automations from the enforced set; and seven cases read the limit through
 * `(limits as any).x`, which an earlier pattern missed entirely.
 *
 * Enforcement here happens THREE ways — a direct plan read, a checkLimit call,
 * and a decorator — and any count of "how many limits bite" is wrong until all
 * three are found, with no way to know when you are done. That is worth
 * remembering the next time a number in this repo looks authoritative.
 *
 * AND THE ENFORCEMENT IS ALREADY WRITTEN. `SubscriptionsService.checkLimit`
 * implements FOURTEEN resources — contacts, staff, products, bookings,
 * invoices, marketplace_listings, warehouses, automations, social_posts,
 * email_campaigns, lead_forms, expenses, webhooks, reports. Twelve of them
 * have no caller. This is not missing capability, it is unreachable
 * capability, which is this codebase's most persistent shape.
 *
 * WHY THIS FILE DOES NOT SIMPLY TURN THEM ON. Enforcing a limit that has never
 * been enforced rejects requests from customers who are already over it. That
 * is a product decision with live blast radius — precisely the class of harm
 * this session spent its time undoing when the AI limiter locked an owner out
 * of features they had paid for. So this makes the gap VISIBLE and RATCHETED,
 * and leaves the decision where it belongs.
 *
 * The ledger below may only shrink.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PLANS } from './plans';

const SRC = join(__dirname, '..', '..');

/**
 * Limits that are declared and sold but not enforced anywhere.
 *
 * A DEBT LEDGER, not an allowlist — same shape as ACKNOWLEDGED_UNSCOPED and
 * UNPRICED_ACKNOWLEDGED. Its value is not that these are acceptable; it is that
 * a NEW limit cannot be added to the pricing page without someone deciding
 * whether the product will honour it.
 *
 * Twelve of these have working checkLimit cases already and need only a call
 * site. The rest are booleans (feature flags) that would be enforced at a
 * different layer.
 */
const UNENFORCED_ACKNOWLEDGED = new Set<string>([
  // checkLimit implements these; nothing calls it for them. contacts,
  // invoicesPerMonth and automations were on this list until the
  // @RequirePlanLimit decorator was found — they are gated on a route.
  'staffMembers',
  'socialPosts',
  'marketplaceListings',
  'warehouses',
  'emailCampaigns',
  'leadForms',
  'expenses',
  'reports',
  'webhooks',
  // Boolean entitlements — enforced, if ever, by hiding a surface rather than
  // by counting rows.
  'aiSuggestions',
  'customBranding',
  'prioritySupport',
  'quotesEnabled',
  'onlineStore',
  'communityAccess',
  'educationAccess',
  'calendarSync',
  'recurringInvoices',
  'advancedAnalytics',
]);

function declaredLimits(): string[] {
  const src = readFileSync(join(__dirname, 'plans.ts'), 'utf8');
  const at = src.indexOf('  limits: {');
  const block = src.slice(at, src.indexOf('  };', at));
  return [...block.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
}

function serverFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist'].includes(e.name)) continue;
      out = out.concat(serverFiles(p));
    } else if (/\.ts$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * `checkLimit`'s `case 'bookings':` -> `limits.bookingsPerMonth`.
 *
 * Enforcement is INDIRECT for most resources: the caller passes a resource
 * string and the plan read happens inside checkLimit. A detector that only
 * looked for `limits.X` outside this module reported bookings and products as
 * unenforced when both are gated at a controller — wrong in the opposite
 * direction to the bare-word attempt, and just as useless.
 */
function resourceToLimitKey(): Map<string, string> {
  const src = readFileSync(join(__dirname, 'subscriptions.service.ts'), 'utf8');
  const at = src.indexOf('async checkLimit(');
  const body = src.slice(at, src.indexOf('\n  async ', at + 10));
  const map = new Map<string, string>();

  // SPLIT ON CASE BOUNDARIES, then read each segment. Do not try to pair
  // `case 'x'` with a following `limits.y` in one expression: a single regex
  // with /g advances lastIndex past each match, so a case whose body has no
  // `limits.` within range lets the NEXT case's read pair with the wrong key.
  // Measured — that produced `warehouses -> automations`, which silently
  // dropped `automations` from the enforced set entirely and left it on the
  // unenforced ledger while it was gated on three routes.
  const segments = body.split(/case\s+'/).slice(1);
  for (const seg of segments) {
    const name = /^([a-z_]+)'/.exec(seg)?.[1];
    if (!name) continue;
    // Only within THIS case — stop at the next one.
    const upto = seg.split(/\n\s*case\s+'/)[0];
    // `limits.x`, `limits?.x`, and `(limits as any).x` — seven of the fourteen
    // cases use the cast form, and a pattern that missed it reported them as
    // reading no limit at all.
    const limit = /\(?limits(?:\s+as\s+\w+)?\)?\s*\??\.\s*(\w+)/.exec(upto)?.[1];
    if (limit) map.set(name, limit);
  }
  return map;
}

/** Limits enforced anywhere — directly off a plan, or via checkLimit. */
function enforcedLimits(): Set<string> {
  const external = serverFiles(SRC).filter(
    (f) => !relative(SRC, f).split(sep).includes('subscriptions'),
  );
  const sources = external.map((f) => readFileSync(f, 'utf8'));
  const found = new Set<string>();

  // (a) Read straight off a plan. `limits.contacts`, `limits?.contacts`,
  //     `limits['contacts']`. The BARE WORD is useless here: a first attempt
  //     matched every variable called `contacts` and reported 13 of 25
  //     enforced, an order of magnitude wrong.
  for (const l of declaredLimits()) {
    const re = new RegExp(`limits\\s*\\??\\.\\s*${l}\\b|limits\\s*\\[\\s*['"]${l}['"]\\s*\\]`);
    if (sources.some((s) => re.test(s))) found.add(l);
  }

  // (b) Gated through checkLimit(businessId, '<resource>') at a real call site.
  const byResource = resourceToLimitKey();
  for (const s of sources) {
    for (const m of s.matchAll(/checkLimit\(\s*[^,]+,\s*['"]([a-z_]+)['"]\s*\)/g)) {
      const limitKey = byResource.get(m[1]);
      if (limitKey) found.add(limitKey);
    }
  }

  // (c) Gated declaratively by @RequirePlanLimit('<resource>') + PlanLimitGuard,
  //     which calls the same checkLimit.
  //
  //     THE THIRD MECHANISM, and the third time this measurement was wrong.
  //     Bare-word matching said 13 of 25. Direct `limits.X` reads said 1. Adding
  //     the checkLimit indirection said 3. Only after finding the decorator does
  //     it say 6 — and contacts, invoicesPerMonth and automations had all been
  //     listed as unenforced debt when they are gated on a route.
  //
  //     Worth stating what that pattern means: when a system has three ways to
  //     do something, any count of "how many do it" is wrong until you have
  //     found all three, and there is no way to know you have.
  for (const s of sources) {
    for (const m of s.matchAll(/@RequirePlanLimit\(\s*['"]([a-z_]+)['"]\s*\)/g)) {
      const limitKey = byResource.get(m[1]);
      if (limitKey) found.add(limitKey);
    }
  }

  return found;
}

describe('every limit a customer is sold is a limit the product keeps', () => {
  const declared = declaredLimits();
  const enforced = enforcedLimits();

  it('finds both sides — this check is not vacuous', () => {
    expect(declared.length, 'no limits parsed from PLANS').toBeGreaterThan(20);
    expect(
      enforced.size,
      'no limit is read off a plan anywhere — the reader is broken, not the product',
    ).toBeGreaterThan(0);
  });

  it('no limit is advertised without a decision about enforcing it', () => {
    const undecided = declared.filter(
      (l) => !enforced.has(l) && !UNENFORCED_ACKNOWLEDGED.has(l),
    );

    expect(
      undecided,
      'These limits are declared in PLANS — and therefore priced and shown to ' +
        'customers — but are never read off a plan and never enforced. Either ' +
        'enforce one (SubscriptionsService.checkLimit already implements most of ' +
        'them and needs only a call site), or add it to UNENFORCED_ACKNOWLEDGED, ' +
        'which may only shrink.',
    ).toEqual([]);
  });

  it('the ledger names no ghosts and may only shrink', () => {
    const real = new Set(declared);
    expect(
      [...UNENFORCED_ACKNOWLEDGED].filter((l) => !real.has(l)),
      'these name no limit in PLANS, so the ledger overstates the debt',
    ).toEqual([]);

    expect(
      [...UNENFORCED_ACKNOWLEDGED].filter((l) => enforced.has(l)),
      'this limit is enforced now — take it off the unenforced ledger',
    ).toEqual([]);
  });

  it('the AI credit limit — the one that is enforced — stays enforced', () => {
    // Named specifically. It is the only limit with real teeth, it is the one
    // that took production down when it was pointed at the wrong pool, and a
    // silent regression to advisory would be invisible.
    expect(enforced.has('aiCreditsPerMonth')).toBe(true);
    for (const key of Object.keys(PLANS)) {
      expect(
        typeof PLANS[key].limits.aiCreditsPerMonth,
        `${key} must declare a numeric AI credit limit`,
      ).toBe('number');
    }
  });
});
