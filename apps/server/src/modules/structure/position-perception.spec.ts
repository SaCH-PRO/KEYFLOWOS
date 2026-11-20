/**
 * W1F-PERCEPTION-MODULE-SCOPE review repair (SEC-W1FPMS-2, COR-W1FPMS-2; owner rulings D-202 `bridgememory`, D-73/D-93):
 * what a staff position's KEY turn perceives (JobRolePolicyService.perceptionForPosition, registered for the envelope
 * envelopeForPosition issues and read back by FlowOrchestratorService.buildPerceptionSection through perceptionOf).
 *
 * The bridge knows a sender only by the phone. OrgAssignment.contactPhone is set by whoever may change the position, and
 * is never bound to the holder's account phone, so the holder of a membership-backed position became the reader of
 * whoever texted from that phone: another member, or someone who is no member at all, read the holder's own KEY history
 * (D-130 cognition rows, CortexActionLog and AiExecutionLog). The holder is now the reader only when the phone is the
 * holder's own account phone and no other member's (phoneMembers is exactly the holder).
 *
 * The modules the turn sees follow the position as its tools do (envelopeForPosition): the JobRole map, read exactly as
 * ModuleScopeGuard reads a map, capped by the holder's membership and by each phone member's. A turn with no reader (a
 * contact-only position, or a phone not shown to be the holder's) is a memberless turn: it sees no contacts (D-73/D-93)
 * and no money (no member, no figure), and otherwise what its JobRole map grants (COR-W1FPMS-2: bookings, projects,
 * operations, which it lost entirely before).
 *
 * Real-DB proof through the signed Twilio webhook: test/perception-module-scope.integration.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { JobRolePolicyService, perceptionForPosition, type StaffPosition } from './job-role-policy.service';

const policy = new JobRolePolicyService();
const BIZ = 'biz_1';
const active = { deletedAt: null, bannedAt: null };
const member = (userId: string, permissionScopes: unknown, role = 'STAFF', extra: Record<string, unknown> = {}) => ({
  userId,
  businessId: BIZ,
  role,
  permissionScopes: permissionScopes as any,
  maxApprovalTier: 0,
  user: { ...active },
  ...extra,
});

/** The JobRole map of the positions below: canonical keys, read exactly. */
const ROLE_MAP = { crm: 'read', bookings: 'read', projects: 'read', operations: 'read', revenue: 'read', expenses: 'read', content: 'read' };
const jobRole = { id: 'jr_1', name: 'Crew', permissions: ROLE_MAP as any };

const S = member('u_s', null); // STAFF on role defaults: reads every module but settings, team, ai, connect
const P = member('u_p', { crm: 'read', bookings: 'read', revenue: 'none', expenses: 'none' });

function heldBy(holder: typeof S, phoneMembers: Array<typeof S>): StaffPosition {
  return { businessId: BIZ, jobRole, membershipId: `m_${holder.userId}`, userId: holder.userId, membership: holder, phoneMembers };
}
const contactOnly = (phoneMembers: Array<typeof S> = [], role: any = jobRole): StaffPosition => ({ businessId: BIZ, jobRole: role, phoneMembers });

const sorted = (xs: readonly string[]) => [...xs].sort();

describe('the reader of a position turn is its holder only on the holder\'s own phone (SEC-W1FPMS-2, D-202)', () => {
  it("the holder texting from their own account phone (the phone's only member) reads their own history", () => {
    expect(perceptionForPosition(heldBy(S, [S])).readerUserId).toBe('u_s');
  });

  it("another member texting from their own phone, filed on a position the holder holds, is nobody's reader", () => {
    // The review's repro: the owner files S's position on P's phone; P texts KEY.
    expect(perceptionForPosition(heldBy(S, [P])).readerUserId).toBeNull();
  });

  it("a position on a phone that is no member's account phone has no reader (whoever texts is not shown to be the holder)", () => {
    expect(perceptionForPosition(heldBy(S, [])).readerUserId).toBeNull();
  });

  it('a phone shared by the holder and another member has no reader', () => {
    expect(perceptionForPosition(heldBy(S, [S, P])).readerUserId).toBeNull();
  });

  it('a holder HTTP does not let in (banned, or a membership in another business) is nobody\'s reader, on their own phone too', () => {
    const banned = member('u_s', null, 'STAFF', { user: { deletedAt: null, bannedAt: new Date() } });
    expect(perceptionForPosition(heldBy(banned, [banned])).readerUserId).toBeNull();
    const elsewhere = member('u_s', null, 'STAFF', { businessId: 'biz_other' });
    expect(perceptionForPosition(heldBy(elsewhere, [elsewhere])).readerUserId).toBeNull();
  });

  it('a contact-only position has no reader', () => {
    expect(perceptionForPosition(contactOnly()).readerUserId).toBeNull();
    expect(perceptionForPosition(null).readerUserId).toBeNull();
  });
});

