/**
 * KF-EXEC-ACTION-001 — the KEY action boundary for helpdesk_create_ticket,
 * against the REAL database.
 *
 * Each `describe` is one proof obligation of the directive. The transactional
 * and concurrency invariants (the claim, the locked re-read, rollback) cannot
 * be shown against a mock: a mock cannot make a second transaction wait on a
 * unique index or on a row lock, so it cannot disagree with the code. Every
 * test here therefore runs against Postgres, and after every test the fixture
 * checks the invariant behind "UNKNOWN is impossible": tickets, executed
 * actions and completed claims are the same set, and no claim is left open.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBoundaryFixture, deferred, settle, sleep } from './helpers/key-action-boundary.fixture';

type BoundaryFixture = Awaited<ReturnType<typeof buildBoundaryFixture>>;

const TOOL = 'helpdesk_create_ticket';
let fx: BoundaryFixture;
let ID: BoundaryFixture['ID'];

beforeAll(async () => {
  fx = await buildBoundaryFixture('kab_');
  ID = fx.ID;
  await fx.seed();
}, 120_000);

afterAll(async () => {
  if (fx) await fx.cleanup();
});

beforeEach(async () => {
  await fx.reset();
});

afterEach(async () => {
  await fx.assertNoUnknownState();
});

const chat = (userId: string, extra: Record<string, unknown> = {}) => ({ surface: 'CHAT' as const, principalUserId: userId, ...extra });

/** A staff member asks for a ticket in chat; under default autonomy it needs their confirmation. */
async function prepareForStaff(args: Record<string, unknown> = { title: 'Printer is on fire' }) {
  const prepared = await fx.boundary.prepare(ID.bizA, TOOL, args, chat(ID.staff));
  expect(prepared.disposition).toBe('AWAITING_CONFIRMATION');
  return prepared.actionId as string;
}

/** A principalless surface files a proposal; an admin approves it. */
async function proposeAndApprove(args: Record<string, unknown> = { title: 'Call back the customer' }) {
  const prepared = await fx.boundary.prepare(ID.bizA, TOOL, args, { surface: 'INBOUND_CONVERSATION' });
  expect(prepared.disposition).toBe('AWAITING_APPROVAL');
  await fx.boundary.recordEvidence(ID.bizA, prepared.actionId, ID.admin);
  return prepared.actionId as string;
}

async function expectRefused(p: Promise<unknown>, code: string) {
  const r = await settle(p);
  expect(r.err, `expected a refusal with ${code}, but the action executed`).toBeInstanceOf(fx.errors.ActionNotClearedError);
  expect(r.err.code).toBe(code);
  return r.err;
}

// ---------------------------------------------------------------------------
describe('P1 — capability identity: a wrapper never substitutes for the capability', () => {
  const wrapper = () => ({
    sourceType: 'AI_PLAN' as const,
    title: 'Plan step: open a ticket',
    actionType: 'EXECUTE_TOOL' as const,
    payload: { toolName: TOOL, inputPayload: { title: 'From a plan', priority: 'HIGH' } },
  });

  it('an EXECUTE_TOOL proposal for the tool is sealed as helpdesk_create_ticket', async () => {
    const proposal = await fx.proposals.create(ID.bizA, wrapper());
    const row = await fx.action(proposal.id);

    expect(row.action_type).toBe('EXECUTE_TOOL');
    expect(row.capability_name).toBe(TOOL);
    expect(row.capability_version).toBe(fx.capabilities.get(TOOL).version);
    expect(row.execution_surface).toBe('PROPOSAL');
    expect(row.action_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row.action_envelope.material).toEqual({
      title: 'From a plan',
      description: null,
      contactId: null,
      priority: 'HIGH',
      source: 'MANUAL',
    });
    expect(row.requires_approval).toBe(true);
    expect(row.requested_by).toBeNull();
  });

  it('it is governed as helpdesk_create_ticket, never as key_autonomy.EXECUTE_TOOL', async () => {
    const proposal = await fx.proposals.create(ID.bizA, wrapper());
    await fx.proposals.approve(ID.bizA, proposal.id, ID.admin);
    const executed = await fx.proposals.execute(ID.bizA, proposal.id, ID.admin, true, true);

    const askedAbout = fx.autonomyOrchestrator.evaluateAction.mock.calls.map((c: any[]) => c[1]);
    expect(askedAbout).toEqual([TOOL]);
    expect(askedAbout).not.toContain('key_autonomy.EXECUTE_TOOL');

    expect(executed.status).toBe('EXECUTED');
    expect(executed.capabilityName).toBe(TOOL);
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });

  it('a block on helpdesk_create_ticket stops the wrapper proposal that was already approved', async () => {
    const proposal = await fx.proposals.create(ID.bizA, wrapper());
    await fx.proposals.approve(ID.bizA, proposal.id, ID.admin);
    // The business blocks the real tool. Under the wrapper identity this entry
    // never matched, because the name evaluated was key_autonomy.EXECUTE_TOOL.
    await fx.setAutonomy(2, { blockedTools: [TOOL] });

    await expect(fx.proposals.execute(ID.bizA, proposal.id, ID.admin, true, true)).rejects.toThrow(/blocked by business settings/);
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    expect((await fx.action(proposal.id)).status).toBe('BLOCKED');
  });

  it('an approval with nobody to name is refused', async () => {
    const proposal = await fx.proposals.create(ID.bizA, wrapper());
    await expect(fx.proposals.approve(ID.bizA, proposal.id, undefined)).rejects.toThrow(/authenticated approver/);
    expect((await fx.action(proposal.id)).status).toBe('PENDING');
  });

  it('a proposal for any other tool is not touched by the boundary', async () => {
    const proposal = await fx.proposals.create(ID.bizA, {
      sourceType: 'AI_PLAN',
      title: 'Other tool',
      actionType: 'EXECUTE_TOOL',
      payload: { toolName: 'crm_add_note', inputPayload: { note: 'x' } },
    });
    const row = await fx.action(proposal.id);
    expect(row.capability_name).toBeNull();
    expect(row.action_fingerprint).toBeNull();
    expect(fx.boundary.governs(proposal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('P2 — mutated parameters invalidate prior control evidence', () => {
  const FULL = { title: 'Original', description: 'As approved', contactId: undefined as string | undefined, priority: 'LOW', source: 'EMAIL' };

  // One case per material field. The evidence was given for the original
  // envelope; the record is then changed to different parameters and
  // re-fingerprinted, as a second request under the same id would be.
  it.each([
    ['title', 'Changed title'],
    ['description', 'Changed description'],
    ['contactId', '__CONTACT__'],
    ['priority', 'URGENT'],
    ['source', 'WHATSAPP'],
  ])('evidence for the original %s does not clear a changed one', async (field, changed) => {
    const actionId = await prepareForStaff({ ...FULL });
    await fx.boundary.recordEvidence(ID.bizA, actionId, ID.staff);

    const { buildHelpdeskCreateTicketEnvelope, fingerprintEnvelope } = await import(
      '../src/modules/key-autonomy/action-boundary/action-envelope'
    );
    const value = changed === '__CONTACT__' ? ID.contactA : changed;
    const mutated = buildHelpdeskCreateTicketEnvelope({ businessId: ID.bizA, capabilityVersion: 1, rawArgs: { ...FULL, [field]: value } });
    const before = await fx.action(actionId);
    expect(fingerprintEnvelope(mutated)).not.toBe(before.action_fingerprint);
    await fx.db.keyActionProposal.update({
      where: { id: actionId },
      data: { actionEnvelope: mutated, actionFingerprint: fingerprintEnvelope(mutated) },
    });

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.staff }), 'EVIDENCE_FINGERPRINT_MISMATCH');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('an envelope changed under an unchanged fingerprint is refused outright', async () => {
    const actionId = await prepareForStaff({ title: 'Original' });
    await fx.boundary.recordEvidence(ID.bizA, actionId, ID.staff);
    await fx.db.$executeRawUnsafe(
      `UPDATE key_action_proposals SET action_envelope = jsonb_set(action_envelope, '{material,title}', '"Swapped"') WHERE id = '${actionId}'`,
    );

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.staff }), 'ENVELOPE_MUTATED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    expect((await fx.action(actionId)).status).toBe('BLOCKED');
  });

  it('arguments presented with an action id must be the ones recorded for it', async () => {
    const actionId = await prepareForStaff({ title: 'Original' });
    await fx.boundary.recordEvidence(ID.bizA, actionId, ID.staff);

    await expectRefused(
      fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'Something else' }, chat(ID.staff, { actionId })),
      'ACTION_ARGUMENTS_MISMATCH',
    );
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    // The action it named is untouched and still executes as recorded.
    const ticket = await fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'Original' }, chat(ID.staff, { actionId }));
    expect(ticket.title).toBe('Original');
  });
});

