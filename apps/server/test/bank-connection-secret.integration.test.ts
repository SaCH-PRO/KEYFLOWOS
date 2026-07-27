/**
 * Phase 2 Increment 2 — BankConnection secret-disclosure boundary (REAL database).
 *
 * BankConnection is a SECRET_CREDENTIAL model: it stores a bank/aggregator
 * `accessToken` (plaintext). The read paths (list/get) and mutation returns
 * previously returned the FULL record, so the access token was serialized into
 * API responses to any authenticated business member.
 *
 * These tests prove the token no longer leaves the service boundary, while the
 * value remains stored (we only strip it from responses) and cross-tenant
 * access stays denied. A sentinel value is used; assertions only check
 * presence/absence and equality to the known fixture — the secret is never
 * printed or snapshotted.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 't2b_';
const SENTINEL_A = 'sk_sentinel_A_do_not_leak';
const SENTINEL_B = 'sk_sentinel_B_do_not_leak';
const ID = {
  userA: `${P}userA`, userB: `${P}userB`,
  bizA: `${P}bizA`, bizB: `${P}bizB`,
  coaA: `${P}coaA`, coaB: `${P}coaB`,
  faA: `${P}faA`, faB: `${P}faB`,
  connA: `${P}connA`, connB: `${P}connB`,
};

let db: any;
let svc: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM bank_connections WHERE id LIKE '${P}%'`,
    `DELETE FROM financial_accounts WHERE id LIKE '${P}%'`,
    `DELETE FROM chart_of_accounts WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { BankConnectionService } = await import('../src/modules/finance/bank-connection.service');
  svc = new BankConnectionService(new PrismaService() as any);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'A', ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'B', ownerId: ID.userB } });
  await db.chartOfAccount.create({ data: { id: ID.coaA, businessId: ID.bizA, name: 'Bank', type: 'ASSET' } });
  await db.chartOfAccount.create({ data: { id: ID.coaB, businessId: ID.bizB, name: 'Bank', type: 'ASSET' } });
  await db.financialAccount.create({ data: { id: ID.faA, businessId: ID.bizA, chartOfAccountId: ID.coaA, name: 'Checking', type: 'BANK' } });
  await db.financialAccount.create({ data: { id: ID.faB, businessId: ID.bizB, chartOfAccountId: ID.coaB, name: 'Checking', type: 'BANK' } });
  await db.bankConnection.create({ data: { id: ID.connA, businessId: ID.bizA, financialAccountId: ID.faA, provider: 'plaid', accessToken: SENTINEL_A } });
  await db.bankConnection.create({ data: { id: ID.connB, businessId: ID.bizB, financialAccountId: ID.faB, provider: 'plaid', accessToken: SENTINEL_B } });
}, 60_000);

afterAll(async () => { if (db) await cleanup(); });

describe('BankConnection — secret does not leave the service boundary', () => {
  it('list() does not include accessToken', async () => {
    const items = await svc.list(ID.bizA);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect('accessToken' in item).toBe(false);
    }
  });

  it('get() does not include accessToken', async () => {
    const conn = await svc.get(ID.bizA, ID.connA);
    expect('accessToken' in conn).toBe(false);
  });

  it('update() return does not include accessToken', async () => {
    const updated = await svc.update(ID.bizA, ID.connA, { status: 'ACTIVE' });
    expect('accessToken' in updated).toBe(false);
  });

  it('the token remains stored (only the response is stripped)', async () => {
    const raw = await db.bankConnection.findUnique({ where: { id: ID.connA } });
    expect(raw.accessToken).toBe(SENTINEL_A); // compared to known fixture, never printed
  });
});

describe('BankConnection — cross-tenant access remains denied', () => {
  it('Business A cannot get Business B connection by id', async () => {
    await expect(svc.get(ID.bizA, ID.connB)).rejects.toThrow();
  });

  it('Business A cannot update Business B connection', async () => {
    await expect(svc.update(ID.bizA, ID.connB, { status: 'DISCONNECTED' })).rejects.toThrow();
    const raw = await db.bankConnection.findUnique({ where: { id: ID.connB } });
    expect(raw.status).not.toBe('DISCONNECTED');
    expect(raw.accessToken).toBe(SENTINEL_B); // B's secret unchanged
  });
});
