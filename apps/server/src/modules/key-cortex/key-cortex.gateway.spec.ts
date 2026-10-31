import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  KeyCortexGateway,
  KEY_CORTEX_WS_REVALIDATE_MS,
  KEY_CORTEX_WS_SWEEP_MS,
  KEY_CORTEX_WS_AUTH_ERROR,
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
// ST-WS-R1 (R0-ID-F6 review; R0-ID-F6b-WS-LIVE-REVOCATION). The gateway decided
// at connect only: handleConnection stored { userId, businessId } and every
// handler trusted it for the socket's lifetime, so a socket opened before a ban,
// a delete, a demotion, a removal from the business or a logout kept approving,
// rejecting, chatting and broadcasting in its tenant, and kept its room pushes.
// Required: before every client action the gateway re-takes the connect-time
// decision for that socket — KeyCortexWsAuthService.authenticateSocket (the HTTP
// AuthMiddleware decision for the handshake token: User row, deletedAt,
// bannedAt, role from the row, the logout and admin-token cutoffs) and
// verifyBusinessMembership for the socket's own businessId — and on failure it
// emits an auth error and disconnects the socket without acting. A successful
// check is reused for at most KEY_CORTEX_WS_REVALIDATE_MS; a sweep every
// KEY_CORTEX_WS_SWEEP_MS cuts a revoked socket that sends nothing.
// ---------------------------------------------------------------------------
describe('ST-WS-R1 — an open socket re-validates its principal before every action', () => {
  let reasoning: any;
  let approval: any;
  let event: any;
  let executor: any;
  let wsAuth: { authenticateSocket: ReturnType<typeof vi.fn>; verifyBusinessMembership: ReturnType<typeof vi.fn> };
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

  it('pins the bounds: a check is reused for at most a few seconds, the passive-socket sweep runs at least once a minute', () => {
    expect(KEY_CORTEX_WS_REVALIDATE_MS).toBe(2_000);
    expect(KEY_CORTEX_WS_REVALIDATE_MS).toBeLessThanOrEqual(5_000);
    expect(KEY_CORTEX_WS_SWEEP_MS).toBeGreaterThan(KEY_CORTEX_WS_REVALIDATE_MS);
    expect(KEY_CORTEX_WS_SWEEP_MS).toBeLessThanOrEqual(60_000);
    expect(KEY_CORTEX_WS_AUTH_ERROR).toBe('key:auth_error');
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
  });

  for (const [label, act, acted] of actions) {
    it(`${label}: after the row is banned or deleted or the session logged out (authenticateSocket refuses), the open socket is cut without acting`, async () => {
      const socket = await connected();
      wsAuth.authenticateSocket.mockResolvedValue(null);
      vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);

      await act(socket);

      expect(acted(socket), `${label} acted`).toBe(false);
      expectCut(socket, label);
      expect(gateway.getTotalConnections()).toBe(0);
    });
  }

  it('demoted below the connect authority: a SUPER_ADMIN with no membership whose row is now USER is cut (the role is read fresh, not kept from connect)', async () => {
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'admin1', email: null, role: 'SUPER_ADMIN' });
    wsAuth.verifyBusinessMembership.mockImplementation(async (_u: string, role: string) => role === 'SUPER_ADMIN');
    const socket = await connected('s1', 'foreign_biz');

    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'admin1', email: null, role: 'USER' });
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);

    expect(wsAuth.verifyBusinessMembership).toHaveBeenLastCalledWith('admin1', 'USER', 'foreign_biz');
    expect(approval.approveAction).not.toHaveBeenCalled();
    expectCut(socket, 'demoted');
  });

  it('removed from the business: the identity is still valid but its membership of the socket’s businessId is gone — cut', async () => {
    const socket = await connected();
    wsAuth.verifyBusinessMembership.mockResolvedValue(false);
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleReject({ approvalId: 'ap1' }, socket);
    expect(approval.rejectAction).not.toHaveBeenCalled();
    expectCut(socket, 'removed');
  });

  it('a different identity behind the socket is not this socket’s principal — cut', async () => {
    const socket = await connected();
    wsAuth.authenticateSocket.mockResolvedValue({ userId: 'someone-else', email: null, role: 'SUPER_ADMIN' });
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleChat({ text: 'hi' }, socket);
    expect(reasoning.streamReasoning).not.toHaveBeenCalled();
    expectCut(socket, 'other identity');
  });

  it('a check that throws fails closed — cut', async () => {
    const socket = await connected();
    wsAuth.verifyBusinessMembership.mockRejectedValue(new Error('db down'));
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await gateway.handleApprove({ approvalId: 'ap1' }, socket);
    expect(approval.approveAction).not.toHaveBeenCalled();
    expectCut(socket, 'throws');
  });

  it('the bound: a ban written now takes effect KEY_CORTEX_WS_REVALIDATE_MS after the last successful check, not later; within it the check is reused, not re-queried', async () => {
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
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('concurrent actions past the bound share one re-validation (DB load is bounded per socket)', async () => {
    const socket = await connected();
    wsAuth.authenticateSocket.mockClear();
    vi.advanceTimersByTime(KEY_CORTEX_WS_REVALIDATE_MS);
    await Promise.all([gateway.handleTyping(socket), gateway.handleTyping(socket), gateway.handleTyping(socket)]);
    expect(wsAuth.authenticateSocket).toHaveBeenCalledTimes(1);
    expect(socket.to).toHaveBeenCalledTimes(3);
  });

  it('passive sockets: every KEY_CORTEX_WS_SWEEP_MS each open socket is re-validated; a revoked one is cut (and so leaves its rooms), a healthy one is kept; onModuleDestroy stops the sweep', async () => {
    gateway.afterInit((gateway as any).server);
    const healthy = await connected('s_ok');
    const revoked = await connected('s_bad');
    wsAuth.authenticateSocket.mockImplementation(async (s: any) =>
      s.id === 's_bad' ? null : { userId: 'u1', email: null, role: 'USER' },
    );

    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_SWEEP_MS);

    expect(revoked.emit).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.anything());
    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(healthy.disconnect).not.toHaveBeenCalled();
    expect(gateway.getTotalConnections()).toBe(1);
    expect(gateway.getClientsForBusiness('b1')).toEqual(['s_ok']);

    (gateway as any).onModuleDestroy();
    wsAuth.authenticateSocket.mockClear();
    await vi.advanceTimersByTimeAsync(KEY_CORTEX_WS_SWEEP_MS * 3);
    expect(wsAuth.authenticateSocket, 'no sweep after destroy').not.toHaveBeenCalled();
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
    it(`${label}: the open socket's next key:approve is refused, nothing is approved or executed, the socket is disconnected`, async () => {
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

      expect(h.approval.approveAction, label).toHaveBeenCalledTimes(1);
      expect(h.executor.executeApprovedAction, label).toHaveBeenCalledTimes(1);
      expect(socket.emit, label).toHaveBeenCalledWith(KEY_CORTEX_WS_AUTH_ERROR, expect.anything());
      expect(socket.disconnect, label).toHaveBeenCalledWith(true);
      expect(h.gw.getTotalConnections(), label).toBe(0);
    });
  }
});
