import { describe, expect, it } from 'vitest';
import {
  EXECUTION_SURFACES,
  deriveControlRequirement,
  type ExecutionSurface,
  type KeyAutonomyVerdict,
  type PrincipalAuthority,
} from './control-clearance';
import { boundaryDisposition, compareWithLegacy, legacyDisposition, type Disposition } from './shadow-parity';

/**
 * Shadow parity (KF-EXEC-ACTION-001): the boundary's decision beside what each
 * surface did with the same oversight decision before it.
 *
 * The matrix is every surface, every shape an oversight decision can take, and
 * every kind of requester. Two things are proved over all of it: the boundary
 * is never looser than the surface was, and the cells where it is stricter are
 * exactly the ones listed below, each of which is a characterized bypass.
 */

const CAPABILITY = { name: 'helpdesk_create_ticket', riskTier: 2 };

const base: KeyAutonomyVerdict = {
  allowed: true,
  requiresQuickConfirm: false,
  requiresFormalApproval: false,
  requiresAdminApproval: false,
  tier: 2,
  reason: 'r',
};
const VERDICTS: Record<string, KeyAutonomyVerdict> = {
  blocked: { ...base, allowed: false },
  auto: base,
  quick: { ...base, requiresQuickConfirm: true },
  formal: { ...base, requiresFormalApproval: true },
  admin: { ...base, requiresFormalApproval: true, requiresAdminApproval: true },
};

const member = (approvalTier: number): PrincipalAuthority => ({
  userId: 'u',
  basis: 'membership',
  membershipId: 'm',
  membershipRole: approvalTier >= 3 ? 'ADMIN' : 'STAFF',
  approvalTier,
});
const PRINCIPALS: Record<string, PrincipalAuthority | null> = {
  nobody_on_the_surface: null,
  stranger: { userId: 'x', basis: 'none', membershipId: null, membershipRole: null, approvalTier: 0 },
  staff: member(0),
  admin: member(3),
  owner_without_membership: { userId: 'o', basis: 'owner_without_membership', membershipId: null, membershipRole: null, approvalTier: 0 },
  super_admin: { userId: 's', basis: 'super_admin', membershipId: null, membershipRole: null, approvalTier: 4 },
};

interface Cell {
  surface: ExecutionSurface;
  verdict: string;
  principal: string;
  legacy: Disposition;
  boundary: Disposition;
  parity: string;
}

function matrix(): Cell[] {
  const cells: Cell[] = [];
  for (const surface of EXECUTION_SURFACES) {
    for (const [verdictName, autonomy] of Object.entries(VERDICTS)) {
      for (const [principalName, principal] of Object.entries(PRINCIPALS)) {
        const requirement = deriveControlRequirement({ capability: CAPABILITY, surface, principal, autonomy });
        const shadow = compareWithLegacy(surface, autonomy, requirement);
        cells.push({
          surface,
          verdict: verdictName,
          principal: principalName,
          legacy: shadow.legacy,
          boundary: shadow.boundary,
          parity: shadow.parity,
        });
      }
    }
  }
  return cells;
}

