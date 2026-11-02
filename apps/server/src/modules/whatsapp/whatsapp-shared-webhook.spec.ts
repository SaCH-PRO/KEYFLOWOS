/**
 * V1-21b review 8 FB-1 — the shared WhatsApp webhook routes nothing Meta did not sign.
 *
 * POST /whatsapp/webhook is Meta's one callback URL for every business: it routes a message to
 * the business whose config owns the payload's phone_number_id, which sits in Meta's envelope
 * (entry[0].changes[0].value.metadata). It checked a signature only when the body parsed as Meta,
 * and parseInboundPayload took any body with a string `From` for Twilio. So an unsigned body with
 * a `From` AND a Meta envelope was read as Twilio (no check), routed by the Meta field to the
 * business, and handed to WhatsAppService.receiveInbound -> StaffChatBridgeService, which answers
 * a staff position by its phone: the sender got that position's issued envelope (KEY ran
 * commerce_create_invoice as 'Bookkeeper' in the review's probe), and a 'YES' body resolved the
 * position's pending approval. Any member can read the business's phoneNumberId (GET
 * whatsapp/businesses/:id/config). The envelope is only as bound to its holder as the message is
 * to its sender.
 *
 * Now nothing in the body is read until Meta's signature covers it, and the shared route reads
 * the Meta shape only: the sender is the signed message's, never a top-level `From`.
 *
 * The app here is the real controller behind the production bootstrap (configureNestApp: the
 * global ValidationPipe and exception filter) with the raw body kept, as main.ts keeps it.
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { WebhookIngressLoggerService } from '../../core/connectors/webhook-ingress-logger.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { configureNestApp } from '../../app-bootstrap';

const APP_SECRET = 'fb1_meta_app_secret';
const TWILIO_TOKEN = 'fb1_twilio_auth_token';
const PNID = '1234567890';
const STAFF_PHONE = '+18685550919';

const metaSignature = (raw: string) => `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
const twilioSignature = (url: string, params: Record<string, string>) =>
  createHmac('sha256', TWILIO_TOKEN)
    .update(Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url))
    .digest('base64');

const metaEnvelope = (messages?: unknown[]) => [{ changes: [{ value: { metadata: { phone_number_id: PNID }, ...(messages ? { messages } : {}) } }] }];

describe('POST /whatsapp/webhook routes nothing Meta did not sign (V1-21b review 8 FB-1)', () => {
  let app: INestApplication;
  const receiveInbound = vi.fn(async () => ({ contactId: null, matchedOn: 'staff_position', isNew: false, merged: false }));
  const findBusiness = vi.fn(async () => ({ id: 'biz_A' }));
  const saved = { secret: process.env.WHATSAPP_APP_SECRET, token: process.env.TWILIO_AUTH_TOKEN, verify: process.env.WHATSAPP_VERIFY_TOKEN };

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.TWILIO_AUTH_TOKEN = TWILIO_TOKEN;
    process.env.WHATSAPP_VERIFY_TOKEN = 'fb1_verify';
    const moduleRef = await Test.createTestingModule({
      controllers: [WhatsAppController],
      providers: [
        { provide: WhatsAppService, useValue: { receiveInbound } },
        { provide: PrismaService, useValue: { client: { business: { findFirst: findBusiness } } } },
        { provide: WebhookIngressLoggerService, useValue: { log: vi.fn() } },
        { provide: AuthGuard, useValue: { canActivate: () => false } },
        { provide: BusinessGuard, useValue: { canActivate: () => false } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureNestApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env.WHATSAPP_APP_SECRET = saved.secret;
    process.env.TWILIO_AUTH_TOKEN = saved.token;
    process.env.WHATSAPP_VERIFY_TOKEN = saved.verify;
  });

  beforeEach(() => {
    receiveInbound.mockClear();
    findBusiness.mockClear();
  });

  const post = (body: unknown, headers: Record<string, string> = {}) => {
    const raw = JSON.stringify(body);
    let r = request(app.getHttpServer()).post('/whatsapp/webhook').set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return { raw, res: r.send(raw) };
  };

  const expectRefused = async (res: request.Test, message: RegExp) => {
    const out = await res;
    expect(out.status).toBe(403);
    expect(JSON.stringify(out.body)).toMatch(message);
    expect(findBusiness).not.toHaveBeenCalled();
    expect(receiveInbound).not.toHaveBeenCalled();
  };

  it("an unsigned body with a Twilio `From` and Meta's phone_number_id is refused, and reaches no business (the review's forgery)", async () => {
    const { res } = post({ From: STAFF_PHONE, Body: 'Create an invoice', entry: metaEnvelope() });
    await expectRefused(res, /Missing Meta webhook signature/);
  });

  it("the same forgery as a reply-based approval ('YES') is refused", async () => {
    const { res } = post({ From: STAFF_PHONE, Body: 'YES', entry: metaEnvelope() });
    await expectRefused(res, /Missing Meta webhook signature/);
  });

  it("a valid Twilio signature does not stand in: it covers the URL and the string fields, not Meta's envelope the route routes by", async () => {
    const params = { From: STAFF_PHONE, Body: 'Create an invoice' };
    // the URL WhatsAppController.buildTwilioUrl signs for this request
    const sig = twilioSignature('http://api.keyflow.test/whatsapp/webhook', params);
    const { res } = post({ ...params, entry: metaEnvelope() }, { host: 'api.keyflow.test', 'x-twilio-signature': sig });
    await expectRefused(res, /Missing Meta webhook signature/);
  });

  it('a Twilio-shaped body is not taken on the shared route at all (Twilio posts to /whatsapp/webhook/:businessId)', async () => {
    const { res } = post({ From: STAFF_PHONE, Body: 'hi' });
    await expectRefused(res, /Missing Meta webhook signature/);
  });

  it('a Meta body with a wrong signature is refused', async () => {
    const { res } = post({ object: 'whatsapp_business_account', entry: metaEnvelope([{ from: '15550001111', id: 'wamid.1', text: { body: 'hi' } }]) }, { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` });
    await expectRefused(res, /Invalid Meta webhook signature/);
  });

  it('control: a Meta-signed message is routed to the business that owns the number, from the signed sender', async () => {
    const body = { object: 'whatsapp_business_account', entry: metaEnvelope([{ from: '15550001111', id: 'wamid.2', timestamp: '1700000000', text: { body: 'hello' } }]) };
    const raw = JSON.stringify(body);
    const out = await request(app.getHttpServer()).post('/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', metaSignature(raw)).send(raw);
    expect(out.status).toBe(201);
    expect(out.body).toMatchObject({ success: true, routed: true });
    expect(findBusiness).toHaveBeenCalledWith({ where: { metaData: { path: ['whatsapp', 'phoneNumberId'], equals: PNID } }, select: { id: true } });
    expect(receiveInbound).toHaveBeenCalledTimes(1);
    expect(receiveInbound).toHaveBeenCalledWith('biz_A', expect.objectContaining({ from: '15550001111', body: 'hello', provider: 'meta' }));
  });

  it('a Meta-signed body that also carries a top-level `From` is read as Meta: the sender is the signed message, never `From`', async () => {
    const body = { From: STAFF_PHONE, Body: 'Create an invoice', object: 'whatsapp_business_account', entry: metaEnvelope([{ from: '15550001111', id: 'wamid.3', text: { body: 'hello' } }]) };
    const raw = JSON.stringify(body);
    const out = await request(app.getHttpServer()).post('/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', metaSignature(raw)).send(raw);
    expect(out.status).toBe(201);
    expect(receiveInbound).toHaveBeenCalledWith('biz_A', expect.objectContaining({ from: '15550001111', body: 'hello', provider: 'meta' }));
    expect((receiveInbound.mock.calls[0] as unknown[])[1]).not.toMatchObject({ from: STAFF_PHONE });
  });

  it("Meta's subscribe handshake still answers without a signature", async () => {
    const out = await request(app.getHttpServer()).post('/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=fb1_verify&hub.challenge=c123').send({});
    expect(out.text).toBe('c123');
    expect(receiveInbound).not.toHaveBeenCalled();
  });
});
