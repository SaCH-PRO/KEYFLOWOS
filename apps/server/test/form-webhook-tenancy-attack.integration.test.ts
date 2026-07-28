/**
 * Connectors Certification — cross-tenant attack suite: form webhook tenancy (REAL database).
 *
 * The form webhook authenticates a public POST to `/webhooks/forms/:businessId/:type`
 * using a PER-BUSINESS secret (stored encrypted via ConnectorCredentialsService,
 * compared against the `x-keyflow-signature` header). This is the only webhook
 * whose tenant is authenticated by a per-business secret, so it carries the full
 * cross-business secret matrix.
 *
 * EXIT CRITERIA (Tenant Isolation — form webhook):
 *   [x] correct business + correct secret succeeds
 *   [x] correct business + wrong secret fails
 *   [x] Business A URL + Business B secret fails
 *   [x] Business B URL + Business A secret fails
 *   [x] missing secret fails
 *   [x] denied requests never reach ingestion (no inbox record created)
 *   [x] the logged signature header is redacted (no secret persisted)
 *
 * Only the form connector's ingestSubmission (the internal ingestion boundary)
 * is stubbed to isolate the auth gate; the secret store, signature check, DB and
 * log sink are all real.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'tfw_';
const SECRET_A = 'whsec_formA_do_not_leak';
const SECRET_B = 'whsec_formB_do_not_leak';
const TYPE = 'webhook_form';
const ID = { userA: `${P}userA`, userB: `${P}userB`, bizA: `${P}bizA`, bizB: `${P}bizB` };

let db: any;
let controller: any;
let ingest: ReturnType<typeof vi.fn>;

async function cleanup() {
  for (const sql of [
    `DELETE FROM webhook_delivery_logs WHERE business_id LIKE '${P}%'`,
    `DELETE FROM connector_statuses WHERE business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

// Call the controller and report whether it resolved (allowed) or threw (denied).
async function post(businessId: string, signature: string | undefined) {
  try {
    const res = await controller.ingest(businessId, TYPE, signature, { formId: 'f1', email: 'a@b.co' });
    return { ok: true, res };
  } catch (e: any) {
    return { ok: false, status: e?.status, name: e?.constructor?.name };
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { FormWebhookController } = await import('../src/core/connectors/form-webhook.controller');
  const prisma = new PrismaService();
  const credentials = new ConnectorCredentialsService(prisma as any);
  const webhookLogger = new WebhookIngressLoggerService(prisma as any);

  ingest = vi.fn().mockResolvedValue({ contactId: `${P}contact` });
  const registry = { get: () => ({ ingestSubmission: ingest }) } as any; // only the internal ingestion is stubbed
  controller = new FormWebhookController(registry, credentials, webhookLogger);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'A', ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'B', ownerId: ID.userB } });
  await credentials.setCredentials(ID.bizA, TYPE, { webhookSecret: SECRET_A });
  await credentials.setCredentials(ID.bizB, TYPE, { webhookSecret: SECRET_B });
}, 60_000);

afterAll(async () => { if (db) await cleanup(); });

describe('Form webhook — per-business secret matrix', () => {
  it('correct business + correct secret SUCCEEDS', async () => {
    ingest.mockClear();
    const r = await post(ID.bizA, SECRET_A);
    expect(r.ok).toBe(true);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('correct business + WRONG secret fails and never ingests', async () => {
    ingest.mockClear();
    const r = await post(ID.bizA, 'not-the-secret');
    expect(r.ok).toBe(false);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('Business A URL + Business B secret fails (cross-tenant)', async () => {
    ingest.mockClear();
    const r = await post(ID.bizA, SECRET_B);
    expect(r.ok).toBe(false);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('Business B URL + Business A secret fails (cross-tenant)', async () => {
    ingest.mockClear();
    const r = await post(ID.bizB, SECRET_A);
    expect(r.ok).toBe(false);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('missing secret fails', async () => {
    ingest.mockClear();
    const r = await post(ID.bizA, undefined);
    expect(r.ok).toBe(false);
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('Form webhook — denied requests do not leak the secret into logs', () => {
  it('the persisted delivery log redacts x-keyflow-signature', async () => {
    await post(ID.bizA, SECRET_B); // a denied cross-tenant attempt is logged
    const rows = await db.webhookDeliveryLog.findMany({ where: { businessId: ID.bizA } });
    for (const row of rows) {
      const headers = (row.headers ?? {}) as Record<string, unknown>;
      if ('x-keyflow-signature' in headers) {
        expect(headers['x-keyflow-signature']).toBe('[REDACTED]');
      }
      expect(JSON.stringify(row).includes(SECRET_B)).toBe(false);
      expect(JSON.stringify(row).includes(SECRET_A)).toBe(false);
    }
  });
});
