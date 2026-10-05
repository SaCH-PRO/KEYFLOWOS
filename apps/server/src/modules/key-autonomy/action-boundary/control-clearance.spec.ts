import { describe, expect, it } from 'vitest';
import {
  EXECUTION_SURFACES,
  computeClearance,
  deriveControlRequirement,
  evidenceKindFor,
  isStricter,
  parseStoredEvidence,
  resolvePrincipalAuthority,
  tenantBindingOf,
  type ControlEvidence,
  type ControlRequirement,
  type KeyAutonomyVerdict,
  type PrincipalAuthority,
  type PrincipalRows,
} from './control-clearance';

const CAPABILITY = { name: 'helpdesk_create_ticket', riskTier: 2 };

const verdict = (over: Partial<KeyAutonomyVerdict> = {}): KeyAutonomyVerdict => ({
  allowed: true,
  requiresQuickConfirm: false,
  requiresFormalApproval: false,
  requiresAdminApproval: false,
  tier: 2,
  reason: 'verdict',
  ...over,
});
const AUTO = verdict({ reason: 'Tier 2 auto-approved' });
const QUICK = verdict({ requiresQuickConfirm: true, reason: 'Tier 2 action requires quick confirmation before execution' });
const FORMAL = verdict({ requiresFormalApproval: true, reason: 'requires explicit approval' });
const BLOCKED = verdict({ allowed: false, reason: 'Tool "helpdesk_create_ticket" is blocked by business settings' });

const principal = (over: Partial<PrincipalAuthority> = {}): PrincipalAuthority => ({
  userId: 'u_staff',
  basis: 'membership',
  membershipId: 'm_staff',
  membershipRole: 'STAFF',
  approvalTier: 0,
  ...over,
});
const STAFF = principal();
const ADMIN = principal({ userId: 'u_admin', membershipId: 'm_admin', membershipRole: 'ADMIN', approvalTier: 3 });
const NOBODY = principal({ userId: 'u_out', basis: 'none', membershipId: null, membershipRole: null });

const rows = (over: Partial<PrincipalRows> = {}): PrincipalRows => ({
  userId: 'u1',
  user: { role: 'USER', deletedAt: null, bannedAt: null },
  business: { ownerId: 'u_owner' },
  membership: null,
  ...over,
});

describe('resolvePrincipalAuthority', () => {
  it('a Membership gives the frozen AUTH-001 approval tier', () => {
    const staff = resolvePrincipalAuthority(rows({ membership: { id: 'm1', role: 'STAFF', maxApprovalTier: 0, permissionScopes: null } }));
    expect(staff).toMatchObject({ basis: 'membership', membershipId: 'm1', membershipRole: 'STAFF', approvalTier: 0 });

    const admin = resolvePrincipalAuthority(rows({ membership: { id: 'm2', role: 'ADMIN', maxApprovalTier: 0, permissionScopes: null } }));
    expect(admin.approvalTier).toBe(3);

    const capped = resolvePrincipalAuthority(rows({ membership: { id: 'm3', role: 'ADMIN', maxApprovalTier: 1, permissionScopes: { crm: 'write' } } }));
    expect(capped.approvalTier).toBe(1);
  });

  it('SUPER_ADMIN is the maximum tier, with or without a Membership', () => {
    const sa = resolvePrincipalAuthority(rows({ user: { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null } }));
    expect(sa).toMatchObject({ basis: 'super_admin', approvalTier: 4, membershipId: null });
  });

  it('the owner with no Membership row may act, and cannot approve', () => {
    const owner = resolvePrincipalAuthority(rows({ userId: 'u_owner' }));
    expect(owner).toMatchObject({ basis: 'owner_without_membership', approvalTier: 0, membershipId: null });
  });

  it.each([
    ['no such user', rows({ user: null })],
    ['a deleted user', rows({ user: { role: 'USER', deletedAt: new Date(), bannedAt: null }, membership: { id: 'm', role: 'OWNER', maxApprovalTier: 4, permissionScopes: null } })],
    ['a banned user', rows({ user: { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: new Date() } })],
    ['no such business', rows({ business: null, membership: { id: 'm', role: 'OWNER', maxApprovalTier: 4, permissionScopes: null } })],
    ['a stranger', rows()],
  ])('%s has no authority', (_label, input) => {
    expect(resolvePrincipalAuthority(input)).toMatchObject({ basis: 'none', approvalTier: 0 });
  });
});

