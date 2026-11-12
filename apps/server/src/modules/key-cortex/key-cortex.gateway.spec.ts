import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  KeyCortexGateway,
  KEY_CORTEX_WS_REVALIDATE_MS,
  KEY_CORTEX_WS_SWEEP_MS,
  KEY_CORTEX_WS_TICK_MS,
  KEY_CORTEX_WS_CHECK_TIMEOUT_MS,
  KEY_CORTEX_WS_CONFIRM_MS,
  KEY_CORTEX_WS_MAX_UNVERIFIED_MS,
  KEY_CORTEX_WS_SWEEP_CONCURRENCY,
  KEY_CORTEX_WS_AUTH_ERROR,
  KEY_CORTEX_WS_RECHECK_REFUSED,
  KEY_CORTEX_WS_AUTH_REFRESH,
  KEY_CORTEX_WS_AUTH_REFRESHED,
} from './key-cortex.gateway';
import { KeyCortexWsAuthService } from './key-cortex-ws-auth.service';
import { buildAdminToken } from '../../core/auth/admin-token.util';

/** Minimal fake socket.io Socket for gateway tests. */
function fakeSocket(id: string, opts: { authToken?: string; businessId?: string; queryUserId?: string } = {}): any {
  return {
    id,
    handshake: {
      auth: {
        ...(opts.authToken ? { token: opts.authToken } : {}),
        ...(opts.businessId ? { businessId: opts.businessId } : {}),
      },
      headers: {},
      query: {
        ...(opts.queryUserId ? { userId: opts.queryUserId } : {}),
        ...(opts.businessId ? { businessId: opts.businessId } : {}),
      },
    },
    join: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
  };
}

