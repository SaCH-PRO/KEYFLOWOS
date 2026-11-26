/**
 * P117 / RR-WEBHOOK-INGRESS-CENSUS (D-261 / D-262 / D-56) —
 * Inbound webhook ingress census across every NestJS controller in `apps/server/src`.
 *
 * WHY:
 * Every inbound webhook in the server verifies signatures, deduplicates retries, and resolves
 * its tenant in its own way without a shared ingress envelope. Without a living census, a new
 * unauthenticated webhook `@Post(...)` route can ship silently without verification, replay
 * protection, or tenant binding.
 *
 * WHAT THIS SPEC CHECKS (TypeScript AST over `apps/server/src`, excluding tests):
 *   1. Discovers every `@Controller` class and every `@Post(...)` handler that runs without
 *      `AuthGuard` or `BusinessGuard` whose combined route path matches a webhook/inbound/callback
 *      segment or whose controller filename marks a webhook/inbound receiver.
 *   2. Asserts exact 1:1 parity with `WEBHOOK_INGRESS_CENSUS`:
 *      - Adding a new public inbound webhook `@Post` route outside the table fails.
 *      - Leaving a stale row in the table for a removed or newly guarded route fails.
 *   3. Asserts every row declares non-empty `verification`, `replayDedup`, a valid `tenantSource`,
 *      and an explicit nullable `knownGap`.
 *   4. Synthetic AST fixture tests verify the scanner catches an unlisted public `@Post('webhook')`
 *      and ignores guarded or non-webhook routes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const SRC = resolve(__dirname, '../..');

export type WebhookTenantSource =
  | 'path-param+ownership-check'
  | 'trusted-mapping'
  | 'signed-metadata'
  | 'env-single-tenant';

export interface DiscoveredWebhookRoute {
  key: string;
  file: string;
  path: string;
  guards: string[];
}

export interface WebhookIngressCensusRow {
  key: string;
  file: string;
  path: string;
  verification: string;
  replayDedup: string;
  tenantSource: WebhookTenantSource;
  knownGap: string | null;
}

const VALID_TENANT_SOURCES = new Set<WebhookTenantSource>([
  'path-param+ownership-check',
  'trusted-mapping',
  'signed-metadata',
  'env-single-tenant',
]);

const AUTH_GUARDS = new Set(['AuthGuard', 'BusinessGuard']);
const WEBHOOK_PATH_RE = /(?:^|[/_-])(?:webhooks?|hooks?|inbound|callbacks?)(?:$|[/_-])/i;
const WEBHOOK_FILE_RE = /(?:webhook|inbound)/i;
const INBOUND_VERB_DECORATORS = new Set(['Post', 'All']);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function decoratorName(dec: ts.Decorator, sf: ts.SourceFile): string {
  const expr = dec.expression;
  if (ts.isCallExpression(expr)) {
    return expr.expression.getText(sf);
  }
  return expr.getText(sf);
}

function firstStringArg(dec: ts.Decorator, sf: ts.SourceFile): string {
  const expr = dec.expression;
  if (!ts.isCallExpression(expr) || expr.arguments.length === 0) return '';
  const arg = expr.arguments[0];
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  // Support @Controller({ path: '...' }) object syntax if used.
  if (ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        prop.name.getText(sf) === 'path' &&
        (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))
      ) {
        return prop.initializer.text;
      }
    }
  }
  return arg.getText(sf);
}

function extractGuardNames(decs: readonly ts.Decorator[], sf: ts.SourceFile): string[] {
  const guards: string[] = [];
  for (const dec of decs) {
    if (decoratorName(dec, sf) !== 'UseGuards') continue;
    if (!ts.isCallExpression(dec.expression)) continue;
    for (const arg of dec.expression.arguments) {
      guards.push(arg.getText(sf).trim());
    }
  }
  return guards;
}

function normalizeRoutePath(prefix: string, subPath: string): string {
  const joined = [prefix, subPath]
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter((segment) => segment.length > 0)
    .join('/');
  return `/${joined}`;
}

export function scanSourceForUnauthenticatedWebhooks(
  relFile: string,
  sourceText: string,
): DiscoveredWebhookRoute[] {
  const sf = ts.createSourceFile(relFile, sourceText, ts.ScriptTarget.Latest, true);
  const discovered: DiscoveredWebhookRoute[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node)) {
      const classDecs = getDecorators(node);
      const ctrlDec = classDecs.find((d) => decoratorName(d, sf) === 'Controller');
      if (ctrlDec) {
        const className = node.name?.text ?? '<AnonymousController>';
        const controllerPrefix = firstStringArg(ctrlDec, sf);
        const classGuards = extractGuardNames(classDecs, sf);

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const methodDecs = getDecorators(member);
          const verbDec = methodDecs.find((d) =>
            INBOUND_VERB_DECORATORS.has(decoratorName(d, sf)),
          );
          if (!verbDec) continue;

          const allGuards = [...classGuards, ...extractGuardNames(methodDecs, sf)];
          if (allGuards.some((g) => AUTH_GUARDS.has(g))) continue;

          const methodSubPath = firstStringArg(verbDec, sf);
          const fullPath = normalizeRoutePath(controllerPrefix, methodSubPath);
          const isWebhookOrInbound =
            WEBHOOK_PATH_RE.test(fullPath) || WEBHOOK_FILE_RE.test(relFile);
          if (!isWebhookOrInbound) continue;

          const methodName = member.name.getText(sf);
          discovered.push({
            key: `${className}.${methodName}`,
            file: relFile,
            path: fullPath,
            guards: allGuards,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return discovered;
}

export function scanRepoUnauthenticatedWebhooks(srcRoot: string): DiscoveredWebhookRoute[] {
  const found: DiscoveredWebhookRoute[] = [];
  for (const absFile of walkTsFiles(srcRoot)) {
    const relFile = relative(srcRoot, absFile).split(sep).join('/');
    const sourceText = readFileSync(absFile, 'utf8');
    found.push(...scanSourceForUnauthenticatedWebhooks(relFile, sourceText));
  }
  found.sort((a, b) => a.key.localeCompare(b.key) || a.path.localeCompare(b.path));
  return found;
}

export function diffAgainstCensus(
  discovered: readonly DiscoveredWebhookRoute[],
  census: readonly WebhookIngressCensusRow[],
): {
  unlisted: DiscoveredWebhookRoute[];
  stale: WebhookIngressCensusRow[];
  mismatched: Array<{ key: string; expected: string; actual: string }>;
} {
  const byKey = new Map(census.map((row) => [row.key, row]));
  const seenKeys = new Set<string>();
  const unlisted: DiscoveredWebhookRoute[] = [];
  const mismatched: Array<{ key: string; expected: string; actual: string }> = [];

  for (const route of discovered) {
    const row = byKey.get(route.key);
    if (!row) {
      unlisted.push(route);
      continue;
    }
    seenKeys.add(route.key);
    const expectedSig = `${row.file} POST ${row.path}`;
    const actualSig = `${route.file} POST ${route.path}`;
    if (expectedSig !== actualSig) {
      mismatched.push({ key: route.key, expected: expectedSig, actual: actualSig });
    }
  }

  const stale = census.filter((row) => !seenKeys.has(row.key));
  return { unlisted, stale, mismatched };
}

/**
 * Canonical census of every unauthenticated inbound webhook/inbound `@Post` route
 * in `apps/server/src`. Keep sorted by `key`.
 */