describe('deriveControlRequirement', () => {
  const derive = (over: Partial<Parameters<typeof deriveControlRequirement>[0]> = {}) =>
    deriveControlRequirement({ capability: CAPABILITY, surface: 'CHAT', principal: STAFF, autonomy: QUICK, ...over });

  it('an unresolved capability is denied', () => {
    expect(derive({ capability: null })).toMatchObject({ kind: 'DENY', code: 'UNKNOWN_CAPABILITY' });
  });

  it('only the phone stream and an undeclared caller have an untrusted tenant binding', () => {
    const untrusted = EXECUTION_SURFACES.filter((s) => tenantBindingOf(s) === 'untrusted');
    expect([...untrusted].sort()).toEqual(['PHONE_STREAM', 'UNDECLARED']);
  });

  it.each(['PHONE_STREAM', 'UNDECLARED'] as const)(
    '%s is denied before policy or principal is considered, whatever they say',
    (surface) => {
      expect(derive({ surface, principal: ADMIN, autonomy: AUTO })).toMatchObject({ kind: 'DENY', code: 'UNTRUSTED_TENANT_BINDING' });
      expect(derive({ surface, principal: null, autonomy: BLOCKED })).toMatchObject({ kind: 'DENY', code: 'UNTRUSTED_TENANT_BINDING' });
    },
  );

  it('policy that blocks the capability denies it for everyone', () => {
    expect(derive({ autonomy: BLOCKED, principal: ADMIN })).toEqual({ kind: 'DENY', code: 'BLOCKED_BY_POLICY', reason: BLOCKED.reason });
    expect(derive({ autonomy: BLOCKED, principal: null, surface: 'PLAN_QUEUE' })).toMatchObject({ kind: 'DENY', code: 'BLOCKED_BY_POLICY' });
  });

  it.each(['INBOUND_CONVERSATION', 'PLAN_QUEUE', 'CORTEX_BRIDGE', 'CUSTOM_LOGIC', 'PRO_AUTO_MONITOR', 'PROPOSAL'] as const)(
    'with no trusted principal on %s, KEY autonomy cannot clear it: a human at the capability tier must',
    (surface) => {
      expect(derive({ surface, principal: null, autonomy: AUTO })).toMatchObject({ kind: 'HUMAN_APPROVAL', minApprovalTier: 2 });
      expect(derive({ surface, principal: null, autonomy: QUICK })).toMatchObject({ kind: 'HUMAN_APPROVAL', minApprovalTier: 2 });
    },
  );

  it('a requester with no authority in the business is denied', () => {
    expect(derive({ principal: NOBODY, autonomy: AUTO })).toMatchObject({ kind: 'DENY', code: 'PRINCIPAL_NOT_AUTHORIZED' });
  });

  it('for an eligible requester the requirement follows KEY autonomy', () => {
    expect(derive({ autonomy: AUTO })).toEqual({ kind: 'NONE', reason: AUTO.reason });
    expect(derive({ autonomy: QUICK })).toEqual({
      kind: 'PRINCIPAL_CONFIRMATION',
      principalUserId: 'u_staff',
      approvalTierFloor: 2,
      reason: QUICK.reason,
    });
    expect(derive({ autonomy: FORMAL })).toMatchObject({ kind: 'HUMAN_APPROVAL', minApprovalTier: 2 });
    expect(derive({ autonomy: verdict({ requiresAdminApproval: true, requiresFormalApproval: true }) })).toMatchObject({ kind: 'HUMAN_APPROVAL' });
  });

  it('the risk tier is an input, not the requirement: one tier, four requirements', () => {
    const kinds = new Set([
      derive({ autonomy: AUTO }).kind,
      derive({ autonomy: QUICK }).kind,
      derive({ autonomy: AUTO, principal: null, surface: 'PLAN_QUEUE' }).kind,
      derive({ autonomy: BLOCKED }).kind,
    ]);
    expect([...kinds].sort()).toEqual(['DENY', 'HUMAN_APPROVAL', 'NONE', 'PRINCIPAL_CONFIRMATION']);
  });

  it('orders requirements by strictness', () => {
    const none: ControlRequirement = { kind: 'NONE', reason: '' };
    const confirm: ControlRequirement = { kind: 'PRINCIPAL_CONFIRMATION', principalUserId: 'u', approvalTierFloor: 2, reason: '' };
    const approve: ControlRequirement = { kind: 'HUMAN_APPROVAL', minApprovalTier: 2, reason: '' };
    const deny: ControlRequirement = { kind: 'DENY', code: 'BLOCKED_BY_POLICY', reason: '' };
    expect(isStricter(confirm, none)).toBe(true);
    expect(isStricter(approve, confirm)).toBe(true);
    expect(isStricter(deny, approve)).toBe(true);
    expect(isStricter(none, confirm)).toBe(false);
    expect(isStricter(confirm, confirm)).toBe(false);
  });
});

