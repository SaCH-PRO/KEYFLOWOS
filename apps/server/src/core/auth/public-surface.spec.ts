/**
 * There is no global auth guard. Every protected route opts in.
 *
 * `grep APP_GUARD apps/server/src` returns nothing. Authentication is applied
 * per controller or per handler with `@UseGuards(AuthGuard, BusinessGuard)` —
 * 1,025 attachments — which means the default for a new route is PUBLIC, and
 * forgetting the decorator produces no error, no warning, and a working
 * endpoint.
 *
 * That is not hypothetical here. `POST /api/v1/cortex/phone/inbound` was live
 * and unauthenticated in production: the controller carried a guard on one of
 * its two handlers, and the other relied on a Twilio signature check that
 * returned `true` when no signing key was configured — which was the case in
 * production. It was fixed to fail closed, but nothing would have reported it.
 *
 * 227 of 2,177 handlers (10.4%) have no AuthGuard. Most are deliberate and carry
 * some other mechanism: a webhook signature, a one-time execution token, an
 * opaque share token, an inline super-admin assertion. This spec does not claim
 * they are all correct. It claims the SET is known, so that the 228th arrives as
 * a failing test rather than as a discovery.
 *
 * WHY THE COUNTS ARE PER HANDLER, AND WHY THAT MATTERS. The obvious check — does
 * this controller file mention AuthGuard — reports phone-voice as guarded,
 * because one of its two handlers is. It would have missed the only real
 * vulnerability of this kind the codebase has had. Hence the two assertions
 * below that pin phone-voice at exactly 1 and key-cortex at 0: they are the
 * cases that break this parser, and they are checked before its output is
 * trusted.
 *
 * That is not a theoretical concern. Getting this number right took four
 * attempts — 87, then 298, then 1,153, then 227 — and every intermediate answer
 * looked plausible enough to write down. The 1,153 came from a regex that had
 * acquired a literal backspace character, so it matched nothing and every
 * controller looked unguarded.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', '..');

const ROUTE = /@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/g;
const GUARD_WITH_AUTH = /@UseGuards\([^)]*AuthGuard[^)]*\)/g;

function controllers(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist'].includes(e.name)) continue;
        walk(p);
      } else if (/\.controller\.ts$/.test(e.name)) out.push(p);
    }
  };
  walk(SRC);
  return out;
}

interface Surface {
  handlers: number;
  open: number;
}

function surfaceOf(src: string): Surface {
  const handlers = (src.match(ROUTE) || []).length;
  if (!handlers) return { handlers: 0, open: 0 };

  const ctrlIdx = src.search(/@Controller\s*\(/);
  // The controller class is the first `class` AFTER @Controller. Searching for
  // the first `export class` in the file instead lands on a DTO — key-cortex
  // declares 650 lines of them first — which hides the class-level guard and
  // reports all 72 of its handlers as open.
  const after = ctrlIdx >= 0 ? src.slice(ctrlIdx) : src;
  const rel = after.search(/class\s+\w+/);
  const classIdx = ctrlIdx >= 0 && rel >= 0 ? ctrlIdx + rel : -1;
  const classHead = classIdx > ctrlIdx ? src.slice(ctrlIdx, classIdx) : '';

  GUARD_WITH_AUTH.lastIndex = 0;
  const classGuarded = GUARD_WITH_AUTH.test(classHead);
  GUARD_WITH_AUTH.lastIndex = 0;
  if (classGuarded) return { handlers, open: 0 };

  const body = classIdx >= 0 ? src.slice(classIdx) : src;
  const methodGuards = (body.match(GUARD_WITH_AUTH) || []).length;
  return { handlers, open: Math.max(0, handlers - methodGuards) };
}

function measure(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of controllers()) {
    const { open } = surfaceOf(fs.readFileSync(f, 'utf8'));
    if (open > 0) out[path.relative(SRC, f).split(path.sep).join('/')] = open;
  }
  return out;
}

/**
 * Handlers reachable without AuthGuard, by controller. Shrink-only.
 *
 * An entry is NOT an approval. It records that the route is public today and
 * that something else — a signature, a token, an inline assertion — is expected
 * to be standing in. Adding one means saying which.
 */
