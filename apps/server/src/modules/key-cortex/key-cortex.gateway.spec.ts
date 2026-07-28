import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexGateway } from './key-cortex.gateway';

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