describe('KeyCortexGateway (connection security)', () => {
  let reasoning: any;
  let approval: any;
  let event: any;
  let executor: any;
  let wsAuth: { authenticateSocket: ReturnType<typeof vi.fn>; verifyBusinessMembership: ReturnType<typeof vi.fn> };
  let gateway: KeyCortexGateway;

  beforeEach(() => {
    reasoning = { streamReasoning: vi.fn() };
    approval = { approveAction: vi.fn(), rejectAction: vi.fn() };
    event = { emit: vi.fn() };
    executor = { executeApprovedAction: vi.fn() };
    wsAuth = { authenticateSocket: vi.fn(), verifyBusinessMembership: vi.fn() };
    gateway = new KeyCortexGateway(reasoning, approval, event, executor, wsAuth as any);
    // Fake socket.io server for push/broadcast paths.
    (gateway as any).server = { to: vi.fn(() => ({ emit: vi.fn() })) };
  });

  async function connect(socket: any) {
    await gateway.handleConnection(socket);
  }

  it('accepts a valid authenticated + authorized socket and joins scoped rooms', async () => {
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'u1', email: null, role: 'USER' });
    wsAuth.verifyBusinessMembership.mockResolvedValue(true);
    const socket = fakeSocket('s1', { authToken: 't', businessId: 'b1' });

    await connect(socket);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith('business:b1');
    expect(socket.join).toHaveBeenCalledWith('user:u1');
    expect(socket.emit).toHaveBeenCalledWith('key:connected', expect.objectContaining({ userId: 'u1', businessId: 'b1' }));
    expect(gateway.getTotalConnections()).toBe(1);
  });

  it('derives the room from the token identity, ignoring a forged query userId', async () => {
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'real', email: null, role: 'USER' });
    wsAuth.verifyBusinessMembership.mockResolvedValue(true);
    const socket = fakeSocket('s1', { authToken: 't', businessId: 'b1', queryUserId: 'attacker' });

    await connect(socket);

    expect(socket.join).toHaveBeenCalledWith('user:real');
    expect(socket.join).not.toHaveBeenCalledWith('user:attacker');
  });

  it('rejects a socket with a missing/invalid token and stores no state', async () => {
    wsAuth.authenticateSocket.mockResolvedValue(null);
    const socket = fakeSocket('s1', { businessId: 'b1' });

    await connect(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
    expect(gateway.getTotalConnections()).toBe(0);
  });

  it('rejects an authenticated socket missing a businessId', async () => {
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'u1', email: null, role: 'USER' });
    const socket = fakeSocket('s1', { authToken: 't' });

    await connect(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(gateway.getTotalConnections()).toBe(0);
  });

  it('rejects a cross-tenant connection (authenticated but not a member)', async () => {
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'u1', email: null, role: 'USER' });
    wsAuth.verifyBusinessMembership.mockResolvedValue(false);
    const socket = fakeSocket('s1', { authToken: 't', businessId: 'someone-elses-biz' });

    await connect(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
    expect(gateway.getTotalConnections()).toBe(0);
  });

  it('disconnects if authentication throws (fails closed)', async () => {
    wsAuth.authenticateSocket.mockRejectedValue(new Error('boom'));
    const socket = fakeSocket('s1', { authToken: 't', businessId: 'b1' });

    await connect(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(gateway.getTotalConnections()).toBe(0);
  });

  it('rejects handler invocation from an unauthenticated socket', async () => {
    const socket = fakeSocket('ghost', { businessId: 'b1' }); // never connected → not in clients
    await gateway.handleChat({ text: 'hi' }, socket);
    expect(socket.emit).toHaveBeenCalledWith('key:error', { message: 'Not authenticated' });
    expect(reasoning.streamReasoning).not.toHaveBeenCalled();
  });

  it('handles reconnect: valid token then invalid token', async () => {
    wsAuth.verifyBusinessMembership.mockResolvedValue(true);

    wsAuth.authenticateSocket.mockResolvedValueOnce({ userId: 'u1', email: null, role: 'USER' });
    const first = fakeSocket('s1', { authToken: 'good', businessId: 'b1' });
    await connect(first);
    expect(gateway.getTotalConnections()).toBe(1);

    wsAuth.authenticateSocket.mockResolvedValueOnce(null);
    const second = fakeSocket('s2', { authToken: 'expired', businessId: 'b1' });
    await connect(second);
    expect(second.disconnect).toHaveBeenCalledWith(true);
    // First connection unaffected; second not added.
    expect(gateway.getTotalConnections()).toBe(1);
  });

  it('supports multiple concurrent sockets for the same user', async () => {
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'u1', email: null, role: 'USER' });
    wsAuth.verifyBusinessMembership.mockResolvedValue(true);

    await connect(fakeSocket('s1', { authToken: 't', businessId: 'b1' }));
    await connect(fakeSocket('s2', { authToken: 't', businessId: 'b1' }));

    expect(gateway.getTotalConnections()).toBe(2);
    expect(gateway.getConnectedCount('b1')).toBe(2);
  });

  it('supports one user connected to two businesses concurrently', async () => {
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'u1', email: null, role: 'USER' });
    wsAuth.verifyBusinessMembership.mockResolvedValue(true);

    const s1 = fakeSocket('s1', { authToken: 't', businessId: 'b1' });
    const s2 = fakeSocket('s2', { authToken: 't', businessId: 'b2' });
    await connect(s1);
    await connect(s2);

    expect(s1.join).toHaveBeenCalledWith('business:b1');
    expect(s2.join).toHaveBeenCalledWith('business:b2');
    expect(gateway.getConnectedCount('b1')).toBe(1);
    expect(gateway.getConnectedCount('b2')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ST-WS-R1 (R0-ID-F6 review; R0-ID-F6b-WS-LIVE-REVOCATION and its review
// repair). The gateway decided at connect only: handleConnection stored
// { userId, businessId } and every handler trusted it for the socket's
// lifetime, so a socket opened before a ban, a delete, a demotion, a removal
// from the business or a logout kept approving, rejecting, chatting and
// broadcasting in its tenant, and kept its room pushes.
// Required: before every client action the gateway re-takes the connect-time
// decision for that socket — KeyCortexWsAuthService.authenticateSocket (the HTTP
// AuthMiddleware decision for the handshake token: User row, deletedAt,
// bannedAt, role from the row, the logout and admin-token cutoffs) and
// verifyBusinessMembership for the socket's own businessId — and performs the
// action only when it passes. A refused check refuses the action at once; the
// socket is disconnected, after an auth error, when a check started
// KEY_CORTEX_WS_CONFIRM_MS or more after it refuses too (review finding CR-1:
// one refused check cannot tell a revocation from a database or provider
// blip). A successful check is reused for at most KEY_CORTEX_WS_REVALIDATE_MS;
// a socket that sends nothing is re-checked on the schedule
// KEY_CORTEX_WS_SWEEP_MS after its last successful check.
// ---------------------------------------------------------------------------
describe('ST-WS-R1 — an open socket re-validates its principal before every action', () => {
  let reasoning: any;
  let approval: any;
  let event: any;
  let executor: any;
  let wsAuth: {
    authenticateSocket: ReturnType<typeof vi.fn>;
    authenticateToken: ReturnType<typeof vi.fn>;
    verifyBusinessMembership: ReturnType<typeof vi.fn>;
  };
  let gateway: KeyCortexGateway;
  let serverTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    reasoning = {
      streamReasoning: vi.fn(async () =>
        (async function* () {
          yield { type: 'text', content: 'ok', done: true };
        })(),
      ),
    };
    approval = {
      approveAction: vi.fn(async () => ({ actionDescription: 'approved it' })),
      rejectAction: vi.fn(async () => ({ actionDescription: 'rejected it' })),
    };
    event = { emit: vi.fn() };
    executor = { executeApprovedAction: vi.fn() };
    wsAuth = {
      authenticateSocket: vi.fn().mockResolvedValue({ userId: 'u1', email: null, role: 'USER' }),
      authenticateToken: vi.fn().mockResolvedValue(null),
      verifyBusinessMembership: vi.fn().mockResolvedValue(true),
    };
    gateway = new KeyCortexGateway(reasoning, approval, event, executor, wsAuth as any);
    serverTo = vi.fn(() => ({ emit: vi.fn() }));
    (gateway as any).server = { to: serverTo };
  });

  afterEach(() => {
    (gateway as any).onModuleDestroy?.();
    vi.useRealTimers();
  });

  async function connected(id = 's1', businessId = 'b1') {
    const socket = fakeSocket(id, { authToken: 't', businessId });
    await gateway.handleConnection(socket);
    expect(socket.disconnect, 'connect control').not.toHaveBeenCalled();
    socket.emit.mockClear();
    return socket;
  }

  /** The four client actions; each reports whether it acted. */
  const actions: Array<[string, (s: any) => Promise<unknown>, (s: any) => boolean]> = [
    [
      'key:approve',
      (s) => gateway.handleApprove({ approvalId: 'ap1' }, s),
      () => approval.approveAction.mock.calls.length > 0 || executor.executeApprovedAction.mock.calls.length > 0,
    ],
    ['key:reject', (s) => gateway.handleReject({ approvalId: 'ap1' }, s), () => approval.rejectAction.mock.calls.length > 0],
    [
      'key:chat',
      (s) => gateway.handleChat({ text: 'hi' }, s),
      () => reasoning.streamReasoning.mock.calls.length > 0 || event.emit.mock.calls.length > 0,
    ],
    ['key:typing', (s) => gateway.handleTyping(s), (s) => s.to.mock.calls.length > 0],
  ];

  function expectCut(socket: any, label: string) {
    expect(socket.emit, `${label}: auth error emitted`).toHaveBeenCalledWith(
      KEY_CORTEX_WS_AUTH_ERROR,
      expect.objectContaining({ message: expect.any(String) }),
    );
    expect(socket.disconnect, `${label}: disconnected`).toHaveBeenCalledWith(true);
    expect((gateway as any).clients.has(socket.id), `${label}: identity forgotten`).toBe(false);
    expect(socket.emit, `${label}: nothing decided`).not.toHaveBeenCalledWith('key:approval_result', expect.anything());
    expect(socket.emit, `${label}: nothing started`).not.toHaveBeenCalledWith('key:status', expect.anything());
    expect(serverTo, `${label}: nothing pushed to the tenant or the user room`).not.toHaveBeenCalled();
  }

  /** One refused check: the action is not performed and the client is told so (typing is silent); the socket is kept until the refusal is confirmed. */
  function expectRefusedNotCut(socket: any, label: string, notified = true) {
    if (notified) {
      expect(socket.emit, `${label}: told the action was not performed`).toHaveBeenCalledWith('key:error', {
        message: KEY_CORTEX_WS_RECHECK_REFUSED,
      });
    }
    expect(socket.emit, `${label}: no auth error on one refusal`).not.toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.anything());
    expect(socket.disconnect, `${label}: not disconnected on one refusal`).not.toHaveBeenCalled();
    expect((gateway as any).clients.has(socket.id), `${label}: still held`).toBe(true);
  }

  /** A revoked principal: no action now, and the socket cut by the action that comes KEY_CORTEX_WS_CONFIRM_MS later. */
  async function expectRefusedThenCut(socket: any, act: () => Promise<unknown>, label: string, notified = true) {
    await act();
    expectRefusedNotCut(socket, label, notified);
    vi.advanceTimersByTime(KEY_CORTEX_WS_CONFIRM_MS);
    await act();
    expectCut(socket, label);
  }

  it('pins the bounds: a check is reused for at most a few seconds, a passive socket is re-checked at least once a minute, a refusal is confirmed within seconds, and nothing goes unverified for more than two minutes', () => {
    expect(KEY_CORTEX_WS_REVALIDATE_MS).toBe(2_000);
    expect(KEY_CORTEX_WS_REVALIDATE_MS).toBeLessThanOrEqual(5_000);
    expect(KEY_CORTEX_WS_SWEEP_MS).toBeGreaterThan(KEY_CORTEX_WS_REVALIDATE_MS);
    expect(KEY_CORTEX_WS_SWEEP_MS).toBeLessThanOrEqual(60_000);
    expect(KEY_CORTEX_WS_TICK_MS).toBeLessThanOrEqual(KEY_CORTEX_WS_CONFIRM_MS);
    // identity-boundary.integration.test.ts waits these out over a real socket (WS_REVALIDATE_BOUND_MS, WS_CONFIRM_BOUND_MS, NOT_PERFORMED).
    expect(KEY_CORTEX_WS_CONFIRM_MS).toBe(5_000);
    expect(KEY_CORTEX_WS_RECHECK_REFUSED.startsWith('Not performed:')).toBe(true);
    expect(KEY_CORTEX_WS_CHECK_TIMEOUT_MS).toBeLessThan(KEY_CORTEX_WS_SWEEP_MS);
    // One fully missed re-check is tolerated before a healthy socket is cut for going unverified.
    expect(KEY_CORTEX_WS_MAX_UNVERIFIED_MS).toBeGreaterThanOrEqual(2 * KEY_CORTEX_WS_SWEEP_MS + KEY_CORTEX_WS_CHECK_TIMEOUT_MS);
    expect(KEY_CORTEX_WS_MAX_UNVERIFIED_MS + KEY_CORTEX_WS_TICK_MS).toBeLessThanOrEqual(120_000);
    expect(KEY_CORTEX_WS_SWEEP_CONCURRENCY).toBeGreaterThan(1);
    expect(KEY_CORTEX_WS_AUTH_ERROR).toBe('key:auth_error');
    expect(KEY_CORTEX_WS_AUTH_REFRESH).toBe('key:auth_refresh');
    expect(KEY_CORTEX_WS_AUTH_REFRESHED).toBe('key:auth_refreshed');
  });

  it('positive control: a healthy socket keeps acting; past the bound each action re-asks the connect checks for this socket, with the fresh role and its own businessId', async () => {
    const socket = await connected();
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    wsAuth.authenticateSocket.mockClear();
    wsAuth.verifyBusinessMembership.mockClear();
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'u1', email: null, role: 'OWNER' });

    await gateway.handleApprove({ approvalId: 'ap1' }, socket);

    expect(wsAuth.authenticateSocket).toHaveBeenCalledTimes(1);
    expect(wsAuth.authenticateSocket).toHaveBeenCalledWith(socket);
    expect(wsAuth.verifyBusinessMembership).toHaveBeenCalledWith('u1', 'OWNER', 'b1');
    expect(approval.approveAction).toHaveBeenCalledWith('ap1', expect.objectContaining({ businessId: 'b1', approvedBy: 'u1' }));
    expect(executor.executeApprovedAction).toHaveBeenCalledWith('b1', 'ap1');
    expect(socket.emit).toHaveBeenCalledWith('key:approval_result', expect.objectContaining({ status: 'approved' }));
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(gateway.getTotalConnections()).toBe(1);

    // ... and keeps working on every later action: reject, chat, typing.
    for (const [label, act] of actions.slice(1)) {
      vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
      await act(socket);
      expect(socket.disconnect, label).not.toHaveBeenCalled();
    }
    expect(approval.rejectAction).toHaveBeenCalled();
    expect(reasoning.streamReasoning).toHaveBeenCalled();
    expect(socket.to).toHaveBeenCalledWith('business:b1');
    expect(wsAuth.authenticateSocket).toHaveBeenCalledTimes(4);
    expect(socket.emit).not.toHaveBeenCalledWith('key:error', expect.anything());
  });

  for (const [label, act, acted] of actions) {
    it(`${label}: after the row is banned or deleted or the session logged out (authenticateSocket refuses), the open socket acts no more — refused at once, cut by the check that confirms it`, async () => {
      const socket = await connected();
      wsAuth.authenticateSocket.mockResolvedValue(null);
      vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);

      await expectRefusedThenCut(socket, () => act(socket), label, label !== 'key:typing');

      expect(acted(socket), `${label} acted`).toBe(false);
      expect(gateway.getTotalConnections()).toBe(0);
    });
  }

  it('demoted below the connect authority: a SUPER_ADMIN with no membership whose row is now USER is cut (the role is read fresh, not kept from connect)', async () => {
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'admin1', email: null, role: 'SUPER_ADMIN' });
    wsAuth.verifyBusinessMembership.mockImplementation(async (_u: string, role: string) => role === 'SUPER_ADMIN');
    const socket = await connected('s1', 'foreign_biz');

    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'admin1', email: null, role: 'USER' });
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await expectRefusedThenCut(socket, () => gateway.handleApprove({ approvalId: 'ap1' }, socket), 'demoted');

    expect(wsAuth.verifyBusinessMembership).toHaveBeenLastCalledWith('admin1', 'USER', 'foreign_biz');
    expect(approval.approveAction).not.toHaveBeenCalled();
  });

  it('removed from the business: the identity is still valid but its membership of the socket’s businessId is gone — cut', async () => {
    const socket = await connected();
    wsAuth.verifyBusinessMembership.mockResolvedValue(false);
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await expectRefusedThenCut(socket, () => gateway.handleReject({ approvalId: 'ap1' }, socket), 'removed');
    expect(approval.rejectAction).not.toHaveBeenCalled();
  });

  it('a different identity behind the socket is not this socket’s principal — cut', async () => {
    const socket = await connected();
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'someone-else', email: null, role: 'SUPER_ADMIN' });
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await expectRefusedThenCut(socket, () => gateway.handleChat({ text: 'hi' }, socket), 'other identity');
    expect(reasoning.streamReasoning).not.toHaveBeenCalled();
  });

  it('a check that throws refuses the action (fails closed) but is no answer, so it never disconnects by itself; a socket with no successful check for KEY_CORTEX_WS_MAX_UNVERIFIED_MS is cut', async () => {
    const socket = await connected();
    wsAuth.verifyBusinessMembership.mockRejectedValue(new Error('db down'));
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(approval.approveAction).not.toHaveBeenCalled();
    expectRefusedNotCut(socket, 'throws');

    vi.advanceTimersByTime(KEY_CORTEX_WS_MAX_UNVERIFIED_MS - KEY_CORTEX_WS_REVALIDATE_MS - 1);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expectRefusedNotCut(socket, 'still throwing, just inside the bound');

    vi.advanceTimersByTime(1);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(approval.approveAction).not.toHaveBeenCalled();
    expectCut(socket, 'still throwing, at the bound');
    expect(socket.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.objectContaining({ reason: 'unverified' }));
  });

  it('the bound: a ban written now refuses actions KEY_CORTEX_WS_REVALIDATE_MS after the last successful check, not later; within it the check is reused, a pending refusal refuses without re-querying, and the confirming check cuts', async () => {
    const socket = await connected(); // the connect decision is the last successful check
    wsAuth.authenticateSocket.mockClear();
    wsAuth.authenticateSocket.mockResolvedValue(null); // banned now

    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS - 1);
    await gateway.handleReject({ approvalId: 'ap1' }, socket);
    expect(wsAuth.authenticateSocket, 'within the bound the last check is reused').not.toHaveBeenCalled();
    expect(approval.rejectAction).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(wsAuth.authenticateSocket, 'at the bound the check runs again').toHaveBeenCalledTimes(1);
    expect(approval.approveAction).not.toHaveBeenCalled();
    expectRefusedNotCut(socket, 'first refusal');

    vi.advanceTimersByTime(KEY_CORTEX_WS_CONFIRM_MS - 1);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    await gateway.handleTyping(socket);
    expect(wsAuth.authenticateSocket, 'a pending refusal refuses without a new query').toHaveBeenCalledTimes(1);
    expect(approval.approveAction).not.toHaveBeenCalled();
    expect(socket.to).not.toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(wsAuth.authenticateSocket, 'the confirming check').toHaveBeenCalledTimes(2);
    expect(approval.approveAction).not.toHaveBeenCalled();
    // (expectCut's "nothing decided" does not apply: the reject inside the reuse window was decided.)
    expect(socket.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.objectContaining({ reason: 'refused' }));
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect((gateway as any).clients.has(socket.id), 'identity forgotten').toBe(false);
  });

  it('concurrent actions past the bound share one re-validation (DB load is bounded per socket)', async () => {
    const socket = await connected();
    wsAuth.authenticateSocket.mockClear();
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await Promise.all([gateway.handleTyping(socket), gateway.handleTyping(socket), gateway.handleTyping(socket)]);
    expect(wsAuth.authenticateSocket).toHaveBeenCalledTimes(1);
    expect(socket.to).toHaveBeenCalledTimes(3);
  });

  it('passive sockets: KEY_CORTEX_WS_SWEEP_MS after its last successful check each open socket is re-checked on the schedule; a revoked one is cut by the check that confirms it (and so leaves its rooms), a healthy one is kept; onModuleDestroy stops the schedule', async () => {
    gateway.afterInit((gateway as any).server);
    const healthy = await connected('s_ok');
    const revoked = await connected('s_bad');
    wsAuth.authenticateSocket.mockClear();
    wsAuth.authenticateSocket.mockImplementation(async (s: any) =>
      s.id === 's_bad' ? null : { userId: 'u1', email: null, role: 'USER' },
    );

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_SWEEP_MS - 1);
    expect(wsAuth.authenticateSocket, 'not due before KEY_CORTEX_WS_SWEEP_MS').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(wsAuth.authenticateSocket, 'both re-checked').toHaveBeenCalledTimes(2);
    expect(revoked.disconnect, 'one refusal is not a disconnect').not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_CONFIRM_MS);
    expect(revoked.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.objectContaining({ reason: 'refused' }));
    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(healthy.disconnect).not.toHaveBeenCalled();
    expect(gateway.getTotalConnections()).toBe(1);
    expect(gateway.getClientsForBusiness('b1')).toEqual(['s_ok']);

    (gateway as any).onModuleDestroy();
    wsAuth.authenticateSocket.mockClear();
    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_SWEEP_MS * 3);
    expect(wsAuth.authenticateSocket, 'no check after destroy').not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // R0-ID-F6b review repair. SEC-WS-1 / CR-2: the sweep awaited one socket after
  // another with no timeout and skipped every tick while one ran, so one hung
  // check stopped passive revocation for the whole instance, and one hung
  // re-validation held every later action of its socket. CR-1: a failure to
  // run the check was a revocation, so one blip permanently disconnected
  // healthy sockets. CR-3: a socket lived no longer than its handshake token,
  // with no in-band refresh.
  // -------------------------------------------------------------------------

  it('SEC-WS-1 / CR-2: a check that never settles holds up no other socket — a revoked socket beside it is cut on time; the hung one, never answered, is cut only once it has gone KEY_CORTEX_WS_MAX_UNVERIFIED_MS unverified', async () => {
    gateway.afterInit((gateway as any).server);
    const slow = await connected('s_slow');
    const bad = await connected('s_bad');
    wsAuth.authenticateSocket.mockClear();
    wsAuth.authenticateSocket.mockImplementation((s: any) =>
      s.id === 's_slow' ? new Promise(() => {}) : Promise.resolve(null),
    );

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_SWEEP_MS + KEY_CORTEX_WS_CONFIRM_MS);
    expect(bad.disconnect, 'the revoked socket').toHaveBeenCalledWith(true);
    expect(bad.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.objectContaining({ reason: 'refused' }));
    expect(slow.disconnect, 'no answer is not a refusal').not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_MAX_UNVERIFIED_MS - KEY_CORTEX_WS_SWEEP_MS - KEY_CORTEX_WS_CONFIRM_MS - 1);
    expect(slow.disconnect, 'not before the bound').not.toHaveBeenCalled();
    const slowChecks = wsAuth.authenticateSocket.mock.calls.filter(([s]: any[]) => s.id === 's_slow').length;
    expect(slowChecks, 'each timed-out check is retried, never more than one at a time').toBeGreaterThan(1);

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_TICK_MS + 1);
    expect(slow.disconnect).toHaveBeenCalledWith(true);
    expect(slow.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.objectContaining({ reason: 'unverified' }));
    expect(gateway.getTotalConnections()).toBe(0);
  });

  it('CR-2: a re-validation that never settles does not hold the socket’s later actions — the action waiting on it is refused at KEY_CORTEX_WS_CHECK_TIMEOUT_MS, and a later one, the provider healthy again, is checked afresh and performed', async () => {
    const socket = await connected();
    wsAuth.authenticateSocket.mockClear();
    wsAuth.authenticateSocket.mockImplementationOnce(() => new Promise(() => {}));
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);

    const first = gateway.handleApprove({ approvalId: 'ap0' }, socket);
    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_CHECK_TIMEOUT_MS - 1);
    expect(socket.emit, 'still waiting just inside the timeout').not.toHaveBeenCalledWith('key:error', expect.anything());
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(approval.approveAction).not.toHaveBeenCalled();
    expectRefusedNotCut(socket, 'timed out');

    await vi.advanceTimersByTimeAsync(60_000);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(wsAuth.authenticateSocket, 'a fresh check, not the hung one').toHaveBeenCalledTimes(2);
    expect(approval.approveAction).toHaveBeenCalledWith('ap1', expect.anything());
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('SEC-WS-1: scheduled checks run concurrently, KEY_CORTEX_WS_SWEEP_CONCURRENCY at once — with 100 sockets at 500ms a check the revoked one last in line is cut well within 60s of its revocation', async () => {
    gateway.afterInit((gateway as any).server);
    const sockets: any[] = [];
    for (let i = 0; i < 100; i++) sockets.push(await connected(`s${i}`));
    const last = sockets[99];
    let inFlight = 0;
    let maxInFlight = 0;
    wsAuth.authenticateSocket.mockImplementation((s: any) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          resolve(s.id === last.id ? null : { userId: 'u1', email: null, role: 'USER' });
        }, 500),
      );
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(last.disconnect, 'the revoked socket').toHaveBeenCalledWith(true);
    expect(sockets.slice(0, 99).filter((s) => s.disconnect.mock.calls.length > 0), 'no healthy socket').toEqual([]);
    expect(gateway.getTotalConnections()).toBe(99);
    expect(maxInFlight, 'never more than the cap').toBeLessThanOrEqual(KEY_CORTEX_WS_SWEEP_CONCURRENCY);
    expect(maxInFlight, 'concurrent, not one socket after another').toBe(KEY_CORTEX_WS_SWEEP_CONCURRENCY);
  });

  it('SEC-WS-1: the bound holds whatever the checks do — when none ever answers, every socket is cut at KEY_CORTEX_WS_MAX_UNVERIFIED_MS unverified, not before, and only KEY_CORTEX_WS_SWEEP_CONCURRENCY checks were started per timeout', async () => {
    gateway.afterInit((gateway as any).server);
    const sockets: any[] = [];
    for (let i = 0; i < 20; i++) sockets.push(await connected(`h${i}`));
    wsAuth.authenticateSocket.mockClear();
    wsAuth.authenticateSocket.mockImplementation(() => new Promise(() => {}));

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_SWEEP_MS + KEY_CORTEX_WS_CHECK_TIMEOUT_MS - 1);
    expect(wsAuth.authenticateSocket, 'the cap, until those time out').toHaveBeenCalledTimes(KEY_CORTEX_WS_SWEEP_CONCURRENCY);

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_MAX_UNVERIFIED_MS - KEY_CORTEX_WS_SWEEP_MS - KEY_CORTEX_WS_CHECK_TIMEOUT_MS);
    expect(sockets.filter((s) => s.disconnect.mock.calls.length > 0), 'not before the bound').toEqual([]);

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_TICK_MS);
    for (const s of sockets) {
      expect(s.disconnect, s.id).toHaveBeenCalledWith(true);
      expect(s.emit, s.id).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.objectContaining({ reason: 'unverified' }));
    }
    expect(gateway.getTotalConnections()).toBe(0);
  });

  it('CR-1: a failure to run the check is not a revocation — one tick of failed membership checks (false, what verifyBusinessMembership answers a Prisma error) disconnects none of 3 healthy sockets; the next check clears it', async () => {
    gateway.afterInit((gateway as any).server);
    const sockets = [await connected('s1'), await connected('s2'), await connected('s3')];
    wsAuth.verifyBusinessMembership.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_SWEEP_MS);
    expect(wsAuth.verifyBusinessMembership).toHaveBeenCalledTimes(3 + 3); // 3 at connect, 3 failed

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_CONFIRM_MS); // the DB is back
    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_SWEEP_MS * 3);
    for (const s of sockets) {
      expect(s.disconnect, s.id).not.toHaveBeenCalled();
      expect(s.emit, s.id).not.toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.anything());
    }
    expect(gateway.getTotalConnections()).toBe(3);

    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, sockets[0]);
    expect(approval.approveAction, 'and they act again').toHaveBeenCalledTimes(1);
  });

  it('CR-1: a blip during an action fails only that action, as it fails one HTTP request — refused with key:error, the socket kept; the next action, the provider answering again, is performed', async () => {
    const socket = await connected();
    wsAuth.authenticateSocket.mockResolvedValueOnce(null); // the blip: "no user"
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(approval.approveAction).not.toHaveBeenCalled();
    expectRefusedNotCut(socket, 'blip');

    vi.advanceTimersByTime(KEY_CORTEX_WS_CONFIRM_MS);
    await gateway.handleApprove({ approvalId: 'ap2' }, socket);
    expect(approval.approveAction).toHaveBeenCalledTimes(1);
    expect(approval.approveAction).toHaveBeenCalledWith('ap2', expect.anything());
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.anything());
    expect(gateway.getTotalConnections()).toBe(1);
  });

  it('CR-1: no answer neither confirms a refusal nor clears it — refused, then a throw, then refused again KEY_CORTEX_WS_CONFIRM_MS after the first: cut', async () => {
    const socket = await connected();
    wsAuth.authenticateSocket
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(null);
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expectRefusedNotCut(socket, 'refused');

    vi.advanceTimersByTime(KEY_CORTEX_WS_CONFIRM_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expectRefusedNotCut(socket, 'then no answer: does not confirm');

    vi.advanceTimersByTime(1);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(wsAuth.authenticateSocket, 'the pending refusal was kept, so this one confirms').toHaveBeenCalledTimes(1 + 3);
    expect(approval.approveAction).not.toHaveBeenCalled();
    expectCut(socket, 'confirmed');
  });

  it('CR-3: key:auth_refresh with a fresh token for the socket’s own user and business makes it the socket’s token — later re-checks use it, not the handshake token', async () => {
    const socket = await connected();
    wsAuth.authenticateToken.mockResolvedValue({ userId: 'u1', email: null, role: 'USER' });
    wsAuth.verifyBusinessMembership.mockClear();

    await gateway.handleAuthRefresh({ token: 'fresh' }, socket);

    expect(wsAuth.authenticateToken).toHaveBeenCalledWith('fresh');
    expect(wsAuth.verifyBusinessMembership).toHaveBeenCalledWith('u1', 'USER', 'b1');
    expect(socket.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_REFRESHED, expect.objectContaining({ timestamp: expect.any(String) }));

    wsAuth.authenticateSocket.mockClear();
    wsAuth.authenticateToken.mockClear();
    wsAuth.authenticateSocket.mockResolvedValue(null); // the handshake token has expired
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(wsAuth.authenticateSocket, 'the handshake token no longer governs').not.toHaveBeenCalled();
    expect(wsAuth.authenticateToken).toHaveBeenCalledWith('fresh');
    expect(approval.approveAction).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('CR-3: a refused refresh changes nothing — another user’s token, a token whose user is no longer a member, an unverifiable token, or no token at all; the handshake token still governs', async () => {
    const socket = await connected();
    const refused = (message: string) =>
      expect(socket.emit).toHaveBeenLastCalledWith('key:error', { message: expect.stringContaining(message) });

    wsAuth.authenticateToken.mockResolvedValueOnce({ userId: 'someone-else', email: null, role: 'OWNER' });
    await gateway.handleAuthRefresh({ token: 'other-user' }, socket);
    refused('Token refresh refused');

    wsAuth.authenticateToken.mockResolvedValueOnce({ userId: 'u1', email: null, role: 'USER' });
    wsAuth.verifyBusinessMembership.mockResolvedValueOnce(false);
    await gateway.handleAuthRefresh({ token: 'not-a-member' }, socket);
    refused('Token refresh refused');

    wsAuth.authenticateToken.mockResolvedValueOnce(null);
    await gateway.handleAuthRefresh({ token: 'expired' }, socket);
    refused('Token refresh refused');

    wsAuth.authenticateToken.mockClear();
    for (const data of [{}, { token: '' }, { token: 42 }, undefined]) {
      await gateway.handleAuthRefresh(data as any, socket);
      refused('Token refresh refused: no token');
    }
    expect(wsAuth.authenticateToken, 'nothing to verify').not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_REFRESHED, expect.anything());
    expect(socket.disconnect, 'a refused refresh is not a revocation').not.toHaveBeenCalled();

    wsAuth.authenticateSocket.mockClear();
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(wsAuth.authenticateSocket, 'still the handshake token').toHaveBeenCalledWith(socket);
    expect(approval.approveAction).toHaveBeenCalledTimes(1);

    const ghost = fakeSocket('ghost', { businessId: 'b1' });
    await gateway.handleAuthRefresh({ token: 'fresh' }, ghost);
    expect(ghost.emit).toHaveBeenCalledWith('key:error', { message: 'Not authenticated' });
  });

  it('CR-3: one refresh at a time — a second key:auth_refresh while one is checked is refused', async () => {
    const socket = await connected();
    let release!: (v: unknown) => void;
    wsAuth.authenticateToken.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = gateway.handleAuthRefresh({ token: 'fresh' }, socket);
    await gateway.handleAuthRefresh({ token: 'fresh-2' }, socket);
    expect(socket.emit).toHaveBeenCalledWith('key:error', { message: expect.stringContaining('already in progress') });
    release({ userId: 'u1', email: null, role: 'USER' });
    await first;
    expect(socket.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_REFRESHED, expect.anything());
    expect(wsAuth.authenticateToken).toHaveBeenCalledTimes(1);
  });

  it('CR-3: a refresh that passes clears a pending refusal (the handshake token just expired), and a check of the replaced token, answering late, decides nothing', async () => {
    gateway.afterInit((gateway as any).server);
    const socket = await connected();
    wsAuth.authenticateSocket.mockResolvedValue(null); // the handshake token has expired
    wsAuth.authenticateToken.mockResolvedValue({ userId: 'u1', email: null, role: 'USER' });
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expectRefusedNotCut(socket, 'expired handshake token');

    await gateway.handleAuthRefresh({ token: 'fresh' }, socket);
    expect(socket.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_REFRESHED, expect.anything());
    await gateway.handleApprove({ approvalId: 'ap2' }, socket);
    expect(approval.approveAction, 'served at once after the refresh').toHaveBeenCalledWith('ap2', expect.anything());

    // A check of the handshake token started before a later refresh, answering after it.
    let late!: (v: unknown) => void;
    wsAuth.authenticateToken.mockImplementationOnce(() => new Promise((r) => (late = r)));
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    const pending = gateway.handleTyping(socket); // re-checks with 'fresh' ...
    wsAuth.authenticateToken.mockResolvedValue({ userId: 'u1', email: null, role: 'USER' });
    await gateway.handleAuthRefresh({ token: 'fresher' }, socket); // ... which 'fresher' replaces
    late(null);
    await pending;

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_SWEEP_MS + KEY_CORTEX_WS_CONFIRM_MS * 2);
    expect(socket.disconnect, 'never cut').not.toHaveBeenCalled();
    expect(gateway.getTotalConnections()).toBe(1);
    expect(wsAuth.authenticateToken).toHaveBeenLastCalledWith('fresher');
  });
});