describe('evidenceKindFor', () => {
  const CONFIRM: ControlRequirement = { kind: 'PRINCIPAL_CONFIRMATION', principalUserId: 'u_staff', approvalTierFloor: 2, reason: 'r' };
  const APPROVE: ControlRequirement = { kind: 'HUMAN_APPROVAL', minApprovalTier: 2, reason: 'r' };

  it('the requester confirms their own action; staff tier 0 is enough for that', () => {
    expect(evidenceKindFor(CONFIRM, STAFF)).toEqual({ kind: 'CONFIRMATION' });
  });

  it('someone else clears a confirmation only as an approver at the capability tier', () => {
    expect(evidenceKindFor(CONFIRM, ADMIN)).toEqual({ kind: 'APPROVAL' });
    expect(evidenceKindFor(CONFIRM, principal({ userId: 'u_other' }))).toHaveProperty('refused');
  });

  it('an approval needs the tier', () => {
    expect(evidenceKindFor(APPROVE, ADMIN)).toEqual({ kind: 'APPROVAL' });
    expect(evidenceKindFor(APPROVE, STAFF)).toHaveProperty('refused');
    expect(evidenceKindFor(APPROVE, principal({ approvalTier: 1 }))).toHaveProperty('refused');
    expect(evidenceKindFor(APPROVE, principal({ approvalTier: 2 }))).toEqual({ kind: 'APPROVAL' });
  });

  it('nobody can give evidence for a denied action, and a stranger can give none at all', () => {
    expect(evidenceKindFor({ kind: 'DENY', code: 'BLOCKED_BY_POLICY', reason: 'blocked' }, ADMIN)).toEqual({ refused: 'blocked' });
    expect(evidenceKindFor(APPROVE, { ...NOBODY, approvalTier: 4 })).toHaveProperty('refused');
  });

  it('when no control is required, evidence is still held to the rule that would apply', () => {
    const none: ControlRequirement = { kind: 'NONE', reason: 'auto' };
    expect(evidenceKindFor(none, STAFF)).toHaveProperty('refused');
    expect(evidenceKindFor(none, STAFF, { requesterUserId: 'u_staff', capabilityTier: 2 })).toEqual({ kind: 'CONFIRMATION' });
    expect(evidenceKindFor(none, ADMIN, { requesterUserId: 'u_staff', capabilityTier: 2 })).toEqual({ kind: 'APPROVAL' });
    expect(evidenceKindFor(none, STAFF, { requesterUserId: null, capabilityTier: 2 })).toHaveProperty('refused');
  });
});