export const WEBHOOK_INGRESS_CENSUS: readonly WebhookIngressCensusRow[] = [
  {
    key: 'ChatwootController.webhook',
    file: 'modules/chatwoot/chatwoot.controller.ts',
    path: '/chatwoot/webhook/:secret',
    verification:
      'Shared path secret matched against process.env.CHATWOOT_WEBHOOK_SECRET in ChatwootService.assertWebhookSecret (fails closed 401)',
    replayDedup: 'None (async handleWebhook replies per inbound webhook without message-id dedup)',
    tenantSource: 'env-single-tenant',
    knownGap:
      'Path secret uses non-constant-time !== comparison and there is no message-id replay deduplication.',
  },
  {
    key: 'FormWebhookController.ingest',
    file: 'core/connectors/form-webhook.controller.ts',
    path: '/webhooks/forms/:businessId/:type',
    verification:
      'Per-business static secret in x-keyflow-signature compared with timingSafeStringEqual against ConnectorCredentialsService webhookSecret (fails closed 403)',
    replayDedup:
      'None at ingress (entity resolution merges contacts, but repeated POSTs re-emit form.submitted and lead_form.submitted)',
    tenantSource: 'path-param+ownership-check',
    knownGap:
      'No delivery-level replay/idempotency deduplication and static header secret rather than HMAC over raw body + timestamp.',
  },
  {
    key: 'InboundCommunicationsController.email',
    file: 'modules/communications/inbound-communications.controller.ts',
    path: '/communications/inbound/email',
    verification:
      'HMAC-SHA256 over req.rawBody in x-keyflow-signature using shared INBOUND_WEBHOOK_SECRET with timingSafeEqual (fails closed 403)',
    replayDedup: 'None at ingress (emits message.intake.received or message.received on every signed delivery)',
    tenantSource: 'signed-metadata',
    knownGap:
      'No replay window or externalId deduplication at webhook ingress; body.businessId trusts the single shared INBOUND_WEBHOOK_SECRET.',
  },
  {
    key: 'InboundCommunicationsController.sms',
    file: 'modules/communications/inbound-communications.controller.ts',
    path: '/communications/inbound/sms',
    verification:
      'HMAC-SHA256 over req.rawBody in x-keyflow-signature using shared INBOUND_WEBHOOK_SECRET with timingSafeEqual (fails closed 403)',
    replayDedup: 'None at ingress (staffChat.routeInboundMessage and event emission run on every signed delivery)',
    tenantSource: 'signed-metadata',
    knownGap:
      'No replay window or externalId deduplication at webhook ingress; body.businessId trusts the single shared INBOUND_WEBHOOK_SECRET.',
  },
  {
    key: 'LivekitController.webhook',
    file: 'modules/livekit/livekit.controller.ts',
    path: '/livekit/webhook',
    verification:
      'LiveKit SDK WebhookReceiver.receive JWT + raw body SHA-256 verification using LIVEKIT_API_KEY / LIVEKIT_API_SECRET (fails closed 401)',
    replayDedup:
      'Idempotent VoiceSession status transition matched by roomName; no explicit webhook event-id dedup table',
    tenantSource: 'trusted-mapping',
    knownGap: 'No explicit webhook event-id replay table (relies on room_finished transition idempotency).',
  },
  {
    key: 'PaymentsController.handlePaypalWebhook',
    file: 'modules/payments/payments.controller.ts',
    path: '/payments/paypal/webhook',
    verification:
      'PayPal verify-webhook-signature API verification using per-business or platform PayPal webhook credentials (fails closed 400)',
    replayDedup:
      'Durable webhook_events unique claim via InvoiceWorkflowService.assertNewProviderEvent("paypal", event.id) with rollback release on abort (V1-15c)',
    tenantSource: 'signed-metadata',
    knownGap: null,
  },
  {
    key: 'PaymentsController.handleStripeWebhook',
    file: 'modules/payments/payments.controller.ts',
    path: '/payments/stripe/webhook',
    verification:
      'Stripe HMAC-SHA256 signature with timestamp tolerance via verifyStripeSignature using STRIPE_WEBHOOK_SECRET or per-business stripeWebhookSecret (fails closed 400)',
    replayDedup:
      'Durable webhook_events unique claim via InvoiceWorkflowService.assertNewProviderEvent("stripe", event.id) with rollback release on abort (V1-15c)',
    tenantSource: 'signed-metadata',
    knownGap: null,
  },
  {
    key: 'PhoneVoiceController.inbound',
    file: 'modules/phone-voice/phone-voice.controller.ts',
    path: '/api/v1/cortex/phone/inbound',
    verification:
      'Twilio X-Twilio-Signature HMAC-SHA1 over full URL (including businessId query) and form params via twilio.validateRequest using TWILIO_AUTH_TOKEN (fails closed 403 when unconfigured / 400 on invalid signature; explicit dev override PHONE_VOICE_ALLOW_UNVERIFIED=1)',
    replayDedup:
      'None (stateless TwiML response minting short-lived signed stream token bound to CallSid and businessId)',
    tenantSource: 'signed-metadata',
    knownGap:
      'No signature/CallSid replay claim on inbound TwiML webhook (unlike WhatsApp Twilio claimTwilioDelivery).',
  },
  {
    key: 'RiscController.receiveEvent',
    file: 'modules/risc/risc.controller.ts',
    path: '/webhooks/risc',
    verification:
      'Google RISC Security Event Token JWT verified via jose jwtVerify against Google RISC JWKS, issuer, and OAuth client audience (fails closed 400)',
    replayDedup:
      'Durable risc_events unique jti deduplication (allows redelivery only when durable sign-in cutoff leg was incomplete)',
    tenantSource: 'trusted-mapping',
    knownGap: null,
  },
  {
    key: 'SocialController.sharedSocialWebhook',
    file: 'modules/social/social.controller.ts',
    path: '/social/webhook',
    verification:
      'Meta x-hub-signature-256 HMAC-SHA256 over req.rawBody using META_APP_SECRET with timingSafeEqual (fails closed 403)',
    replayDedup:
      'Per-business keyInboxMessage lookup by (businessId, channel, externalMessageId) in MetaSocialIngestionService',
    tenantSource: 'trusted-mapping',
    knownGap:
      'Routes only entry[0] page ID without validating additional entries in multi-entry Meta payloads; no timestamp replay window.',
  },
  {
    key: 'SocialController.socialWebhook',
    file: 'modules/social/social.controller.ts',
    path: '/social/webhook/:businessId',
    verification:
      'Meta x-hub-signature-256 HMAC-SHA256 over req.rawBody using META_APP_SECRET with timingSafeEqual (fails closed 403)',
    replayDedup:
      'Per-business keyInboxMessage lookup by (businessId, channel, externalMessageId) in MetaSocialIngestionService',
    tenantSource: 'path-param+ownership-check',
    knownGap: 'No timestamp replay window on Meta HMAC signature (dedup relies on externalMessageId).',
  },
  {
    key: 'WebhooksController.handleStripeWebhook',
    file: 'modules/webhooks/webhooks.controller.ts',
    path: '/webhooks/stripe',
    verification:
      'Stripe stripe.webhooks.constructEvent HMAC-SHA256 + timestamp tolerance using STRIPE_WEBHOOK_SECRET, then delegates to PaymentsService.handleStripeWebhook (fails closed 400)',
    replayDedup:
      'Shared durable webhook_events unique claim via PaymentsService -> InvoiceWorkflowService.assertNewProviderEvent("stripe", event.id)',
    tenantSource: 'signed-metadata',
    knownGap: null,
  },
  {
    key: 'WhatsAppController.sharedWebhook',
    file: 'modules/whatsapp/whatsapp.controller.ts',
    path: '/whatsapp/webhook',
    verification:
      'Meta x-hub-signature-256 HMAC-SHA256 over req.rawBody using WHATSAPP_APP_SECRET with timingSafeEqual (fails closed 403)',
    replayDedup: 'None at controller ingress (relies on downstream message handling)',
    tenantSource: 'trusted-mapping',
    knownGap:
      'No delivery-level webhook_events replay dedup on Meta WhatsApp deliveries; routes only entry[0].',
  },
  {
    key: 'WhatsAppController.webhook',
    file: 'modules/whatsapp/whatsapp.controller.ts',
    path: '/whatsapp/webhook/:businessId',
    verification:
      'Meta x-hub-signature-256 HMAC-SHA256 (WHATSAPP_APP_SECRET) or Twilio X-Twilio-Signature HMAC-SHA1 via twilio.validateRequest (TWILIO_AUTH_TOKEN) (fails closed 403)',
    replayDedup:
      'Twilio deliveries claimed once via webhook_events SHA-256 signature digest (claimTwilioDelivery); Meta deliveries have no controller-level replay claim',
    tenantSource: 'path-param+ownership-check',
    knownGap:
      'Meta branch has no delivery-level webhook_events replay dedup and checks only entry[0] phone_number_id.',
  },
];