// The same, through the REAL KeyCortexWsAuthService (the HTTP AuthMiddleware
// decision over mocked Supabase / Prisma / Redis): each revocation the HTTP
// side has honoured since R0-ID-F2/F3 now cuts an already-open socket.
describe('ST-WS-R1 — through the real KeyCortexWsAuthService: each revocation cuts an open socket', () => {
  const ADMIN_SECRET = 'gateway-spec-admin-secret-not-real';
  const ADMIN = { id: 'admin_ws', email: 'admin-ws@example.com', role: 'SUPER_ADMIN' };
  const MEMBER = { id: 'member_ws', email: 'member-ws@example.com' };
  type Row = { role: string; deletedAt: Date | null; bannedAt: Date | null } | null;
  type State = { row: Row; member: boolean; keys: Map<string, string> };
  let priorSecret: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    priorSecret = process.env.ADMIN_JWT_SECRET;
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (priorSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = priorSecret;
  });

  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const nowS = () => Math.floor(Date.now() / 1000);
  /** Supabase-shaped; its signature is never checked here (getUserFromToken is the mocked verifier). */
  const supabaseJwt = () =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: MEMBER.id, aud: 'authenticated', iat: nowS() })}.sig`;
  const ACTIVE = (role: string): Row => ({ role, deletedAt: null, bannedAt: null });

  function harness(start: { row: Row; member: boolean; supabaseUser?: { id: string; email?: string } | null }) {
    const state: State = { row: start.row, member: start.member, keys: new Map() };
    const supabaseAuth = { getUserFromToken: vi.fn(async () => start.supabaseUser ?? null) };
    const prisma = {
      client: {
        user: { findUnique: vi.fn(async () => state.row) },
        business: { findFirst: vi.fn(async () => (state.member ? { id: 'b1' } : null)) },
      },
    };
    const redis = {
      get: vi.fn(async (k: string) => state.keys.get(k) ?? null),
      pttl: vi.fn(async (k: string) => (state.keys.has(k) ? -1 : -2)),
    };
    const service = new KeyCortexWsAuthService(supabaseAuth as any, prisma as any, redis as any);
    const approval = { approveAction: vi.fn(async () => ({ actionDescription: 'x' })), rejectAction: vi.fn() };
    const executor = { executeApprovedAction: vi.fn() };
    const gw = new KeyCortexGateway({} as any, approval as any, { emit: vi.fn() } as any, executor as any, service);
    (gw as any).server = { to: vi.fn(() => ({ emit: vi.fn() })) };
    return { state, gw, approval, executor };
  }

  const cases: Array<[string, Parameters<typeof harness>[0], 'admin' | 'supabase', (s: State) => void]> = [
    ['SUPER_ADMIN (no membership) banned', { row: ACTIVE('SUPER_ADMIN'), member: false }, 'admin', (s) => { s.row = { ...s.row!, bannedAt: new Date() }; }],
    ['SUPER_ADMIN (no membership) deleted', { row: ACTIVE('SUPER_ADMIN'), member: false }, 'admin', (s) => { s.row = { ...s.row!, deletedAt: new Date() }; }],
    ['SUPER_ADMIN (no membership) demoted to USER', { row: ACTIVE('SUPER_ADMIN'), member: false }, 'admin', (s) => { s.row = ACTIVE('USER'); }],
    ['SUPER_ADMIN User row hard-deleted', { row: ACTIVE('SUPER_ADMIN'), member: false }, 'admin', (s) => { s.row = null; }],
    ['admin token cut off by a logout (admin:user:<id>:revokedAt)', { row: ACTIVE('SUPER_ADMIN'), member: false }, 'admin', (s) => { s.keys.set(`admin:user:${ADMIN.id}:revokedAt`, String(Date.now() + 1)); }],
    ['member removed from the business', { row: ACTIVE('USER'), member: true, supabaseUser: MEMBER }, 'supabase', (s) => { s.member = false; }],
    ['member banned', { row: ACTIVE('USER'), member: true, supabaseUser: MEMBER }, 'supabase', (s) => { s.row = { ...s.row!, bannedAt: new Date() }; }],
    ['member logged out (auth:revoked:user:<id>)', { row: ACTIVE('USER'), member: true, supabaseUser: MEMBER }, 'supabase', (s) => { s.keys.set(`auth:revoked:user:${MEMBER.id}`, String(nowS())); }],
  ];

  for (const [label, start, kind, revoke] of cases) {
    it(`${label}: the open socket's next key:approve is refused, nothing is approved or executed, the socket is disconnected by the check that confirms it`, async () => {
      const h = harness(start);
      const token = kind === 'admin' ? buildAdminToken(ADMIN, ADMIN_SECRET) : supabaseJwt();
      const socket = fakeSocket('s_real', { authToken: token, businessId: 'b1' });
      await h.gw.handleConnection(socket);
      expect(socket.disconnect, `${label}: connect control`).not.toHaveBeenCalled();

      // Positive control past the bound: still served.
      vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
      await h.gw.handleApprove({ approvalId: 'ap0' }, socket);
      expect(h.approval.approveAction, `${label}: healthy control`).toHaveBeenCalledTimes(1);

      revoke(h.state);
      vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
      await h.gw.handleApprove({ approvalId: 'ap1' }, socket);
      expect(h.approval.approveAction, `${label}: refused at once`).toHaveBeenCalledTimes(1);
      expect(socket.emit, `${label}: told so`).toHaveBeenCalledWith('key:error', { message: KEY_CORTEX_WS_RECHECK_REFUSED });
      expect(socket.disconnect, `${label}: one refusal is not a disconnect`).not.toHaveBeenCalled();

      vi.advanceTimersByTime(KEY_CORTEX_WS_CONFIRM_MS);
      await h.gw.handleApprove({ approvalId: 'ap2' }, socket);

      expect(h.approval.approveAction, label).toHaveBeenCalledTimes(1);
      expect(h.executor.executeApprovedAction, label).toHaveBeenCalledTimes(1);
      expect(socket.emit, label).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.objectContaining({ reason: 'refused' }));
      expect(socket.disconnect, label).toHaveBeenCalledWith(true);
      expect(h.gw.getTotalConnections(), label).toBe(0);
    });
  }

  it('CR-3: a healthy SUPER_ADMIN socket lives no longer than its 24h admin token (an HTTP request with it is refused too) — unless it sends key:auth_refresh with a fresh one before the expiry, which keeps it served past it', async () => {
    const h = harness({ row: ACTIVE('SUPER_ADMIN'), member: false });
    const stale = fakeSocket('s_stale', { authToken: buildAdminToken(ADMIN, ADMIN_SECRET), businessId: 'b1' });
    const kept = fakeSocket('s_kept', { authToken: buildAdminToken(ADMIN, ADMIN_SECRET), businessId: 'b1' });
    await h.gw.handleConnection(stale);
    await h.gw.handleConnection(kept);

    // A minute before the handshake tokens expire, both are served.
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 - 60_000);
    await h.gw.handleApprove({ approvalId: 'ap0' }, stale);
    await h.gw.handleApprove({ approvalId: 'ap0' }, kept);
    expect(h.approval.approveAction).toHaveBeenCalledTimes(2);

    // Refused: another identity's token is not this socket's (the row lookup answers for whoever asks).
    await h.gw.handleAuthRefresh({ token: buildAdminToken({ ...ADMIN, id: 'other_admin' }, ADMIN_SECRET) }, kept);
    expect(kept.emit).toHaveBeenLastCalledWith('key:error', { message: expect.stringContaining('Token refresh refused') });
    await h.gw.handleAuthRefresh({ token: buildAdminToken(ADMIN, ADMIN_SECRET) }, kept);
    expect(kept.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_REFRESHED, expect.anything());

    vi.advanceTimersByTime(60_000 + 1); // past the handshake tokens' expiry
    await h.gw.handleApprove({ approvalId: 'ap1' }, stale);
    vi.advanceTimersByTime(KEY_CORTEX_WS_CONFIRM_MS);
    await h.gw.handleApprove({ approvalId: 'ap1' }, stale);
    expect(stale.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.anything());
    expect(stale.disconnect).toHaveBeenCalledWith(true);

    await h.gw.handleApprove({ approvalId: 'ap2' }, kept);
    expect(h.approval.approveAction).toHaveBeenLastCalledWith('ap2', expect.objectContaining({ approvedBy: ADMIN.id }));
    expect(h.approval.approveAction).toHaveBeenCalledTimes(3);
    expect(kept.disconnect).not.toHaveBeenCalled();
    expect(h.gw.getClientsForBusiness('b1')).toEqual(['s_kept']);
  });
});
