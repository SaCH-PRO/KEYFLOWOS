/**
 * The tenant isolation list has to name models that exist.
 *
 * BUSINESS_ID_MODELS in packages/db/src/client.ts is a hand-maintained set of
 * model names. It is consulted by string:
 *
 *   function tenantOperationAllowed(model: string) {
 *     return !!activeBusinessId() && BUSINESS_ID_MODELS.has(model);
 *   }
 *
 * A name that does not match a real model never matches anything, so that model
 * is silently unscoped. Nothing throws. Nothing logs. The set just quietly
 * protects one fewer table than it appears to.
 *
 * This has now happened twice. The file's own comment records the first:
 * MessageThread, CommunicationEvent and NotificationEvent survived a rename and
 * named nothing. The second was mine — ConversationThread stayed in the list
 * after I dropped the model in the inbox merge, in the same week I wrote the
 * comment warning about it.
 *
 * A list checked by string against a schema nobody diffs it with is exactly the
 * shape of every other defect here: nav labels vs allowlists, compensation keys
 * vs tool names, tool enums vs domain enums, reason codes vs a form. This is
 * that diff, run every build.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const CLIENT = path.join(ROOT, 'packages', 'db', 'src', 'client.ts');
const SCHEMA = path.join(ROOT, 'packages', 'db', 'prisma', 'schema.prisma');

function listedModels(): string[] {
  const src = fs.readFileSync(CLIENT, 'utf8');
  const at = src.indexOf('const BUSINESS_ID_MODELS = new Set([');
  expect(at, 'BUSINESS_ID_MODELS not found — client.ts was restructured').toBeGreaterThan(-1);

  const body = src.slice(at, src.indexOf(']);', at));
  // Only quoted entries, so the surrounding prose cannot contribute names.
  return [...body.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((m) => m[1]);
}

function schemaModels(): Set<string> {
  const src = fs.readFileSync(SCHEMA, 'utf8');
  return new Set([...src.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm)].map((m) => m[1]));
}

describe('BUSINESS_ID_MODELS describes reality', () => {
  const listed = listedModels();
  const models = schemaModels();

  it('finds both sides', () => {
    expect(listed.length).toBeGreaterThan(20);
    expect(models.size).toBeGreaterThan(200);
  });

  it('every listed name is a real model', () => {
    const ghosts = listed.filter((name) => !models.has(name));

    expect(
      ghosts,
      'these name no model in schema.prisma, so they scope nothing and the set ' +
        'silently protects fewer tables than it appears to',
    ).toEqual([]);
  });

  it('every listed model actually has a businessId column', () => {
    // The other direction. Injecting businessId into a model that has no such
    // column throws PrismaClientValidationError at runtime — which is why
    // TaskAssignment is deliberately excluded and says so in the file.
    const src = fs.readFileSync(SCHEMA, 'utf8');
    const without = listed.filter((name) => {
      const at = src.search(new RegExp(`^model\\s+${name}\\s*\\{`, 'm'));
      if (at === -1) return false; // covered by the assertion above
      const block = src.slice(at, src.indexOf('\n}', at));
      return !/\bbusinessId\s+String/.test(block);
    });

    expect(
      without,
      'these have no businessId column — injecting one throws PrismaClientValidationError',
    ).toEqual([]);
  });

  it('the goal tables are covered', () => {
    // Named because their absence was a live cross-tenant hole:
    // POST /cortex/goals/:goalId/plans resolved a goal id straight from the URL
    // with no scoping at the service layer either, so a user of one business
    // could build a plan from another business's goal and read its title and
    // description back in the response.
    expect(listed).toContain('AiGoal');
    expect(listed).toContain('AiPlan');
  });
});

/**
 * Models that carry a businessId and are NOT scoped by the extension.
 *
 * This list is a DEBT LEDGER, not an allowlist. It exists because the gap was
 * invisible: the three checks above all read listed -> reality, so a new model
 * with a businessId is unscoped by default and nothing fails. Verified on
 * 2026-08-09 by adding one and watching this file pass.
 *
 * When this was written: 347 models carry a businessId, 77 were scoped, 270
 * were these. Now: 348 carry one, 310 scoped, 35 here, 3 in NEVER_SCOPE. The
 * three numbers sum to 348 exactly, and the assertions below are what keep them
 * summing — a model has one status, never two and never none.
 *
 * WHY IT IS NOT SIMPLY EMPTIED. Adding a model here injects businessId into
 * findUnique, and Prisma 6.19 ACCEPTS an extra scalar in a WhereUniqueInput
 * instead of rejecting it — measured, with a negative control, and recorded in
 * client.ts above the Payment/MarketplaceOrder exclusion. Any lookup by a
 * GLOBAL key (providerPaymentId, a webhook token, an external id) would then
 * return null SILENTLY: no error, no log, no provider retry. Emptying this list
 * in one commit would create 270 chances of that, and every test would pass.
 *
 * SO: this list may only SHRINK, one reviewed model at a time.
 *
 * AND THE TEST FOR "REVIEWED" IS NOT THE OBVIOUS ONE. The natural question is
 * "does any findUnique key on a global unique". That is necessary and it is not
 * sufficient. Membership is the counter-example: every one of its unique lookups
 * keys on `id`, so a key-shape test clears it — while
 * `membership.findMany({ where: { userId } })` means "every business this user
 * belongs to", and the extension injects businessId into findMany exactly as
 * readily. The right question covers all fifteen intercepted operations: does
 * EVERY call site already name businessId in its own `where`? Where it does,
 * injection re-states a predicate the caller already wrote and can change
 * nothing. Where it does not, a human reads it before it moves.
 */