describe('computeClearance', () => {
  const FP = 'f'.repeat(64);
  const NOW = new Date('2026-10-05T12:00:00.000Z');
  const CONFIRM: ControlRequirement = { kind: 'PRINCIPAL_CONFIRMATION', principalUserId: 'u_staff', approvalTierFloor: 2, reason: 'confirm it' };
  const APPROVE: ControlRequirement = { kind: 'HUMAN_APPROVAL', minApprovalTier: 2, reason: 'approve it' };

  const evidenceFrom = (giver: PrincipalAuthority, kind: ControlEvidence['kind'], over: Partial<ControlEvidence> = {}): ControlEvidence => ({
    v: 1,
    kind,
    fingerprint: FP,
    principalUserId: giver.userId,
    issuedAt: '2026-10-05T11:55:00.000Z',
    expiresAt: '2026-10-05T12:10:00.000Z',
    assumptions: { basis: giver.basis, membershipId: giver.membershipId, approvalTier: giver.approvalTier },
    ...over,
  });

  const clear = (over: Partial<Parameters<typeof computeClearance>[0]> = {}) =>
    computeClearance({
      requirement: CONFIRM,
      storedFingerprint: FP,
      recomputedFingerprint: FP,
      evidence: evidenceFrom(STAFF, 'CONFIRMATION'),
      evidencePrincipal: STAFF,
      now: NOW,
      ...over,
    });

  it('clears a confirmed action for its requester', () => {
    expect(clear()).toEqual({ cleared: true, basis: 'CONFIRMED', requirement: CONFIRM, approvedBy: 'u_staff' });
  });

  it('clears an approved action for an approver at the tier', () => {
    expect(clear({ requirement: APPROVE, evidence: evidenceFrom(ADMIN, 'APPROVAL'), evidencePrincipal: ADMIN })).toMatchObject({
      cleared: true,
      basis: 'APPROVED',
      approvedBy: 'u_admin',
    });
  });

  it('clears with no evidence when no control is required, and names no approver', () => {
    const none: ControlRequirement = { kind: 'NONE', reason: 'auto' };
    expect(clear({ requirement: none, evidence: null, evidencePrincipal: null })).toEqual({
      cleared: true,
      basis: 'NO_CONTROL_REQUIRED',
      requirement: none,
      approvedBy: null,
    });
  });

  it('a changed envelope is refused before anything else, even when no control is required', () => {
    const none: ControlRequirement = { kind: 'NONE', reason: 'auto' };
    expect(clear({ requirement: none, recomputedFingerprint: 'e'.repeat(64) })).toMatchObject({ cleared: false, code: 'ENVELOPE_MUTATED', reevaluate: false });
    expect(clear({ storedFingerprint: null })).toMatchObject({ cleared: false, code: 'ENVELOPE_MUTATED' });
  });

  it('a denial is a refusal that fresh evidence cannot change', () => {
    const deny: ControlRequirement = { kind: 'DENY', code: 'BLOCKED_BY_POLICY', reason: 'blocked now' };
    expect(clear({ requirement: deny })).toEqual({ cleared: false, code: 'BLOCKED_BY_POLICY', reason: 'blocked now', reevaluate: false, requirement: deny });
  });

  it('a required control with no evidence asks for it', () => {
    expect(clear({ evidence: null, evidencePrincipal: null })).toMatchObject({ cleared: false, code: 'CONTROL_EVIDENCE_REQUIRED', reevaluate: true });
  });

  it('evidence for other parameters does not clear these', () => {
    expect(clear({ evidence: evidenceFrom(STAFF, 'CONFIRMATION', { fingerprint: 'a'.repeat(64) }) })).toMatchObject({
      cleared: false,
      code: 'EVIDENCE_FINGERPRINT_MISMATCH',
    });
  });

  it.each([
    ['at its expiry instant', '2026-10-05T12:00:00.000Z'],
    ['after its expiry', '2026-10-05T11:59:59.000Z'],
    ['with an unreadable expiry', 'soon'],
  ])('evidence %s is expired', (_label, expiresAt) => {
    expect(clear({ evidence: evidenceFrom(STAFF, 'CONFIRMATION', { expiresAt }) })).toMatchObject({ cleared: false, code: 'EVIDENCE_EXPIRED' });
  });

  it('a revoked evidence-giver clears nothing', () => {
    expect(clear({ evidencePrincipal: null })).toMatchObject({ cleared: false, code: 'EVIDENCE_PRINCIPAL_REVOKED' });
    expect(clear({ evidencePrincipal: { ...STAFF, basis: 'none', membershipId: null } })).toMatchObject({ cleared: false, code: 'EVIDENCE_PRINCIPAL_REVOKED' });
    expect(clear({ evidencePrincipal: ADMIN })).toMatchObject({ cleared: false, code: 'EVIDENCE_PRINCIPAL_REVOKED' });
  });

  it('a demoted evidence-giver has to give the evidence again', () => {
    const demoted: PrincipalAuthority = { ...ADMIN, membershipRole: 'STAFF', approvalTier: 0 };
    expect(clear({ requirement: APPROVE, evidence: evidenceFrom(ADMIN, 'APPROVAL'), evidencePrincipal: demoted })).toMatchObject({
      cleared: false,
      code: 'EVIDENCE_AUTHORITY_CHANGED',
      reevaluate: true,
    });
  });

  it('a Membership removed and re-created is not the Membership the evidence was given under', () => {
    expect(clear({ evidencePrincipal: { ...STAFF, membershipId: 'm_new' } })).toMatchObject({ cleared: false, code: 'EVIDENCE_AUTHORITY_CHANGED' });
  });

  it('a promotion does not invalidate evidence', () => {
    expect(clear({ evidencePrincipal: { ...STAFF, approvalTier: 3 } })).toMatchObject({ cleared: true });
  });

  it('a confirmation cannot stand in for an approval the requirement now asks for', () => {
    expect(clear({ requirement: APPROVE })).toMatchObject({ cleared: false, code: 'EVIDENCE_INSUFFICIENT', reevaluate: true });
    const adminConfirmed = evidenceFrom({ ...ADMIN, userId: 'u_staff' }, 'CONFIRMATION');
    expect(clear({ requirement: APPROVE, evidence: adminConfirmed, evidencePrincipal: { ...ADMIN, userId: 'u_staff' } })).toMatchObject({
      cleared: false,
      code: 'EVIDENCE_INSUFFICIENT',
    });
  });

  it('an approval satisfies a confirmation requirement', () => {
    expect(clear({ evidence: evidenceFrom(ADMIN, 'APPROVAL'), evidencePrincipal: ADMIN })).toMatchObject({ cleared: true, basis: 'APPROVED', approvedBy: 'u_admin' });
  });
});

describe('parseStoredEvidence', () => {
  const good = {
    v: 1,
    kind: 'APPROVAL',
    fingerprint: 'f'.repeat(64),
    principalUserId: 'u',
    issuedAt: 'a',
    expiresAt: 'b',
    assumptions: { basis: 'membership', membershipId: 'm', approvalTier: 3 },
  };

  it('reads well-formed evidence', () => {
    expect(parseStoredEvidence(good)).toEqual(good);
  });

  it.each([
    ['null', null],
    ['a boolean', true],
    ['an approval flag', { approved: true }],
    ['another version', { ...good, v: 2 }],
    ['an unknown kind', { ...good, kind: 'OVERRIDE' }],
    ['no principal', { ...good, principalUserId: '' }],
    ['no assumptions', { ...good, assumptions: null }],
  ])('treats %s as no evidence', (_label, stored) => {
    expect(parseStoredEvidence(stored)).toBeNull();
  });
});
