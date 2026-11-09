/**
 * V1-40-SEC-TRUST-CENSUS-REDACTION — log-redaction negative control (REAL
 * database), the packet-branch agent gate, dependabot and the Release 0 trust
 * census (CF-32, CF-33; owner ruling D-22).
 *
 * IA-044 (log_secret_pii_redaction, T0) asks for "negative tests for
 * secret/token/PII leakage across logs". None existed. This suite runs three
 * Release 0 flows through the production request path with every log surface
 * the server writes to recorded, and fails if a log entry carries:
 *
 *   - a contact email (the invoice's customer, and the contact the operator
 *     creates, with its duplicate-submit 409);
 *   - a bearer token: the operator's `Authorization: Bearer <jwt>` (verified by
 *     the real AuthMiddleware), and the public invoice link's token, which is
 *     the customer's bearer credential for GET /commerce/public/invoice-link/:token;
 *   - the providerPaymentId recordPayment derives (R0-D2), whole or its digest.
 *
 *   flow                                   window
 *   POST .../invoices/:id/payments         operator, bearer JWT, idempotency key
 *   POST .../contacts (+ the same again)   operator, bearer JWT; the second is the 409
 *   GET  /commerce/public/invoice-link/:t  anonymous customer, link token in the path
 *
 * THE LOGGER SPY. During each window every log surface is replaced by a
 * recorder: the Nest Logger instance methods (every `new Logger(ctx).x()` in
 * src), the Logger statics, ConsoleLogger (a direct ConsoleLogger use) and
 * console.log/info/warn/error/debug/trace. Each entry is rendered the way
 * ConsoleLogger would print it (strings as they are, anything else through
 * util.inspect), so an object or an Error that carries a secret is caught too.
 * Every level is recorded, debug and verbose included: main.ts creates the app
 * with no `logger` option, so Nest's default ConsoleLogger prints all six
 * levels (DEFAULT_LOG_LEVELS, @nestjs/common console-logger.service.js).
 * Each window first asserts the spy saw the window's own HTTP access line, so
 * an empty capture can never pass as "nothing leaked".
 *
 * THE REQUEST PATH. As app.module.ts wires it: CorrelationIdMiddleware, the
 * real AuthMiddleware (a locally signed HS256 token, SUPABASE_JWT_SECRET set
 * for this suite and SUPABASE_URL unset, so no provider traffic), the three
 * APP_INTERCEPTORs (LoggingInterceptor, BusinessEventInterceptor with the real
 * ResilientEmitterService and BusinessEventService, TenantInterceptor with the
 * Prisma tenant context provider installed), GlobalHttpExceptionFilter and
 * ValidationPipe. AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard,
 * CrmRateLimitGuard, PublicRateLimitGuard (real Redis at REDIS_URL, this
 * suite's own key namespace), CommerceController/Service, InvoiceWorkflowService,
 * the real ledger chain, CrmController/Service, CrmTimelineService,
 * ContactAuditService and TimelineService are real against the database.
 * Stand-ins: the BullMQ queue (its stand-in hands the job to the real
 * BusinessEventService.emit, as the worker does), Gmail, Drive, AI, catalog,
 * stats caches, the plan-limit count, the transactional-email sender and the
 * channel adapter registry.
 *
 * THE EVENT BUS. EventEmitterModule.forRoot with the options of
 * src/core/event-bus/event-bus.module.ts, and the real
 * AutomationExecutorService (with the real ActivityService) mounted on it: the
 * contact.created / invoice.paid playbook listener, and the one listener on
 * those events whose log calls named a contact field
 * (automation-executor.service.ts:286, `Email sent to ${c.email}`, and :358,
 * `WhatsApp delivery queued for ${phone}`, before FOLLOW3-C2). The other
 * contact.created listeners (flow/activity-event.listener.ts,
 * flow/flow.listener.ts, ai/ai.listener.ts,
 * growth-intelligence/journey-listener.service.ts,
 * webhooks/webhook-dispatcher.service.ts) are not mounted; their log calls
 * were read, not run, and interpolate no contact field.
 *
 *   flow                                   window
 *   POST .../contacts with a SEND_EMAIL    operator, bearer JWT; a playbook on
 *     playbook on contact.created          contact.created (seeded, real listener)
 *   POST .../contacts with a SEND_WHATSAPP operator, bearer JWT; a playbook on
 *     playbook on contact.created          contact.created and a WhatsApp
 *                                          connection with one active destination
 *                                          (seeded; the adapter registry is an
 *                                          empty stand-in, only its presence is read)
 *
 * RESULT. No contact email, operator bearer JWT or providerPaymentId reaches
 * the logs in the recordPayment, contact create (no playbook) and public link
 * windows. The playbook windows no longer leak either (FOLLOW3-C2-PLAYBOOK-LOG-CONTACT-ID):
 * V1-40 found the SEND_EMAIL action logging the contact's email
 * (apps/server/src/modules/flow/automation-executor.service.ts:286) and pinned
 * it with a CHARACTERIZATION case; :358 logged the phone for SEND_WHATSAPP.
 * Both lines now name the contact by id. The negative controls cover the
 * email, and the phone as typed, in E.164 and as digits only; a positive case
 * per action finds its line naming `contact <contactId>`, so an emptied log
 * cannot pass, and the window checks prove each action still ran (the send
 * the email stand-in was asked for; the playbook's run count and the queued
 * outboundDelivery row). For SEND_EMAIL these windows prove the executor's own
 * line only: the transactional-email sender is a stand-in here. The real one
 * logged the recipient email itself
 * (apps/server/src/modules/notifications/transactional-email.service.ts:760 on
 * a send, :764 on each failed attempt, :771 after the last; SEC-C2-1). Section
 * 1c runs the real sender under the SEND_EMAIL action (no database), and
 * directly for its other lines; since W3-C2b-EMAIL-LOG-LEAK its negative
 * controls find no recipient email or message content in any of them.
 *
 * The public link token no longer reaches the logs (V1-83,
 * FOLLOW3-C1-HTTP-LOG-ROUTE-PATTERN). LoggingInterceptor's access line
 * (apps/server/src/core/interceptors/logging.interceptor.ts, :22 at bb6b86d4)
 * and GlobalHttpExceptionFilter's 500 line and error-registry label
 * (apps/server/src/core/filters/http-exception.filter.ts, :65 and :77 at
 * bb6b86d4) were built from request.url. Both now name the route pattern
 * Express matched (req.route.path, e.g. GET /commerce/public/invoice-link/:token),
 * else the constant '<unrouted>', and never the query. The public link
 * windows prove it through the real Nest app and Express routing: the plain
 * view, the view with a `?code=` query, and a 500 injected into the token
 * route. Section 1b drives LoggingInterceptor and GlobalHttpExceptionFilter
 * directly with the rest of the class: platform secrets (the Chatwoot webhook
 * secret in the path, WHATSAPP_VERIFY_TOKEN in hub.verify_token, an OAuth
 * `code`) on the success line, the SLOW warn line (past 1000 ms, on a stubbed
 * clock), the error line and the 500 line, and an unrouted request whose path
 * and query reach none of them. A static case pins that neither file reads the
 * request URL, path, query or params outside the filter's response body.
 *
 * Fixtures: prefix `v40a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 *
 * The file also carries the packet's static proofs, which need no database:
 * the agent gate binds pkt/* heads (D-22; its scope and validation scripts are
 * executed with bash against fixture artifacts), dependabot is configured and
 * leaves the SHA-pinned secret scanner alone, and the Release 0 trust census
 * cites an existing test path or OPEN on every row and a disposition on every
 * T0 row.
 */
import 'reflect-metadata';
import path from 'path';
import os from 'os';
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { inspect } from 'util';
import { createHmac } from 'crypto';
import { spawnSync } from 'child_process';
import { defer, lastValueFrom, of, throwError } from 'rxjs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Logger, ConsoleLogger, ForbiddenException } from '@nestjs/common';
import type { ArgumentsHost, CallHandler, ExecutionContext } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const REPO_ROOT = path.resolve(__dirname, '../../..');

const P = 'v40a_';

// ---------------------------------------------------------------------------
// The log recorder (the Logger spy)
// ---------------------------------------------------------------------------

interface LogEntry {
  channel: string;
  text: string;
}

const LOG_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

/** One argument the way ConsoleLogger prints it: a string as it is, anything else inspected in full. */
function renderArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  return inspect(arg, { depth: 12, breakLength: Infinity, maxArrayLength: null, maxStringLength: null });
}

function render(args: unknown[]): string {
  return args.map(renderArg).join(' ');
}

/**
 * Record every log call until stop(). Nothing recorded is printed: the
 * recorder replaces the surface, so each entry is seen exactly once.
 */
function startCapture(): { entries: LogEntry[]; stop: () => void } {
  const entries: LogEntry[] = [];
  const spies: Array<{ mockRestore: () => void }> = [];
  for (const level of LOG_LEVELS) {
    spies.push(
      vi.spyOn(Logger.prototype as any, level).mockImplementation(function (this: any, ...args: unknown[]) {
        entries.push({ channel: `Logger#${level}[${this?.context ?? '-'}]`, text: render(args) });
      }),
    );
    spies.push(
      vi.spyOn(Logger as any, level).mockImplementation((...args: unknown[]) => {
        entries.push({ channel: `Logger.${level}`, text: render(args) });
      }),
    );
    spies.push(
      vi.spyOn(ConsoleLogger.prototype as any, level).mockImplementation(function (this: any, ...args: unknown[]) {
        entries.push({ channel: `ConsoleLogger#${level}[${this?.context ?? '-'}]`, text: render(args) });
      }),
    );
  }
  for (const method of CONSOLE_METHODS) {
    spies.push(
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        entries.push({ channel: `console.${method}`, text: render(args) });
      }),
    );
  }
  return {
    entries,
    stop: () => {
      for (const s of spies.reverse()) s.mockRestore();
    },
  };
}

/** The entries (channel + text) that contain any of the needles, case-insensitively. */
function entriesContaining(entries: LogEntry[], needles: string[]): LogEntry[] {
  const lowered = needles.filter((n) => n.length > 0).map((n) => n.toLowerCase());
  return entries.filter((e) => lowered.some((n) => e.text.toLowerCase().includes(n)));
}

/** An email and the encodings it could take in a logged URL or JSON body. */
function emailForms(email: string): string[] {
  return [email, encodeURIComponent(email)];
}

// ---------------------------------------------------------------------------
// Identity: a locally verified HS256 bearer token (no provider traffic)
// ---------------------------------------------------------------------------

/** Test-only HS256 secret for the real AuthMiddleware. Not a real secret. */
const JWT_SECRET = 'v40a-test-only-hs256-secret-not-a-real-credential-000000';
const b64url = (s: string) => Buffer.from(s).toString('base64url');

/** An HS256 JWT shaped like a Supabase access token (no `iss`: accepted under NODE_ENV=test with no SUPABASE_URL). */
function mintToken(sub: string, email: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub, email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 }));
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** The parts of a JWT whose presence in a log is the token's: the whole, the signed input, the payload, the signature. */
function tokenForms(token: string): string[] {
  const [header, payload, signature] = token.split('.');
  return [token, `${header}.${payload}`, payload, signature];
}

// ===========================================================================
// 0. The recorder catches a planted leak on every surface (no database)
// ===========================================================================

describe('the log recorder: a planted secret is caught on every log surface', () => {
  const SECRET = `${P}Planted.Secret@Test.Local`;

  it('Logger instance (every level), Logger statics, ConsoleLogger, console and non-string arguments are recorded and matched', () => {
    const cap = startCapture();
    try {
      const logger = new Logger('V40aProbe');
      logger.log(`log ${SECRET}`);
      logger.debug(`debug ${SECRET}`);
      logger.verbose(`verbose ${SECRET}`);
      logger.warn({ nested: { email: SECRET } }, 'object first');
      logger.error('error with a stack', new Error(`boom ${SECRET}`).stack);
      logger.fatal(`fatal ${SECRET}`);
      Logger.warn(`static ${SECRET}`, 'V40aStatic');
      new ConsoleLogger('V40aConsoleLogger').log(`console logger ${SECRET}`);
      console.error('console error', new Error(`console ${SECRET}`));
      console.log({ deep: { deeper: { deepest: [SECRET] } } });
    } finally {
      cap.stop();
    }
    const hits = entriesContaining(cap.entries, [SECRET.toUpperCase()]);
    expect(hits.map((h) => h.channel)).toEqual([
      'Logger#log[V40aProbe]',
      'Logger#debug[V40aProbe]',
      'Logger#verbose[V40aProbe]',
      'Logger#warn[V40aProbe]',
      'Logger#error[V40aProbe]',
      'Logger#fatal[V40aProbe]',
      'Logger.warn',
      'ConsoleLogger#log[V40aConsoleLogger]',
      'console.error',
      'console.log',
    ]);
  });

  it('stop() restores every surface: nothing is recorded after it', () => {
    const cap = startCapture();
    cap.stop();
    const restored = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      new Logger('V40aAfterStop').log(`after ${SECRET}`);
    } finally {
      restored.mockRestore();
    }
    expect(cap.entries).toEqual([]);
  });
});

// ===========================================================================
// 1. Log-redaction negative control (real database)
// ===========================================================================