describe('the modules a position turn sees follow the position, as its tools do (SEC-W1FPMS-2, COR-W1FPMS-2)', () => {
  it("the holder-reader sees what the JobRole map and their membership both read", () => {
    const narrowed = member('u_s', { crm: 'read', bookings: 'read', revenue: 'read', expenses: 'none', team: 'admin' });
    expect(sorted(perceptionForPosition(heldBy(narrowed, [narrowed])).modules)).toEqual(sorted(['crm', 'bookings', 'revenue']));
    expect(sorted(perceptionForPosition(heldBy(S, [S])).modules)).toEqual(sorted(Object.keys(ROLE_MAP)));
  });

  it("a turn on another member's phone is capped by that member too, and as a memberless turn sees no contacts and no money (D-73/D-93)", () => {
    expect(sorted(perceptionForPosition(heldBy(S, [P])).modules)).toEqual(['bookings']);
  });

  it("a contact-only position sees what its JobRole map grants but contacts and money: bookings, projects, operations, content (COR-W1FPMS-2)", () => {
    expect(sorted(perceptionForPosition(contactOnly()).modules)).toEqual(sorted(['bookings', 'projects', 'operations', 'content']));
  });

  it('a contact-only position on a member\'s phone is capped by that member, as its envelope is', () => {
    const projectsNone = member('u_p', { bookings: 'read', projects: 'none', operations: 'read', content: 'none' });
    expect(sorted(perceptionForPosition(contactOnly([projectsNone])).modules)).toEqual(sorted(['bookings', 'operations']));
  });

  it("a JobRole map is read exactly as ModuleScopeGuard reads it: a legacy family key or a case variant grants no module, and no JobRole grants none", () => {
    const legacy = { id: 'jr_l', name: 'Legacy', permissions: { finance: 'admin', Bookings: 'read', projects: 'READ', operations: 'write' } as any };
    expect(perceptionForPosition(contactOnly([], legacy)).modules).toEqual(['operations']);
    expect(perceptionForPosition(contactOnly([], null)).modules).toEqual([]);
    expect(perceptionForPosition({ businessId: BIZ, jobRole: { id: 'jr_a', name: 'Arr', permissions: [] as any }, phoneMembers: [] }).modules).toEqual([]);
  });

  it('a phone member HTTP does not let in caps the position to no module (fail closed)', () => {
    const banned = member('u_p', null, 'STAFF', { user: { deletedAt: new Date(), bannedAt: null } });
    expect(perceptionForPosition(contactOnly([banned])).modules).toEqual([]);
  });
});

describe('the policy registers the perception for the envelope it issues for the position, and for no other object', () => {
  it('perceptionOf(envelopeForPosition(position)) is perceptionForPosition(position)', () => {
    for (const position of [heldBy(S, [S]), heldBy(S, [P]), contactOnly()]) {
      const envelope = policy.envelopeForPosition(position);
      expect(policy.isIssued(envelope)).toBe(true);
      expect(policy.perceptionOf(envelope)).toEqual(perceptionForPosition(position));
    }
  });

  it("a JobRole's own envelope, a copy of a position's envelope, and a non-object have no perception", () => {
    const envelope = policy.envelopeForPosition(heldBy(S, [S]));
    expect(policy.perceptionOf({ ...envelope })).toBeNull();
    expect(policy.perceptionOf(policy.envelopeForJobRole(jobRole))).toBeNull();
    expect(policy.perceptionOf(undefined)).toBeNull();
    expect(policy.perceptionOf('envelope')).toBeNull();
  });

  it('the envelope itself is unchanged: the same tools as before the perception was registered', () => {
    const position = heldBy(S, [P]);
    const a = policy.envelopeForPosition(position);
    const b = policy.envelopeForPosition(position);
    expect(a).not.toBe(b);
    expect({ ...a, approvedTools: [...a.approvedTools], blockedTools: [...a.blockedTools] }).toEqual({ ...b, approvedTools: [...b.approvedTools], blockedTools: [...b.blockedTools] });
  });
});
