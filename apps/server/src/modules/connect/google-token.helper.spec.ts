/**
 * R0-CMF6c review SEC-CMF6c-1: GoogleTokenHelper.getValidAccessToken (the
 * gmail sync's token read, GmailIngestionService) writes a refreshed gmail
 * access token back only onto the connection it was refreshed for, as
 * GmailService.getValidAccessToken does (R0-CMF6c U19, U20). The real-database
 * proof is test/gmail-connect-binding.integration.test.ts (N05, N06, L08); this
 * pins the shape the database cannot show (the row lock is the transaction's
 * first statement; business.update, never updateMany) and the lost-race
 * contract. The other services' columns keep the plain write-back.
 *
 * A fake client whose business reads answer from a script (outside the
 * transaction: the read that decides to refresh; inside it: the re-read under
 * the business row lock), recording every call; Google's refresh_token grant
 * answers `acc_for_<refresh token>`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleTokenHelper } from './google-token.helper';

const BIZ = 'biz_cmf6c_helper';
const GMAIL = { access: 'gmailAccessToken', refresh: 'gmailRefreshToken', expiry: 'gmailTokenExpiry' } as const;
const CALENDAR = { access: 'calendarAccessToken', refresh: 'calendarRefreshToken', expiry: 'calendarTokenExpiry' } as const;

interface Call { model: string; method: string; args: any }
const WRITE_METHODS = new Set(['update', 'updateMany', 'upsert', 'create', 'delete', 'deleteMany']);

function refreshFake(script: { outer: any[]; locked: any[] }) {
  const calls: Call[] = [];
  let inTx = false;
  const client: any = {
    business: {
      findUnique: async (args: any) => {
        calls.push({ model: 'business', method: inTx ? 'findUnique:locked' : 'findUnique', args });
        const next = (inTx ? script.locked : script.outer).shift();
        if (next === undefined) throw new Error(`unit: unscripted business read (${inTx ? 'locked' : 'outer'})`);
        return next;
      },
      update: async (args: any) => {
        calls.push({ model: 'business', method: inTx ? 'update:locked' : 'update', args });
        return { id: args.where.id, ...args.data };
      },
      updateMany: async (args: any) => {
        calls.push({ model: 'business', method: 'updateMany', args });
        return { count: 1 };
      },
    },
  };
  client.$transaction = async (fn: (tx: any) => Promise<unknown>) => {
    calls.push({ model: '$transaction', method: 'begin', args: null });
    inTx = true;
    try {
      return await fn(client);
    } finally {
      inTx = false;
    }
  };
  client.$queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ model: '$queryRaw', method: 'raw', args: { sql: strings.join('?'), values } });
    return [];
  };
  const writes = () => calls.filter((c) => WRITE_METHODS.has(c.method.replace(/:locked$/, '')));
  return { prisma: { client } as any, calls, writes };
}

const refreshGrants: string[] = [];

const expired = (email: string | null, refresh: string | null) => ({
  gmailEmail: email, gmailAccessToken: 'acc_stale', gmailRefreshToken: refresh, gmailTokenExpiry: new Date(Date.now() - 60 * 60 * 1000),
});
const live = (email: string, refresh: string, access: string) => ({
  gmailEmail: email, gmailAccessToken: access, gmailRefreshToken: refresh, gmailTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
});

describe('GoogleTokenHelper — a refreshed gmail access token is written back only onto the connection it was refreshed for (R0-CMF6c review SEC-CMF6c-1)', () => {
  beforeEach(() => {
    refreshGrants.length = 0;
    vi.stubEnv('GOOGLE_CLIENT_ID', 'unit-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'unit-client-secret');
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = String(input);
      const body = new URLSearchParams(String(init?.body ?? ''));
      if (url === 'https://oauth2.googleapis.com/token' && body.get('grant_type') === 'refresh_token') {
        refreshGrants.push(String(body.get('refresh_token')));
        return new Response(JSON.stringify({ access_token: `acc_for_${body.get('refresh_token')}`, expires_in: 3600 }), { status: 200 });
      }
      throw new Error(`unit: unexpected fetch ${url}`);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('[R0-CMF6c-T01] gmail columns: the write is made in a transaction whose first statement is the business row lock, after a re-read showing the refresh token and mailbox the refresh used, through business.update (the token-encryption extension encrypts it; never updateMany); the refreshed token is returned', async () => {
    const f = refreshFake({ outer: [expired('a@gmail.test', 'ref_a')], locked: [{ gmailEmail: 'a@gmail.test', gmailRefreshToken: 'ref_a' }] });
    const helper = new GoogleTokenHelper(f.prisma);
    await expect(helper.getValidAccessToken(BIZ, GMAIL, 'Gmail')).resolves.toBe('acc_for_ref_a');
    expect(refreshGrants).toEqual(['ref_a']);
    expect(f.calls[0]).toMatchObject({ model: 'business', method: 'findUnique', args: { where: { id: BIZ } } });
    expect(f.calls[0].args.select).toMatchObject({ gmailEmail: true, gmailRefreshToken: true, gmailAccessToken: true, gmailTokenExpiry: true });
    const begin = f.calls.findIndex((c) => c.model === '$transaction');
    expect(begin).toBe(1);
    expect(f.calls[begin + 1]).toMatchObject({ model: '$queryRaw' });
    expect(f.calls[begin + 1].args.sql).toMatch(/FROM\s+businesses\s+WHERE\s+id\s*=\s*\?\s+FOR\s+NO\s+KEY\s+UPDATE/i);
    expect(f.calls[begin + 1].args.values).toEqual([BIZ]);
    expect(f.calls[begin + 2]).toMatchObject({
      model: 'business',
      method: 'findUnique:locked',
      args: { where: { id: BIZ }, select: { gmailEmail: true, gmailRefreshToken: true } },
    });
    expect(f.writes()).toEqual([f.calls[begin + 3]]);
    expect(f.writes()[0]).toMatchObject({
      method: 'update:locked',
      args: { where: { id: BIZ }, data: { gmailAccessToken: 'acc_for_ref_a', gmailTokenExpiry: expect.any(Date) } },
    });
    expect(Object.keys(f.writes()[0].args.data).sort()).toEqual(['gmailAccessToken', 'gmailTokenExpiry']);
  });

  it('[R0-CMF6c-T02] gmail columns, a lost race writes nothing and reads again, once: a disconnect fails "Gmail was disconnected while its access token was refreshed"; another mailbox or a re-consent with a live token gives that token; an expired one is refreshed for that connection; two lost races in a row fail after two refreshes and no write', async () => {
    const off = refreshFake({ outer: [expired('a@gmail.test', 'ref_a'), expired(null, null)], locked: [{ gmailEmail: null, gmailRefreshToken: null }] });
    await expect(new GoogleTokenHelper(off.prisma).getValidAccessToken(BIZ, GMAIL, 'Gmail')).rejects.toThrow(
      'Gmail was disconnected while its access token was refreshed',
    );
    expect(off.writes()).toEqual([]);
    expect(refreshGrants).toEqual(['ref_a']);

    refreshGrants.length = 0;
    const swapped = refreshFake({
      outer: [expired('a@gmail.test', 'ref_a'), live('b@gmail.test', 'ref_b', 'acc_b')],
      locked: [{ gmailEmail: 'b@gmail.test', gmailRefreshToken: 'ref_b' }],
    });
    await expect(new GoogleTokenHelper(swapped.prisma).getValidAccessToken(BIZ, GMAIL, 'Gmail')).resolves.toBe('acc_b');
    expect(swapped.writes()).toEqual([]);
    expect(refreshGrants).toEqual(['ref_a']);

    // The address alone is not the predicate: a re-consent of the same mailbox (a new refresh token) wins.
    refreshGrants.length = 0;
    const reconsented = refreshFake({
      outer: [expired('a@gmail.test', 'ref_a'), live('a@gmail.test', 'ref_a2', 'acc_a2')],
      locked: [{ gmailEmail: 'a@gmail.test', gmailRefreshToken: 'ref_a2' }],
    });
    await expect(new GoogleTokenHelper(reconsented.prisma).getValidAccessToken(BIZ, GMAIL, 'Gmail')).resolves.toBe('acc_a2');
    expect(reconsented.writes()).toEqual([]);
    expect(refreshGrants).toEqual(['ref_a']);

    // The refresh token alone is not the predicate either: the same refresh token under another address loses.
    refreshGrants.length = 0;
    const readdressed = refreshFake({
      outer: [expired('a@gmail.test', 'ref_a'), live('b@gmail.test', 'ref_a', 'acc_b')],
      locked: [{ gmailEmail: 'b@gmail.test', gmailRefreshToken: 'ref_a' }],
    });
    await expect(new GoogleTokenHelper(readdressed.prisma).getValidAccessToken(BIZ, GMAIL, 'Gmail')).resolves.toBe('acc_b');
    expect(readdressed.writes()).toEqual([]);

    // Another connection whose token has expired too is refreshed for that connection and written onto it.
    refreshGrants.length = 0;
    const next = refreshFake({
      outer: [expired('a@gmail.test', 'ref_a'), expired('b@gmail.test', 'ref_b')],
      locked: [{ gmailEmail: 'b@gmail.test', gmailRefreshToken: 'ref_b' }, { gmailEmail: 'b@gmail.test', gmailRefreshToken: 'ref_b' }],
    });
    await expect(new GoogleTokenHelper(next.prisma).getValidAccessToken(BIZ, GMAIL, 'Gmail')).resolves.toBe('acc_for_ref_b');
    expect(refreshGrants).toEqual(['ref_a', 'ref_b']);
    expect(next.writes()).toEqual([
      expect.objectContaining({ method: 'update:locked', args: expect.objectContaining({ data: expect.objectContaining({ gmailAccessToken: 'acc_for_ref_b' }) }) }),
    ]);

    refreshGrants.length = 0;
    const churn = refreshFake({
      outer: [expired('a@gmail.test', 'ref_a'), expired('b@gmail.test', 'ref_b')],
      locked: [{ gmailEmail: 'b@gmail.test', gmailRefreshToken: 'ref_b' }, { gmailEmail: 'c@gmail.test', gmailRefreshToken: 'ref_c' }],
    });
    await expect(new GoogleTokenHelper(churn.prisma).getValidAccessToken(BIZ, GMAIL, 'Gmail')).rejects.toThrow(
      'Gmail was disconnected or replaced while its access token was refreshed',
    );
    expect(churn.writes()).toEqual([]);
    expect(refreshGrants).toEqual(['ref_a', 'ref_b']);
  });

  it('[R0-CMF6c-T03] unchanged: a gmail token still valid is returned with no refresh and no write; no refresh token is "Gmail not connected"; the other services\' columns (calendar) keep the plain write-back, with no transaction', async () => {
    const valid = refreshFake({ outer: [live('a@gmail.test', 'ref_a', 'acc_a')], locked: [] });
    await expect(new GoogleTokenHelper(valid.prisma).getValidAccessToken(BIZ, GMAIL, 'Gmail')).resolves.toBe('acc_a');
    expect(valid.writes()).toEqual([]);
    expect(refreshGrants).toEqual([]);

    const none = refreshFake({ outer: [expired(null, null)], locked: [] });
    await expect(new GoogleTokenHelper(none.prisma).getValidAccessToken(BIZ, GMAIL, 'Gmail')).rejects.toThrow('Gmail not connected');
    expect(none.writes()).toEqual([]);
    expect(refreshGrants).toEqual([]);

    const calendar = refreshFake({
      outer: [{ calendarAccessToken: 'cal_stale', calendarRefreshToken: 'cal_ref', calendarTokenExpiry: new Date(Date.now() - 60 * 60 * 1000) }],
      locked: [],
    });
    await expect(new GoogleTokenHelper(calendar.prisma).getValidAccessToken(BIZ, CALENDAR, 'Google Calendar')).resolves.toBe('acc_for_cal_ref');
    expect(calendar.calls[0].args.select).not.toHaveProperty('gmailEmail');
    expect(calendar.calls.some((c) => c.model === '$transaction' || c.model === '$queryRaw')).toBe(false);
    expect(calendar.writes()).toEqual([
      { model: 'business', method: 'update', args: { where: { id: BIZ }, data: { calendarAccessToken: 'acc_for_cal_ref', calendarTokenExpiry: expect.any(Date) } } },
    ]);
  });
});