const ACKNOWLEDGED_PUBLIC: Record<string, number> = {
  'app.controller.ts': 4,
  'core/connectors/form-webhook.controller.ts': 1,
  'core/connectors/google-suite.controller.ts': 1,
  'modules/admin-auth/admin-auth.controller.ts': 3,
  'modules/ai/ai.controller.ts': 1,
  'modules/ai/code-executor.controller.ts': 1,
  'modules/analytics/analytics.controller.ts': 14,
  'modules/automation/automation.controller.ts': 1,
  'modules/bookings/bookings.controller.ts': 4,
  'modules/calendar/calendar.controller.ts': 1,
  'modules/catalog/catalog.controller.ts': 1,
  'modules/chatwoot/chatwoot.controller.ts': 1,
  'modules/commerce/commerce-ai.controller.ts': 1,
  // 11 -> 10: POST businesses/:businessId/invoices now carries the same
  // guards as every other write on this controller. It was the primary
  // invoice-creation route with no auth, no tenant check and no plan limit,
  // which also made it a way around RequirePlanLimit('invoices').
  'modules/commerce/commerce.controller.ts': 10,
  'modules/commerce/leverage.controller.ts': 9,
  'modules/communications/communications.controller.ts': 3,
  'modules/communications/inbound-communications.controller.ts': 2,
  'modules/communications/omnichannel.controller.ts': 18,
  'modules/connect/microsoft-oauth.controller.ts': 1,
  'modules/crm/crm-google.controller.ts': 1,
  'modules/crm/privacy/contact-privacy.controller.ts': 1,
  'modules/device/device.controller.ts': 13,
  'modules/directory/directory.controller.ts': 2,
  'modules/documents/documents.controller.ts': 3,
  'modules/education/education.controller.ts': 2,
  'modules/email-marketing/email-marketing.controller.ts': 3,
  'modules/feature-flags/feature-flags.controller.ts': 1,
  'modules/flow-signal/flow-signal-role.controller.ts': 1,
  'modules/flow/flow.controller.ts': 13,
  'modules/gamification/gamification.controller.ts': 1,
  'modules/google-drive/google-drive.controller.ts': 1,
  // 9 -> 11: forgot-password and reset-password. Both are necessarily
  // unauthenticated — the whole premise is a user who cannot sign in — so what
  // stands in for a guard is stated here rather than assumed:
  //   forgot-password  rate limited per IP and per email, returns an identical
  //                    body for known and unknown addresses so it cannot be
  //                    used to enumerate accounts, and refuses any redirect
  //                    target outside the configured origins.
  //   reset-password   the recovery token IS the credential. It is verified
  //                    before anything else happens, the new password goes
  //                    through the same PasswordPolicyService signup uses
  //                    (including the Pwned Passwords lookup), and every other
  //                    session is dropped on success.
  'modules/identity/identity.controller.ts': 11,
  'modules/key-connector/key-connector.controller.ts': 10,
  'modules/keystore/keystore-admin.controller.ts': 11,
  'modules/keystore/keystore.controller.ts': 10,
  'modules/lead-forms/lead-forms.controller.ts': 1,
  'modules/livekit/livekit.controller.ts': 1,
  'modules/marketplace/marketplace-public.controller.ts': 1,
  'modules/payments/payments.controller.ts': 11,
  'modules/phone-voice/phone-voice.controller.ts': 1,
  'modules/portal/portal.controller.ts': 1,
  'modules/public-events/presence.controller.ts': 1,
  'modules/public-events/public-events.controller.ts': 1,
  'modules/push-notifications/push-notification.controller.ts': 4,
  'modules/risc/risc.controller.ts': 1,
  'modules/site/presence/presence.controller.ts': 3,
  'modules/site/site.controller.ts': 16,
  'modules/social/social.controller.ts': 5,
  'modules/subscriptions/subscriptions.controller.ts': 2,
  'modules/templates/templates.controller.ts': 2,
  'modules/trash/trash.controller.ts': 3,
  'modules/webhooks/webhooks.controller.ts': 2,
  'modules/whatsapp/whatsapp.controller.ts': 4,
};

describe('the unauthenticated HTTP surface', () => {
  it('the parser handles a class-level guard — key-cortex is fully covered', () => {
    // 72 handlers, one @UseGuards directly under @Controller. If this reads as
    // open, the class-head slice is wrong and every number below is inflated.
    const src = fs.readFileSync(
      path.join(SRC, 'modules', 'key-cortex', 'key-cortex.controller.ts'),
      'utf8',
    );
    const s = surfaceOf(src);
    expect(s.handlers).toBeGreaterThan(60);
    expect(s.open, 'a class-level guard was not detected').toBe(0);
  });

  it('the parser handles a per-handler guard — phone-voice has exactly one open route', () => {
    // The case a file-level check gets wrong, and the one that was actually
    // exploitable. If this stops reading 1, the gate has gone blind to the
    // defect it exists for.
    const src = fs.readFileSync(
      path.join(SRC, 'modules', 'phone-voice', 'phone-voice.controller.ts'),
      'utf8',
    );
    expect(surfaceOf(src)).toEqual({ handlers: 2, open: 1 });
  });

  it('finds the whole surface — this is not vacuous', () => {
    const total = controllers().reduce(
      (n, f) => n + surfaceOf(fs.readFileSync(f, 'utf8')).handlers,
      0,
    );
    expect(total, 'route handlers not being counted').toBeGreaterThan(2000);
  });

  it('no controller exposes an unauthenticated handler that is not acknowledged', () => {
    const measured = measure();

    const added = Object.entries(measured)
      .filter(([f, n]) => !(f in ACKNOWLEDGED_PUBLIC) || n > ACKNOWLEDGED_PUBLIC[f])
      .map(([f, n]) => `${f}: ${n} open (acknowledged ${ACKNOWLEDGED_PUBLIC[f] ?? 0})`);

    expect(
      added,
      'a route is reachable without AuthGuard. There is no global guard, so a ' +
        'handler without @UseGuards(AuthGuard, ...) is public to the internet. ' +
        'If that is deliberate, say what authenticates it instead — a signature, ' +
        'a one-time token, an inline role assertion — and record it here.',
    ).toEqual([]);
  });

  it('the ledger shrinks and does not go stale', () => {
    const measured = measure();
    const overstated = Object.entries(ACKNOWLEDGED_PUBLIC)
      .filter(([f, n]) => (measured[f] ?? 0) < n)
      .map(([f, n]) => `${f}: acknowledged ${n}, now ${measured[f] ?? 0}`);

    expect(
      overstated,
      'these are guarded now — lower the number or remove the entry, so the ' +
        'list keeps meaning what it says',
    ).toEqual([]);
  });
});