const ACKNOWLEDGED_UNSCOPED = new Set([
  'AiMemory',
  'ApiKey',
 
  'BusinessReputation',
  'CalendarSyncConflict',
 
  'ChannelConnection', 'ChannelDestination',
 
  'ContactChannelStat',
  'ContactExportJob', 'ContactExternalMapping', 'ContactForgetRequest',
 
  'ConversationAIInsight', 'Course',
  'DriveIntakeFile',
  'FinanceActionItem',
  'FlowRun',
 
  'GenomeDepartment',
  'GenomeGrowthChannel',
  'IngestionItem',
  'IntegrationConnection', 'IntegrationSyncRun',
  'InventoryStock',
  'KeyCallSession',
  'Membership',
  'MessageIntake',
  'PortalAccess',
 
  'PromoCode',
  'PushSubscription',
  'SeoKeyword', 'SeoPage',
  'SitePageDraft',
  'SocialConnection',
  'SupplierConnection',
  'SyncJob',
 
  'VoiceSession',
  'WhatsAppMessage',
]);

/** Models whose businessId column exists but which must never be scoped. */
const NEVER_SCOPE = new Set([
  // Resolved by a global provider key in webhooks that have no tenant context.
  // See the note above the exclusion in client.ts — scoping these turns a
  // taken payment into a silent null.
  'Payment', 'MarketplaceOrder',
  // Same shape, found 2026-08-09 while clearing batch 4. WebhookEvent's unique
  // is @@unique([provider, providerEventId]) — a provider's own redelivery key,
  // with no businessId in it. It has no call sites yet, which made it look like
  // the harmless empty models scoped in that batch; it is their opposite. Debt
  // that must never be paid belongs here, not in the ledger above, so that the
  // remaining count means "work still owed" and nothing else.
  'WebhookEvent',
]);

describe('the unscoped set may only shrink', () => {
  const listed = new Set(listedModels());

  /** Every model declaring a `businessId String` scalar. */
  function modelsWithBusinessId(): string[] {
    const src = fs.readFileSync(SCHEMA, 'utf8');
    const out: string[] = [];
    for (const m of src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      if (/^\s+businessId\s+String/m.test(m[2])) out.push(m[1]);
    }
    return out;
  }

  it('finds the tenant-bearing models', () => {
    expect(modelsWithBusinessId().length).toBeGreaterThan(300);
  });

  it('no NEW model carries a businessId without a decision', () => {
    const undecided = modelsWithBusinessId().filter(
      (m) => !listed.has(m) && !ACKNOWLEDGED_UNSCOPED.has(m) && !NEVER_SCOPE.has(m),
    );

    expect(
      undecided,
      'These models carry a businessId and are neither scoped by the extension nor ' +
        'acknowledged as unscoped. A new model is UNSCOPED BY DEFAULT and nothing ' +
        'else reports it. Add each to BUSINESS_ID_MODELS in packages/db/src/client.ts ' +
        '(preferred) after checking it has no findUnique by a global key, or to ' +
        'ACKNOWLEDGED_UNSCOPED with the reason if its access is genuinely ' +
        'cross-tenant or non-HTTP.',
    ).toEqual([]);
  });

  it('the ledger names no ghosts', () => {
    const real = new Set(modelsWithBusinessId());
    const ghosts = [...ACKNOWLEDGED_UNSCOPED, ...NEVER_SCOPE].filter((m) => !real.has(m));
    expect(
      ghosts,
      'these name no model with a businessId, so the ledger overstates the debt',
    ).toEqual([]);
  });

  it('nothing is both scoped and acknowledged as unscoped', () => {
    const both = [...ACKNOWLEDGED_UNSCOPED].filter((m) => listed.has(m));
    expect(both, 'scoped models must be removed from the ledger when they are fixed').toEqual([]);
  });

  it('the two ledgers are disjoint', () => {
    // The other three checks compare a ledger against the SCHEMA. Nothing
    // compared the ledgers to each other, so Payment and MarketplaceOrder sat
    // in both from the day NEVER_SCOPE was introduced: counted as debt still
    // owed AND as work that must never be done. That inflated the remaining
    // figure by two and left the status of those two models unreadable —
    // exactly the ambiguity the shrink-only gate exists to prevent.
    const both = [...ACKNOWLEDGED_UNSCOPED].filter((m) => NEVER_SCOPE.has(m));
    expect(
      both,
      'these are in both ACKNOWLEDGED_UNSCOPED (debt still owed) and NEVER_SCOPE ' +
        '(must never be scoped). A model has one status or the other, never both — ' +
        'remove it from ACKNOWLEDGED_UNSCOPED.',
    ).toEqual([]);
  });
});