describe('Inbound webhook ingress census (RR-WEBHOOK-INGRESS-CENSUS)', () => {
  const discovered = scanRepoUnauthenticatedWebhooks(SRC);

  it('has unique, well-formed census rows with non-empty verification, replayDedup, and valid tenantSource', () => {
    expect(WEBHOOK_INGRESS_CENSUS.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const row of WEBHOOK_INGRESS_CENSUS) {
      expect(seen.has(row.key), `Duplicate census key: ${row.key}`).toBe(false);
      seen.add(row.key);
      expect(row.file.trim().length, `Empty file on ${row.key}`).toBeGreaterThan(0);
      expect(row.path.startsWith('/'), `Path must start with / on ${row.key}`).toBe(true);
      expect(row.verification.trim().length, `Empty verification on ${row.key}`).toBeGreaterThan(0);
      expect(row.replayDedup.trim().length, `Empty replayDedup on ${row.key}`).toBeGreaterThan(0);
      expect(VALID_TENANT_SOURCES.has(row.tenantSource), `Invalid tenantSource on ${row.key}`).toBe(
        true,
      );
      if (row.knownGap !== null) {
        expect(row.knownGap.trim().length, `Blank knownGap on ${row.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('lists every live unauthenticated inbound webhook @Post route with zero unlisted routes and zero stale rows', () => {
    const { unlisted, stale, mismatched } = diffAgainstCensus(discovered, WEBHOOK_INGRESS_CENSUS);

    expect(
      unlisted.map((r) => `${r.key} (${r.file} POST ${r.path})`),
      'Unlisted unauthenticated inbound webhook @Post route(s) found — add each to WEBHOOK_INGRESS_CENSUS with verification, replayDedup, and tenantSource',
    ).toEqual([]);

    expect(
      stale.map((r) => `${r.key} (${r.file} POST ${r.path})`),
      'Stale row(s) in WEBHOOK_INGRESS_CENSUS that no longer match a live unauthenticated webhook @Post route',
    ).toEqual([]);

    expect(
      mismatched,
      'Census row file/path drifted from live controller',
    ).toEqual([]);
  });

  it('pins SocialController.socialWebhook as path-param+ownership-check backed by assertMetaPageIsBusiness', () => {
    const row = WEBHOOK_INGRESS_CENSUS.find((r) => r.key === 'SocialController.socialWebhook');
    expect(row).toBeDefined();
    expect(row?.tenantSource).toBe('path-param+ownership-check');

    const socialCtrlSrc = readFileSync(
      join(SRC, 'modules/social/social.controller.ts'),
      'utf8',
    );
    expect(socialCtrlSrc).toMatch(
      /await\s+this\.assertMetaPageIsBusiness\(\s*businessId\s*,\s*body\s*\)/,
    );
  });

  it('synthetic fixture: detects unlisted public @Post/@All webhook routes (including compound names) and ignores guarded or non-webhook routes', () => {
    const fixtureSource = `
      import { All, Controller, Post, UseGuards } from '@nestjs/common';

      @Controller('acme')
      export class AcmeController {
        @Post('webhook')
        unlistedWebhook() {
          return { ok: true };
        }

        @Post('stripe-webhook')
        compoundWebhook() {
          return { ok: true };
        }

        @All('hooks/acme')
        allVerbHook() {
          return { ok: true };
        }

        @UseGuards(AuthGuard)
        @Post('webhook/guarded')
        guardedWebhook() {
          return { ok: true };
        }

        @Post('public/signup')
        publicSignup() {
          return { ok: true };
        }
      }

      @Controller('webhooks/rogue')
      export class RogueWebhookController {
        @Post(':businessId')
        ingest() {
          return { ok: true };
        }
      }

      @UseGuards(AuthGuard)
      @Controller('guarded-webhooks')
      export class GuardedWebhookController {
        @Post('inbound')
        guardedInbound() {
          return { ok: true };
        }
      }
    `;

    const fixtureRoutes = scanSourceForUnauthenticatedWebhooks(
      'modules/acme/acme.controller.ts',
      fixtureSource,
    );
    expect(fixtureRoutes.map((r) => `${r.key}:${r.path}`)).toEqual([
      'AcmeController.unlistedWebhook:/acme/webhook',
      'AcmeController.compoundWebhook:/acme/stripe-webhook',
      'AcmeController.allVerbHook:/acme/hooks/acme',
      'RogueWebhookController.ingest:/webhooks/rogue/:businessId',
    ]);

    const { unlisted } = diffAgainstCensus(fixtureRoutes, WEBHOOK_INGRESS_CENSUS);
    expect(unlisted.map((r) => r.key)).toEqual([
      'AcmeController.unlistedWebhook',
      'AcmeController.compoundWebhook',
      'AcmeController.allVerbHook',
      'RogueWebhookController.ingest',
    ]);
  });
});