// ---------------------------------------------------------------------------
describe('control evidence is server-issued and bound to the action and the principal', () => {
  it('the requester confirms their own action, and it executes', async () => {
    const actionId = await prepareForStaff();
    const before = Date.now();
    const outcome = await fx.boundary.confirmAndExecute(ID.bizA, actionId, ID.staff);

    const row = await fx.action(actionId);
    expect(row.control_evidence).toMatchObject({
      v: 1,
      kind: 'CONFIRMATION',
      fingerprint: row.action_fingerprint,
      principalUserId: ID.staff,
      assumptions: { basis: 'membership', membershipId: ID.mStaff, approvalTier: 0 },
    });
    const ttl = new Date(row.evidence_expires_at).getTime() - before;
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThan(16 * 60 * 1000);
    expect(outcome.replayed).toBe(false);
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });

  it('another staff member cannot confirm it for them', async () => {
    const actionId = await prepareForStaff();
    await expect(fx.boundary.recordEvidence(ID.bizA, actionId, ID.staff2)).rejects.toThrow(/Only the requester/);
    await expect(fx.boundary.recordEvidence(ID.bizA, actionId, ID.stranger)).rejects.toThrow(/no authority/);
    expect((await fx.action(actionId)).control_evidence).toBeNull();
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('an approver at the capability tier may clear it instead', async () => {
    const actionId = await prepareForStaff();
    await fx.boundary.recordEvidence(ID.bizA, actionId, ID.admin);
    expect((await fx.action(actionId)).control_evidence.kind).toBe('APPROVAL');
    await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin });
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });

  it('expired evidence clears nothing, and the action goes back to waiting', async () => {
    const actionId = await prepareForStaff();
    await fx.boundary.recordEvidence(ID.bizA, actionId, ID.staff);
    const past = new Date(Date.now() - 1000).toISOString();
    await fx.db.$executeRawUnsafe(
      `UPDATE key_action_proposals SET control_evidence = jsonb_set(control_evidence, '{expiresAt}', '"${past}"') WHERE id = '${actionId}'`,
    );

    const err = await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.staff }), 'EVIDENCE_EXPIRED');
    expect(err.disposition).toBe('AWAITING_CONFIRMATION');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    expect((await fx.action(actionId)).status).toBe('PENDING');

    // Confirmed again, it executes.
    await fx.boundary.confirmAndExecute(ID.bizA, actionId, ID.staff);
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });

  it('an approval status with no evidence behind it is not clearance', async () => {
    const actionId = await prepareForStaff();
    // What the old approve() wrote: a status and a name, bound to nothing.
    await fx.db.keyActionProposal.update({
      where: { id: actionId },
      data: { status: 'APPROVED', approvedBy: ID.admin, approvedAt: new Date() },
    });

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }), 'CONTROL_EVIDENCE_REQUIRED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it.each([
    ['a bare boolean', true],
    ['an approval flag', { approved: true, by: 'admin' }],
    ['evidence with no principal', { v: 1, kind: 'APPROVAL', fingerprint: 'x', principalUserId: '', issuedAt: 'a', expiresAt: 'b', assumptions: { basis: 'membership', approvalTier: 4 } }],
  ])('%s in the evidence column is not evidence', async (_label, stored) => {
    const actionId = await prepareForStaff();
    await fx.db.keyActionProposal.update({ where: { id: actionId }, data: { status: 'APPROVED', controlEvidence: stored as any } });
    await expectRefused(fx.boundary.admit(ID.bizA, actionId), 'CONTROL_EVIDENCE_REQUIRED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('P4 — revocation or demotion before claim admission yields zero tickets', () => {
  it('the approver’s Membership is hard-deleted after they approved', async () => {
    const actionId = await proposeAndApprove();
    await fx.db.$executeRawUnsafe(`DELETE FROM memberships WHERE id = '${ID.mAdmin}'`);

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }), 'EVIDENCE_PRINCIPAL_REVOKED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('the approver is demoted from ADMIN to STAFF after they approved', async () => {
    const actionId = await proposeAndApprove();
    await fx.db.membership.update({ where: { id: ID.mAdmin }, data: { role: 'STAFF' } });

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }), 'EVIDENCE_AUTHORITY_CHANGED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    // They can no longer approve it at all; someone at the tier still can.
    await expect(fx.boundary.recordEvidence(ID.bizA, actionId, ID.admin)).rejects.toThrow(/approval tier 2 or higher/);
    await fx.boundary.recordEvidence(ID.bizA, actionId, ID.owner);
    await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.owner });
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });

  it('the approver’s tier is lowered below the capability tier after they approved', async () => {
    const actionId = await proposeAndApprove();
    await fx.db.membership.update({ where: { id: ID.mAdmin }, data: { maxApprovalTier: 1 } });

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }), 'EVIDENCE_AUTHORITY_CHANGED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('the requester’s Membership is deleted after they confirmed', async () => {
    const actionId = await prepareForStaff();
    await fx.boundary.recordEvidence(ID.bizA, actionId, ID.staff);
    await fx.db.$executeRawUnsafe(`DELETE FROM memberships WHERE id = '${ID.mStaff}'`);

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.staff }), 'PRINCIPAL_NOT_AUTHORIZED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('the requester is banned after KEY autonomy would have cleared their action', async () => {
    await fx.setAutonomy(4);
    const prepared = await fx.boundary.prepare(ID.bizA, TOOL, { title: 'Auto' }, chat(ID.staff));
    expect(prepared.disposition).toBe('CLEARABLE');
    await fx.db.user.update({ where: { id: ID.staff }, data: { bannedAt: new Date() } });

    await expectRefused(fx.boundary.admit(ID.bizA, prepared.actionId), 'PRINCIPAL_NOT_AUTHORIZED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  describe('the owner with no Membership row', () => {
    it('may request and confirm, as BusinessGuard lets them act', async () => {
      const prepared = await fx.boundary.prepare(ID.bizBare, TOOL, { title: 'Owner ticket' }, chat(ID.bareOwner));
      expect(prepared.requirement).toMatchObject({ kind: 'PRINCIPAL_CONFIRMATION', principalUserId: ID.bareOwner });
      await fx.boundary.confirmAndExecute(ID.bizBare, prepared.actionId, ID.bareOwner);

      const row = await fx.action(prepared.actionId);
      expect(row.control_evidence.assumptions).toEqual({ basis: 'owner_without_membership', membershipId: null, approvalTier: 0 });
      expect(await fx.tickets(ID.bizBare)).toHaveLength(1);
    });

    it('cannot approve a proposal nobody requested: approval needs a Membership tier', async () => {
      const prepared = await fx.boundary.prepare(ID.bizBare, TOOL, { title: 'From the queue' }, { surface: 'PLAN_QUEUE' });
      await expect(fx.boundary.recordEvidence(ID.bizBare, prepared.actionId, ID.bareOwner)).rejects.toThrow(/approval tier 2 or higher/);
      expect(await fx.tickets(ID.bizBare)).toHaveLength(0);
    });

    it('ownership transferred after they confirmed yields zero tickets', async () => {
      const prepared = await fx.boundary.prepare(ID.bizBare, TOOL, { title: 'Owner ticket' }, chat(ID.bareOwner));
      await fx.boundary.recordEvidence(ID.bizBare, prepared.actionId, ID.bareOwner);
      await fx.db.$executeRawUnsafe(`UPDATE businesses SET owner_id = '${ID.owner}' WHERE id = '${ID.bizBare}'`);

      await expectRefused(fx.boundary.admit(ID.bizBare, prepared.actionId, { executedBy: ID.bareOwner }), 'PRINCIPAL_NOT_AUTHORIZED');
      expect(await fx.tickets(ID.bizBare)).toHaveLength(0);
    });
  });

  it('SUPER_ADMIN may approve without a Membership, and loses that with the role', async () => {
    const prepared = await fx.boundary.prepare(ID.bizA, TOOL, { title: 'Escalated' }, { surface: 'CORTEX_BRIDGE' });
    await fx.boundary.recordEvidence(ID.bizA, prepared.actionId, ID.superAdmin);
    await fx.db.user.update({ where: { id: ID.superAdmin }, data: { role: 'USER' } });

    await expectRefused(fx.boundary.admit(ID.bizA, prepared.actionId), 'EVIDENCE_PRINCIPAL_REVOKED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    await fx.db.user.update({ where: { id: ID.superAdmin }, data: { role: 'SUPER_ADMIN' } });
  });

  // Two connections. These are the cases a single-connection test cannot make.
  it('a revocation still in flight makes admission wait, and is observed once it commits', async () => {
    const actionId = await proposeAndApprove();
    const started = deferred();
    const release = deferred();

    // Connection 1: delete the approver's Membership and hold the transaction open.
    const revocation = fx.db.$transaction(
      async (tx: any) => {
        await tx.$executeRawUnsafe(`DELETE FROM memberships WHERE id = '${ID.mAdmin}'`);
        started.resolve();
        await release.promise;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    await started.promise;

    // Connection 2: admission. It must not decide on the row it can still see.
    let settled = false;
    const admission = settle(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin })).finally(() => {
      settled = true;
    });
    await sleep(750);
    expect(settled, 'admission decided while a revocation was uncommitted').toBe(false);
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);

    release.resolve();
    await revocation;
    const result = await admission;
    expect(result.err).toBeInstanceOf(fx.errors.ActionNotClearedError);
    expect(result.err.code).toBe('EVIDENCE_PRINCIPAL_REVOKED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  }, 60_000);

  it('a revocation that starts during admission waits for the claim to commit', async () => {
    const actionId = await proposeAndApprove();
    const insideClaim = deferred();
    const release = deferred();

    // Hold the claim transaction open after it has locked and re-read authority.
    const real = fx.helpdesk;
    const HelpdeskService = fx.tokens.HelpdeskService;
    class PausingHelpdesk extends HelpdeskService {
      async createTicketRow(client: any, businessId: string, body: any) {
        insideClaim.resolve();
        await release.promise;
        return real.createTicketRow(client, businessId, body);
      }
    }
    fx.provide(HelpdeskService, Object.assign(Object.create(PausingHelpdesk.prototype), real));

    const admission = settle(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }));
    await insideClaim.promise;

    let revoked = false;
    const revocation = fx.db.$executeRawUnsafe(`DELETE FROM memberships WHERE id = '${ID.mAdmin}'`).then(() => {
      revoked = true;
    });
    await sleep(750);
    expect(revoked, 'a Membership was deleted under an admission that had read it').toBe(false);

    release.resolve();
    const result = await admission;
    await revocation;
    expect(result.err).toBeUndefined();
    expect(revoked).toBe(true);
    // Admission came first, so the ticket exists; the revocation applies after it.
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('P5 — tightened policy or reduced autonomy forces reevaluation or rejection', () => {
  it('autonomy that would have cleared the action is reduced before admission', async () => {
    await fx.setAutonomy(4);
    const prepared = await fx.boundary.prepare(ID.bizA, TOOL, { title: 'Auto' }, chat(ID.staff));
    expect(prepared.requirement.kind).toBe('NONE');
    expect(prepared.disposition).toBe('CLEARABLE');

    await fx.setAutonomy(1);
    const err = await expectRefused(fx.boundary.admit(ID.bizA, prepared.actionId), 'CONTROL_EVIDENCE_REQUIRED');
    expect(err.disposition).toBe('AWAITING_CONFIRMATION');
    expect(err.requirement.kind).toBe('PRINCIPAL_CONFIRMATION');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);

    // Reevaluated, not dead: the requester confirms and it runs.
    await fx.boundary.confirmAndExecute(ID.bizA, prepared.actionId, ID.staff);
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });

  it('the tool is blocked after the requester confirmed', async () => {
    const actionId = await prepareForStaff();
    await fx.boundary.recordEvidence(ID.bizA, actionId, ID.staff);
    await fx.setAutonomy(2, { blockedTools: [TOOL] });

    const err = await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.staff }), 'BLOCKED_BY_POLICY');
    expect(err.disposition).toBe('DENIED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    expect((await fx.action(actionId)).status).toBe('BLOCKED');
  });

  it('the business is put in advisory mode after an approval', async () => {
    const actionId = await proposeAndApprove();
    await fx.setAutonomy(0);

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }), 'BLOCKED_BY_POLICY');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('autonomy raised after the fact does not need the evidence it no longer requires', async () => {
    const actionId = await prepareForStaff();
    await fx.setAutonomy(4);
    await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.staff });
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    expect((await fx.action(actionId)).outcome_evidence.clearance).toBe('NO_CONTROL_REQUIRED');
  });

  it('a policy store that cannot be read is a refusal, not a default', async () => {
    const actionId = await prepareForStaff();
    await fx.boundary.recordEvidence(ID.bizA, actionId, ID.staff);
    const real = fx.oversight;
    const AiOversightService = fx.tokens.AiOversightService;
    // The real service, reading through a client whose two stores both throw.
    const failing = Object.assign(Object.create(AiOversightService.prototype), real, {
      getAutonomySettings: (businessId: string) =>
        AiOversightService.prototype.getAutonomySettings.call(real, businessId, {
          autopilotSettings: { findUnique: async () => { throw new Error('connection reset'); } },
          aiMemory: { findUnique: async () => { throw new Error('connection reset'); } },
        }),
    });
    fx.provide(AiOversightService, failing);
    try {
      await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.staff }), 'BLOCKED_BY_POLICY');
    } finally {
      fx.provide(AiOversightService, real);
    }
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('P6 — concurrent N-way execution gives exactly one claim and one ticket', () => {
  const N = 12;

  it(`${N} concurrent admissions of one cleared action`, async () => {
    const actionId = await proposeAndApprove();

    const results = await Promise.all(
      Array.from({ length: N }, () => settle(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }))),
    );

    const tickets = await fx.tickets(ID.bizA);
    const claims = await fx.claims(ID.bizA);
    expect(tickets).toHaveLength(1);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ status: 'completed', idempotency_key: `key-action-claim:${actionId}` });

    // Every caller is told about the same ticket; exactly one of them made it.
    expect(results.filter((r) => r.err)).toEqual([]);
    expect(new Set(results.map((r) => r.ok!.ticket.id))).toEqual(new Set([tickets[0].id]));
    expect(results.filter((r) => r.ok!.replayed === false)).toHaveLength(1);
  }, 60_000);

  it(`${N} concurrent confirm-and-execute calls for one action`, async () => {
    const actionId = await prepareForStaff();

    const results = await Promise.all(
      Array.from({ length: N }, () => settle(fx.boundary.confirmAndExecute(ID.bizA, actionId, ID.staff))),
    );

    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    expect(await fx.claims(ID.bizA)).toHaveLength(1);
    // A loser may find the action already executed when it tries to confirm;
    // none of them may have created anything.
    expect(results.filter((r) => r.ok && !r.ok.replayed)).toHaveLength(1);
  }, 60_000);

  it('a sequential retry returns the recorded ticket and creates nothing', async () => {
    const actionId = await proposeAndApprove();
    const first = await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin });
    const second = await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin });

    expect(first.replayed).toBe(false);
    expect(second).toEqual({ actionId, ticket: first.ticket, replayed: true });
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });

  it('two distinct actions with identical parameters are two claims and two tickets', async () => {
    const a = await fx.boundary.prepare(ID.bizA, TOOL, { title: 'Same' }, chat(ID.staff, { sourceId: 'call_1' }));
    const b = await fx.boundary.prepare(ID.bizA, TOOL, { title: 'Same' }, chat(ID.staff, { sourceId: 'call_2' }));
    expect(a.actionId).not.toBe(b.actionId);
    expect(a.fingerprint).toBe(b.fingerprint);
    await fx.boundary.confirmAndExecute(ID.bizA, a.actionId, ID.staff);
    await fx.boundary.confirmAndExecute(ID.bizA, b.actionId, ID.staff);
    expect(await fx.tickets(ID.bizA)).toHaveLength(2);
    expect(await fx.claims(ID.bizA)).toHaveLength(2);
  });

  it('a rejection and an execution race for the same claim: exactly one is recorded', async () => {
    const actionId = await proposeAndApprove();
    const [executed, rejected] = await Promise.all([
      settle(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin })),
      settle(fx.boundary.voidAction(ID.bizA, actionId, 'REJECTED', ID.owner, 'not needed')),
    ]);

    const row = await fx.action(actionId);
    const tickets = await fx.tickets(ID.bizA);
    expect(await fx.claims(ID.bizA)).toHaveLength(1);
    if (row.status === 'EXECUTED') {
      expect(tickets).toHaveLength(1);
      expect(rejected.err).toBeDefined();
    } else {
      expect(row.status).toBe('REJECTED');
      expect(tickets).toHaveLength(0);
      expect(executed.err).toBeDefined();
    }
  });

  it('a rejected action can never execute afterwards', async () => {
    const actionId = await proposeAndApprove();
    await fx.proposals.reject(ID.bizA, (await fx.boundary.prepare(ID.bizA, TOOL, { title: 'Other' }, { surface: 'PLAN_QUEUE' })).actionId, ID.admin, 'no');
    await fx.boundary.voidAction(ID.bizA, actionId, 'REJECTED', ID.owner, 'no');

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }), 'ACTION_ALREADY_RESOLVED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    expect((await fx.action(actionId)).status).toBe('REJECTED');
  });
});

