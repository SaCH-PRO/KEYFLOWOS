/**
 * W9-KEY-DISPATCH-INCLUDES review SEC-W9KDI-1 (review CR-W7CTC-2; owner rulings D-73, D-88).
 *
 * chat() dispatches each model tool call with chatToolAction(base, toolName, server): the surface's
 * own context, except that a staff position's call_create_task (HOLDER_ONLY_TOOLS) on a turn with
 * no principal runs for the position's holder (onBehalfOfUserId). The positive path through the
 * real chat() is pinned on a real database in test/staff-bridge-boundary.integration.test.ts
 * (CR-W7CTC-2). These are its negative controls, which no case there reaches: a turn with a
 * principal keeps its context, every other tool keeps its context, and a turn with no holder keeps
 * its context. The holder is never a principal and grants nothing.
 */
import { describe, it, expect } from 'vitest';
import { chatToolAction, type FlowServerContext } from './flow-orchestrator.service';
import { FLOW_TOOLS } from './flow-tool-registry';
import { HOLDER_ONLY_TOOLS, JobRolePolicyService, NO_JOB_ROLE } from '../structure/job-role-policy.service';
import type { ActionContext } from '../key-autonomy/action-boundary/key-action-boundary.service';

const HOLDER = 'u_holder';
const MEMBER = 'u_member';
const envelope = new JobRolePolicyService().envelopeForJobRole(NO_JOB_ROLE);
const server = (positionHolderUserId?: string | null): FlowServerContext => ({ jobRoleEnvelope: envelope, positionHolderUserId });
/** A staff bridge turn as chat() builds it: a CHAT turn with no principal. */
const bridgeTurn = (): ActionContext => ({ surface: 'CHAT', principalUserId: null, crew: ['general'], sourceId: 'tc_1', sessionId: 's_1' });
/** A member's own chat turn: its principal is the member. */
const memberTurn = (): ActionContext => ({ surface: 'CHAT', principalUserId: MEMBER, crew: ['general'], sourceId: 'tc_1', sessionId: 's_1' });

describe('chatToolAction — the dispatch context of a model tool call in chat() (W9-KEY-DISPATCH-INCLUDES; D-73, D-88)', () => {
  it('SEC-W9KDI-1 (D-73, D-88): HOLDER_ONLY_TOOLS is call_create_task alone', () => {
    expect([...HOLDER_ONLY_TOOLS]).toEqual(['call_create_task']);
  });

  it("SEC-W9KDI-1 (D-73, D-88): a staff position's turn (no principal) runs call_create_task for its holder as onBehalfOfUserId, and the rest of the context is unchanged", () => {
    const base = bridgeTurn();
    const action = chatToolAction(base, 'call_create_task', server(HOLDER));
    expect(action).toEqual({ ...bridgeTurn(), onBehalfOfUserId: HOLDER });
    expect(action.principalUserId, 'the holder is never a principal').toBeNull();
    expect(base, 'the base context is not mutated').toEqual(bridgeTurn());
  });

  it('SEC-W9KDI-1 (D-73, D-88): a turn with a principal (a member chat) keeps its context, whatever holder the server argument names', () => {
    const base = memberTurn();
    const action = chatToolAction(base, 'call_create_task', server(HOLDER));
    expect(action).toBe(base);
    expect(action).not.toHaveProperty('onBehalfOfUserId');
  });

  it("SEC-W9KDI-1 (D-73, D-88): every tool other than call_create_task keeps the context on a holder's turn", () => {
    const others = FLOW_TOOLS.map((t) => t.name).filter((name) => !HOLDER_ONLY_TOOLS.includes(name));
    expect(others.length).toBeGreaterThan(100);
    for (const name of others) {
      const base = bridgeTurn();
      expect(chatToolAction(base, name, server(HOLDER)), name).toBe(base);
    }
  });

  it('SEC-W9KDI-1 (D-73, D-88): a turn with no holder (a contact-only position, or no server argument) keeps its context', () => {
    for (const s of [server(null), server(undefined), server(''), undefined]) {
      const base = bridgeTurn();
      const action = chatToolAction(base, 'call_create_task', s);
      expect(action, JSON.stringify(s ?? null)).toBe(base);
      expect(action).not.toHaveProperty('onBehalfOfUserId');
    }
  });
});