describe('shadow parity: boundary beside legacy oversight', () => {
  const cells = matrix();

  it('covers every surface, verdict shape and requester kind', () => {
    expect(cells).toHaveLength(EXECUTION_SURFACES.length * 5 * 6);
  });

  it('the boundary is never looser than the surface was', () => {
    expect(cells.filter((c) => c.parity === 'BOUNDARY_LOOSER')).toEqual([]);
  });

  it('whatever legacy oversight blocked is still blocked, on every surface that consulted it', () => {
    const consulted: ExecutionSurface[] = ['CHAT', 'CHAT_STREAM', 'CHAT_CONFIRM', 'PLAN_HTTP', 'PLAN_QUEUE', 'GRAPH_ACTION', 'INBOUND_CONVERSATION', 'PRO_AUTO_MONITOR'];
    for (const c of cells.filter((x) => x.verdict === 'blocked' && consulted.includes(x.surface))) {
      expect(c).toMatchObject({ legacy: 'BLOCK', boundary: 'BLOCK', parity: 'SAME' });
    }
  });

  it('for an eligible requester in chat the two agree on every verdict', () => {
    const eligible = ['staff', 'admin', 'owner_without_membership', 'super_admin'];
    const chat = cells.filter((c) => (c.surface === 'CHAT' || c.surface === 'CHAT_STREAM') && eligible.includes(c.principal));
    expect(chat).toHaveLength(2 * 5 * 4);
    expect(chat.filter((c) => c.parity !== 'SAME')).toEqual([]);
  });

  // The differences, stated. Each is a bypass the characterization recorded.
  const eligibleCell = (surface: ExecutionSurface, verdict: string) =>
    cells.find((c) => c.surface === surface && c.verdict === verdict && c.principal === 'staff') as Cell;

  it.each([
    // surface, verdict, what the surface did, what the boundary does
    ['CHAT_CONFIRM', 'quick', 'EXECUTE', 'ASK_CONFIRMATION'], // E3: client-resubmitted name and arguments executed
    ['PLAN_HTTP', 'quick', 'EXECUTE', 'ASK_CONFIRMATION'], // E6: plan approval stood in for the confirmation
    ['GRAPH_ACTION', 'quick', 'EXECUTE', 'ASK_CONFIRMATION'], // E10: requiresQuickConfirm ignored
  ] as const)('%s with a %s verdict: the surface would %s, the boundary will %s', (surface, verdict, legacy, boundary) => {
    expect(eligibleCell(surface, verdict)).toMatchObject({ legacy, boundary, parity: 'BOUNDARY_STRICTER' });
  });

  it.each([
    ['PHONE_STREAM', 'E4: no governance at all'],
    ['UNDECLARED', 'a caller that declares no surface'],
  ] as const)('%s (%s) executed under every verdict and is now blocked under every verdict', (surface) => {
    for (const c of cells.filter((x) => x.surface === surface)) {
      expect(c).toMatchObject({ legacy: 'EXECUTE', boundary: 'BLOCK', parity: 'BOUNDARY_STRICTER' });
    }
  });

  it.each([
    ['INBOUND_CONVERSATION', 'E5: a model confidence above 0.9 auto-approved it'],
    ['PLAN_QUEUE', 'E7: the dispatcher checked only `allowed`'],
    ['PRO_AUTO_MONITOR', 'the monitor checked only `allowed`, under a mode override'],
    ['CORTEX_BRIDGE', 'E9: no oversight decision'],
    ['CUSTOM_LOGIC', 'E11: no oversight decision'],
    ['PROPOSAL', 'E8: evaluated as key_autonomy.EXECUTE_TOOL'],
  ] as const)('%s (%s): with no principal, an allowed action now waits for a human', (surface) => {
    const principalless = cells.filter((c) => c.surface === surface && c.principal === 'nobody_on_the_surface' && c.verdict !== 'blocked');
    expect(principalless).toHaveLength(4);
    for (const c of principalless) {
      expect(c.boundary).toBe('QUEUE_APPROVAL');
      expect(c.parity).toBe('BOUNDARY_STRICTER');
    }
  });

  it('a requester with no authority in the business is blocked on every surface', () => {
    for (const c of cells.filter((x) => x.principal === 'stranger')) {
      expect(c.boundary).toBe('BLOCK');
    }
  });

  it('the surfaces that never consulted oversight ignored a block; the boundary does not', () => {
    for (const surface of ['CORTEX_BRIDGE', 'CUSTOM_LOGIC', 'PROPOSAL'] as const) {
      for (const c of cells.filter((x) => x.surface === surface && x.verdict === 'blocked')) {
        expect(c).toMatchObject({ legacy: 'EXECUTE', boundary: 'BLOCK', parity: 'BOUNDARY_STRICTER' });
      }
    }
  });

  // Counted by hand from the two tables, per surface, before it was run:
  // 30 cells each (5 verdicts by 6 requesters). A surface that honoured every
  // flag agrees in 24 (all but the requester-less and the stranger cells where
  // it would have acted); one that ignored quick-confirm agrees in 20; one that
  // checked only `allowed` in 10; one that consulted nothing agrees only where
  // an eligible requester would have been auto-cleared anyway (4); a surface
  // with no proven tenant agrees nowhere.
  it('the agreement of each surface with the boundary is fixed, so a new difference cannot arrive unnoticed', () => {
    const same: Record<string, number> = {};
    for (const surface of EXECUTION_SURFACES) same[surface] = 0;
    for (const c of cells) if (c.parity === 'SAME') same[c.surface]++;
    expect(same).toEqual({
      CHAT: 24,
      CHAT_STREAM: 24,
      CHAT_CONFIRM: 20,
      PLAN_HTTP: 20,
      GRAPH_ACTION: 20,
      INBOUND_CONVERSATION: 10,
      PLAN_QUEUE: 10,
      PRO_AUTO_MONITOR: 10,
      PROPOSAL: 4,
      CORTEX_BRIDGE: 4,
      CUSTOM_LOGIC: 4,
      PHONE_STREAM: 0,
      UNDECLARED: 0,
    });

    const summary = { SAME: 0, BOUNDARY_STRICTER: 0, BOUNDARY_LOOSER: 0 } as Record<string, number>;
    for (const c of cells) summary[c.parity]++;
    expect(summary).toEqual({ SAME: 150, BOUNDARY_STRICTER: 240, BOUNDARY_LOOSER: 0 });
  });

  it('legacyDisposition and boundaryDisposition are total over their inputs', () => {
    for (const surface of EXECUTION_SURFACES) {
      for (const autonomy of Object.values(VERDICTS)) {
        expect(['BLOCK', 'QUEUE_APPROVAL', 'ASK_CONFIRMATION', 'EXECUTE']).toContain(legacyDisposition(surface, autonomy));
      }
    }
    expect(boundaryDisposition({ kind: 'NONE', reason: '' })).toBe('EXECUTE');
    expect(boundaryDisposition({ kind: 'DENY', code: 'BLOCKED_BY_POLICY', reason: '' })).toBe('BLOCK');
  });
});