describe('log redaction: no contact email, bearer token or providerPaymentId in the log output (REAL database)', () => {
  const HEADER_AUTH = 'authorization';

  const ID = {
    owner: `${P}owner`,
    biz: `${P}biz`,
    customer: `${P}customer`,
    invoice: `${P}inv`,
  };

  /** The invoice's customer: on the invoice the payment and the public link read. */
  const CUSTOMER_EMAIL = `${P}invoice.customer@test.local`;
  /** The contact the operator creates through POST .../contacts. */
  const NEW_CONTACT_EMAIL = `${P}new.contact@test.local`;
  /** The contact created while a SEND_EMAIL playbook listens on contact.created. */
  const PLAYBOOK_CONTACT_EMAIL = `${P}playbook.contact@test.local`;
  const PLAYBOOK_NAME = 'V40A welcome email';
  /** The contact created while a SEND_WHATSAPP playbook listens on contact.created. */
  const WA_CONTACT_EMAIL = `${P}playbook.whatsapp@test.local`;
  /** Its phone as the operator typed it; the delivery row carries it as stored. */
  const WA_CONTACT_PHONE = '+1 (868) 555-0183';
  /** The same phone in E.164 and digits only: a log line in either form is the same leak. */
  const WA_CONTACT_PHONE_E164 = '+18685550183';
  const WA_CONTACT_PHONE_DIGITS = '18685550183';
  const WA_PLAYBOOK_NAME = 'V40A welcome WhatsApp';
  /** What the transactional-email stand-in was asked to send (the playbook's effect). */
  const emailsSent: Array<{ recipientEmail: string; type: string }> = [];
  const OWNER_EMAIL = `${P}owner@test.local`;
  const IDEMPOTENCY_KEY = `${P}idem-0001`;
  const TOTAL = 250;

  // This suite's public rate-limit keys live under its own namespace.
  const RATE_LIMIT_NS = P;

  // Environment this suite sets and restores.
  const ENV_KEYS = [
    'RATE_LIMIT_KEY_NAMESPACE',
    'SUPABASE_JWT_SECRET',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ] as const;
  const previousEnv: Record<string, string | undefined> = {};

  let db: any;
  let app: any;
  let redis: any;
  let setTenantContextProvider: ((p: { getCurrentBusinessId: () => string | undefined }) => void) | undefined;

  let bearer = '';
  let linkToken = '';

  /** A credential-shaped query parameter on the public link (an OAuth-style `code`). Not a real credential. */
  const QUERY_SECRET = `${P}query_secret_0001`;
  /** The route pattern Express matched for the public link view. */
  const LINK_ROUTE = '/commerce/public/invoice-link/:token';
  /** The message of the error injected into the token route (the 500 window). */
  const INJECTED_500 = 'v40a injected 500';
  /** The newest http entry the error registry held right after the 500 window. */
  let registryAfter500: { label: string; message: string } | undefined;

  /** What each window recorded, and what it read afterwards. */
  const windows: Record<string, { entries: LogEntry[]; status: number[] }> = {};
  /** The contact each contact-create window created. */
  const windowContacts: Record<string, string> = {};
  /**
   * V1-55b-FEED-DEDUPE-REST: every run of the real AutomationExecutorService's
   * contact.created listener (it writes no feed row any more, so its run is
   * observed itself): the payload it was handed and the promise of its run.
   */
  const contactCreatedRuns: Array<{ businessId: string; contactId: string; run: Promise<unknown> }> = [];
  /** The contact.created listener runs each contact-create window saw finish inside it. */
  const runsFinishedInWindow: Record<string, number> = {};
  let providerPaymentId = '';

  async function cleanup() {
    for (const sql of [
      `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM automations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      // The SEND_WHATSAPP window: the delivery the playbook queues, its content
      // and variant, and the seeded WhatsApp connection and destination.
      `DELETE FROM outbound_deliveries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM outbound_variants WHERE content_id IN (SELECT id FROM outbound_content WHERE business_id LIKE ${sqlLikePrefix(P)})`,
      `DELETE FROM outbound_content WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM channel_destinations WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM channel_connections WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
    ]) {
      try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
    }
  }

  async function clearRateLimits() {
    const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
    if (keys.length) await redis.del(...keys);
  }

  function agent() {
    return request(app.getHttpServer());
  }

  /** Wait for a fire-and-forget write to land, so its logging happens inside the window. */
  async function until(check: () => Promise<boolean>, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Let any other fire-and-forget work a request started reach its log calls. */
  const settle = () => new Promise((r) => setTimeout(r, 400));

  /** Run one flow inside a capture window. */
  async function captureWindow(name: string, flow: () => Promise<number[]>) {
    const cap = startCapture();
    let status: number[] = [];
    try {
      status = await flow();
      await settle();
    } finally {
      cap.stop();
    }
    windows[name] = { entries: cap.entries, status };
  }

  /** The access line LoggingInterceptor writes for a request (the spy's liveness check). */
  function accessLines(entries: LogEntry[], method: string, pathPrefix: string): LogEntry[] {
    return entries.filter((e) => e.channel.endsWith('[HTTP]') && e.text.includes(`${method} ${pathPrefix}`));
  }

  function describeLeaks(leaks: LogEntry[]): string {
    return leaks.map((e) => `${e.channel}: ${e.text.slice(0, 300)}`).join('\n');
  }

  beforeAll(async () => {
    for (const k of ENV_KEYS) previousEnv[k] = process.env[k];
    process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;
    process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
    // No provider client: the real AuthMiddleware verifies the token locally.
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const dbMod = await import('@keyflow/db');
    db = dbMod.db;
    setTenantContextProvider = dbMod.setTenantContextProvider;

    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { APP_INTERCEPTOR } = await import('@nestjs/core');
    const { EventEmitterModule } = await import('@nestjs/event-emitter');
    const { AutomationExecutorService } = await import('../src/modules/flow/automation-executor.service');
    const { ActivityService } = await import('../src/modules/flow/activity.service');
    const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
    const { AdapterRegistryService } = await import('../src/modules/communications/adapters/adapter-registry.service');
    const IORedis = (await import('ioredis')).default;
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { AuthMiddleware } = await import('../src/core/auth/auth.middleware');
    const { SupabaseAuthService } = await import('../src/core/auth/supabase-auth.service');
    const { CorrelationIdMiddleware } = await import('../src/core/middleware/correlation-id.middleware');
    const { LoggingInterceptor } = await import('../src/core/interceptors/logging.interceptor');
    const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
    const { getCurrentBusinessId } = await import('../src/core/tenant/tenant-context');
    const { BusinessEventInterceptor } = await import('../src/modules/business-events/business-event.interceptor');
    const { ResilientEmitterService } = await import('../src/modules/business-events/resilient-emitter.service');
    const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
    const { BusinessEventQueueService } = await import('../src/modules/business-events/business-event.queue');
    const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
    const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
    const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
    const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
    const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
    const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
    const { CommerceService } = await import('../src/modules/commerce/commerce.service');
    const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
    const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
    const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
    const { GmailService } = await import('../src/modules/commerce/gmail.service');
    const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
    const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
    const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
    const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
    const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
    const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
    const { CatalogService } = await import('../src/modules/catalog/catalog.service');
    const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
    const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
    const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
    const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
    const { PostingService } = await import('../src/modules/finance/posting.service');
    const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
    const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
    const { TimelineService } = await import('../src/modules/timeline/timeline.service');
    const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
    const { CrmController } = await import('../src/modules/crm/crm.controller');
    const { CrmService } = await import('../src/modules/crm/crm.service');
    const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
    const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
    const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
    const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
    const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
    const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
    const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
    const { CrmImportService } = await import('../src/modules/crm/crm-import.service');
    const { CrmPlaybookService } = await import('../src/modules/crm/crm-playbook.service');
    const { CrmActionsService } = await import('../src/modules/crm/crm-actions.service');
    const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
    const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
    const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');
    const { CrmDataQualityService } = await import('../src/modules/crm/crm-data-quality.service');
    const { CrmSavedViewsService } = await import('../src/modules/crm/crm-saved-views.service');
    const { CrmRelationshipHealthService } = await import('../src/modules/crm/crm-relationship-health.service');
    const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
    const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
    const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
    const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
    const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
    const { errorRegistry } = await import('../src/core/observability/error-registry');

    redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

    const moduleRef = await Test.createTestingModule({
      // The production event bus (src/core/event-bus/event-bus.module.ts), so
      // the @OnEvent listeners mounted below run on the emits these flows make.
      imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
      controllers: [CommerceController, CrmController],
      providers: [
        PrismaService,
        { provide: REDIS_CLIENT, useValue: redis },
        // Request path, as app.module.ts wires it.
        SupabaseAuthService,
        AuthMiddleware,
        { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
        { provide: APP_INTERCEPTOR, useClass: BusinessEventInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
        ResilientEmitterService,
        BusinessEventService,
        // BullMQ stand-in: hands the job to the real BusinessEventService, as the worker does.
        {
          provide: BusinessEventQueueService,
          useFactory: (events: any) => ({
            enqueue: async (job: any) => {
              await events.emit({ ...job });
              return { id: `${P}job` };
            },
          }),
          inject: [BusinessEventService],
        },
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        PublicRateLimitGuard,
        PlanLimitGuard,
        CrmRateLimitGuard,
        FeatureFlagGuard,
        TeamAuditInterceptor,
        // The contact.created / invoice.paid playbook listener, real, with the
        // real ActivityService; only the email sender is a stand-in (no provider traffic).
        AutomationExecutorService,
        ActivityService,
        {
          provide: TransactionalEmailService,
          useValue: {
            send: async (input: { recipientEmail: string; type: string }) => {
              emailsSent.push({ recipientEmail: input.recipientEmail, type: input.type });
              return { sent: true };
            },
          },
        },
        // SEND_WHATSAPP only checks that a registry is present
        // (automation-executor.service.ts:296); it queues an outboundDelivery
        // row and sends nothing itself, so the stand-in is empty.
        { provide: AdapterRegistryService, useValue: {} },
        // Commerce: the real payment, link and ledger chain.
        CommerceService,
        InvoiceWorkflowService,
        InvoiceReceiptBuilderService,
        RevenuePostingService,
        PostingService,
        ChartOfAccountsSeederService,
        PaymentEvidenceService,
        TimelineService,
        { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
        { provide: EvidenceService, useValue: {} },
        { provide: TaskAssignmentService, useValue: {} },
        { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
        { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
        { provide: CatalogService, useValue: {} },
        { provide: PublicEventsService, useValue: {} },
        { provide: TimeEntryService, useValue: {} },
        { provide: GmailService, useValue: { sendEmail: async () => ({ messageId: `${P}msg` }) } },
        { provide: CommerceVisionService, useValue: {} },
        { provide: StoreReadinessService, useValue: {} },
        { provide: DocumentIntelligenceService, useValue: {} },
        { provide: GoogleDriveService, useValue: {} },
        // CRM: the real contact write, its in-transaction event and its audit entry.
        CrmService,
        CrmStatsService,
        CrmTimelineService,
        ContactAuditService,
        { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
        { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
        { provide: CrmListsService, useValue: {} },
        { provide: EntityResolutionService, useValue: {} },
        { provide: ContactCustomFieldValueService, useValue: {} },
        { provide: CrmImportService, useValue: {} },
        { provide: CrmPlaybookService, useValue: {} },
        { provide: CrmActionsService, useValue: {} },
        { provide: CrmRevenueService, useValue: {} },
        { provide: CrmJourneyService, useValue: {} },
        { provide: CrmDuplicateDetectionService, useValue: {} },
        { provide: CrmDataQualityService, useValue: {} },
        { provide: CrmSavedViewsService, useValue: {} },
        { provide: CrmRelationshipHealthService, useValue: {} },
        { provide: CrmCommunicationService, useValue: {} },
        { provide: BestChannelService, useValue: {} },
        { provide: ConversationAiService, useValue: {} },
        { provide: CrmNetworkService, useValue: {} },
        { provide: ContactInsightService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // app.module.ts: CorrelationIdMiddleware, then AuthMiddleware, on every route.
    const correlation = new CorrelationIdMiddleware();
    const auth = moduleRef.get(AuthMiddleware);
    app.use((req: any, res: any, next: any) => correlation.use(req, res, next));
    app.use((req: any, res: any, next: any) => {
      auth.use(req, res, next).catch(next);
    });
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    // main.ts installs the tenant context provider before the app serves.
    setTenantContextProvider({ getCurrentBusinessId });
    // V1-55b: record each run of the real contact.created listener. The
    // event-emitter loader calls instance[methodKey] at emit time, so wrapping
    // the instance's method (after init, the subscription already made) sees
    // every delivery and still runs the real handler.
    const executor = moduleRef.get(AutomationExecutorService);
    const realOnContactCreated = executor.onContactCreated.bind(executor);
    executor.onContactCreated = (payload: Parameters<typeof realOnContactCreated>[0]) => {
      const run = realOnContactCreated(payload);
      contactCreatedRuns.push({ businessId: payload?.businessId, contactId: payload?.contact?.id, run });
      return run;
    };

    await cleanup(); // in case a prior run aborted
    await clearRateLimits();

    // ---- one tenant: an owner, the invoice's customer, a SENT invoice ------
    await db.user.create({ data: { id: ID.owner, email: OWNER_EMAIL, role: 'USER' } });
    await db.business.create({ data: { id: ID.biz, name: 'V40A Biz', ownerId: ID.owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
    await db.contact.create({
      data: { id: ID.customer, businessId: ID.biz, firstName: 'V40a', lastName: 'Customer', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
    });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
    await db.invoice.create({
      data: {
        id: ID.invoice,
        invoiceNumber: 'V40A-001',
        status: 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: ID.customer,
        items: { create: [{ id: `${ID.invoice}_item1`, description: 'V40A item', quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });

    bearer = mintToken(ID.owner, OWNER_EMAIL);

    // ---- the customer's link, minted by the real route (outside any window) --
    const link = await agent()
      .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invoice}/payment-link`)
      .set(HEADER_AUTH, `Bearer ${bearer}`)
      .send({});
    if (link.status !== 201 || !link.body?.token) {
      throw new Error(`payment link failed (is the bearer token verified?): ${link.status} ${JSON.stringify(link.body)}`);
    }
    linkToken = link.body.token;

    // ---- window 1: recordPayment ---------------------------------------------
    await captureWindow('recordPayment', async () => {
      const res = await agent()
        .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invoice}/payments`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send({ amount: 100, method: 'cash', reference: `${P}slip-0001`, idempotencyKey: IDEMPOTENCY_KEY });
      // The keyed replay: the same submit again answers from the recorded row.
      const replay = await agent()
        .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invoice}/payments`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send({ amount: 100, method: 'cash', reference: `${P}slip-0001`, idempotencyKey: IDEMPOTENCY_KEY });
      await until(async () => (await db.businessEvent.count({ where: { businessId: ID.biz } })) > 0);
      return [res.status, replay.status];
    });
    const payment = await db.payment.findFirst({ where: { invoiceId: ID.invoice, businessId: ID.biz }, select: { providerPaymentId: true } });
    providerPaymentId = payment?.providerPaymentId ?? '';

    // ---- window 2: contact create, then the duplicate submit (409) ----------
    await captureWindow('contactCreate', async () => {
      const body = { firstName: `${P}Ada`, lastName: 'Lovelace', email: NEW_CONTACT_EMAIL, phone: '+1 868 555 0140' };
      const created = await agent()
        .post(`/crm/businesses/${ID.biz}/contacts`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send(body);
      const duplicate = await agent()
        .post(`/crm/businesses/${ID.biz}/contacts`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send(body);
      const contactId = created.body?.id;
      if (contactId) {
        await until(async () => (await db.contactAuditEntry.count({ where: { businessId: ID.biz, contactId } })) > 0);
        // The real contact.created listener ran, and finished, inside the window
        // (V1-55b: observed as its run, since it writes no feed row any more).
        await until(async () => contactCreatedRuns.some((r) => r.contactId === contactId));
        const runs = contactCreatedRuns.filter((r) => r.contactId === contactId);
        await Promise.all(runs.map((r) => r.run));
        runsFinishedInWindow.contactCreate = runs.length;
        windowContacts.contactCreate = contactId;
      }
      return [created.status, duplicate.status];
    });

    // ---- window 2b: contact create while a SEND_EMAIL playbook listens -------
    // Seeded outside the window, as an operator configures it; the real
    // AutomationExecutorService runs it on the contact.created emit.
    await db.automation.create({
      data: {
        id: `${P}playbook_email`,
        businessId: ID.biz,
        name: PLAYBOOK_NAME,
        trigger: 'contact.created',
        enabled: true,
        actionData: { type: 'SEND_EMAIL', notificationType: 'invoice_sent' },
      },
    });
    await captureWindow('contactCreatePlaybook', async () => {
      const created = await agent()
        .post(`/crm/businesses/${ID.biz}/contacts`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send({ firstName: `${P}Grace`, lastName: 'Hopper', email: PLAYBOOK_CONTACT_EMAIL });
      // The playbook's run is recorded after its action: it finished inside the window.
      await until(async () => ((await db.automation.findUnique({ where: { id: `${P}playbook_email` }, select: { runCount: true } }))?.runCount ?? 0) > 0);
      windowContacts.contactCreatePlaybook = created.body?.id ?? '';
      return [created.status];
    });
    await db.automation.update({ where: { id: `${P}playbook_email` }, data: { enabled: false } });

    // ---- window 2c: contact create while a SEND_WHATSAPP playbook listens ----
    // Seeded outside the window: the playbook, and the business's WhatsApp
    // connection with one active destination (the action queues a delivery to it).
    await db.channelConnection.create({
      data: {
        id: `${P}wa_conn`,
        businessId: ID.biz,
        provider: 'WHATSAPP',
        label: 'V40A WhatsApp',
        destinations: {
          create: [{ id: `${P}wa_dest`, businessId: ID.biz, platform: 'WHATSAPP', displayName: 'V40A WhatsApp line', isActive: true }],
        },
      },
    });
    await db.automation.create({
      data: {
        id: `${P}playbook_whatsapp`,
        businessId: ID.biz,
        name: WA_PLAYBOOK_NAME,
        trigger: 'contact.created',
        enabled: true,
        actionData: { type: 'SEND_WHATSAPP', message: 'V40A welcome' },
      },
    });
    await captureWindow('contactCreateWhatsApp', async () => {
      const created = await agent()
        .post(`/crm/businesses/${ID.biz}/contacts`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send({ firstName: `${P}Katherine`, lastName: 'Johnson', email: WA_CONTACT_EMAIL, phone: WA_CONTACT_PHONE });
      const contactId = created.body?.id;
      if (contactId) {
        // The playbook's run is recorded after its action, and the listener's
        // whole run (playbooks, then flows) finished inside the window.
        await until(async () => ((await db.automation.findUnique({ where: { id: `${P}playbook_whatsapp` }, select: { runCount: true } }))?.runCount ?? 0) > 0);
        await until(async () => contactCreatedRuns.some((r) => r.contactId === contactId));
        await Promise.all(contactCreatedRuns.filter((r) => r.contactId === contactId).map((r) => r.run));
        windowContacts.contactCreateWhatsApp = contactId;
      }
      return [created.status];
    });
    await db.automation.update({ where: { id: `${P}playbook_whatsapp` }, data: { enabled: false } });

    // ---- window 3: the customer opens the public invoice link ----------------
    await clearRateLimits();
    await captureWindow('publicInvoiceLink', async () => {
      const res = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(linkToken)}`);
      await until(async () => (await db.contactEvent.count({ where: { businessId: ID.biz, contactId: ID.customer, type: 'invoice.viewed' } })) > 0);
      return [res.status];
    });

    // ---- window 3b: the same view with a credential-shaped query ------------
    await captureWindow('publicInvoiceLinkQuery', async () => {
      const res = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(linkToken)}?code=${QUERY_SECRET}`);
      return [res.status];
    });

    // ---- window 3c: an unhandled error on the token route (the 500 line) ----
    // The real route, guards, interceptors and filter; only the service read
    // throws, once, as a database outage would.
    const failOnce = vi
      .spyOn(CommerceService.prototype, 'getPaymentLinkByToken')
      .mockRejectedValueOnce(new Error(INJECTED_500));
    try {
      await captureWindow('publicInvoiceLink500', async () => {
        const res = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(linkToken)}`);
        return [res.status];
      });
    } finally {
      failOnce.mockRestore();
    }
    const newestHttp = errorRegistry.snapshot(200).entries.find((e) => e.source === 'http');
    registryAfter500 = newestHttp ? { label: newestHttp.label, message: newestHttp.message } : undefined;
  }, 180_000);

  afterAll(async () => {
    setTenantContextProvider?.({ getCurrentBusinessId: () => undefined });
    if (app) await app.close();
    if (db) await cleanup();
    if (redis) {
      try { await clearRateLimits(); } catch { /* best-effort */ }
      await redis.quit();
    }
    for (const k of ENV_KEYS) {
      if (previousEnv[k] === undefined) delete process.env[k];
      else process.env[k] = previousEnv[k];
    }
    // An explicit budget: the default hook timeout cut this cleanup short once
    // and left users.v40a_owner behind (V1-40 review).
  }, 60_000);

  // ---- recordPayment ---------------------------------------------------------

  describe('POST /commerce/businesses/:businessId/invoices/:invoiceId/payments (recordPayment)', () => {
    it('the window ran the real flow: 201 recorded, the keyed replay answered, a providerPaymentId was derived, and the spy saw the access lines', () => {
      expect(windows.recordPayment.status).toEqual([201, 201]);
      expect(providerPaymentId).toMatch(new RegExp(`^manual_${ID.invoice}_key_[0-9a-f]{32}$`));
      // The access line names the route pattern, not the request URL (V1-83).
      expect(accessLines(windows.recordPayment.entries, 'POST', '/commerce/businesses/:businessId/invoices/:invoiceId/payments').length).toBe(2);
    });

    it('NEGATIVE CONTROL: no log entry carries the providerPaymentId, whole or its digest', () => {
      const digest = providerPaymentId.split('_key_')[1] ?? '';
      expect(digest).toHaveLength(32);
      const leaks = entriesContaining(windows.recordPayment.entries, [providerPaymentId, digest]);
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('NEGATIVE CONTROL: no log entry carries the operator bearer token (whole, signed input, payload or signature)', () => {
      const leaks = entriesContaining(windows.recordPayment.entries, tokenForms(bearer));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it("NEGATIVE CONTROL: no log entry carries the invoice customer's email", () => {
      const leaks = entriesContaining(windows.recordPayment.entries, emailForms(CUSTOMER_EMAIL));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });
  });

  // ---- contact create --------------------------------------------------------

  describe('POST /crm/businesses/:businessId/contacts (contact create, and its duplicate 409)', () => {
    it('the window ran the real flow: 201 created, the duplicate answered 409, and the spy saw both access lines', () => {
      expect(windows.contactCreate.status).toEqual([201, 409]);
      // One success line (debug) and one error line (the 409 reaches LoggingInterceptor's error branch),
      // each naming the route pattern (V1-83).
      expect(accessLines(windows.contactCreate.entries, 'POST', '/crm/businesses/:businessId/contacts').length).toBe(2);
    });

    it("NEGATIVE CONTROL: no log entry carries the new contact's email", () => {
      const leaks = entriesContaining(windows.contactCreate.entries, emailForms(NEW_CONTACT_EMAIL));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('NEGATIVE CONTROL: no log entry carries the operator bearer token', () => {
      const leaks = entriesContaining(windows.contactCreate.entries, tokenForms(bearer));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('the real contact.created listener ran inside the window (its run finished there), with no playbook configured', async () => {
      const contactId = windowContacts.contactCreate;
      expect(contactId).toBeTruthy();
      // V1-55b-FEED-DEDUPE-REST: AutomationExecutorService writes no feed row for
      // contact.created (ActivityEventListener, not mounted here, writes the one
      // row), so the proof is its run itself: handed this contact once, and
      // finished inside the window.
      expect(contactCreatedRuns.filter((r) => r.contactId === contactId).map((r) => r.businessId)).toEqual([ID.biz]);
      expect(runsFinishedInWindow.contactCreate).toBe(1);
      // No playbook ran for it (none was configured yet): no automation feed row names the contact.
      expect(await db.activity.count({ where: { businessId: ID.biz, module: 'automation', contactId } })).toBe(0);
    });
  });

  // ---- contact create with a SEND_EMAIL playbook on contact.created ----------

  describe('POST /crm/businesses/:businessId/contacts with a SEND_EMAIL playbook on contact.created (real listener)', () => {
    it('the window ran the real flow: 201, the playbook ran once and asked the sender for exactly this contact, and the spy saw the access line', async () => {
      expect(windows.contactCreatePlaybook.status).toEqual([201]);
      expect(emailsSent).toEqual([{ recipientEmail: PLAYBOOK_CONTACT_EMAIL, type: 'invoice_sent' }]);
      const playbook = await db.automation.findUnique({ where: { id: `${P}playbook_email` }, select: { runCount: true } });
      expect(playbook?.runCount).toBe(1);
      expect(accessLines(windows.contactCreatePlaybook.entries, 'POST', '/crm/businesses/:businessId/contacts').length).toBe(1);
    });

    it('NEGATIVE CONTROL: no log entry carries the operator bearer token', () => {
      const leaks = entriesContaining(windows.contactCreatePlaybook.entries, tokenForms(bearer));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    // RED at b1e8f5f5 (V1-40, then pinned by a CHARACTERIZATION case) and on
    // the FOLLOW3-C2-PLAYBOOK-LOG-CONTACT-ID tests-first commit: the SEND_EMAIL
    // action logged `Email sent to ${c.email}` at log level
    // (apps/server/src/modules/flow/automation-executor.service.ts:286 before the fix).
    // The sender is a stand-in in this window, so this proves the executor's
    // own line only; the real sender's lines are section 1c (SEC-C2-1).
    it("NEGATIVE CONTROL: with the sender stood in, no log entry in the window carries the new contact's email when a SEND_EMAIL playbook runs on contact.created (the executor's own line; the real sender's lines are section 1c)", () => {
      const leaks = entriesContaining(windows.contactCreatePlaybook.entries, emailForms(PLAYBOOK_CONTACT_EMAIL));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('the SEND_EMAIL action still logs its send, naming the contact by id (an emptied log cannot pass)', () => {
      const contactId = windowContacts.contactCreatePlaybook;
      expect(contactId).toBeTruthy();
      const lines = windows.contactCreatePlaybook.entries.filter(
        (e) => e.channel === 'Logger#log[AutomationExecutorService]' && e.text.startsWith('Email sent to '),
      );
      expect(lines.map((e) => e.text)).toEqual([`Email sent to contact ${contactId} for playbook "${PLAYBOOK_NAME}"`]);
    });
  });

  // ---- contact create with a SEND_WHATSAPP playbook on contact.created -------

  describe('POST /crm/businesses/:businessId/contacts with a SEND_WHATSAPP playbook on contact.created (real listener)', () => {
    it('the window ran the real flow: 201, the playbook ran once and queued one WhatsApp delivery to this contact\'s phone, and the spy saw the access line', async () => {
      expect(windows.contactCreateWhatsApp.status).toEqual([201]);
      const contactId = windowContacts.contactCreateWhatsApp;
      expect(contactId).toBeTruthy();
      const playbook = await db.automation.findUnique({ where: { id: `${P}playbook_whatsapp` }, select: { runCount: true } });
      expect(playbook?.runCount).toBe(1);
      const deliveries = await db.outboundDelivery.findMany({
        where: { businessId: ID.biz },
        select: { recipientPhone: true, contactId: true, destinationId: true, status: true },
      });
      expect(deliveries).toEqual([{ recipientPhone: WA_CONTACT_PHONE, contactId, destinationId: `${P}wa_dest`, status: 'Queued' }]);
      // The SEND_EMAIL playbook was disabled before this window: its one send is still the only one.
      expect(emailsSent).toEqual([{ recipientEmail: PLAYBOOK_CONTACT_EMAIL, type: 'invoice_sent' }]);
      expect(accessLines(windows.contactCreateWhatsApp.entries, 'POST', '/crm/businesses/:businessId/contacts').length).toBe(1);
    });

    it('NEGATIVE CONTROL: no log entry carries the operator bearer token', () => {
      const leaks = entriesContaining(windows.contactCreateWhatsApp.entries, tokenForms(bearer));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    // RED on the FOLLOW3-C2-PLAYBOOK-LOG-CONTACT-ID tests-first commit: the
    // SEND_WHATSAPP action logged `WhatsApp delivery queued for ${phone}` at log
    // level (apps/server/src/modules/flow/automation-executor.service.ts:358 before the fix).
    it("NEGATIVE CONTROL: no log entry carries the new contact's phone (as typed, E.164 or digits only) or email when a SEND_WHATSAPP playbook runs on contact.created", () => {
      const leaks = entriesContaining(windows.contactCreateWhatsApp.entries, [
        WA_CONTACT_PHONE,
        encodeURIComponent(WA_CONTACT_PHONE),
        WA_CONTACT_PHONE_E164,
        encodeURIComponent(WA_CONTACT_PHONE_E164),
        WA_CONTACT_PHONE_DIGITS,
        ...emailForms(WA_CONTACT_EMAIL),
      ]);
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('the SEND_WHATSAPP action still logs the queued delivery, naming the contact by id (an emptied log cannot pass)', () => {
      const contactId = windowContacts.contactCreateWhatsApp;
      expect(contactId).toBeTruthy();
      const lines = windows.contactCreateWhatsApp.entries.filter(
        (e) => e.channel === 'Logger#log[AutomationExecutorService]' && e.text.startsWith('WhatsApp delivery queued for '),
      );
      expect(lines.map((e) => e.text)).toEqual([`WhatsApp delivery queued for contact ${contactId} in playbook "${WA_PLAYBOOK_NAME}"`]);
    });
  });

  // ---- public invoice link ---------------------------------------------------

  describe('GET /commerce/public/invoice-link/:token (the customer view)', () => {
    it('the window ran the real flow: 200, the view event landed, and the spy saw the access line', () => {
      expect(windows.publicInvoiceLink.status).toEqual([200]);
      // The access line names the route pattern, not the request URL (V1-83).
      expect(accessLines(windows.publicInvoiceLink.entries, 'GET', LINK_ROUTE).length).toBe(1);
    });

    it("NEGATIVE CONTROL: no log entry carries the invoice customer's email", () => {
      const leaks = entriesContaining(windows.publicInvoiceLink.entries, emailForms(CUSTOMER_EMAIL));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('NEGATIVE CONTROL: no log entry carries the providerPaymentId of the payment on the viewed invoice', () => {
      const digest = providerPaymentId.split('_key_')[1] ?? '';
      const leaks = entriesContaining(windows.publicInvoiceLink.entries, [providerPaymentId, digest]);
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    // RED at b1e8f5f5 (V1-40) and again on the V1-83 tests-first commit at
    // bb6b86d4: LoggingInterceptor built its access line from req.url
    // (logging.interceptor.ts:22, emitted at :26 debug), and main.ts keeps
    // Nest's default ConsoleLogger, which prints debug.
    it("NEGATIVE CONTROL: no log entry carries the link token (the customer's bearer credential)", () => {
      expect(linkToken.length).toBeGreaterThanOrEqual(32);
      const leaks = entriesContaining(windows.publicInvoiceLink.entries, [linkToken, encodeURIComponent(linkToken)]);
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it("the window's access line is the route pattern, the status, the duration and the correlation id", () => {
      const lines = windows.publicInvoiceLink.entries.filter((e) => e.channel.endsWith('[HTTP]'));
      expect(lines.map((e) => e.channel)).toEqual(['Logger#debug[HTTP]']);
      expect(lines[0].text).toMatch(/^GET \/commerce\/public\/invoice-link\/:token 200 \d+ms \[[^\]\s]+\]$/);
    });
  });

  describe('GET /commerce/public/invoice-link/:token?code=... (a credential-shaped query on the same route)', () => {
    it('the window ran the real flow: 200, and the spy saw the access line', () => {
      expect(windows.publicInvoiceLinkQuery.status).toEqual([200]);
      expect(accessLines(windows.publicInvoiceLinkQuery.entries, 'GET', LINK_ROUTE).length).toBe(1);
    });

    it('NEGATIVE CONTROL: no log entry carries the query secret, or the link token', () => {
      const leaks = entriesContaining(windows.publicInvoiceLinkQuery.entries, [
        QUERY_SECRET,
        encodeURIComponent(QUERY_SECRET),
        linkToken,
        encodeURIComponent(linkToken),
      ]);
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('the access line carries no query string at all', () => {
      const lines = windows.publicInvoiceLinkQuery.entries.filter((e) => e.channel.endsWith('[HTTP]'));
      expect(lines.map((e) => e.channel)).toEqual(['Logger#debug[HTTP]']);
      expect(lines[0].text).toMatch(/^GET \/commerce\/public\/invoice-link\/:token 200 \d+ms \[[^\]\s]+\]$/);
      expect(lines[0].text).not.toContain('?');
    });
  });

  describe('GET /commerce/public/invoice-link/:token answering 500 (an unhandled error on the token route)', () => {
    it('the window ran the real route: the injected error answered 500', () => {
      expect(windows.publicInvoiceLink500.status).toEqual([500]);
    });

    // RED on the V1-83 tests-first commit at bb6b86d4: the 500 line logged
    // request.url (http-exception.filter.ts:65), and so did the access line's
    // error branch (logging.interceptor.ts:32).
    it('NEGATIVE CONTROL: no log entry carries the link token', () => {
      const leaks = entriesContaining(windows.publicInvoiceLink500.entries, [linkToken, encodeURIComponent(linkToken)]);
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('the GlobalHttpExceptionFilter line names the route pattern', () => {
      const lines = windows.publicInvoiceLink500.entries.filter((e) => e.channel === 'Logger#error[GlobalHttpExceptionFilter]');
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toMatch(/^Unhandled exception on GET \/commerce\/public\/invoice-link\/:token \[[^\]\s]+\]/);
    });

    it("the access line's error branch names the route pattern", () => {
      const lines = windows.publicInvoiceLink500.entries.filter((e) => e.channel === 'Logger#error[HTTP]');
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toMatch(new RegExp(`^GET /commerce/public/invoice-link/:token ERR \\d+ms \\[[^\\]\\s]+\\] ${INJECTED_500}$`));
    });

    it('the newest error-registry http entry is labelled by the route pattern', () => {
      expect(registryAfter500).toEqual({ label: `GET ${LINK_ROUTE}`, message: INJECTED_500 });
    });
  });
});

// ===========================================================================
// 1b. The req.url leak is a class: platform secrets, and the 500 line (no database)
// ===========================================================================

describe('the HTTP access line and the 500 line log the route pattern, never request.url: platform secrets in paths and queries (IA-044 scope)', () => {
  // Literals only: none of these is a real credential.
  const CHATWOOT_SECRET = `${P}chatwoot-webhook-secret-0001`;
  const VERIFY_TOKEN = `${P}whatsapp-verify-token-0001`;
  const OAUTH_CODE = `${P}oauth-code-0001`;
  const LINK_TOKEN = `${P}link-token-0001`;
  const CORRELATION = `${P}corr`;
  /** What a request no route matched carries: a secret in its path and one in its query. */
  const UNROUTED_PATH_SECRET = `${P}unrouted-path-secret-0001`;
  const UNROUTED_QUERY_SECRET = `${P}unrouted-query-secret-0001`;
  const UNROUTED_URL = `/${P}nowhere/${UNROUTED_PATH_SECRET}?${P}q=${UNROUTED_QUERY_SECRET}`;
  /** What the access line and the 500 line name when Express matched no route. */
  const UNROUTED = '<unrouted>';

  let LoggingInterceptorClass: typeof import('../src/core/interceptors/logging.interceptor').LoggingInterceptor;
  let ExceptionFilterClass: typeof import('../src/core/filters/http-exception.filter').GlobalHttpExceptionFilter;
  let registry: typeof import('../src/core/observability/error-registry').errorRegistry;

  /** The slice of an Express response the filter writes to. */
  interface FakeResponse {
    status(code: number): FakeResponse;
    json(body: unknown): FakeResponse;
  }

  beforeAll(async () => {
    ({ LoggingInterceptor: LoggingInterceptorClass } = await import('../src/core/interceptors/logging.interceptor'));
    ({ GlobalHttpExceptionFilter: ExceptionFilterClass } = await import('../src/core/filters/http-exception.filter'));
    ({ errorRegistry: registry } = await import('../src/core/observability/error-registry'));
  });

  /** The label the error registry holds for the 500 whose message is `message` (null when none). */
  function registryLabel(message: string): string | null {
    return registry.snapshot(200).entries.find((e) => e.source === 'http' && e.message === message)?.label ?? null;
  }

  /** The request Express hands a handler: `route.path` is set only when a route matched. */
  function fakeRequest(method: string, url: string, routePath?: string): Record<string, unknown> {
    const req: Record<string, unknown> = { method, url, originalUrl: url, path: url.split('?')[0], correlationId: CORRELATION };
    if (routePath !== undefined) req.route = { path: routePath };
    return req;
  }

  const escapeRe = (s: string) => s.replace(/[.*?+^$()[\]\\|{}]/g, '\\$&');

  /** Each leaking entry on its own line, in full, for the failure message. */
  const describeEntries = (entries: LogEntry[]) => entries.map((e) => `${e.channel}: ${e.text}`).join('\n');

  function http(req: Record<string, unknown>, res: unknown): ExecutionContext & ArgumentsHost {
    return { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext & ArgumentsHost;
  }

  /**
   * One request through the production LoggingInterceptor; `error` makes the
   * handler throw it. `routePath` is the pattern Express matched (absent: no route).
   * `elapsedMs` is how long the handler takes on a stubbed Date.now (absent:
   * the real clock, a few ms, so the line is the debug one).
   */
  async function throughInterceptor(
    method: string,
    url: string,
    statusCode: number,
    error?: Error,
    routePath?: string,
    elapsedMs?: number,
  ): Promise<LogEntry[]> {
    const cap = startCapture();
    let clock = 1_700_000_000_000;
    const clockSpy = elapsedMs === undefined ? null : vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const ctx = http(fakeRequest(method, url, routePath), { statusCode });
      const next: CallHandler = {
        handle: () =>
          defer(() => {
            if (elapsedMs !== undefined) clock += elapsedMs;
            return error ? throwError(() => error) : of({ ok: true });
          }),
      };
      await lastValueFrom(new LoggingInterceptorClass().intercept(ctx, next)).catch(() => undefined);
    } finally {
      clockSpy?.mockRestore();
      cap.stop();
    }
    return cap.entries;
  }

  /** One exception through the production GlobalHttpExceptionFilter. `routePath` as for throughInterceptor. */
  function throughFilter(method: string, url: string, exception: unknown, routePath?: string): { entries: LogEntry[]; status: number } {
    const cap = startCapture();
    let status = 0;
    try {
      const res: FakeResponse = {
        status: (s: number) => {
          status = s;
          return res;
        },
        json: () => res,
      };
      new ExceptionFilterClass().catch(exception, http(fakeRequest(method, url, routePath), res));
    } finally {
      cap.stop();
    }
    return { entries: cap.entries, status };
  }

  /**
   * Mounted public routes whose URL carries a platform secret, with the route
   * pattern Express sets on req.route.path when the route matches.
   */
  const FLOWS = [
    // apps/server/src/modules/chatwoot/chatwoot.controller.ts:14, POST /chatwoot/webhook/:secret
    { name: 'the Chatwoot webhook secret in the path', method: 'POST', url: `/chatwoot/webhook/${CHATWOOT_SECRET}`, route: '/chatwoot/webhook/:secret', status: 202, secret: CHATWOOT_SECRET },
    // apps/server/src/modules/whatsapp/whatsapp.controller.ts:234-237, WHATSAPP_VERIFY_TOKEN in hub.verify_token
    { name: 'WHATSAPP_VERIFY_TOKEN in the query', method: 'GET', url: `/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1234`, route: '/whatsapp/webhook', status: 200, secret: VERIFY_TOKEN },
    // apps/server/src/modules/google-drive/google-drive.controller.ts:26, an OAuth authorization code
    { name: 'an OAuth code on a callback', method: 'GET', url: `/drive/callback?state=${P}state&code=${OAUTH_CODE}`, route: '/drive/callback', status: 302, secret: OAUTH_CODE },
  ];

  // RED on the V1-83 tests-first commit at bb6b86d4: the access line was
  // built from req.url (logging.interceptor.ts:22, emitted at :26 debug and
  // :32 error), and the 500 line logged request.url
  // (http-exception.filter.ts:65), so each secret reached all three.
  it('NEGATIVE CONTROL: no HTTP access line carries a platform secret in the path or query (Chatwoot webhook secret, hub.verify_token, OAuth code): the success line, the 403 error line and the 500 line name the route pattern', async () => {
    const runs = [];
    for (const flow of FLOWS) {
      const success = await throughInterceptor(flow.method, flow.url, flow.status, undefined, flow.route);
      const refused = await throughInterceptor(flow.method, flow.url, 403, new ForbiddenException('Invalid verify token'), flow.route);
      const unhandledMessage = `v40a unhandled on ${flow.route}`;
      const unhandled = throughFilter(flow.method, flow.url, new Error(unhandledMessage), flow.route);
      runs.push({ flow, success, refused, unhandled, unhandledMessage });
    }

    // Every flow's leaks first, so a failure names each secret on each surface.
    const leaks = runs.flatMap(({ flow, success, refused, unhandled, unhandledMessage }) =>
      entriesContaining(
        [...success, ...refused, ...unhandled.entries, { channel: 'errorRegistry[http].label', text: registryLabel(unhandledMessage) ?? '' }],
        [flow.secret, encodeURIComponent(flow.secret)],
      ),
    );
    expect(leaks, describeEntries(leaks)).toEqual([]);

    for (const { flow, success, refused, unhandled, unhandledMessage } of runs) {
      expect(success.map((e) => e.channel), flow.name).toEqual(['Logger#debug[HTTP]']);
      expect(success[0].text, flow.name).toMatch(new RegExp(`^${flow.method} ${escapeRe(flow.route)} ${flow.status} \\d+ms \\[${CORRELATION}\\]$`));

      expect(refused.map((e) => e.channel), flow.name).toEqual(['Logger#error[HTTP]']);
      expect(refused[0].text, flow.name).toMatch(new RegExp(`^${flow.method} ${escapeRe(flow.route)} ERR \\d+ms \\[${CORRELATION}\\] Invalid verify token$`));

      expect(unhandled.status, flow.name).toBe(500);
      expect(unhandled.entries.map((e) => e.channel), flow.name).toEqual(['Logger#error[GlobalHttpExceptionFilter]']);
      expect(unhandled.entries[0].text.startsWith(`Unhandled exception on ${flow.method} ${flow.route} [${CORRELATION}]`), flow.name).toBe(true);
      expect(registryLabel(unhandledMessage), flow.name).toBe(`${flow.method} ${flow.route}`);
    }
  });

  // RED on the V1-83 tests-first commit at bb6b86d4: http-exception.filter.ts:65
  // logged request.url (a fix to LoggingInterceptor alone left it open).
  it('NEGATIVE CONTROL: no 500 line carries a token in the URL: the filter names the route pattern, and so does its registry label', () => {
    const message = 'v40a unhandled on the token route';
    const { entries, status } = throughFilter('GET', `/commerce/public/invoice-link/${LINK_TOKEN}`, new Error(message), '/commerce/public/invoice-link/:token');
    expect(status).toBe(500);
    const leaks = entriesContaining(entries, [LINK_TOKEN]);
    expect(leaks, describeEntries(leaks)).toEqual([]);
    expect(entries.map((e) => e.channel)).toEqual(['Logger#error[GlobalHttpExceptionFilter]']);
    expect(entries[0].text.startsWith(`Unhandled exception on GET /commerce/public/invoice-link/:token [${CORRELATION}]`)).toBe(true);
    expect(registryLabel(message)).toBe('GET /commerce/public/invoice-link/:token');
  });

  // RED on the V1-83 tests-first commit at bb6b86d4: with no req.route the
  // access line and the 500 line logged the raw URL, and the registry label
  // fell back to request.url (http-exception.filter.ts:77).
  it('NEGATIVE CONTROL: a request no route matched logs neither its path nor its query: the access line, the 500 line and the registry label name <unrouted>', async () => {
    const needles = [UNROUTED_PATH_SECRET, UNROUTED_QUERY_SECRET, `${P}nowhere`];
    const success = await throughInterceptor('GET', UNROUTED_URL, 200);
    const failed = await throughInterceptor('GET', UNROUTED_URL, 500, new Error('v40a unrouted failure'));
    const message = 'v40a unhandled with no route';
    const unhandled = throughFilter('GET', UNROUTED_URL, new Error(message));

    const leaks = entriesContaining(
      [...success, ...failed, ...unhandled.entries, { channel: 'errorRegistry[http].label', text: registryLabel(message) ?? '' }],
      needles,
    );
    expect(leaks, describeEntries(leaks)).toEqual([]);

    expect(success.map((e) => e.channel)).toEqual(['Logger#debug[HTTP]']);
    expect(success[0].text).toMatch(new RegExp(`^GET ${escapeRe(UNROUTED)} 200 \\d+ms \\[${CORRELATION}\\]$`));
    expect(failed.map((e) => e.channel)).toEqual(['Logger#error[HTTP]']);
    expect(failed[0].text).toMatch(new RegExp(`^GET ${escapeRe(UNROUTED)} ERR \\d+ms \\[${CORRELATION}\\] v40a unrouted failure$`));

    expect(unhandled.status).toBe(500);
    expect(unhandled.entries.map((e) => e.channel)).toEqual(['Logger#error[GlobalHttpExceptionFilter]']);
    expect(unhandled.entries[0].text.startsWith(`Unhandled exception on GET ${UNROUTED} [${CORRELATION}]`)).toBe(true);
    const label = registryLabel(message);
    expect(label).toBe(`GET ${UNROUTED}`);
    for (const needle of needles) expect(label ?? '').not.toContain(needle);
  });

  // The SLOW warn line (duration > 1000 ms) is the access line's third
  // emitter. An OAuth callback that exchanges its code with the provider is a
  // realistic path past one second. Before this case, putting req.originalUrl
  // back into that branch alone left the whole suite green (SEC-C1-1).
  it('NEGATIVE CONTROL: a slow request (past the 1000 ms threshold) logs the SLOW warn line with the route pattern, never the URL: every platform-secret flow and an unrouted request', async () => {
    const SLOW_MS = 1500;
    const cases = [
      ...FLOWS.map((f) => ({ name: f.name, method: f.method, url: f.url, routePath: f.route as string | undefined, pattern: f.route, status: f.status, needles: [f.secret, encodeURIComponent(f.secret)] })),
      { name: 'an unrouted request', method: 'GET', url: UNROUTED_URL, routePath: undefined, pattern: UNROUTED, status: 200, needles: [UNROUTED_PATH_SECRET, UNROUTED_QUERY_SECRET, `${P}nowhere`] },
    ];
    const runs: Array<{ c: (typeof cases)[number]; entries: LogEntry[] }> = [];
    for (const c of cases) runs.push({ c, entries: await throughInterceptor(c.method, c.url, c.status, undefined, c.routePath, SLOW_MS) });

    const leaks = runs.flatMap(({ c, entries }) => entriesContaining(entries, c.needles));
    expect(leaks, describeEntries(leaks)).toEqual([]);

    for (const { c, entries } of runs) {
      expect(entries.map((e) => e.channel), c.name).toEqual(['Logger#warn[HTTP]']);
      expect(entries[0].text, c.name).toBe(`SLOW ${c.method} ${c.pattern} ${c.status} ${SLOW_MS}ms [${CORRELATION}]`);
    }
  });

  // The committed form of the review grep (SEC-C1-1). The runtime cases above
  // drive each emitter; this pins that no emitter can reach the URL at all,
  // including one added later. The only URL read left is the filter's
  // response body (`path: request.url`, the caller's own URL echoed back to
  // the caller; crm-contact-duplicate pins it), which no log call references.
  it('STATIC: LoggingInterceptor and GlobalHttpExceptionFilter read no request URL, path, query or params, except the filter response body, and no log call names that body', () => {
    const URL_READ = /\b(?:url|originalUrl|baseUrl)\b|\b(?:req|request)\s*\??\.\s*(?:path|query|params)\b/g;
    const code = (rel: string) =>
      readFileSync(path.join(REPO_ROOT, rel), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    /** Each `this.logger.<level>(...)` and `errorRegistry.record(...)` call: its level (or 'record') and its argument text. */
    const logCalls = (src: string) => {
      const calls: Array<{ level: string; args: string }> = [];
      for (const m of src.matchAll(/this\.logger\.(\w+)\(|errorRegistry\.(record)\(/g)) {
        let depth = 1;
        let i = m.index! + m[0].length;
        const from = i;
        for (; i < src.length && depth > 0; i++) {
          if (src[i] === '(') depth++;
          else if (src[i] === ')') depth--;
        }
        calls.push({ level: m[1] ?? m[2], args: src.slice(from, i - 1) });
      }
      return calls;
    };

    const interceptor = code('apps/server/src/core/interceptors/logging.interceptor.ts');
    expect(interceptor.match(URL_READ) ?? [], 'logging.interceptor.ts reads the request URL').toEqual([]);

    const filter = code('apps/server/src/core/filters/http-exception.filter.ts');
    const reads = [...filter.matchAll(URL_READ)];
    expect(reads.map((r) => r[0]), 'http-exception.filter.ts reads the request URL only once').toEqual(['url']);
    const bodyStart = filter.indexOf('const body');
    const bodyEnd = filter.indexOf('};', bodyStart);
    const readLine = filter.slice(filter.lastIndexOf('\n', reads[0].index!) + 1, filter.indexOf('\n', reads[0].index!)).trim();
    expect(readLine).toBe('path: request.url,');
    expect(bodyStart).toBeGreaterThan(-1);
    expect(reads[0].index!).toBeGreaterThan(bodyStart);
    expect(reads[0].index!).toBeLessThan(bodyEnd);

    // Every emitter, so a new one is seen here and gets its runtime case in
    // this section; none of their arguments reads the URL or the body.
    const interceptorCalls = logCalls(interceptor);
    const filterCalls = logCalls(filter);
    expect(interceptorCalls.map((c) => c.level)).toEqual(['warn', 'debug', 'error']);
    expect(filterCalls.map((c) => c.level)).toEqual(['error', 'record']);
    for (const c of [...interceptorCalls, ...filterCalls]) {
      expect(c.args.match(URL_READ) ?? [], c.args).toEqual([]);
      expect(c.args, c.args).not.toMatch(/\bbody\b/);
    }
  });

  it('the filter logs only on the 500 branch: a 4xx on the same route logs nothing', () => {
    const { entries, status } = throughFilter('GET', `/commerce/public/invoice-link/${LINK_TOKEN}`, new ForbiddenException());
    expect(status).toBe(403);
    expect(entries).toEqual([]);
  });
});

// ===========================================================================
// 1c. The SEND_EMAIL action's real sender logs no recipient email or message content (no database)
// ===========================================================================

/**
 * FOLLOW3-C2 review (SEC-C2-1, F1), closed by W3-C2b-EMAIL-LOG-LEAK. Section
 * 1's SEND_EMAIL window replaces TransactionalEmailService with a stand-in (no
 * provider traffic), so its negative control sees the executor's own line
 * only. Here the real AutomationExecutorService runs one SEND_EMAIL playbook
 * through the real TransactionalEmailService. Stand-ins: Prisma (the playbook,
 * the business, a contact that may be contacted, the notification log),
 * CrmService (the contact's detail), ActivityService, and GmailService, which
 * reports connected and sends nothing. The sender's retry wait is skipped.
 *
 * Before W3-C2b the sender logged the recipient email itself
 * (transactional-email.service.ts:760 on a send, :764 on each failed attempt,
 * :771 after the last; also :262 on a referral-CTA error and :361 on a dedupe
 * skip), pinned here by two CHARACTERIZATION cases with the negative control
 * as it.todo. The sender's lines now name the contact by id, as FOLLOW3-C2 did
 * for the executor's lines (IA-044, CF-029), or "a recipient with no contact"
 * when the send carries none. Error text (Gmail, a template, a lookup) reaches
 * the logs with every address-shaped token and the message's subject
 * redacted, and a failed notification-log write logs its error class and code
 * only: a Prisma validation error quotes its whole argument (the recipient,
 * the subject, the template data).
 *
 * The cases run the playbook path (a send, each failed attempt, the last
 * failure) and then the sender directly for the lines the playbook does not
 * reach: the referral CTA, the dedupe skip, a template failure and drainQueue.
 * Each negative control first finds the sender line it is about, so an emptied
 * log cannot pass.
 */
describe('the SEND_EMAIL action through the real transactional-email sender (no database): the sender logs no recipient email or message content (SEC-C2-1)', () => {
  const BIZ = `${P}sender_biz`;
  const BIZ_NAME = 'V40A Sender Biz';
  const CONTACT_ID = `${P}sender_contact`;
  const EMAIL = `${P}sender.contact@test.local`;
  const RECIPIENT_NAME = 'Ada Sender';
  const PLAYBOOK = 'V40A sender characterization';
  const INVOICE_NUMBER = `${P}INV-1`;
  const INVOICE_URL = `https://example.test/i/${P}link_token`;
  const LINE_ITEM = `${P}line item description`;
  const SUBJECT = `Invoice ${INVOICE_NUMBER} from ${BIZ_NAME}`;
  const SEND_EMAIL_ACTION = {
    type: 'SEND_EMAIL',
    notificationType: 'invoice_sent',
    templateData: {
      invoiceNumber: INVOICE_NUMBER,
      total: 100,
      currency: 'TTD',
      dueDate: '2026-12-01',
      invoiceUrl: INVOICE_URL,
      items: [{ description: LINE_ITEM, quantity: 1, unitPrice: 100, total: 100 }],
    },
  };
  /** What the message carries besides its recipient: none of it may reach a log line. */
  const CONTENT = [SUBJECT, INVOICE_NUMBER, INVOICE_URL, LINE_ITEM, RECIPIENT_NAME];

  let Executor: typeof import('../src/modules/flow/automation-executor.service').AutomationExecutorService;
  let Sender: typeof import('../src/modules/notifications/transactional-email.service').TransactionalEmailService;

  beforeAll(async () => {
    ({ AutomationExecutorService: Executor } = await import('../src/modules/flow/automation-executor.service'));
    ({ TransactionalEmailService: Sender } = await import('../src/modules/notifications/transactional-email.service'));
  });

  interface GmailPayload {
    to: string;
    subject: string;
    htmlBody: string;
  }

  /** The sender's own lines (every level). */
  const senderLines = (entries: LogEntry[]) => entries.filter((e) => e.channel.endsWith('[TransactionalEmailService]'));

  /** Run the SEND_EMAIL playbook on contact.created through the real sender, every log surface recorded. */
  async function runPlaybook(
    gmailSend: (payload: GmailPayload) => Promise<{ messageId: string }>,
    opts: { logCreate?: (args: unknown) => Promise<unknown> } = {},
  ): Promise<{ entries: LogEntry[]; gmailCalls: number; runs: number; sent: GmailPayload[] }> {
    let gmailCalls = 0;
    let runs = 0;
    const sent: GmailPayload[] = [];
    const prisma = {
      client: {
        automation: {
          findMany: async () => [{ id: `${P}sender_playbook`, name: PLAYBOOK, condition: null, actionData: SEND_EMAIL_ACTION }],
          update: async () => {
            runs++;
            return {};
          },
        },
        business: { findUnique: async () => ({ id: BIZ, name: BIZ_NAME, notificationPreferences: {} }) },
        contact: { findFirst: async () => ({ doNotContact: false }) },
        customerNotificationLog: { findFirst: async () => null, create: opts.logCreate ?? (async () => ({})) },
      },
    };
    const gmail = {
      getGmailStatus: async () => ({ connected: true }),
      sendEmail: async (payload: GmailPayload) => {
        gmailCalls++;
        sent.push(payload);
        return gmailSend(payload);
      },
    };
    const crm = { contactDetail: async () => ({ contact: { id: CONTACT_ID, email: EMAIL, firstName: 'Ada', lastName: 'Sender' } }) };
    const activity = { log: async () => undefined };
    const sender = new Sender(prisma as never, gmail as never);
    const executor = new Executor(prisma as never, activity as never, crm as never, sender, null, null);
    // The sender waits attempt * 1000 ms between attempts; skip the wait.
    const wait = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as never);
    const cap = startCapture();
    try {
      await (executor as unknown as { executePlaybooks: (b: string, t: string, c: Record<string, unknown>) => Promise<void> }).executePlaybooks(
        BIZ,
        'contact.created',
        { contactId: CONTACT_ID },
      );
    } finally {
      cap.stop();
      wait.mockRestore();
    }
    return { entries: cap.entries, gmailCalls, runs, sent };
  }

  /**
   * Call the real sender directly (Prisma and Gmail stood in), every log surface
   * recorded. With `gmailSend`, Gmail answers through it and the sender's retry
   * wait is skipped.
   */
  async function runSender(
    call: (sender: InstanceType<typeof Sender>) => Promise<unknown>,
    notificationLog: Record<string, unknown> = {},
    opts: { gmailSend?: () => Promise<{ messageId: string }> } = {},
  ): Promise<{ entries: LogEntry[]; gmailCalls: number; result: unknown }> {
    let gmailCalls = 0;
    const prisma = {
      client: {
        business: { findUnique: async () => ({ id: BIZ, name: BIZ_NAME, slug: `${P}sender-biz`, notificationPreferences: {} }) },
        contact: { findFirst: async () => ({ doNotContact: false }) },
        customerNotificationLog: { findFirst: async () => null, create: async () => ({}), ...notificationLog },
      },
    };
    const gmail = {
      getGmailStatus: async () => ({ connected: true }),
      sendEmail: async () => {
        gmailCalls++;
        return opts.gmailSend ? opts.gmailSend() : { messageId: `${P}msg` };
      },
    };
    const sender = new Sender(prisma as never, gmail as never);
    const wait = opts.gmailSend
      ? vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
          fn();
          return 0;
        }) as never)
      : null;
    const cap = startCapture();
    let result: unknown;
    try {
      result = await call(sender);
    } finally {
      cap.stop();
      wait?.mockRestore();
    }
    return { entries: cap.entries, gmailCalls, result };
  }

  it('the run is real: the playbook ran once, the real sender reached Gmail once, and the executor line names the contact id', async () => {
    const { entries, gmailCalls, runs } = await runPlaybook(async () => ({ messageId: `${P}msg` }));
    expect(runs).toBe(1);
    expect(gmailCalls).toBe(1);
    expect(entries.filter((e) => e.channel === 'Logger#log[AutomationExecutorService]' && e.text.startsWith('Email sent to ')).map((e) => e.text)).toEqual([
      `Email sent to contact ${CONTACT_ID} for playbook "${PLAYBOOK}"`,
    ]);
  });

  it('SEC-C2-1: a send logs its outcome once, on the sender line (transactional-email.service.ts:760), naming the contact id and the business; the mail itself still goes to the recipient with its content', async () => {
    const { entries, sent } = await runPlaybook(async () => ({ messageId: `${P}msg` }));
    expect(senderLines(entries)).toEqual([
      { channel: 'Logger#log[TransactionalEmailService]', text: `Sent invoice_sent to contact ${CONTACT_ID} for business ${BIZ}` },
    ]);
    // Only the logs change: Gmail was asked to send this message to this address.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    expect(sent[0].subject).toBe(SUBJECT);
    for (const piece of [INVOICE_NUMBER, INVOICE_URL, LINE_ITEM, RECIPIENT_NAME]) expect(sent[0].htmlBody).toContain(piece);
  });

  it('SEC-C2-1: a failed send logs each attempt at warn (:764) and the last failure at error (:771), naming the contact id, with the Gmail error text', async () => {
    const { entries, gmailCalls } = await runPlaybook(async () => {
      throw new Error('V40A gmail stand-in refused');
    });
    expect(gmailCalls).toBe(3);
    expect(senderLines(entries)).toEqual([
      { channel: 'Logger#warn[TransactionalEmailService]', text: `Attempt 1/3 failed for invoice_sent to contact ${CONTACT_ID}: V40A gmail stand-in refused` },
      { channel: 'Logger#warn[TransactionalEmailService]', text: `Attempt 2/3 failed for invoice_sent to contact ${CONTACT_ID}: V40A gmail stand-in refused` },
      { channel: 'Logger#warn[TransactionalEmailService]', text: `Attempt 3/3 failed for invoice_sent to contact ${CONTACT_ID}: V40A gmail stand-in refused` },
      { channel: 'Logger#error[TransactionalEmailService]', text: `All 3 attempts failed for invoice_sent to contact ${CONTACT_ID}: V40A gmail stand-in refused` },
    ]);
  });

  it("NEGATIVE CONTROL: the real sender logs no recipient email on a send, a failed attempt or the last failure when a SEND_EMAIL playbook runs (transactional-email.service.ts:760, :764, :771)", async () => {
    const ok = await runPlaybook(async () => ({ messageId: `${P}msg` }));
    expect(senderLines(ok.entries)).toHaveLength(1);
    expect(entriesContaining(ok.entries, emailForms(EMAIL))).toEqual([]);

    // A Gmail error that quotes the recipient is redacted before it is logged.
    const failed = await runPlaybook(async (payload) => {
      throw new Error(`V40A gmail stand-in refused ${payload.to}: mailbox unavailable`);
    });
    expect(failed.gmailCalls).toBe(3);
    expect(senderLines(failed.entries).map((e) => e.text)).toEqual([
      `Attempt 1/3 failed for invoice_sent to contact ${CONTACT_ID}: V40A gmail stand-in refused <address>: mailbox unavailable`,
      `Attempt 2/3 failed for invoice_sent to contact ${CONTACT_ID}: V40A gmail stand-in refused <address>: mailbox unavailable`,
      `Attempt 3/3 failed for invoice_sent to contact ${CONTACT_ID}: V40A gmail stand-in refused <address>: mailbox unavailable`,
      `All 3 attempts failed for invoice_sent to contact ${CONTACT_ID}: V40A gmail stand-in refused <address>: mailbox unavailable`,
    ]);
    expect(entriesContaining(failed.entries, emailForms(EMAIL))).toEqual([]);
  });

  it('NEGATIVE CONTROL (SEC-C2-1): no log entry carries the message content (subject, invoice number, link, line item, recipient name) on a send, a failed send whose Gmail error quotes the message, or a notification-log write whose error quotes the row', async () => {
    const ok = await runPlaybook(async () => ({ messageId: `${P}msg` }));
    expect(senderLines(ok.entries)).toHaveLength(1);
    expect(entriesContaining(ok.entries, CONTENT)).toEqual([]);

    const failed = await runPlaybook(async (payload) => {
      throw new Error(`V40A gmail stand-in rejected "${payload.subject}" for ${payload.to}`);
    });
    expect(senderLines(failed.entries)).toHaveLength(4);
    expect(senderLines(failed.entries)[3].text).toBe(`All 3 attempts failed for invoice_sent to contact ${CONTACT_ID}: V40A gmail stand-in rejected "<subject>" for <address>`);
    expect(entriesContaining(failed.entries, [...CONTENT, ...emailForms(EMAIL)])).toEqual([]);

    // A Prisma validation error quotes the whole create() argument: the
    // recipient, its name and the subject. The line keeps the error class only.
    const unlogged = await runPlaybook(async () => ({ messageId: `${P}msg` }), {
      logCreate: async (args) => {
        throw Object.assign(new Error(`Invalid \`prisma.customerNotificationLog.create()\` invocation: ${JSON.stringify(args)}`), {
          name: 'PrismaClientValidationError',
        });
      },
    });
    const logLine = senderLines(unlogged.entries).filter((e) => e.text.startsWith('Failed to log notification'));
    expect(logLine).toEqual([
      { channel: 'Logger#error[TransactionalEmailService]', text: `Failed to log notification (SENT invoice_sent to contact ${CONTACT_ID}): PrismaClientValidationError` },
    ]);
    expect(entriesContaining(unlogged.entries, [...CONTENT, ...emailForms(EMAIL)])).toEqual([]);
  });

  it('NEGATIVE CONTROL (SEC-C2-1): the referral-CTA error line (:262) and the dedupe skip line (:361) carry no recipient email; each names the contact id', async () => {
    // booking_confirmed looks for an earlier referral marker keyed by the
    // address; a lookup error that quotes that key is redacted before it is logged.
    const referral = await runSender(
      (sender) =>
        sender.send({
          businessId: BIZ,
          type: 'booking_confirmed',
          recipientEmail: EMAIL,
          recipientName: RECIPIENT_NAME,
          contactId: CONTACT_ID,
          templateData: { serviceName: 'V40A Cut', startTime: '2026-12-01T10:00:00Z', endTime: '2026-12-01T11:00:00Z', bookingId: `${P}booking` },
        }),
      {
        findFirst: async (args: unknown) => {
          throw new Error(`Invalid \`prisma.customerNotificationLog.findFirst()\` invocation: ${JSON.stringify(args)}`);
        },
      },
    );
    expect(referral.result).toEqual({ status: 'SENT', messageId: `${P}msg` });
    const referralLines = senderLines(referral.entries).filter((e) => e.text.startsWith('Referral CTA injection skipped'));
    expect(referralLines).toHaveLength(1);
    expect(referralLines[0].channel).toBe('Logger#warn[TransactionalEmailService]');
    expect(referralLines[0].text.startsWith(`Referral CTA injection skipped for contact ${CONTACT_ID} in business ${BIZ}: `)).toBe(true);
    expect(entriesContaining(referral.entries, emailForms(EMAIL))).toEqual([]);

    const dedupe = await runSender(
      (sender) =>
        sender.send({
          businessId: BIZ,
          type: 'invoice_sent',
          recipientEmail: EMAIL,
          recipientName: RECIPIENT_NAME,
          contactId: CONTACT_ID,
          templateData: SEND_EMAIL_ACTION.templateData,
          dedupeKey: `${P}dedupe_1`,
        }),
      { findFirst: async () => ({ id: `${P}log_1`, status: 'SENT', messageId: `${P}dedupe_1` }) },
    );
    expect(dedupe.gmailCalls).toBe(0);
    expect(senderLines(dedupe.entries)).toEqual([
      { channel: 'Logger#debug[TransactionalEmailService]', text: `Skipping duplicate invoice_sent for contact ${CONTACT_ID} (dedupeKey=${P}dedupe_1)` },
    ]);
    expect(entriesContaining(dedupe.entries, emailForms(EMAIL))).toEqual([]);
  });

  it('NEGATIVE CONTROL (SEC-C2-1): a template failure and a send drained from the queue (drainQueue calls send) log no recipient email; a send with no contact names none', async () => {
    // A template error that quotes the recipient is redacted before it is logged.
    const templateData: Record<string, unknown> = {};
    Object.defineProperty(templateData, 'invoiceNumber', {
      enumerable: true,
      get() {
        throw new Error(`V40A template stand-in has no invoice for ${EMAIL}`);
      },
    });
    const broken = await runSender((sender) =>
      sender.send({ businessId: BIZ, type: 'invoice_sent', recipientEmail: EMAIL, recipientName: RECIPIENT_NAME, contactId: CONTACT_ID, templateData }),
    );
    expect(broken.result).toEqual({ status: 'FAILED' });
    expect(senderLines(broken.entries)).toEqual([
      { channel: 'Logger#error[TransactionalEmailService]', text: `Template rendering failed for invoice_sent to contact ${CONTACT_ID}: V40A template stand-in has no invoice for <address>` },
    ]);
    expect(entriesContaining(broken.entries, emailForms(EMAIL))).toEqual([]);

    // drainQueue re-sends a QUEUED row by its stored address; the row has no contact.
    const drained = await runSender((sender) => sender.drainQueue(), {
      findMany: async () => [
        {
          id: `${P}queued_1`,
          businessId: BIZ,
          type: 'invoice_sent',
          recipientEmail: EMAIL,
          recipientName: RECIPIENT_NAME,
          contactId: null,
          templateData: SEND_EMAIL_ACTION.templateData,
        },
      ],
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    });
    expect(drained.result).toBe(1);
    expect(drained.gmailCalls).toBe(1);
    expect(senderLines(drained.entries)).toEqual([
      { channel: 'Logger#log[TransactionalEmailService]', text: `Sent invoice_sent to a recipient with no contact for business ${BIZ}` },
      { channel: 'Logger#log[TransactionalEmailService]', text: 'Queue drain: sent 1/1 queued notifications' },
    ]);
    expect(entriesContaining(drained.entries, [...CONTENT, ...emailForms(EMAIL)])).toEqual([]);
  });

  it('CR-1 (W3-C2b review, SEC-C2-1): a Gmail failure whose message is not a string still ends the send FAILED and writes its FAILED notification row; every line names the contact id and no recipient email', async () => {
    // A provider error object as the thrown message: the redaction reads it as
    // text (as it was interpolated before SEC-C2-1), so the send keeps its
    // error contract ({status: 'FAILED'} and the FAILED row), never a TypeError.
    const providerMessage = { code: 503, toString: () => `gmail 503 for ${EMAIL}` };
    const rows: Array<{ status?: unknown }> = [];
    const failed = await runSender(
      (sender) =>
        sender.send({
          businessId: BIZ,
          type: 'invoice_sent',
          recipientEmail: EMAIL,
          recipientName: RECIPIENT_NAME,
          contactId: CONTACT_ID,
          templateData: SEND_EMAIL_ACTION.templateData,
        }),
      {
        create: async (args: { data: { status?: unknown } }) => {
          rows.push(args.data);
          return {};
        },
      },
      {
        gmailSend: async () => {
          throw { message: providerMessage };
        },
      },
    );
    expect(failed.result).toEqual({ status: 'FAILED' });
    expect(failed.gmailCalls).toBe(3);
    expect(rows.map((r) => r.status)).toEqual(['FAILED']);
    expect(senderLines(failed.entries)).toEqual([
      { channel: 'Logger#warn[TransactionalEmailService]', text: `Attempt 1/3 failed for invoice_sent to contact ${CONTACT_ID}: gmail 503 for <address>` },
      { channel: 'Logger#warn[TransactionalEmailService]', text: `Attempt 2/3 failed for invoice_sent to contact ${CONTACT_ID}: gmail 503 for <address>` },
      { channel: 'Logger#warn[TransactionalEmailService]', text: `Attempt 3/3 failed for invoice_sent to contact ${CONTACT_ID}: gmail 503 for <address>` },
      { channel: 'Logger#error[TransactionalEmailService]', text: `All 3 attempts failed for invoice_sent to contact ${CONTACT_ID}: gmail 503 for <address>` },
    ]);
    expect(entriesContaining(failed.entries, [...CONTENT, ...emailForms(EMAIL)])).toEqual([]);
  });
});

// ===========================================================================
// 2. The agent gate binds packet branches (D-22)
// ===========================================================================

describe('agent control gate: pkt/* heads are packet PRs (D-22)', () => {
  const GATE = path.join(REPO_ROOT, '.github/workflows/agent-control-gate.yml');

  /** The `case` arm of the scope step that sets required=true. */
  function requiredArm(): string {
    const gate = readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n');
    const start = gate.indexOf('- name: Determine whether packet controls apply');
    const end = gate.indexOf('- name: Validate control artifacts');
    expect(start > 0 && end > start, 'the scope step exists').toBe(true);
    const step = gate.slice(start, end);
    const arm = /\n\s+([^\n]+)\)\n\s+echo "required=true" >> "\$GITHUB_OUTPUT"/.exec(step);
    expect(arm, 'the scope step has a required=true arm').not.toBeNull();
    return arm![1].trim();
  }

  /** Bash `case` patterns of the arm, evaluated for one head ref. */
  function matches(arm: string, headRef: string): boolean {
    return arm.split('|').map((p) => p.trim()).some((pattern) => {
      const re = new RegExp(`^${pattern.replace(/[.+^${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      return re.test(headRef);
    });
  }

  it('NEGATIVE CONTROL: a pkt/* head triggers the packet controls', () => {
    const arm = requiredArm();
    expect(matches(arm, 'pkt/V1-40-SEC-TRUST-CENSUS-REDACTION'), `required arm: ${arm}`).toBe(true);
  });

  it('impl/* heads still trigger the packet controls, and other heads do not', () => {
    const arm = requiredArm();
    expect(matches(arm, 'impl/kf-meta-control-parser-001')).toBe(true);
    for (const head of ['main', 'claude/elegant-curie-7azpsb', 'dependabot/npm_and_yarn/foo-1.2.3', 'docs/x', 'int/trial-A', 'xpkt/x']) {
      expect(matches(arm, head), head).toBe(false);
    }
  });

  it('the gate still validates the artifacts and requires the #80 grant for every head the scope step admits', () => {
    const gate = readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n');
    expect(gate).toMatch(/- name: Validate control artifacts\n\s+if: steps\.scope\.outputs\.required == 'true'\n/);
    expect(gate).toMatch(/- name: Require ChatGPT admission before non-draft merge readiness\n\s+if: steps\.scope\.outputs\.required == 'true' && github\.event\.pull_request\.draft == false\n/);
    expect(gate).toContain('grant="$(node scripts/agent-control/auto-merge-admitted.mjs --grant-only)" || grant_status=$?');
  });

  it('the head ref reaches the scope and validation scripts through env, never interpolated into a run block', () => {
    const gate = readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n');
    // A branch name is attacker-chosen text; `${{ github.head_ref }}` inside run: is script injection.
    const runBlocks = gate.split(/\n\s+run: \|\n/).slice(1).map((b) => b.split(/\n\s{6}- name: /)[0]);
    expect(runBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of runBlocks) expect(block).not.toContain('github.head_ref');
    expect(gate).toMatch(/- name: Determine whether packet controls apply\n[\s\S]*?env:\n\s+HEAD_REF: \$\{\{ github\.head_ref \}\}\n\s+run: \|\n[\s\S]*?case "\$HEAD_REF" in/);
    expect(gate).toMatch(/if \[ "\$declared_branch" != "\$HEAD_REF" \]; then/);
    expect(gate).toMatch(/if \[ "\$return_branch" != "\$HEAD_REF" \]; then/);
  });

  // ---- the scripts themselves, executed with bash as the runner does --------

  /** The `run: |` script of one step, de-indented, as the runner hands it to bash. */
  function stepScript(stepName: string): string {
    const lines = readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
    expect(start, `step "${stepName}"`).toBeGreaterThan(0);
    const stepIndent = lines[start].search(/\S/);
    let i = start + 1;
    while (i < lines.length && !/^\s+run: \|\s*$/.test(lines[i])) {
      expect(lines[i].trim() === '' || lines[i].search(/\S/) > stepIndent, `step "${stepName}" has a run block`).toBe(true);
      i++;
    }
    const runIndent = lines[i].search(/\S/);
    const body: string[] = [];
    for (i += 1; i < lines.length; i++) {
      if (lines[i].trim() !== '' && lines[i].search(/\S/) <= runIndent) break;
      body.push(lines[i]);
    }
    const indent = Math.min(...body.filter((l) => l.trim() !== '').map((l) => l.search(/\S/)));
    const script = body.map((l) => l.slice(indent)).join('\n').trimEnd() + '\n';
    // An expression here would be substituted by the runner before bash sees it.
    expect(script, `step "${stepName}" carries no \${{ }} expression`).not.toContain('${{');
    return script;
  }

  /** `shell: bash` on a GitHub runner: bash --noprofile --norc -eo pipefail {0}. */
  function bash(script: string, cwd: string, env: Record<string, string>) {
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      cwd,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: cwd, ...env },
      encoding: 'utf8',
    });
  }

  function scope(headRef: string): { required: string; injected: boolean } {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v40a-scope-'));
    try {
      const out = path.join(dir, 'github_output');
      writeFileSync(out, '');
      const r = bash(stepScript('Determine whether packet controls apply'), dir, { HEAD_REF: headRef, GITHUB_OUTPUT: out });
      expect(r.status, r.stderr).toBe(0);
      return { required: readFileSync(out, 'utf8').trim(), injected: existsSync(path.join(dir, 'PWNED')) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('the scope step, executed: pkt/* and impl/* heads are packet PRs; no other head is, and a head ref cannot inject', () => {
    for (const head of ['pkt/V1-40-SEC-TRUST-CENSUS-REDACTION', 'impl/kf-product-contacts-visibility-001']) {
      expect(scope(head), head).toEqual({ required: 'required=true', injected: false });
    }
    for (const head of ['main', 'pkt', 'Pkt/x', 'feature/pkt/x', 'xpkt/x', 'dependabot/github_actions/x']) {
      expect(scope(head), head).toEqual({ required: 'required=false', injected: false });
    }
    // A legal git ref name (no space) that would run a command if interpolated.
    expect(scope('pkt/$(touch${IFS}PWNED)')).toEqual({ required: 'required=true', injected: false });
    expect(scope('x";touch${IFS}PWNED;"')).toEqual({ required: 'required=false', injected: false });
  });

  /**
   * A throwaway repository holding control artifacts that name `artifactBranch`,
   * with the validation step run against it for the PR head `headRef`.
   */
  function validate(headRef: string, artifactBranch: string) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v40a-validate-'));
    try {
      const git = (...args: string[]) => {
        const r = spawnSync('git', ['-c', 'user.name=v40a', '-c', 'user.email=v40a@test.local', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
          cwd: dir,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1' },
          encoding: 'utf8',
        });
        expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).toBe(0);
        return r.stdout.trim();
      };
      git('init', '-q', '-b', 'work');
      writeFileSync(path.join(dir, 'README.md'), 'v40a fixture\n');
      git('add', '.');
      git('commit', '-q', '-m', 'source head');
      const sourceHead = git('rev-parse', 'HEAD');
      mkdirSync(path.join(dir, '.agent-control'));
      const common = [`implementation_branch: ${artifactBranch}`, 'state: PROVING', 'health: GREEN', 'scope_changed: false', 'production_touched: false'];
      writeFileSync(path.join(dir, '.agent-control/active-packet.yaml'), ['packet_id: V40A-FIXTURE', `source_main: ${sourceHead}`, ...common, ''].join('\n'));
      writeFileSync(
        path.join(dir, '.agent-control/claude-return.yaml'),
        ['packet_id: V40A-FIXTURE', `source_head: ${sourceHead}`, ...common, 'review_status: PENDING_CHATGPT_REVIEW', ''].join('\n'),
      );
      git('add', '.');
      git('commit', '-q', '-m', 'control artifacts');
      const r = bash(stepScript('Validate control artifacts'), dir, { HEAD_REF: headRef });
      return { status: r.status, output: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('the validation step, executed: a pkt/* PR whose artifacts name an impl/* branch fails closed there, draft or not (CR-V140-2)', () => {
    const r = validate('pkt/V1-40-SEC-TRUST-CENSUS-REDACTION', 'impl/kf-product-contacts-visibility-001');
    expect(r.status).toBe(1);
    expect(r.output).toContain('::error::active-packet.yaml implementation_branch does not match PR head');
  });

  it('the validation step, executed: artifacts that name the pkt/* head pass it (the remaining barrier for a non-draft PR is the grant step)', () => {
    const r = validate('pkt/V1-40-SEC-TRUST-CENSUS-REDACTION', 'pkt/V1-40-SEC-TRUST-CENSUS-REDACTION');
    expect(r.output).toBe('');
    expect(r.status).toBe(0);
  });

  it("this checkout's own control artifacts name an impl/* branch, so a pkt/* PR off this base stops at the validation step", () => {
    const active = path.join(REPO_ROOT, '.agent-control/active-packet.yaml');
    if (!existsSync(active)) return;
    const declared = /^implementation_branch:[ \t]*"?([^"\n]*)"?/m.exec(readFileSync(active, 'utf8'))?.[1] ?? '';
    expect(declared.startsWith('pkt/'), `implementation_branch: ${declared}`).toBe(false);
  });

  it('CHARACTERIZATION (SEC-V40-2): the gate runs the PR\'s own workflow and script copies, and the comment and the census record that limit', () => {
    const gate = readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n');
    // pull_request (not pull_request_target): the workflow file comes from the PR.
    expect(gate).toMatch(/^on:\n\s+pull_request:\n/m);
    expect(gate).not.toContain('pull_request_target');
    // The checkout takes the PR merge ref (no `ref:`), and the grant step runs the checked-out copy.
    expect(gate).toMatch(/- name: Checkout PR\n\s+uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 0\n/);
    expect(gate).toContain('node scripts/agent-control/auto-merge-admitted.mjs --grant-only');
    // The scope step's comment states where pkt/* stops and the self-modification limit, not "cannot pass".
    const step = gate.slice(gate.indexOf('- name: Determine whether packet controls apply'), gate.indexOf('- name: Validate control artifacts'));
    expect(step).not.toMatch(/cannot pass the grant step/);
    expect(step).toContain('at "Validate control');
    expect(step).toContain("executes the PR's own");
    // The census carries the same limit on the rows that cite this gate as evidence.
    const census = readFileSync(path.join(REPO_ROOT, 'docs/reconstruction/product/evidence/RELEASE0-TRUST-CENSUS-001.md'), 'utf8');
    for (const id of ['IA-048', 'CF-023']) {
      const row = census.split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';
      expect(row, id).toMatch(/self-modifiable/);
    }
  });
});

// ===========================================================================
// 3. Dependabot
// ===========================================================================

describe('dependabot: version updates for the workspace and the workflows', () => {
  const FILE = path.join(REPO_ROOT, '.github/dependabot.yml');

  it('NEGATIVE CONTROL: .github/dependabot.yml exists (version 2)', () => {
    expect(existsSync(FILE), '.github/dependabot.yml').toBe(true);
    expect(readFileSync(FILE, 'utf8')).toMatch(/^version: 2$/m);
  });

  it('it watches the pnpm workspace (npm ecosystem at /) and the GitHub Actions workflows, on a schedule', () => {
    const text = existsSync(FILE) ? readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n') : '';
    const blocks = text.split(/\n\s*- package-ecosystem: /).slice(1);
    const ecosystem = (name: string) => blocks.find((b) => b.replace(/["']/g, '').startsWith(name));
    for (const name of ['npm', 'github-actions']) {
      const block = ecosystem(name);
      expect(block, `${name} entry`).toBeDefined();
      expect(block!).toMatch(/directory: ["']?\/["']?\n/);
      expect(block!).toMatch(/schedule:\n\s+interval: ["']?(daily|weekly|monthly)["']?/);
    }
  });

  it('the github-actions entry ignores the SHA- and digest-pinned secret scanner, which moves by hand (CR-V140-1)', () => {
    const text = existsSync(FILE) ? readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n') : '';
    const actions = text.split(/\n\s*- package-ecosystem: /).slice(1).find((b) => b.replace(/["']/g, '').startsWith('github-actions')) ?? '';
    // ci-cd.yml pins the action to a tag commit and the CLI image by digest; the
    // security suite asserts both, and Dependabot would rewrite only the first.
    const ciCd = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci-cd.yml'), 'utf8');
    expect(ciCd).toMatch(/uses: trufflesecurity\/trufflehog@[0-9a-f]{40} # v\d+\.\d+\.\d+\n\s+with:\n\s+path: \.\/\n\s+version: '[\d.]+@sha256:[0-9a-f]{64}'/);
    expect(actions).toMatch(/\n\s+ignore:\n\s+- dependency-name: ["']?trufflesecurity\/trufflehog["']?\n/);
    // Every other action in the workflows is pinned by tag, which Dependabot moves whole.
    const shaPinned = new Set<string>();
    const workflows = path.join(REPO_ROOT, '.github/workflows');
    for (const name of readdirSync(workflows)) {
      if (!/\.ya?ml$/.test(name)) continue;
      for (const m of readFileSync(path.join(workflows, name), 'utf8').matchAll(/uses: ([\w.-]+\/[\w./-]+)@[0-9a-f]{40}\b/g)) shaPinned.add(m[1]);
    }
    expect([...shaPinned]).toEqual(['trufflesecurity/trufflehog']);
  });
});

// ===========================================================================
// 4. The Release 0 trust census
// ===========================================================================

describe('Release 0 trust census (RELEASE0-TRUST-CENSUS-001)', () => {
  const FILE = path.join(REPO_ROOT, 'docs/reconstruction/product/evidence/RELEASE0-TRUST-CENSUS-001.md');
  /**
   * CF-029's two states for the platform sender's caller lines (SEC-W4HK-1,
   * CR-W5SEC-2): OPEN before W5-SYSTEM-EMAIL-CALLERS; closed by it, and by
   * W6-LOG-ADDRESSES-AND-DOCS for the approval routing caller, after. The
   * other address-logging calls stay OPEN after them.
   */
  const CALLERS_OPEN = "OPEN: the platform sender's callers";
  const CALLERS_CLOSED = "the platform sender's callers that logged the recipient or that error text were closed by W5-SYSTEM-EMAIL-CALLERS";
  const APPROVAL_CLOSED = 'the approval routing caller was closed by W6-LOG-ADDRESSES-AND-DOCS';
  const OTHERS_OPEN = 'OPEN: other production log calls';

  /** The ids of the source matrices: 68 assurance domains and 50 catastrophic-failure scenarios. */
  const IA_IDS = Array.from({ length: 68 }, (_, i) => `IA-${String(i + 1).padStart(3, '0')}`);
  const CF_IDS = Array.from({ length: 50 }, (_, i) => `CF-${String(i + 1).padStart(3, '0')}`);

  const STATES = ['UNASSESSED', 'CHARACTERIZING', 'CHARACTERIZED', 'DESIGNED', 'IMPLEMENTED_NOT_PROVEN', 'PROVEN_AT_DECLARED_SCOPE', 'EXTERNALLY_VERIFIED', 'BLOCKED', 'NOT_APPLICABLE'];
  const DISPOSITIONS = ['PREVENTED', 'DETECTED_AND_CONTAINED', 'RECOVERABLE', 'TRANSFERRED', 'ACCEPTED_RESIDUAL_RISK', 'NOT_APPLICABLE', 'RELEASE_BLOCKING'];
  /** A disposition that claims a working control must stand on a cited test. */
  const CLAIMING = ['PREVENTED', 'DETECTED_AND_CONTAINED', 'RECOVERABLE'];
  const TEST_PATH = /\.(spec|test)\.[cm]?[jt]sx?$/;

  interface Row {
    id: string;
    cells: string[];
  }

  function rows(prefix: 'IA' | 'CF'): Row[] {
    const text = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
    return text
      .split('\n')
      .filter((l) => new RegExp(`^\\| ${prefix}-\\d{3} \\|`).test(l))
      .map((l) => {
        const cells = l.split('|').slice(1, -1).map((c) => c.trim());
        return { id: cells[0], cells };
      });
  }

  /**
   * IA table:  | ID | Tier | Domain | Recorded | R0 touch | Evidence | Proposed state | Disposition |
   * CF table:  | ID | Tier | Scenario | Domains | R0 touch | Evidence | Proposed disposition |
   */
  const IA_COL = { tier: 1, touch: 4, evidence: 5, state: 6, disposition: 7, width: 8 };
  const CF_COL = { tier: 1, touch: 4, evidence: 5, disposition: 6, width: 7 };

  function citedPaths(cell: string): string[] {
    return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  }

  function checkEvidence(row: Row, cell: string): string[] {
    const problems: string[] = [];
    const paths = citedPaths(cell);
    const open = /\bOPEN\b/.test(cell);
    if (!open && paths.length === 0) problems.push(`${row.id}: evidence cites no test path and does not say OPEN`);
    for (const p of paths) {
      if (!TEST_PATH.test(p)) problems.push(`${row.id}: ${p} is not a test path`);
      else if (!existsSync(path.join(REPO_ROOT, p))) problems.push(`${row.id}: ${p} does not exist`);
    }
    return problems;
  }

  it('NEGATIVE CONTROL: the census exists, names its owner of record (D-22) and was not posted by this worker', () => {
    expect(existsSync(FILE), 'RELEASE0-TRUST-CENSUS-001.md').toBe(true);
    const text = readFileSync(FILE, 'utf8');
    expect(text).toMatch(/owner_of_record: owner\b/);
    expect(text).toMatch(/posted: false\b/);
  });

  it('every assurance domain (IA-001..IA-068) and every catastrophic-failure scenario (CF-001..CF-050) has exactly one row', () => {
    expect(rows('IA').map((r) => r.id)).toEqual(IA_IDS);
    expect(rows('CF').map((r) => r.id)).toEqual(CF_IDS);
  });

  it('every IA row cites an existing test path or OPEN, proposes an allowed state, and every T0 row carries a disposition', () => {
    const problems: string[] = [];
    for (const row of rows('IA')) {
      if (row.cells.length !== IA_COL.width) { problems.push(`${row.id}: ${row.cells.length} cells`); continue; }
      const tier = row.cells[IA_COL.tier];
      if (!/^T[0-3]$/.test(tier)) problems.push(`${row.id}: tier ${tier}`);
      if (!/^(yes|no)\b/.test(row.cells[IA_COL.touch])) problems.push(`${row.id}: R0 touch must say yes or no`);
      problems.push(...checkEvidence(row, row.cells[IA_COL.evidence]));
      const state = row.cells[IA_COL.state].replace(/`/g, '');
      if (!STATES.includes(state)) problems.push(`${row.id}: proposed state ${state}`);
      const disposition = row.cells[IA_COL.disposition].replace(/`/g, '');
      if (tier === 'T0' && !DISPOSITIONS.includes(disposition)) problems.push(`${row.id}: T0 disposition ${disposition || '(none)'}`);
      if (disposition && disposition !== '-' && !DISPOSITIONS.includes(disposition)) problems.push(`${row.id}: disposition ${disposition}`);
      if (CLAIMING.includes(disposition) && citedPaths(row.cells[IA_COL.evidence]).length === 0) {
        problems.push(`${row.id}: ${disposition} claimed with no cited test`);
      }
      if (state === 'PROVEN_AT_DECLARED_SCOPE' && citedPaths(row.cells[IA_COL.evidence]).length === 0) {
        problems.push(`${row.id}: PROVEN_AT_DECLARED_SCOPE with no cited test`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every CF row cites an existing test path or OPEN, and every T0 scenario carries a disposition', () => {
    const problems: string[] = [];
    for (const row of rows('CF')) {
      if (row.cells.length !== CF_COL.width) { problems.push(`${row.id}: ${row.cells.length} cells`); continue; }
      const tier = row.cells[CF_COL.tier];
      if (!/^T[0-3]$/.test(tier)) problems.push(`${row.id}: tier ${tier}`);
      if (!/^(yes|no)\b/.test(row.cells[CF_COL.touch])) problems.push(`${row.id}: R0 touch must say yes or no`);
      problems.push(...checkEvidence(row, row.cells[CF_COL.evidence]));
      const disposition = row.cells[CF_COL.disposition].replace(/`/g, '');
      if (tier === 'T0' && !DISPOSITIONS.includes(disposition)) problems.push(`${row.id}: T0 disposition ${disposition || '(none)'}`);
      if (disposition && disposition !== '-' && !DISPOSITIONS.includes(disposition)) problems.push(`${row.id}: disposition ${disposition}`);
      if (CLAIMING.includes(disposition) && citedPaths(row.cells[CF_COL.evidence]).length === 0) {
        problems.push(`${row.id}: ${disposition} claimed with no cited test`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('ACCEPTED_RESIDUAL_RISK is never proposed by the worker: only the owner of record may accept a risk', () => {
    const accepted = [...rows('IA'), ...rows('CF')].filter((r) => r.cells.some((c) => c.replace(/`/g, '') === 'ACCEPTED_RESIDUAL_RISK'));
    expect(accepted.map((r) => r.id)).toEqual([]);
  });

  it('the summary table matches the rows (no drift between the counts and the tables)', () => {
    const text = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
    const summary = (label: string): [number, number] => {
      const line = text.split('\n').find((l) => l.startsWith(`| ${label} |`));
      expect(line, `summary row "${label}"`).toBeDefined();
      const [ia, cf] = line!.split('|').slice(2, 4).map((c) => Number(/^\s*(\d+)/.exec(c)?.[1]));
      return [ia, cf];
    };
    const ia = rows('IA');
    const cf = rows('CF');
    const t0 = (r: Row[]) => r.filter((x) => x.cells[1] === 'T0');
    const disp = (r: Row[], col: number, values: string[]) => r.filter((x) => values.includes(x.cells[col]));
    const openOnly = (r: Row[], col: number) => r.filter((x) => citedPaths(x.cells[col]).length === 0);
    const touched = (r: Row[], col: number) => r.filter((x) => x.cells[col].startsWith('yes'));
    expect(summary('Rows')).toEqual([ia.length, cf.length]);
    expect(summary('T0 rows')).toEqual([t0(ia).length, t0(cf).length]);
    expect(summary('T0 rows proposed PREVENTED or DETECTED_AND_CONTAINED')).toEqual([
      disp(t0(ia), IA_COL.disposition, ['PREVENTED', 'DETECTED_AND_CONTAINED']).length,
      disp(t0(cf), CF_COL.disposition, ['PREVENTED', 'DETECTED_AND_CONTAINED']).length,
    ]);
    expect(summary('T0 rows proposed NOT_APPLICABLE')).toEqual([
      disp(t0(ia), IA_COL.disposition, ['NOT_APPLICABLE']).length,
      disp(t0(cf), CF_COL.disposition, ['NOT_APPLICABLE']).length,
    ]);
    expect(summary('T0 rows RELEASE_BLOCKING')).toEqual([
      disp(t0(ia), IA_COL.disposition, ['RELEASE_BLOCKING']).length,
      disp(t0(cf), CF_COL.disposition, ['RELEASE_BLOCKING']).length,
    ]);
    expect(summary('Rows touched by Release 0 (`yes`)')).toEqual([touched(ia, IA_COL.touch).length, touched(cf, CF_COL.touch).length]);
    expect(summary('Rows whose evidence is OPEN only')).toEqual([openOnly(ia, IA_COL.evidence).length, openOnly(cf, CF_COL.evidence).length]);
  });

  it('IA-044 (log redaction) cites this negative control', () => {
    const row = rows('IA').find((r) => r.id === 'IA-044');
    expect(row?.cells[IA_COL.evidence] ?? '').toContain('`apps/server/test/log-redaction.integration.test.ts`');
  });

  it('the IA-044, CF-011 and CF-029 OPEN notes name every leak this suite pins, not only the link token (SEC-V40-1, SEC-V40-3)', () => {
    const notes: Record<string, string> = {
      'IA-044': rows('IA').find((r) => r.id === 'IA-044')?.cells[IA_COL.evidence] ?? '',
      'CF-011': rows('CF').find((r) => r.id === 'CF-011')?.cells[CF_COL.evidence] ?? '',
      'CF-029': rows('CF').find((r) => r.id === 'CF-029')?.cells[CF_COL.evidence] ?? '',
    };
    for (const [id, note] of Object.entries(notes)) {
      for (const needle of ['logging.interceptor.ts:22', 'http-exception.filter.ts:65', 'Chatwoot', 'hub.verify_token', 'OAuth']) {
        expect(note, `${id} names ${needle}`).toContain(needle);
      }
    }
    // The logged contact email is personal data, not a secret: IA-044 and CF-029 carry it (CF-011 is secrets only).
    for (const id of ['IA-044', 'CF-029']) expect(notes[id], id).toContain('automation-executor.service.ts:286');
    // SEC-C2-1 (FOLLOW3-C2 review, F1) was closed by W3-C2b-EMAIL-LOG-LEAK:
    // section 1c pins the SEND_EMAIL sender's lines (transactional-email.service.ts
    // :760, :764, :771) naming the contact id, never the address. The census text
    // that recorded them OPEN is outside that packet's write set, so it was
    // reported for correction rather than edited (review SEC-C2b-1). Until it is
    // corrected a note may still carry the OPEN wording; once corrected it says
    // W3-C2b-EMAIL-LOG-LEAK closed them. Each note names the sender's three lines
    // and records exactly one of the two states, so the correction lands without
    // a change here. CF-029 keeps the log calls outside these windows OPEN (SEC-C2-2).
    const SENDER_OPEN = "OPEN: the SEND_EMAIL action's sender";
    const SENDER_CLOSED = "the SEND_EMAIL action's sender's lines were closed by W3-C2b-EMAIL-LOG-LEAK";
    for (const id of ['IA-044', 'CF-029']) {
      for (const needle of ['transactional-email.service.ts:760', ':764', ':771']) {
        expect(notes[id], `${id} names ${needle}`).toContain(needle);
      }
      expect(
        [SENDER_OPEN, SENDER_CLOSED].filter((state) => notes[id].includes(state)),
        `${id} records the SEND_EMAIL sender's lines in exactly one state (W3-C2b-EMAIL-LOG-LEAK, SEC-C2b-1)`,
      ).toHaveLength(1);
    }
    for (const needle of ['outside the suite\'s windows', 'cross-module-agent.service.ts:355', 'system-email.service.ts:130', 'email-marketing.service.ts:428', 'key-cortex-phone.service.ts:296']) {
      expect(notes['CF-029'], `CF-029 names ${needle}`).toContain(needle);
    }
    const findings = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').split('## 6.')[1] ?? '';
    for (const needle of ['http-exception.filter.ts:65', 'chatwoot.controller.ts:14', 'whatsapp.controller.ts:234-237', 'automation-executor.service.ts:286', 'transactional-email.service.ts:760', 'Validate control artifacts', 'self-modifiable']) {
      expect(findings, `section 6 names ${needle}`).toContain(needle);
    }
    // Section 6 item 3 records the sender's lines in exactly one state, as the notes do (SEC-C2b-1).
    expect(
      ["the SEND_EMAIL sender's lines are OPEN", "the SEND_EMAIL sender's lines were closed by W3-C2b-EMAIL-LOG-LEAK"].filter((state) => findings.includes(state)),
      "section 6 records the SEND_EMAIL sender's lines in exactly one state (W3-C2b-EMAIL-LOG-LEAK, SEC-C2b-1)",
    ).toHaveLength(1);
    expect(findings).not.toMatch(/A non-draft pkt\/\* PR fails closed at the grant step/);
  });

  it('CF-029 scopes the platform sender\'s closure (9B-D2, D-82) to its own lines and records the lines one hop up in exactly one state (SEC-W4HK-1, CR-W5SEC-2)', () => {
    // W4-HOUSEKEEPING review SEC-W4HK-1: SystemEmailService redacts addresses
    // on its own lines only. The SystemEmailSendError it throws still carries
    // the provider text (system-email.service.ts:125, :144), and its callers
    // logged that text or the recipient themselves; system-email.log-redaction.spec.ts
    // pins that boundary by CHARACTERIZATION. So the census names the sink-only
    // scope, and records the caller lines after it either OPEN or closed by the
    // packets that fixed them, never both (W5-SYSTEM-EMAIL-CALLERS review
    // CR-W5SEC-2: the case below holds which state).
    const note = rows('CF').find((r) => r.id === 'CF-029')?.cells[CF_COL.evidence] ?? '';
    const SCOPE = "that closure covers the sink's own lines only";
    expect(note, `CF-029 says "${SCOPE}"`).toContain(SCOPE);
    const after = note.slice(note.indexOf(SCOPE));
    expect(
      [CALLERS_OPEN, CALLERS_CLOSED].filter((state) => after.includes(state)),
      "CF-029 records the platform sender's caller lines in exactly one state (CR-W5SEC-2)",
    ).toHaveLength(1);
    for (const needle of [
      'system-email.service.ts:125',
      ':144',
      'identity-signup.service.ts:185, :266',
      'ai-usage-alert-scheduler.service.ts:156',
      'financial-briefing-scheduler.service.ts:269',
      'accountant-export-email.service.ts:103',
      'http-exception.filter.ts:71',
    ]) {
      expect(after, `CF-029 names ${needle} under the sink-only scope`).toContain(needle);
    }
  });

  // W5-SYSTEM-EMAIL-CALLERS review CR-W5SEC-2 / SEC-W5SEC-1 (9B-D2, SEC-W4HK-1):
  // W5-SYSTEM-EMAIL-CALLERS closed the caller lines the census listed OPEN
  // (identity-signup :185/:266 and its Supabase-step lines :168/:236/:251,
  // ai-usage-alert-scheduler :156, financial-briefing-scheduler :263/:269,
  // accountant-export-email :103, the accountant export 500 line), and its
  // review found a caller CF-029 did not list: AiOversightService.routeAndNotify
  // relogged ApprovalRoutingService's SystemEmailSendError text
  // (ai-oversight.service.ts:558, :569; approval-routing.service.ts:188), which
  // W6-LOG-ADDRESSES-AND-DOCS closed. CF-029 records every one of them closed,
  // with no OPEN wording left for them, and keeps the other address-logging
  // calls OPEN.
  it('CF-029 records the W5-SYSTEM-EMAIL-CALLERS caller lines and the approval routing caller (ai-oversight.service.ts:558, :569; approval-routing.service.ts:188) CLOSED, in exactly that one state (9B-D2, SEC-W4HK-1; W6-LOG-ADDRESSES-AND-DOCS, review CR-W5SEC-2)', () => {
    const note = rows('CF').find((r) => r.id === 'CF-029')?.cells[CF_COL.evidence] ?? '';
    const SCOPE = "that closure covers the sink's own lines only";
    const after = note.slice(note.indexOf(SCOPE));
    expect([CALLERS_OPEN, CALLERS_CLOSED].filter((state) => after.includes(state))).toEqual([CALLERS_CLOSED]);
    expect(
      after.indexOf(OTHERS_OPEN),
      'CF-029 keeps the other address-logging calls OPEN after the closed callers',
    ).toBeGreaterThan(after.indexOf(CALLERS_CLOSED));
    const closed = after.slice(after.indexOf(CALLERS_CLOSED), after.indexOf(OTHERS_OPEN));
    for (const needle of [
      'identity-signup.service.ts:185, :266',
      ':168, :236, :251',
      'ai-usage-alert-scheduler.service.ts:156',
      'financial-briefing-scheduler.service.ts:269',
      ':263',
      'accountant-export-email.service.ts:103',
      'http-exception.filter.ts:71',
      'finance.controller.ts:1169',
      APPROVAL_CLOSED,
      'approval-routing.service.ts:188',
      'ai-oversight.service.ts:558',
      ':569',
      '`apps/server/src/modules/notifications/system-email.log-redaction.spec.ts`',
    ]) {
      expect(closed, `CF-029 records ${needle} closed`).toContain(needle);
    }
    // The closed lines are no longer listed among the OPEN address-logging calls.
    const others = after.slice(after.indexOf(OTHERS_OPEN));
    for (const stale of ['financial-briefing-scheduler.service.ts:263', 'identity-signup.service.ts:168', 'ai-oversight.service.ts', 'approval-routing.service.ts']) {
      expect(others, `CF-029 no longer lists ${stale} OPEN`).not.toContain(stale);
    }
    for (const kept of ['cross-module-agent.service.ts:355', 'email-marketing.service.ts:428', 'key-cortex-phone.service.ts:296']) {
      expect(others, `CF-029 still lists ${kept} OPEN`).toContain(kept);
    }
  });
});