// ---------------------------------------------------------------------------
describe('P8 — successful outcome evidence names the actual SupportTicket', () => {
  it('the ticket, the action record and the claim agree, and the ticket is the envelope', async () => {
    const args = { title: '  Invoice is wrong  ', description: 'Line 3', contactId: ID.contactA, priority: 'HIGH', source: 'EMAIL', status: 'CLOSED' };
    const actionId = await proposeAndApprove(args);
    const outcome = await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin });

    const [ticket] = await fx.tickets(ID.bizA);
    expect(ticket).toMatchObject({
      id: outcome.ticket.id,
      business_id: ID.bizA,
      title: 'Invoice is wrong',
      description: 'Line 3',
      contact_id: ID.contactA,
      priority: 'HIGH',
      // Declared by the registry and dropped by the old handler: now written.
      source: 'EMAIL',
      // Not material, so not carried: the client could not close its own ticket.
      status: 'OPEN',
    });

    const row = await fx.action(actionId);
    expect(row.status).toBe('EXECUTED');
    expect(row.execution_result).toEqual({ id: ticket.id, title: 'Invoice is wrong', status: 'OPEN' });
    expect(row.outcome_evidence).toMatchObject({
      v: 1,
      status: 'SUCCEEDED',
      capability: TOOL,
      fingerprint: row.action_fingerprint,
      claimKey: `key-action-claim:${actionId}`,
      clearance: 'APPROVED',
      entity: { type: 'supportTicket', id: ticket.id },
    });

    const [claim] = await fx.claims(ID.bizA);
    expect(claim).toMatchObject({
      status: 'completed',
      request_hash: row.action_fingerprint,
      response: { actionId, supportTicketId: ticket.id },
    });
  });

  it('supportTicket.created is emitted once, after the commit, for the committed ticket', async () => {
    const actionId = await proposeAndApprove({ title: 'Emit me', priority: 'URGENT' });
    const seenAtEmit: number[] = [];
    const count = async () => (await fx.tickets(ID.bizA)).length;
    // Recorded synchronously by the fixture; the ticket must already be visible
    // from another connection when the event fires.
    const outcome = await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin });
    seenAtEmit.push(await count());

    const created = fx.events.emitted.filter((e) => e.name === 'supportTicket.created');
    expect(created).toHaveLength(1);
    expect(created[0].payload).toMatchObject({ businessId: ID.bizA, priority: 'URGENT', ticket: { id: outcome.ticket.id } });
    expect(seenAtEmit).toEqual([1]);
  });

  it('a refused action emits nothing', async () => {
    const actionId = await prepareForStaff();
    await expectRefused(fx.boundary.admit(ID.bizA, actionId), 'CONTROL_EVIDENCE_REQUIRED');
    expect(fx.events.emitted.filter((e) => e.name === 'supportTicket.created')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('P10 — the principal chain is preserved', () => {
  it('approved proposal from a principalless surface', async () => {
    const actionId = await proposeAndApprove();
    await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.owner });

    const row = await fx.action(actionId);
    const chain = { requestedBy: null, proposedBy: 'key_ai', approvedBy: ID.admin, executedFor: ID.admin, executedBy: ID.owner };
    expect(row.outcome_evidence.principalChain).toEqual(chain);
    expect({
      requestedBy: row.requested_by,
      proposedBy: row.proposed_by,
      approvedBy: row.approved_by,
      executedFor: row.executed_for,
      executedBy: row.executed_by,
    }).toEqual(chain);
  });

  it('requester-confirmed action from chat', async () => {
    const actionId = await prepareForStaff();
    await fx.boundary.confirmAndExecute(ID.bizA, actionId, ID.staff);

    const row = await fx.action(actionId);
    expect(row.outcome_evidence.principalChain).toEqual({
      requestedBy: ID.staff,
      proposedBy: 'key_ai',
      approvedBy: ID.staff,
      executedFor: ID.staff,
      executedBy: ID.staff,
    });
    expect(row.user_id).toBe(ID.staff);
    expect(row.executed_for).toBe(ID.staff);
  });

  it('action cleared by KEY autonomy for a trusted requester: nobody approved it, and it says so', async () => {
    await fx.setAutonomy(4);
    const ticket = await fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'Auto' }, chat(ID.staff));
    const [row] = await fx.actions(ID.bizA);

    expect(row.execution_result.id).toBe(ticket.id);
    expect(row.outcome_evidence.clearance).toBe('NO_CONTROL_REQUIRED');
    expect(row.outcome_evidence.principalChain).toEqual({
      requestedBy: ID.staff,
      proposedBy: 'key_ai',
      approvedBy: null,
      executedFor: ID.staff,
      executedBy: ID.staff,
    });
    expect(row.approved_by).toBeNull();
  });

  it('on the graph route the caller proposed the action themselves', async () => {
    const prepared = await fx.boundary.prepare(ID.bizA, TOOL, { title: 'Mine' }, { surface: 'GRAPH_ACTION', principalUserId: ID.staff });
    expect((await fx.action(prepared.actionId)).proposed_by).toBe(ID.staff);
  });
});

// ---------------------------------------------------------------------------
describe('P9 — failure is explicit; a rollback before commit is retryable and never duplicates', () => {
  it('a crash after the ticket insert and before the commit leaves nothing, and the retry makes one ticket', async () => {
    const actionId = await proposeAndApprove();
    const real = fx.helpdesk;
    const HelpdeskService = fx.tokens.HelpdeskService;
    let crashes = 1;
    class CrashingHelpdesk extends HelpdeskService {
      async createTicketRow(client: any, businessId: string, body: any) {
        const ticket = await real.createTicketRow(client, businessId, body);
        if (crashes-- > 0) throw Object.assign(new Error('process killed before commit'), { name: 'SimulatedCrash' });
        return ticket;
      }
    }
    fx.provide(HelpdeskService, Object.assign(Object.create(CrashingHelpdesk.prototype), real));

    const first = await settle(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }));
    // A crash is not a verdict on the action: it surfaces as itself, and
    // nothing is recorded about the action at all.
    expect(first.err?.message).toBe('process killed before commit');
    expect(first.err).not.toBeInstanceOf(fx.errors.ActionNotClearedError);
    expect((await fx.action(actionId)).status).toBe('APPROVED');

    // The insert happened inside the transaction and went with it.
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    expect(await fx.claims(ID.bizA)).toHaveLength(0);
    expect(fx.events.emitted.filter((e) => e.name === 'supportTicket.created')).toEqual([]);

    const retry = await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin });
    expect(retry.replayed).toBe(false);
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    expect(await fx.claims(ID.bizA)).toHaveLength(1);
  });

  it('a write the database rejects is a FAILED outcome, and the claim does not survive it', async () => {
    const doomed = `${fx.P}contact_doomed`;
    await fx.db.contact.create({ data: { id: doomed, businessId: ID.bizA, firstName: 'Gone' } });
    const actionId = await proposeAndApprove({ title: 'Contact vanishes', contactId: doomed });

    // The contact is hard-deleted from another connection after the boundary
    // has checked it and before the insert: a real foreign-key violation.
    const real = fx.helpdesk;
    const HelpdeskService = fx.tokens.HelpdeskService;
    class RacingHelpdesk extends HelpdeskService {
      async createTicketRow(client: any, businessId: string, body: any) {
        await fx.db.$executeRawUnsafe(`DELETE FROM contacts WHERE id = '${doomed}'`);
        return real.createTicketRow(client, businessId, body);
      }
    }
    fx.provide(HelpdeskService, Object.assign(Object.create(RacingHelpdesk.prototype), real));

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }), 'EXECUTION_FAILED');
    const row = await fx.action(actionId);
    expect(row.status).toBe('FAILED');
    expect(row.outcome_evidence).toMatchObject({ status: 'FAILED', entity: null });
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    expect(await fx.claims(ID.bizA)).toHaveLength(0);
  });

  it('a connection lost mid-transaction is not recorded as an outcome: the action stays executable', async () => {
    const actionId = await proposeAndApprove();
    const real = fx.oversight;
    const AiOversightService = fx.tokens.AiOversightService;
    let failures = 1;
    const flaky = Object.assign(Object.create(AiOversightService.prototype), real, {
      evaluate: (...args: any[]) => {
        if (failures-- > 0) throw new Error('server closed the connection unexpectedly');
        return AiOversightService.prototype.evaluate.apply(real, args as any);
      },
    });
    fx.provide(AiOversightService, flaky);
    try {
      const first = await settle(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }));
      expect(first.err?.message).toMatch(/closed the connection/);
      expect(first.err).not.toBeInstanceOf(fx.errors.ActionNotClearedError);
      expect((await fx.action(actionId)).status).toBe('APPROVED');
      expect(await fx.claims(ID.bizA)).toHaveLength(0);

      const retry = await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin });
      expect(retry.replayed).toBe(false);
    } finally {
      fx.provide(AiOversightService, real);
    }
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });

  it('a domain failure is recorded as FAILED, with the reason, and is not retried into a ticket', async () => {
    // A contact that exists, in another business.
    const actionId = await proposeAndApprove({ title: 'Wrong tenant contact', contactId: ID.contactB });

    const err = await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }), 'EXECUTION_FAILED');
    expect(err.message).toMatch(/does not exist in this business/);

    const row = await fx.action(actionId);
    expect(row.status).toBe('FAILED');
    expect(row.failure_reason).toMatch(/does not exist in this business/);
    expect(row.outcome_evidence).toMatchObject({ status: 'FAILED', entity: null });
    expect(await fx.tickets()).toHaveLength(0);
    expect(await fx.claims(ID.bizA)).toHaveLength(0);

    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin }), 'ACTION_NOT_EXECUTABLE');
    expect(await fx.tickets()).toHaveLength(0);
  });

  it('an action record is only ever PENDING, APPROVED or terminal: there is no executing state to be stranded in', async () => {
    const actionId = await proposeAndApprove();
    await fx.boundary.admit(ID.bizA, actionId, { executedBy: ID.admin });
    await prepareForStaff({ title: 'Still waiting' });
    const statuses = new Set((await fx.actions(ID.bizA)).map((a: any) => a.status));
    expect([...statuses].sort()).toEqual(['EXECUTED', 'PENDING']);
    expect(statuses.has('EXECUTING')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Q1/Q4 — surfaces with no trusted principal cannot execute', () => {
  const PRINCIPALLESS = ['INBOUND_CONVERSATION', 'PLAN_QUEUE', 'CORTEX_BRIDGE', 'CUSTOM_LOGIC', 'PRO_AUTO_MONITOR'] as const;

  it.each(PRINCIPALLESS)('%s files a human proposal and creates no ticket, at any autonomy level', async (surface) => {
    // The most permissive autonomy the business can set: tier 2 auto-executes.
    await fx.setAutonomy(4, { approvedTools: [TOOL] });

    const err = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'Take a message' }, { surface }), 'CONTROL_EVIDENCE_REQUIRED');
    expect(err.disposition).toBe('AWAITING_APPROVAL');
    expect(err.retryable).toBe(false);
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);

    const [row, ...rest] = await fx.actions(ID.bizA);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ id: err.actionId, status: 'PENDING', requested_by: null, execution_surface: surface, requires_approval: true });
    expect(row.control_requirement).toMatchObject({ kind: 'HUMAN_APPROVAL', minApprovalTier: 2 });
    expect(row.control_requirement.shadow).toMatchObject({ legacy: 'EXECUTE', boundary: 'QUEUE_APPROVAL', parity: 'BOUNDARY_STRICTER' });

    // A retrying surface does not fill the queue.
    await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'Take a message' }, { surface }), 'CONTROL_EVIDENCE_REQUIRED');
    expect(await fx.actions(ID.bizA)).toHaveLength(1);

    // A human below the tier cannot approve it; a human at the tier can.
    await expect(fx.boundary.recordEvidence(ID.bizA, row.id, ID.staff)).rejects.toThrow(/approval tier 2 or higher/);
    await fx.boundary.recordEvidence(ID.bizA, row.id, ID.admin);
    await fx.boundary.admit(ID.bizA, row.id, { executedBy: ID.admin });
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });

  it.each([
    ['PHONE_STREAM', { surface: 'PHONE_STREAM' }],
    ['a caller that declares no surface', undefined],
    ['a caller with a made-up surface', { surface: 'TRUST_ME' }],
    ['PHONE_STREAM claiming a principal', { surface: 'PHONE_STREAM', principalUserId: '__OWNER__' }],
  ])('%s is refused and writes nothing, not even a proposal', async (_label, ctx: any) => {
    await fx.setAutonomy(4, { approvedTools: [TOOL] });
    const context = ctx?.principalUserId === '__OWNER__' ? { ...ctx, principalUserId: ID.owner } : ctx;

    const err = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'From a phone call' }, context), 'UNTRUSTED_TENANT_BINDING');
    expect(err.disposition).toBe('DENIED');
    expect(err.actionId).toBeNull();
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    expect(await fx.actions(ID.bizA)).toHaveLength(0);
    expect(await fx.claims(ID.bizA)).toHaveLength(0);
  });

  it('a requester with no authority in the business is denied', async () => {
    await fx.setAutonomy(4);
    await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'x' }, chat(ID.stranger)), 'PRINCIPAL_NOT_AUTHORIZED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
    expect(await fx.actions(ID.bizA)).toHaveLength(0);
  });

  it('invalid arguments are refused before anything is recorded', async () => {
    await expect(fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'x', priority: 'ASAP' }, chat(ID.staff))).rejects.toThrow(/must be one of/);
    await expect(fx.boundary.executeFromTool(ID.bizA, TOOL, {}, chat(ID.staff))).rejects.toThrow(/Missing required fields/);
    expect(await fx.actions(ID.bizA)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('a plan step is one action, however often and from wherever the step is run', () => {
  const STEP = { title: 'Open a ticket for the plan' };
  const queue = (planStepId = 'step_1') => ({ surface: 'PLAN_QUEUE' as const, planId: 'plan_1', planStepId });

  it('the step run again after its proposal was approved executes the approved action', async () => {
    // The plan runner's resume: the queue files the action, a human approves
    // it, the step is set pending and the queue runs it again.
    const first = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue()), 'CONTROL_EVIDENCE_REQUIRED');
    await fx.proposals.approve(ID.bizA, first.actionId, ID.admin);

    const ticket = await fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue());

    expect(ticket.title).toBe(STEP.title);
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    // The same record throughout: no second proposal was filed for the step.
    const rows = await fx.actions(ID.bizA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.actionId, status: 'EXECUTED', plan_step_id: 'step_1' });
    expect(rows[0].outcome_evidence.principalChain).toMatchObject({ requestedBy: null, approvedBy: ID.admin, executedFor: ID.admin });
  });

  it('a step whose proposal the plan executor created is found by the queue run that follows its approval', async () => {
    // PlanExecutorService.createStepProposal: sealed on the PROPOSAL surface.
    const proposal = await fx.proposals.create(ID.bizA, {
      sourceType: 'AI_PLAN',
      sourceId: 'plan_1',
      planId: 'plan_1',
      planStepId: 'step_1',
      title: 'Plan step: open a ticket',
      actionType: 'EXECUTE_TOOL',
      payload: { toolName: TOOL, inputPayload: { ...STEP }, planContext: { planId: 'plan_1', planStepId: 'step_1' } },
    });
    await fx.proposals.approve(ID.bizA, proposal.id, ID.admin);

    await fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue());

    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    expect(await fx.actions(ID.bizA)).toHaveLength(1);
    expect((await fx.action(proposal.id)).status).toBe('EXECUTED');
  });

  it('the step run again after it executed is given the same ticket and creates nothing', async () => {
    const first = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue()), 'CONTROL_EVIDENCE_REQUIRED');
    await fx.boundary.recordEvidence(ID.bizA, first.actionId, ID.admin);
    const ticket = await fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue());

    const again = await Promise.all(Array.from({ length: 6 }, () => fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue())));

    expect(new Set(again.map((t: any) => t.id))).toEqual(new Set([ticket.id]));
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
    expect(await fx.claims(ID.bizA)).toHaveLength(1);
    expect(await fx.actions(ID.bizA)).toHaveLength(1);
  });

  it('before it is approved, running the step again clears nothing', async () => {
    const first = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue()), 'CONTROL_EVIDENCE_REQUIRED');
    const second = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue()), 'CONTROL_EVIDENCE_REQUIRED');
    expect(second.actionId).toBe(first.actionId);
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('an approval for one step does not clear another step, or the same step with other parameters', async () => {
    const first = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue('step_1')), 'CONTROL_EVIDENCE_REQUIRED');
    await fx.boundary.recordEvidence(ID.bizA, first.actionId, ID.admin);

    const otherStep = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue('step_2')), 'CONTROL_EVIDENCE_REQUIRED');
    const otherArgs = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'Something else' }, queue('step_1')), 'CONTROL_EVIDENCE_REQUIRED');

    expect(otherStep.actionId).not.toBe(first.actionId);
    expect(otherArgs.actionId).not.toBe(first.actionId);
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('an approval that has since been invalidated does not survive the re-run', async () => {
    const first = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue()), 'CONTROL_EVIDENCE_REQUIRED');
    await fx.boundary.recordEvidence(ID.bizA, first.actionId, ID.admin);
    await fx.db.$executeRawUnsafe(`DELETE FROM memberships WHERE id = '${ID.mAdmin}'`);

    await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue()), 'EVIDENCE_PRINCIPAL_REVOKED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('a rejected step action is not resumed: the step asks again', async () => {
    const first = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue()), 'CONTROL_EVIDENCE_REQUIRED');
    await fx.proposals.reject(ID.bizA, first.actionId, ID.admin, 'not now');

    const second = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { ...STEP }, queue()), 'CONTROL_EVIDENCE_REQUIRED');
    expect(second.actionId).not.toBe(first.actionId);
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });

  it('outside a plan step, an approved action is never picked up by a look-alike request', async () => {
    const actionId = await proposeAndApprove({ title: 'Approved once' });
    // Same surface, same parameters, no plan step: a different request.
    const other = await expectRefused(fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'Approved once' }, { surface: 'INBOUND_CONVERSATION' }), 'CONTROL_EVIDENCE_REQUIRED');
    expect(other.actionId).not.toBe(actionId);
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('the supplementary execution log is written once per execution', () => {
  const logged = () => fx.executionLog.logToolExecution.mock.calls;

  it('the confirm path writes it, because it no longer passes through executeTool', async () => {
    const actionId = await prepareForStaff({ title: 'Logged', priority: 'HIGH' });
    const outcome = await fx.boundary.confirmAndExecute(ID.bizA, actionId, ID.staff);

    expect(logged()).toHaveLength(1);
    const [businessId, toolName, args, result, success] = logged()[0];
    expect({ businessId, toolName, success }).toEqual({ businessId: ID.bizA, toolName: TOOL, success: true });
    expect(args).toMatchObject({ title: 'Logged', priority: 'HIGH' });
    expect(result).toEqual(outcome.ticket);
  });

  it('the proposal path writes it', async () => {
    const actionId = await proposeAndApprove();
    await fx.proposals.execute(ID.bizA, actionId, ID.admin, true, true);
    expect(logged()).toHaveLength(1);
  });

  it('the tool path does not, because executeTool writes that row itself', async () => {
    await fx.setAutonomy(4);
    await fx.boundary.executeFromTool(ID.bizA, TOOL, { title: 'Auto' }, chat(ID.staff));
    expect(logged()).toHaveLength(0);
  });

  it('a replay and a refusal write nothing', async () => {
    const actionId = await prepareForStaff();
    await expectRefused(fx.boundary.admit(ID.bizA, actionId, { log: true }), 'CONTROL_EVIDENCE_REQUIRED');
    await fx.boundary.confirmAndExecute(ID.bizA, actionId, ID.staff);
    fx.executionLog.logToolExecution.mockClear();

    const replay = await fx.boundary.admit(ID.bizA, actionId, { log: true });
    expect(replay.replayed).toBe(true);
    expect(logged()).toHaveLength(0);
  });

  it('a log that cannot be written does not undo or fail the execution', async () => {
    fx.executionLog.logToolExecution.mockRejectedValueOnce(new Error('log table is down'));
    const actionId = await prepareForStaff();
    const outcome = await fx.boundary.confirmAndExecute(ID.bizA, actionId, ID.staff);
    expect(outcome.replayed).toBe(false);
    expect(await fx.tickets(ID.bizA)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('tenant binding of an action', () => {
  it('an action of one business cannot be confirmed, executed or voided through another', async () => {
    const actionId = await prepareForStaff();

    await expect(fx.boundary.recordEvidence(ID.bizB, actionId, ID.stranger)).rejects.toThrow(/Action not found/);
    await expectRefused(fx.boundary.admit(ID.bizB, actionId, { executedBy: ID.stranger }), 'ACTION_NOT_FOUND');
    await expect(fx.boundary.voidAction(ID.bizB, actionId, 'CANCELLED', ID.stranger)).rejects.toThrow(/Action not found/);

    expect(await fx.tickets()).toHaveLength(0);
    expect(await fx.claims()).toHaveLength(0);
    expect((await fx.action(actionId)).status).toBe('PENDING');
  });

  it('"No, cancel" voids only the caller’s own action', async () => {
    const actionId = await prepareForStaff();
    await expect(
      fx.boundary.voidAction(ID.bizA, actionId, 'CANCELLED', ID.staff2, null, { onlyIfRequestedBy: ID.staff2 }),
    ).rejects.toThrow(/Action not found/);
    expect((await fx.action(actionId)).status).toBe('PENDING');

    await fx.boundary.voidAction(ID.bizA, actionId, 'CANCELLED', ID.staff, null, { onlyIfRequestedBy: ID.staff });
    expect((await fx.action(actionId)).status).toBe('CANCELLED');
    await expectRefused(fx.boundary.confirmAndExecute(ID.bizA, actionId, ID.staff).catch((e: any) => {
      // recordEvidence refuses a cancelled action before admission is reached.
      if (e?.status === 409) throw new fx.errors.ActionNotClearedError('ACTION_ALREADY_RESOLVED', e.message, actionId, 'DENIED');
      throw e;
    }), 'ACTION_ALREADY_RESOLVED');
    expect(await fx.tickets(ID.bizA)).toHaveLength(0);
  });
});
