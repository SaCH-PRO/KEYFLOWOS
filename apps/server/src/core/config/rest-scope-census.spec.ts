/**
 * SWEEP-P0-SCOPES — the REST scope census is pinned: docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md.
 *
 * WHY: the 2026-11-13 browser sweep found member routes that checked a business membership and
 * nothing else (webhooks with their signing secrets, API keys, projects, stock and warehouses:
 * BUG-001, BUG-013, BUG-014, BUG-015). Each was a write a STAFF member with no access to the module
 * could make. The census lists every such route the server has; this file makes the next one
 * visible, so a new membership-only write route has to be gated or placed in the census on purpose.
 *
 * WHAT IS READ (typescript AST, every non-test .ts file under apps/server/src: modules/, core/ and
 * the app root, so a controller outside modules/ is not missed; review SEC-1: the connector
 * credential and webhook-secret routes live in core/connectors): each `@Controller` class, its
 * class-level `@UseGuards`, and per handler the HTTP verb decorator, the method-level `@UseGuards`,
 * `@RequireModuleScope(module, level)` (level defaults to read, as the decorator does) and the
 * handler body text.
 *
 * THE POPULATION: a route is a membership-only write when its verb is POST, PUT, PATCH or DELETE,
 * it runs a member guard (AuthGuard, BusinessGuard or OptionalAuthGuard), and it does not carry an
 * ENFORCED scope: a `@RequireModuleScope` on the handler AND ModuleScopeGuard in its guard chain
 * (the guard reads the handler's metadata only, so a declaration without the guard is inert and the
 * route counts as membership-only). Public routes (no member guard) are pinned by
 * core/auth/public-surface.spec.ts and are not this census.
 *
 * A GET joins the population when it starts a credential binding (second review SV-3): its path names
 * an OAuth consent start (`auth-url`, `authorize`, `oauth/start`, `oauth/url`) or its handler is an
 * auth-URL builder (`...AuthUrl`). Such a GET is a write in effect: it signs a state naming the
 * business, and the provider's callback stores the account of whoever completes the consent on that
 * business (GET /connect/microsoft/businesses/:b/auth-url was membership-only, the SEC-1 class, and
 * had no row because the census counted write verbs only). A GET whose write is hidden in a service
 * under another name is not visible to this reader; a binding start is the class the reviews found.
 *
 * Round 1 class repair (CLASS B): a member route of any verb whose handler reaches a provider
 * credential write through the call graph (below, buildCredentialGraph) joins the population too, so
 * a GET that writes a credential under any name needs a row.
 *
 * THE DOC: every census table row is `| \`Class.handler\` | VERB | path | disposition | reason |`.
 * Dispositions:
 *   applied        this packet gated it; the reason is `module:level`, the scope it now carries.
 *   exempt-check   the route applies an authority check beyond membership: the reason names it as
 *                  `check:<name>` (the handler body must use it) or, for a check its service makes,
 *                  `service-check:<name>` (the name must exist in the route's module directory).
 *   exempt-guard   a dedicated authority guard runs; the reason names it as `guard:<Name>`, and the
 *                  route's guard chain must include it.
 *   exempt-own     the route acts on the caller's own record (own profile, own device, own session).
 *   exempt-ruled   an owner ruling keeps it open; the reason cites the ruling (D-<n>).
 *   deferred       another packet owns the gate; the route may leave the population (gated there)
 *                  without this file failing, but must still exist.
 *   open           membership-only and recorded for a follow-up packet (the reason names the
 *                  module the follow-up should apply and why it was not applied here).
 *   secret-read    (GET rows) a read that would carry a secret, reviewed: the reason says how the
 *                  secret is kept out (a scope, `check:<function>`, or the redaction it applies).
 *                  A reason that starts with a scope (`module:level`) names the enforced scope the
 *                  route carries (CEN-08).
 *
 * WHAT IS REQUIRED:
 *   CEN-01 the doc parses; every row is unique, names a disposition above and a non-empty reason.
 *   CEN-02 every route of the population has a row (a new membership-only write route fails here).
 *   CEN-03 every row names a real route with the verb and path it states; every row other than
 *          `applied`, `deferred` and `secret-read` names a route still in the population (a route
 *          gated since must leave the census or move to `applied`).
 *   CEN-04 every `applied` row's route carries exactly the enforced scope its reason names.
 *   CEN-05 every `exempt-check` row names a check its handler uses (`check:`) or its module
 *          defines (`service-check:`).
 *   CEN-06 every `exempt-guard` row's route runs the guard it names.
 *   CEN-07 every `exempt-ruled` row cites an owner ruling.
 *   CEN-08 every `secret-read` row whose reason starts with a scope carries exactly that enforced
 *          scope (the read that answers a secret is gated where the census says it is).
 *   CEN-09 no credential-binding start (any verb: the GETs above, a POST `oauth/start`) is left
 *          membership-only on purpose: its row is `applied`, `exempt-check`, `exempt-guard` or
 *          `exempt-ruled`, never `open` or `deferred` (second review SV-2, SV-3).
 *   CEN-10 (round 1 class repair, CLASS B) by the call graph, not by path or name: the reader still
 *          sees every writer the reviews found by hand, and its pinned refresh doors and authority
 *          checks are real. CEN-10b: every route (member or public, any verb) that reaches a provider
 *          credential write reaches it only through settings admin enforced on the route or a pinned
 *          check (settings admin, or the owner rule a ruling sets: D-11, D-42, D-94, D-99, D-111 with
 *          D-114; for a public callback, the signed state its start minted) that dominates the call;
 *          a route whose file another branch holds is a `deferred` row naming `held:`. CEN-10c: so
 *          does every KEY module action (a KeyCortex connector adapter's execute).
 *          Round 3 (CM-1, CM-2, CM-3): a check counts only as its pinned declaration, on the business the
 *          write uses, and a null-answering check only through a falsy test of its result that ends in
 *          throw or return; the reader follows typed locals, moduleRef.get(X), injection tokens (their
 *          provider or their interface's implementers), constant event names and SQL, *AndReturn and
 *          nested relation writes, and ON CONFLICT DO UPDATE SET; a status lift (connectorStatus
 *          'connected', ChannelConnection.healthState) and a payment or sending account id are binding
 *          writes. CEN-10d holds every shape the round 2 and round 3 hunts passed; CEN-10h holds the
 *          status doors (a status recorded after a provider call lifts no disconnect).
 *   CEN-11 (round 2, CLASS A; round 3: WPH2-1, WPH2-2) every route and KEY action that reaches a send
 *          of the business's people or money rows, or a grant on a stored business file, to an account
 *          outside the server reaches it through the receiver check (assertMayExport,
 *          assertReceiversMayOpenContacts) or the owner rule; CEN-11b: the account such a send goes to
 *          is bound only by a member who reads what it receives, and the binder is recorded.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

const SRC = resolve(__dirname, '../..');
const REPO = resolve(SRC, '../../..');
const CENSUS = join(REPO, 'docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md');

const HTTP_VERBS: Record<string, string> = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', All: 'ALL' };
const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MEMBER_GUARDS = ['AuthGuard', 'BusinessGuard', 'OptionalAuthGuard'];
const DISPOSITIONS = new Set(['applied', 'exempt-check', 'exempt-guard', 'exempt-own', 'exempt-ruled', 'deferred', 'open', 'secret-read']);

interface Route {
  key: string;
  file: string;
  verb: string;
  path: string;
  guards: string[];
  scope?: { module: string; minLevel: string };
  body: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const unquote = (s: string) => s.replace(/^['"`]|['"`]$/g, '');

interface Parsed {
  file: string;
  text: string;
  sf: ts.SourceFile;
}
let parsedCache: Parsed[] | null = null;
/** Every non-test source file under apps/server/src, parsed once for the route reader and the credential call graph. */
function parsed(): Parsed[] {
  parsedCache ??= walk(SRC).map((file) => {
    const text = readFileSync(file, 'utf8');
    return { file, text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) };
  });
  return parsedCache;
}

function routes(files: Parsed[] = parsed()): Route[] {
  const out: Route[] = [];
  for (const { file, text, sf } of files) {
    if (!text.includes('@Controller')) continue;
    const decorators = (n: ts.Node) => (ts.canHaveDecorators(n) ? ts.getDecorators(n) ?? [] : []);
    const name = (d: ts.Decorator) => (ts.isCallExpression(d.expression) ? d.expression.expression.getText(sf) : d.expression.getText(sf));
    const args = (d: ts.Decorator) => (ts.isCallExpression(d.expression) ? d.expression.arguments.map((a) => a.getText(sf)) : []);
    for (const node of sf.statements) {
      if (!ts.isClassDeclaration(node) || !node.name) continue;
      const classDecorators = decorators(node);
      const controller = classDecorators.find((d) => name(d) === 'Controller');
      if (!controller) continue;
      const prefix = unquote(args(controller)[0] ?? '');
      const classGuards = classDecorators.filter((d) => name(d) === 'UseGuards').flatMap(args);
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const ds = decorators(member);
        const http = ds.find((d) => name(d) in HTTP_VERBS);
        if (!http) continue;
        const scopeDecorator = ds.find((d) => name(d) === 'RequireModuleScope');
        const scopeArgs = scopeDecorator ? args(scopeDecorator).map(unquote) : [];
        out.push({
          key: `${node.name.getText(sf)}.${member.name.getText(sf)}`,
          file: relative(SRC, file),
          verb: HTTP_VERBS[name(http)],
          path: '/' + [prefix, unquote(args(http)[0] ?? '')].filter(Boolean).join('/'),
          guards: [...classGuards, ...ds.filter((d) => name(d) === 'UseGuards').flatMap(args)],
          scope: scopeDecorator ? { module: scopeArgs[0], minLevel: scopeArgs[1] ?? 'read' } : undefined,
          body: member.body?.getText(sf) ?? '',
        });
      }
    }
  }
  return out;
}

const enforced = (r: Route) => !!r.scope && r.guards.includes('ModuleScopeGuard');
const isMember = (r: Route) => r.guards.some((g) => MEMBER_GUARDS.includes(g));

/** Second review SV-3: a route that starts a credential binding (an OAuth consent start), by its path or handler name. */
const BINDING_START_PATH = /\/(auth-url|authorize|oauth\/(start|url|authorize))(\/|$)/i;
const BINDING_START_HANDLER = /AuthUrl$/;
const isBindingStart = (r: Route) => BINDING_START_PATH.test(r.path) || BINDING_START_HANDLER.test(r.key.split('.')[1] ?? '');

interface Row {
  key: string;
  verb: string;
  path: string;
  disposition: string;
  reason: string;
  line: number;
}

function censusRows(): Row[] {
  const rows: Row[] = [];
  readFileSync(CENSUS, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const m = /^\|\s*`([A-Za-z0-9_]+\.[A-Za-z0-9_]+)`\s*\|\s*([A-Z]+)\s*\|\s*`?([^|`]*)`?\s*\|\s*([a-z-]+)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
      if (m) rows.push({ key: m[1], verb: m[2], path: m[3].trim(), disposition: m[4], reason: m[5], line: i + 1 });
    });
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Round 1 class repair (CLASS B): the credential-writer call graph. Round 2 (CW-5): its leaves come
// from the schema, and it follows the shapes the round 2 hunt passed through it.
//
// The reviews found the SEC-1 class one instance at a time (connector credentials, then channel and
// social connections, then the Outlook consent start, then Shopify connect), each a route whose path
// and handler name said nothing about credentials. This reader finds them by what the handler does:
// it follows the handler's calls through injected services (constructor and property injection,
// superclasses), same-class helpers, top-level helper functions, connector dispatch (a call on a
// local of an interface several classes implement goes to every implementation), a method name
// only one class defines, a call on any other receiver (a chained one: this.registry.get(t)!.x(),
// by the same name rules), and an event the method emits (to every @OnEvent listener of it), down to
// the code that writes a provider credential:
//   - a Prisma write (create, update, upsert, delete and their Many forms) on a model that stores a
//     credential, through the delegate or any local or class alias of it (const repo =
//     prisma.socialConnection; a destructured delegate), whose data names one of its credential
//     columns (in the call, or, when the data is built elsewhere, in the method and the same-class
//     helpers it calls), or that deletes or deactivates such a row (isActive, a DISCONNECTED status;
//     for an upsert, its update part), or that replaces a JSON column that holds credentials whole.
//     The credential columns are every schema column whose name says it holds a secret
//     (SECRET_COLUMN over packages/db/prisma/schema.prisma; the app-issued tokens are excused by name,
//     NOT_PROVIDER_CREDENTIALS) and the binding rules (BINDING_RULES: account ids, JSON keys, BYOK
//     keys, destinations);
//   - a Business write whose metaData carries a credential key (WhatsApp, payment and SEO secrets,
//     and the GA4 / Search Console entries whole);
//   - raw SQL (tagged or a call, execute or query) that SETs such a column or a JSON column naming
//     a credential key, or deletes, inserts or deactivates such a row;
//   - a consent start: an OAuth state signer (createHmac over a state, in a method that does not
//     verify one) or an OAuth session store (store...OAuthSession / ...OAuthState);
//   - a pinned binding writer (BINDING_WRITERS): a write that binds by what it records, not by a
//     column (WhatsApp's connected verification record lifts an explicit disconnect).
// A writer that only persists the provider's answer for a binding that already exists (a refreshed
// access token, a rotated refresh token) or clears what no binding holds is a REFRESH_DOOR: it is
// pinned by name below with its reason, must still exist and still write, and is not a binding write.
//
// A path to a credential write is GUARDED when settings admin is enforced on the route
// (ModuleScopeGuard with @RequireModuleScope('settings', 'admin')) or when one of the pinned
// authority checks (CREDENTIAL_CHECKS: settings admin as ModuleScopeGuard reads it, or the owner
// rule where a ruling sets one, D-11, D-42, D-94, D-99, D-111 with D-114) dominates the call that
// leads there in some method on the path: the check is called in an earlier statement of a block that
// encloses the call (an `if` condition counts; a check inside a sibling branch does not). For a
// public route (a provider callback) the check is the signed-state verification its start minted.
// CEN-10 fails for every route with an unguarded path, naming the path.
//
// Round 2 (CLASS A, WHP-1, WHP-2): the same reader, with other leaves and checks, follows every route
// to the code that sends the business's people or money rows to an account outside the server
// (an outbound POST, PUT or PATCH in a method that reads a Contact, Invoice, Booking, order, payment
// or quote): see EXPORT_RULES and CEN-11.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const SCHEMA = join(REPO, 'packages/db/prisma/schema.prisma');

interface SchemaModel {
  name: string;
  delegate: string;
  table: string;
  fields: Map<string, { db: string; type: string }>;
  /** Round 3 (CM-2 g06): relation field -> the model it holds, so a nested write (`business.update({ data: { socialConnections: { deleteMany: {} } } })`) is read as a write of that model. */
  relations: Map<string, string>;
}
let schemaCache: Map<string, SchemaModel> | null = null;
/** The Prisma datamodel as the schema file states it: model -> its delegate, its table, its scalar fields and their columns, and its relation fields. */
function schemaModels(): Map<string, SchemaModel> {
  if (schemaCache) return schemaCache;
  const text = readFileSync(SCHEMA, 'utf8');
  const named = new Set([...text.matchAll(/^(?:model|enum|type|view)\s+(\w+)/gm)].map((m) => m[1]));
  const models = new Set([...text.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]));
  const out = new Map<string, SchemaModel>();
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields = new Map<string, { db: string; type: string }>();
    const relations = new Map<string, string>();
    for (const line of m[2].split('\n')) {
      const f = /^\s+(\w+)\s+(\w+)(\[\]|\?)?(.*)$/.exec(line);
      if (!f) continue;
      if (models.has(f[2])) { relations.set(f[1], f[2]); continue; }
      if (named.has(f[2])) continue; // an enum
      fields.set(f[1], { db: /@map\("([^"]+)"\)/.exec(f[4])?.[1] ?? f[1], type: f[2] });
    }
    out.set(m[1], { name: m[1], delegate: m[1][0].toLowerCase() + m[1].slice(1), table: /@@map\("([^"]+)"\)/.exec(m[2])?.[1] ?? m[1], fields, relations });
  }
  return (schemaCache = out);
}

/** A schema column whose name says it holds a secret (round 2: the grep the class finding named, Token|Secret|Password|apiKey|credentials|refresh). */
const SECRET_COLUMN = /(token|secret|password|api_?key|credential|refresh|auth_?data|encrypted)/i;
const SECRET_TYPES = new Set(['String', 'Json', 'Bytes']);

/** Schema columns SECRET_COLUMN matches that are not provider credentials, each with why (CEN-10 checks each still exists). */
const NOT_PROVIDER_CREDENTIALS: Record<string, string> = {
  'Business.contactsSyncToken': 'the Google People API sync cursor (written by the owner-only sync, D-99), not a credential',
  'DriveSyncCursor.pageToken': 'the Drive changes cursor, not a credential',
  'Quote.viewToken': 'the app-issued quote view link',
  'PaymentLink.token': 'the app-issued pay link',
  'PortalAccess.token': 'the app-issued client portal token',
  'ContactExportJob.token': 'the app-issued export download token',
  'SitePageDraft.previewToken': 'the app-issued page preview link',
  'Webhook.secret': "the outbound webhook's signing secret, minted by the server at create under settings write and the receiver's event reads (BUG-001, SEC-2, SV-5), not a provider credential",
  'IntellectualPropertyProfile.tradeSecrets': 'business text (the trade secrets an IP profile lists), not a credential',
};

/**
 * What else a write binds, by Prisma delegate, beyond the secret-named columns: `*delete` / `*create`
 * / `*deactivate` (deleting, creating or deactivating such a row is a binding write), `*metadata`
 * (replacing the JSON column that holds the credentials whole wipes them), and the columns or JSON
 * keys named here (an account id, a destination's own token, a BYOK key).
 */
const BINDING_RULES: Record<string, string[]> = {
  // the account, location and calendar the owner's Google tokens act on (round 2 CW-3; D-99)
  business: ['bpAccountId', 'bpLocationId', 'calendarId'],
  bankConnection: ['providerItemId', '*delete', '*deactivate'],
  // providerMeta: the WhatsApp business account id a connection sends from.
  // healthState (round 3, CB-1, CM-3 g14): the sending state a settings admin sets (PATCH connections/:id
  // 'Disabled' pauses the sender; DeliveryQueueService refuses a campaign whose sender is not 'Connected'),
  // so a write that sets or recomputes it is a binding write: leaving an admin's 'Disabled' lifts it.
  channelConnection: ['providerMeta', 'healthState', '*delete', '*create', '*deactivate'],
  // a destination's own page access token and page id (round 2 CW-2): every send goes to it
  channelDestination: ['destinationMeta', '*delete', '*create', '*deactivate'],
  connectorAccount: ['*delete'],
  socialConnection: ['*delete', '*create', '*deactivate'],
  supplierConnection: ['*delete', '*deactivate'],
  integrationConnection: ['*delete', '*deactivate'],
  // metadata holds encryptedCredentials: a write that replaces it whole wipes them (round 2 CW-5 M13).
  // *lift (round 3, CM-3 g13): a write whose update sets status 'connected' lifts a disconnect recorded on
  // the row, for any connector (WhatsApp's recordConnected was the one instance pinned by name).
  // boundBy (round 3, WPH2-1): the member an export account's sends are checked for (its receiver); writing it binds.
  connectorStatus: ['encryptedCredentials', 'boundBy', '*delete', '*deactivate', '*metadata', '*lift'],
  // the business's BYOK provider keys (settings / ai_preferences; round 2 CW-1)
  aiMemory: ['byokOpenai', 'byokAnthropic', 'byokXai', 'byokKimi', 'byokGoogle', 'byokNative'],
};

let credentialModelsCache: Record<string, string[]> | null = null;
/** Prisma delegate -> the columns (and rules) whose write binds a credential: the schema's secret-named columns, then BINDING_RULES. */
function credentialModels(): Record<string, string[]> {
  if (credentialModelsCache) return credentialModelsCache;
  const out: Record<string, string[]> = {};
  for (const m of schemaModels().values()) {
    for (const [field, { type }] of m.fields) {
      if (!SECRET_TYPES.has(type) || !SECRET_COLUMN.test(field) || Object.hasOwn(NOT_PROVIDER_CREDENTIALS, `${m.name}.${field}`)) continue;
      (out[m.delegate] ??= []).push(field);
    }
  }
  for (const [delegate, rules] of Object.entries(BINDING_RULES)) out[delegate] = [...new Set([...(out[delegate] ?? []), ...rules])];
  return (credentialModelsCache = out);
}

/** Round 3 (CM-2 g05): the *AndReturn forms write too. */
const CREDENTIAL_WRITE_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany']);
/** A nested relation write inside a Prisma write's data (round 3, CM-2 g06). */
const NESTED_WRITE_OPS = /^(create|createMany|connectOrCreate|update|updateMany|upsert|delete|deleteMany|set|disconnect)$/;
/**
 * Business.metaData keys that hold a credential (core/security/sanitize-business.ts: WhatsApp, payment and SEO secrets; the GA4 and
 * Search Console entries hold their tokens whole), and (round 3, CM-3 g09) the account ids those credentials act on: the WiPay
 * account number its checkouts name (resolveWipayMerchant), the PayPal client id and sandbox flag, the Stripe publishable key, and
 * the WhatsApp sending number and business account.
 */
const META_CREDENTIAL_KEYS =
  /\b(stripeSecretKey|stripeWebhookSecret|stripePublishableKey|paypalClientSecret|paypalClientId|paypalSandbox|wipayApiKey|wipayAccountNumber|wipayDeveloperId|accessToken|authToken|refreshToken|accountSid|phoneNumberId|wabaId|gsc|ga4)\b/;
const DEACTIVATES = /\bisActive\b|['"](DISCONNECTED|disconnected|REVOKED|revoked)['"]/;
const DEACTIVATES_SQL = /\bis_active"?\s*=\s*false\b|\bstatus"?\s*=\s*'(DISCONNECTED|disconnected|REVOKED|revoked)'/;
/** Round 3 (CM-3 g13): a status write that marks a connector connected (a literal, or a conditional that can be one). */
const LIFTS = /\bstatus\s*:\s*(?:[^,{}]*\?\s*)?['"]connected['"]/;
const LIFTS_SQL = /\bstatus"?\s*=\s*'connected'/;
const OAUTH_SESSION_STORE = /^(store|save|put|create|issue|mint)\w*O[Aa]uth\w*(Session|State)s?$/;

/**
 * Writers that bind by what they record rather than by a column (round 2 CW-4), pinned by name with
 * why: each must exist and still write a connector row (CEN-10 checks).
 */
const BINDING_WRITERS: Record<string, string> = {
  'WhatsAppConnector.recordConnected':
    "records a passed check as connected, which lifts the explicit disconnect only settings admin writes (POST disconnect/whatsapp): Connect, Reconnect and a passed smoke test reach it",
};

/** Raw SQL that writes a credential: a SET of a credential column or of a JSON column naming a credential key, or a DELETE, INSERT or deactivation of a credential row. */
function rawSqlLeaf(sql: string): string | null {
  const models = credentialModels();
  const byTable = new Map([...schemaModels().values()].map((m) => [m.table.toLowerCase(), m]));
  const appTokens = new Set(
    Object.keys(NOT_PROVIDER_CREDENTIALS).map((k) => {
      const [model, field] = k.split('.');
      const m = schemaModels().get(model);
      return `${(m?.table ?? model).toLowerCase()}.${(m?.fields.get(field)?.db ?? field).toLowerCase()}`;
    }),
  );
  for (const st of sql.split(';')) {
    const ins = /\bINSERT\s+INTO\s+"?(?:public"?\."?)?(\w+)"?(?:\s*\(([^)]*)\))?/i.exec(st);
    // Round 3 (CM-2 g08): an INSERT ... ON CONFLICT ... DO UPDATE SET is an UPDATE of the same table.
    const onConflict = ins ? /\bDO\s+UPDATE\s+SET\s+([\s\S]*)/i.exec(st) : null;
    const upd = onConflict ? ([st, ins![1], onConflict[1]] as unknown as RegExpExecArray) : /\bUPDATE\s+(?:ONLY\s+)?"?(?:public"?\."?)?(\w+)"?(?:\s+(?:AS\s+)?\w+)?\s+SET\s+([\s\S]*)/i.exec(st);
    const del = /\bDELETE\s+FROM\s+"?(?:public"?\."?)?(\w+)"?/i.exec(st);
    const table = (upd ?? del ?? ins)?.[1]?.toLowerCase();
    if (!table) continue;
    const m = byTable.get(table);
    const rules = m ? models[m.delegate] ?? [] : [];
    if (ins?.[2] && m) {
      // an INSERT that names a credential column in its column list
      const cols = rules.filter((c) => !c.startsWith('*')).map((c) => (m.fields.get(c)?.db ?? c).toLowerCase());
      const named = ins[2].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase());
      const hit = named.filter((c) => cols.includes(c) || (SECRET_COLUMN.test(c) && !appTokens.has(`${table}.${c}`)));
      if (hit.length) return `raw SQL INSERT INTO ${table} (${hit.join(', ')})`;
    }
    if (upd) {
      const sets = upd[2].split(/\bWHERE\b|\bRETURNING\b|\bFROM\b/i)[0];
      const assigned = [...sets.matchAll(/"?(\w+)"?\s*=(?!=)/g)].map((x) => x[1].toLowerCase());
      const cols = m ? rules.filter((c) => !c.startsWith('*')).map((c) => (m.fields.get(c)?.db ?? c).toLowerCase()) : [];
      const hit = assigned.filter((a) => cols.includes(a) || (SECRET_COLUMN.test(a) && !appTokens.has(`${table}.${a}`)));
      if (hit.length) return `raw SQL UPDATE ${table} SET ${[...new Set(hit)].join(', ')}`;
      if (assigned.some((a) => /^(meta_?data|metadata|destination_meta|provider_meta)$/.test(a)) && (META_CREDENTIAL_KEYS.test(sets) || /encryptedCredentials|byok/i.test(sets))) {
        return `raw SQL UPDATE ${table} SET a JSON credential key`;
      }
      if (rules.includes('*deactivate') && DEACTIVATES_SQL.test(sets)) return `raw SQL UPDATE ${table} (deactivate)`;
      if (rules.includes('*lift') && LIFTS_SQL.test(sets)) return `raw SQL UPDATE ${table} (status lift)`;
    }
    if (del && rules.includes('*delete')) return `raw SQL DELETE FROM ${table}`;
    if (ins && rules.includes('*create')) return `raw SQL INSERT INTO ${table}`;
  }
  return null;
}

/**
 * Writers that persist the provider's answer for a binding that already exists, or clear what no
 * binding holds. Each must exist and still write a credential (CEN-10 checks), so the list cannot
 * outlive what it excuses.
 */
const REFRESH_DOORS: Record<string, string> = {
  'GoogleDriveService.refreshAccessToken': 'stores the access token Google returns for the stored refresh token',
  'CalendarService.refreshAccessToken': 'stores the access token Google returns for the stored refresh token',
  'GmailService.writeRefreshedTokenIfUnchanged': 'stores a refreshed Gmail access token only while the stored refresh token is unchanged',
  'GoogleTokenHelper.getValidAccessToken': 'refreshes a Google Suite access token from the stored refresh token',
  'MicrosoftTokenHelper.getValidAccessToken': 'refreshes the Outlook access token; Microsoft rotates the refresh token with it (same account)',
  'GmailService.sweepExpiredPending': 'deletes PENDING Gmail connections whose confirmation window has passed (no binding)',
  'GmailIngestionService.writeStatusWhileMailboxLinked': 'clears an access token left with no refresh token and no mailbox (an orphan, no binding)',
  'SeoGoogleSearchConsoleService.syncSearchData': 'stamps the sync on the stored GSC entry (tokens carried as stored) under the owner-only sync route',
  'SeoGoogleAnalyticsService.syncAnalyticsData': 'stamps the sync on the stored GA4 entry (tokens carried as stored) under the owner-only sync route',
};

/**
 * Round 3 (CM-3 g13): writers that mark a connector 'connected' only to record a provider call its
 * stored credentials just passed (a sent email, a synced page, a charge). Such a write lifts no
 * disconnect: the connector's own disconnect removes those credentials (so no call can pass after it),
 * or its connectedness is read from the credentials, never from the stored status. CEN-10h checks both
 * for each door's connector class, and that the door still writes; a connector whose stored status
 * decides (WhatsApp: recordConnected, a BINDING_WRITER) cannot be pinned here.
 */
const STATUS_DOORS: Record<string, { connector: string; why: string }> = {
  'GmailConnector.trackActivity': { connector: 'GmailConnector', why: 'records a Gmail send or read the stored mailbox tokens passed' },
  'GmailIngestionService.syncInbox': { connector: 'GmailConnector', why: 'records an inbox sync the stored mailbox tokens passed' },
  'GoogleCalendarConnector.trackActivity': { connector: 'GoogleCalendarConnector', why: 'records a calendar call the stored Google tokens passed' },
  'GoogleDriveConnector.trackActivity': { connector: 'GoogleDriveConnector', why: 'records a Drive call the stored Google tokens passed' },
  'GoogleContactsSyncService.sync': { connector: 'GoogleContactsConnector', why: 'records a Google Contacts sync the stored tokens passed' },
  'GoogleContactsSyncService.writeProgress': { connector: 'GoogleContactsConnector', why: 'records the progress of a Google Contacts sync the stored tokens are running' },
  'GoogleContactsConnector.smokeTest': { connector: 'GoogleContactsConnector', why: 'records a People API check the stored tokens passed' },
  'GoogleFormsIngestionService.syncForms': { connector: 'GoogleFormsConnector', why: 'records a Forms sync the stored Google tokens passed' },
  'OutlookContactsSyncService.sync': { connector: 'OutlookContactsConnector', why: 'records an Outlook Contacts sync the stored Microsoft tokens passed' },
  'QuickbooksConnector.trackActivity': { connector: 'QuickbooksConnector', why: 'records a QuickBooks call the stored credentials passed' },
  'XeroConnector.trackActivity': { connector: 'XeroConnector', why: 'records a Xero call the stored credentials passed' },
  'MailchimpConnector.trackActivity': { connector: 'MailchimpConnector', why: 'records a Mailchimp call the stored API key passed' },
  'KlaviyoConnector.trackActivity': { connector: 'KlaviyoConnector', why: 'records a Klaviyo call the stored API key passed' },
  'MetaSocialConnector.trackActivity': { connector: 'MetaSocialConnector', why: 'records a Meta call the stored page tokens passed' },
  'SocialPlatformConnector.trackActivity': { connector: 'SocialPlatformConnector', why: 'records a social platform call the stored tokens passed' },
  'FormPlatformConnector.trackActivity': { connector: 'FormPlatformConnector', why: 'records a form platform delivery the stored credential passed' },
  'StripeConnector.trackActivity': { connector: 'StripeConnector', why: "records a Stripe call the owner's stored key (D-11) passed; the connector reads that key, not this status" },
  'PayPalConnector.trackActivity': { connector: 'PayPalConnector', why: "records a PayPal call the owner's stored keys (D-11) passed; the connector reads those keys, not this status" },
  'WiPayConnector.trackActivity': { connector: 'WiPayConnector', why: "records a WiPay call the owner's stored key (D-11) passed; the connector reads that key, not this status" },
};

/**
 * Authority checks that guard a credential write when they dominate it. A role-only check is not one
 * (KeyConnectorController's requireConnectorWriter admits every ADMIN, and D-114 binds an ADMIN to an
 * explicit map): the route must also hold settings admin by the map. A method or helper that always runs
 * one of these before it can return (assertProfileOwner, assertConnectorSettingsAdmin) counts as one
 * (wrappers, below).
 *
 * Round 3 (CM-1): a check is known by its DECLARATION, not by its name. The call must resolve (through
 * `this`, a typed property or local, an import, a function of the same file) to one of the pinned
 * declarations (`decl`: `Class.method`, or `fn:<name>@<file under src>`), so a file-local no-op that
 * carries a check's name checks nothing. A check that answers null instead of throwing (`gate`:
 * verifyState, consumeOAuthSession) guards only through a falsy test of its result that ends in throw or
 * return and dominates the write. A check that names the business it decides for (`biz`: that argument's
 * index) guards only a write to that business: the argument must be the route's :businessId, or appear
 * in the call that leads to the write (a member who is OWNER of C and STAFF in A, checked on C, does not
 * pass for A).
 */
interface CheckRule {
  decl: string[];
  args?: RegExp;
  biz?: number;
  gate?: boolean;
  why: string;
}
const SETTINGS_ADMIN_ARGS = /['"]settings['"]\s*,\s*['"]admin['"]/;
const CREDENTIAL_CHECKS: Record<string, CheckRule> = {
  assertMemberModuleLevel: { decl: ['fn:assertMemberModuleLevel@core/auth/member-module-level.ts'], args: SETTINGS_ADMIN_ARGS, biz: 1, why: 'settings admin, read as ModuleScopeGuard reads it' },
  assertConnectorSettingsAdmin: { decl: ['ConnectorController.assertConnectorSettingsAdmin'], biz: 0, why: 'settings admin; gmail and the Google Suite connections answer their owner rules (D-11, D-99)' },
  assertConnectorBindingAuthority: { decl: ['ConnectorController.assertConnectorBindingAuthority'], biz: 0, why: 'settings admin, or the Gmail (D-11, D-42) and Google Suite (D-99) owner rules for those connections, for a route that starts or resumes a binding' },
  assertGoogleConnectOwner: { decl: ['fn:assertGoogleConnectOwner@core/connectors/google-suite.controller.ts'], biz: 1, why: 'D-99: every Google connection is the owner\'s' },
  assertConnectAuthority: { decl: ['GmailService.assertConnectAuthority'], biz: 0, why: 'D-11, D-42: the business mailbox is the owner\'s (GMAIL_OWNER_ONLY)' },
  connectStanding: { decl: ['GmailService.connectStanding'], biz: 0, why: 'D-11, D-42: the Gmail owner rule assertConnectAuthority runs, answering the standing for the audit row' },
  assertBusinessOwner: { decl: ['IdentityService.assertBusinessOwner'], biz: 0, why: 'D-11: the business profile and its stored secrets are the owner\'s' },
  assertConfigOwner: { decl: ['WhatsAppService.assertConfigOwner'], biz: 0, why: 'D-11: the WhatsApp sending identity is the owner\'s' },
  assertConnectorOwner: { decl: ['SeoController.assertConnectorOwner'], biz: 0, why: 'D-94: GA4 and Search Console are the owner\'s' },
  assertCommandActorModuleLevel: { decl: ['fn:assertCommandActorModuleLevel@core/auth/member-module-level.ts'], args: SETTINGS_ADMIN_ARGS, biz: 1, why: 'settings admin for a KEY command\'s human actor, read as ModuleScopeGuard reads it' },
  verifyState: {
    decl: [
      'CrmGoogleService.verifyState', 'GoogleDriveService.verifyState', 'MicrosoftOAuthService.verifyState', 'GmailService.verifyState',
      'CalendarService.verifyState', 'CalendarSyncService.verifyState', 'GoogleSuiteService.verifyState',
    ],
    gate: true,
    why: 'a public provider callback: the signed state its (guarded) start minted',
  },
  consumeOAuthSession: { decl: ['SocialConnectionsService.consumeOAuthSession'], gate: true, why: 'a provider callback: the OAuth session its (guarded) start stored' },
};

// ── Round 2 (CLASS A): the export graph. Same reader, other leaves and checks. ──────────────────

/** An outbound send that carries a body (fetch with POST / PUT / PATCH, an axios or HttpService post / put / patch). */
const OUTBOUND_SEND = /\bfetch\([\s\S]*?method:\s*['"`](POST|PUT|PATCH)['"`]|\b(axios|httpService|this\.http)\s*\.\s*(post|put|patch)\s*\(/;
const SEND_METHOD = /method:\s*['"`](POST|PUT|PATCH)['"`]/;
/** A read of a person or money row (a Contact, an Invoice, a Booking, a store order, a payment, a quote), or such a row included. */
const RECORD_READ = /\.(contact|contacts|invoice|booking|marketplaceOrder|payment|quote|lead)\s*\.\s*(findUnique|findFirst|findMany|findUniqueOrThrow|findFirstOrThrow)\b|include:\s*\{[^}]*\b(contact|customer|invoice|booking)\s*:\s*(true|\{)/;
/**
 * Round 3 (WPH2-2): a send that hands out a stored business file: a grant on a file the business keeps
 * (Drive's POST files/:id/permissions). The file holds the records (an invoice PDF names the client and
 * the amounts), so the grant is an export of them even though the method reads no row.
 */
const FILE_GRANT = /\/permissions\b/;

/** Round 3: an outbound send call (the call is the leaf, so a check in the same method that dominates it guards it). */
function isOutboundSend(call: ts.CallExpression, own: string): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee) && callee.text === 'fetch') {
    const opts = call.arguments[1];
    if (!opts) return false;
    if (ts.isObjectLiteralExpression(opts)) return SEND_METHOD.test(textOf(opts));
    return SEND_METHOD.test(own); // the options are built elsewhere in the method
  }
  if (ts.isPropertyAccessExpression(callee) && /^(post|put|patch)$/.test(callee.name.text)) {
    return /\b(axios|httpService|http)\b/.test(textOf(callee.expression));
  }
  return false;
}

/**
 * Methods that send records out to a destination every reader of those records may receive, pinned
 * by id with why (CEN-11 checks each still sends). Everything else that sends records out is an
 * export: the route must check the reads the export carries (assertMayExport, the rule webhooks
 * apply at create: core/auth/receiver-reads.ts) before it.
 *
 * Round 3 (WPH2-1): OutlookContactsSyncService.pushContact is not one. Its reason here said the sync maps
 * only contacts its principals may write, but the receiver is the Microsoft account's binder (a settings
 * admin, crm none under D-114), not the sync's principals: the owner's PRIVATE contacts went to it. It
 * now checks the receiver itself (assertReceiversMayOpenContacts), and CEN-11 holds it.
 */
const OUTBOUND_DESTINATIONS: Record<string, string> = {
  'GoogleContactsSyncService.pushContact':
    "the owner's Google account: only the owner connects Google Contacts (D-99), and the owner reads every contact; it sends back a contact the sync already mapped to that account",
  'PaymentsService.createStripeCheckout':
    "the business's own Stripe account (its secret key is the owner's profile secret, D-11, or the platform's): a payer's checkout for the invoice they pay",
  'PaymentsService.createWipayCheckout':
    "the business's own WiPay account (its API key is the owner's profile secret, D-11, or the platform's): a payer's checkout for the invoice they pay",
};

/** Checks that guard an export when they dominate it: the receiver's reads, or the owner (who reads everything). */
const EXPORT_CHECKS: Record<string, CheckRule> = {
  assertMayExport: { decl: ['fn:assertMayExport@core/auth/receiver-reads.ts'], biz: 1, why: "the reads the export's records need (core/auth/receiver-reads.ts: the module levels, and for contacts every one in view), for the member who sends them to the account bound" },
  assertReceiversMayOpenContacts: {
    decl: ['fn:assertReceiversMayOpenContacts@core/auth/receiver-reads.ts'],
    biz: 1,
    why: "round 3 (WPH2-1): every contact sent is one every receiver of the account may open (the account's recorded binder; an account with no recorded binder is read as a non-owner's)",
  },
  assertGoogleConnectOwner: { decl: ['fn:assertGoogleConnectOwner@core/connectors/google-suite.controller.ts'], biz: 1, why: 'D-99: the owner, who reads every record, owns every Google connection' },
  assertConnectAuthority: { decl: ['GmailService.assertConnectAuthority'], biz: 0, why: 'D-11, D-42: the owner\'s mailbox' },
  assertBusinessOwner: { decl: ['IdentityService.assertBusinessOwner'], biz: 0, why: 'D-11: the owner' },
};

/**
 * Round 3 (WPH2-1, WPH2-2; CEN-11b): exporters that are not connector classes. Each names the connector
 * type of the account it sends to, the routes that bind that account (an OAuth consent start) and,
 * where the binder is a member the sends must be checked for, the callback that records the binder.
 */
const EXPORT_ACCOUNTS: Record<string, { type: string; binds: string[]; recordsBinder?: string }> = {
  OutlookContactsSyncService: { type: 'outlook_contacts', binds: ['MicrosoftOAuthController.buildAuthUrl'], recordsBinder: 'MicrosoftOAuthService.handleCallback' },
  GoogleDriveService: { type: 'google_drive', binds: ['GoogleDriveController.getAuthUrl'] },
};

interface GraphClass {
  file: string;
  /** property -> the type it holds: a class, an interface, or an injection token (`@Inject(TOKEN)`). */
  props: Map<string, string>;
  /** property -> its declared type annotation, when an injection token names it (round 3, CM-2 g01). */
  propDecl: Map<string, string>;
  methods: Map<string, ts.Node>;
  /** this.<name> -> a Prisma delegate it holds (a property initialised with one, a getter returning one). */
  aliases: Map<string, string>;
  extendsName?: string;
  implementsNames: string[];
}

interface CredentialGraph {
  classes: Map<string, GraphClass>;
  /** KEY connector adapters: Class.execute(command: ConnectorCommand), the door every KEY module action goes through. */
  keyEntries: string[];
  /** method id -> why it is unguarded (a path), or absent when every path from it to a leaf is guarded. */
  unguarded: Map<string, string[]>;
  /** method id -> some path to a leaf, guarded or not. */
  reaches: Map<string, string[]>;
  /** door id -> the leaves the door excuses. */
  doorWrites: Map<string, string[]>;
  /** Every declaration the source has, as a check's `decl` names it (`Class.method`, `fn:<name>@<file>`). */
  declarations: Set<string>;
  /** Methods that always run a pinned check before they return. */
  wrappers: Set<string>;
  /** method id -> its own leaves (before doors). */
  leaves: Map<string, string[]>;
}

interface LeafContext {
  /** The method's own text. */
  own: string;
  /** The method's text, the same-class helpers it calls and the file constants it names. */
  mention: string;
  aliases: ReadonlyMap<string, string>;
  /** The text an expression stands for: a string constant it names (file-level or imported), or its own text (round 3, CM-2 g07). */
  constText(e: ts.Expression): string;
}

interface GraphRules {
  /** The leaf a call makes itself (a credential write, an export send), or null. */
  leafOfCall(call: ts.CallExpression | ts.TaggedTemplateExpression, ctx: LeafContext): string | null;
  /** A leaf the method makes as a whole (a consent start, a pinned binding writer), or null. */
  leafOfMethod(id: string, own: string, mention: string): string | null;
  checks: Record<string, CheckRule>;
  /** Methods whose leaves are excused, id -> why. */
  doors: Record<string, string>;
}

const textOf = (n: ts.Node) => n.getText(n.getSourceFile());
const strip = (expr: ts.Expression): ts.Expression => {
  let e = expr;
  while (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isAwaitExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
};

/** The Prisma delegate an expression names: `x.socialConnection`, `x['socialConnection']`, or a local or class alias of one (any schema model with `any`). */
function modelOf(expr: ts.Expression, aliases: ReadonlyMap<string, string>, any = false): string | null {
  const models = any ? Object.fromEntries([...schemaModels().values()].map((m) => [m.delegate, true])) : credentialModels();
  const e = strip(expr);
  const known = (m: string | undefined) => (m && Object.hasOwn(models, m) ? m : null);
  if (ts.isIdentifier(e)) return known(aliases.get(e.text));
  if (ts.isPropertyAccessExpression(e)) {
    if (Object.hasOwn(models, e.name.text)) return e.name.text;
    if (e.expression.kind === ts.SyntaxKind.ThisKeyword) return known(aliases.get(`this.${e.name.text}`));
    return null;
  }
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) {
    return Object.hasOwn(models, e.argumentExpression.text) ? e.argumentExpression.text : null;
  }
  return null;
}

/** The locals of a body that hold a Prisma delegate (`const repo = tx.socialConnection`, `const { socialConnection } = this.prisma.client`). */
function aliasesIn(body: ts.Node, base: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map(base);
  const models = Object.fromEntries([...schemaModels().values()].map((m) => [m.delegate, true]));
  const holder = (init: ts.Expression) => {
    const e = strip(init);
    return ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || e.kind === ts.SyntaxKind.ThisKeyword;
  };
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      if (ts.isIdentifier(n.name)) {
        const m = modelOf(n.initializer, out, true);
        if (m) out.set(n.name.text, m);
      } else if (ts.isObjectBindingPattern(n.name) && holder(n.initializer)) {
        for (const el of n.name.elements) {
          const prop = (el.propertyName ?? el.name).getText(el.getSourceFile());
          if (Object.hasOwn(models, prop) && ts.isIdentifier(el.name)) out.set(el.name.text, prop);
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(body);
  return out;
}

/** Round 3 (CM-2 g06): a nested write inside a Prisma write's data on a relation that holds a credential model. */
function nestedRelationLeaf(model: string, op: string, first: ts.Expression | undefined): string | null {
  const schema = [...schemaModels().values()].find((m) => m.delegate === model);
  if (!schema || !first || !ts.isObjectLiteralExpression(first)) return null;
  const models = credentialModels();
  const parts = first.properties.filter((p) => p.name && /^(data|create|update)$/.test(p.name.getText(p.getSourceFile())));
  for (const part of parts) {
    if (!ts.isPropertyAssignment(part) || !ts.isObjectLiteralExpression(part.initializer)) continue;
    for (const field of part.initializer.properties) {
      if (!ts.isPropertyAssignment(field) || !field.name || !ts.isObjectLiteralExpression(field.initializer)) continue;
      const target = schema.relations.get(field.name.getText(field.getSourceFile()));
      const delegate = target ? schemaModels().get(target)?.delegate : undefined;
      const rules = delegate ? models[delegate] : undefined;
      if (!rules) continue;
      for (const nested of field.initializer.properties) {
        const nestedOp = nested.name?.getText(nested.getSourceFile()) ?? '';
        if (!NESTED_WRITE_OPS.test(nestedOp)) continue;
        const text = textOf(nested);
        const cols = rules.filter((c) => !c.startsWith('*') && new RegExp(`\\b${c}\\b`).test(text));
        const removes = /^(delete|deleteMany|set|disconnect)$/.test(nestedOp) && rules.includes('*delete');
        const creates = /^(create|createMany|connectOrCreate|upsert)$/.test(nestedOp) && rules.includes('*create');
        if (cols.length || removes || creates) return `${model}.${op}(nested ${delegate}.${nestedOp}${cols.length ? `: ${cols.join(', ')}` : ''})`;
      }
    }
  }
  return null;
}

/** The credential write a call makes itself, or null (CLASS B leaves). */
function credentialLeafOfCall(call: ts.CallExpression | ts.TaggedTemplateExpression, ctx: LeafContext): string | null {
  const { mention, aliases } = ctx;
  if (ts.isTaggedTemplateExpression(call)) {
    return /\$(executeRaw|queryRaw)(Unsafe)?$/.test(textOf(call.tag)) ? rawSqlLeaf(textOf(call.template)) : null;
  }
  const callee = call.expression;
  const argsText = call.arguments.map(textOf).join(', ');
  if (!ts.isPropertyAccessExpression(callee)) return null;
  // Round 3 (CM-2 g07): the SQL may be a constant the call names.
  if (/^\$(executeRaw|queryRaw)(Unsafe)?$/.test(callee.name.text)) return rawSqlLeaf(call.arguments.map((a) => ctx.constText(a)).join(', '));
  if (!CREDENTIAL_WRITE_OPS.has(callee.name.text)) return null;
  const op = callee.name.text;
  const anyModel = modelOf(callee.expression, aliases, true);
  const nested = anyModel ? nestedRelationLeaf(anyModel, op, call.arguments[0]) : null;
  if (nested) return nested;
  const model = modelOf(callee.expression, aliases);
  if (!model) return null;
  const cols = credentialModels()[model];
  // the data is built elsewhere: a data / create / update / metadata value that is not an object literal, a shorthand, or a spread
  // (a parenthesised spread, `...(cond && { col: v })`, is still written out in the call)
  // and a computed column name, `[fields.access]: token`, is named elsewhere too
  const indirect = /\b(data|create|update|metadata|metaData|value|destinationMeta)\s*(:\s*(?![{\s])|[,}])|\.\.\.[A-Za-z_$]|\[[A-Za-z_$][\w$.]*\]\s*:/.test(argsText);
  const scope = indirect ? mention : argsText;
  const hit = cols.filter((c) => !c.startsWith('*') && new RegExp(`\\b${c}\\b`).test(scope));
  if (hit.length) return `${model}.${op}(${hit.join(', ')})`;
  if (op.startsWith('delete') && cols.includes('*delete')) return `${model}.${op}`;
  if ((op.startsWith('create') || op === 'upsert') && cols.includes('*create')) return `${model}.${op}`;
  // an upsert deactivates (or lifts) through its update part only (a create of a disconnected row binds nothing)
  const first = call.arguments[0];
  const updatePart =
    op === 'upsert' && first && ts.isObjectLiteralExpression(first)
      ? first.properties.filter((p) => p.name && p.name.getText(p.getSourceFile()) === 'update').map(textOf).join(', ')
      : argsText;
  const writes = op.startsWith('update') || op === 'upsert';
  if (writes && cols.includes('*deactivate') && DEACTIVATES.test(updatePart)) return `${model}.${op}(deactivate)`;
  if (writes && cols.includes('*lift') && LIFTS.test(indirect && !/\bstatus\b/.test(updatePart) ? mention : updatePart)) return `${model}.${op}(status lift)`;
  // a JSON column that holds the credentials, replaced by a literal that keeps nothing of the stored one
  if (writes && cols.includes('*metadata') && /\bmetadata\s*:\s*\{(?![^{}]*\.\.\.)/.test(updatePart)) return `${model}.${op}(metadata replaced)`;
  if (model === 'business' && /\bmetaData\b/.test(indirect ? mention : argsText) && META_CREDENTIAL_KEYS.test(mention)) return 'business.metaData(credential keys)';
  return null;
}

const CREDENTIAL_RULES: GraphRules = {
  leafOfCall: credentialLeafOfCall,
  leafOfMethod: (id, own) => {
    const method = id.slice(id.lastIndexOf('.') + 1);
    if ((/createHmac\(/.test(own) && /\bstate\b/.test(own) && !/verify|validate|check|parse|decode/i.test(method)) || OAUTH_SESSION_STORE.test(method)) {
      return 'consent start (OAuth state)';
    }
    if (Object.hasOwn(BINDING_WRITERS, id)) return `binding writer (${id})`;
    return null;
  },
  checks: CREDENTIAL_CHECKS,
  doors: { ...REFRESH_DOORS, ...Object.fromEntries(Object.entries(STATUS_DOORS).map(([id, d]) => [id, d.why])) },
};

const EXPORT_RULES: GraphRules = {
  leafOfCall: (call, ctx) => {
    if (!ts.isCallExpression(call) || !isOutboundSend(call, ctx.own)) return null;
    if (FILE_GRANT.test(call.arguments[0] ? textOf(call.arguments[0]) : '')) return 'export (hands out a stored business file)';
    return RECORD_READ.test(ctx.mention) ? 'export (sends records out)' : null;
  },
  leafOfMethod: () => null,
  checks: EXPORT_CHECKS,
  doors: OUTBOUND_DESTINATIONS,
};

function buildGraph(rules: GraphRules, files: Parsed[] = parsed()): CredentialGraph {
  const classes = new Map<string, GraphClass>();
  const interfaces = new Map<string, string[]>();
  const functions = new Map<string, Array<{ body: ts.Node; sf: ts.SourceFile; params: readonly ts.ParameterDeclaration[] }>>();
  /** Round 3: a top-level function's declared return type (`Promise<GmailService>` -> GmailService). */
  const functionReturns = new Map<string, string>();
  const listeners = new Map<string, string[]>();
  const declarations = new Set<string>();
  const keyEntries: string[] = [];
  /** Round 3 (CM-2 g01): an injection token -> the provider classes bound to it (`{ provide: TOKEN, useClass: X }`). */
  const providers = new Map<string, string[]>();
  /** Round 3 (CM-2 g04, g07): top-level constants (initializers) by file, and by name across the source. */
  const fileConsts = new Map<ts.SourceFile, Map<string, ts.Expression>>();
  const constsByPath = new Map<string, Map<string, ts.Expression>>();
  const knownFiles = new Set(files.map(({ sf }) => relative(SRC, sf.fileName)));
  /** Round 3 (CM-1): per file, an imported name -> the file (under src) and the name it is declared with. */
  const imports = new Map<ts.SourceFile, Map<string, { file: string; name: string }>>();
  /** Method parameters, and declared return types, by method id. */
  const methodParams = new Map<string, readonly ts.ParameterDeclaration[]>();
  const methodReturns = new Map<string, string>();
  const decorators = (n: ts.Node) => (ts.canHaveDecorators(n) ? ts.getDecorators(n) ?? [] : []);
  const injected = (sf: ts.SourceFile, n: ts.Node) => {
    const inj = decorators(n).find((d) => ts.isCallExpression(d.expression) && d.expression.expression.getText(sf) === 'Inject');
    const a = inj && ts.isCallExpression(inj.expression) ? inj.expression.arguments[0] : undefined;
    if (!a) return undefined;
    if (ts.isIdentifier(a)) return a.text;
    if (ts.isArrowFunction(a)) return a.body.getText(sf);
    if (ts.isStringLiteralLike(a)) return a.text;
    return undefined;
  };
  const cleanType = (t: string) => t.replace(/\s*\|\s*(undefined|null)/g, '').replace(/^Promise<(.*)>$/, '$1').trim();
  const relFile = (sf: ts.SourceFile) => relative(SRC, sf.fileName);

  for (const { sf } of files) {
    const consts = new Map<string, ts.Expression>();
    const imported = new Map<string, { file: string; name: string }>();
    for (const node of sf.statements) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
        const target = relative(SRC, resolve(join(sf.fileName, '..'), node.moduleSpecifier.text));
        const file = target.endsWith('.ts') ? target : knownFiles.has(`${target}.ts`) || !knownFiles.has(`${target}/index.ts`) ? `${target}.ts` : `${target}/index.ts`;
        const named = node.importClause?.namedBindings;
        if (named && ts.isNamedImports(named)) for (const el of named.elements) imported.set(el.name.text, { file, name: (el.propertyName ?? el.name).text });
      }
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer) {
            consts.set(d.name.text, d.initializer);
          }
        }
      }
    }
    fileConsts.set(sf, consts);
    constsByPath.set(relFile(sf), consts);
    imports.set(sf, imported);
    const visitProviders = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        const prop = (k: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === k);
        const provide = prop('provide');
        const use = prop('useClass') ?? prop('useExisting');
        const factory = prop('useFactory');
        const cls = use ? use.initializer.getText(sf) : factory ? /\bnew\s+([A-Z]\w*)/.exec(factory.initializer.getText(sf))?.[1] : undefined;
        if (provide && cls) {
          const token = ts.isStringLiteralLike(provide.initializer) ? provide.initializer.text : provide.initializer.getText(sf);
          providers.set(token, [...new Set([...(providers.get(token) ?? []), cls])]);
        }
      }
      n.forEachChild(visitProviders);
    };
    visitProviders(sf);
  }

  /** The string values an expression may stand for: a literal, a constant (local, file-level or imported, or a member of a constant object), a conditional's branches, a map's values. */
  const stringValues = (expr: ts.Expression | undefined, sf: ts.SourceFile, scope?: ts.Node, depth = 0): string[] => {
    if (!expr || depth > 6) return [];
    const e = strip(expr);
    if (ts.isStringLiteralLike(e)) return [e.text];
    if (ts.isConditionalExpression(e)) return [...stringValues(e.whenTrue, sf, scope, depth + 1), ...stringValues(e.whenFalse, sf, scope, depth + 1)];
    const objectValues = (o: ts.Expression | undefined): string[] => {
      const v = o ? strip(o) : undefined;
      if (!v || !ts.isObjectLiteralExpression(v)) return [];
      return v.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? stringValues(p.initializer, sf, scope, depth + 1) : []));
    };
    const constOf = (name: string): ts.Expression | undefined => {
      if (scope) {
        let found: ts.Expression | undefined;
        const visit = (n: ts.Node) => {
          if (!found && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found = n.initializer;
          if (!found) n.forEachChild(visit);
        };
        visit(scope);
        if (found) return found;
      }
      const local = fileConsts.get(sf)?.get(name);
      if (local) return local;
      const imp = imports.get(sf)?.get(name);
      return imp ? constsByPath.get(imp.file)?.get(imp.name) : undefined;
    };
    if (ts.isIdentifier(e)) {
      const init = constOf(e.text);
      if (!init) return [];
      const v = strip(init);
      // `const eventName = eventMap[status]`: every value of the map
      if (ts.isElementAccessExpression(v) && ts.isIdentifier(strip(v.expression))) return objectValues(constOf((strip(v.expression) as ts.Identifier).text));
      return stringValues(init, sf, scope, depth + 1);
    }
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const obj = constOf(e.expression.text);
      const o = obj ? strip(obj) : undefined;
      if (o && ts.isObjectLiteralExpression(o)) {
        const p = o.properties.find((x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && x.name.getText(x.getSourceFile()) === e.name.text);
        return p ? stringValues(p.initializer, sf, scope, depth + 1) : [];
      }
    }
    if (ts.isElementAccessExpression(e) && ts.isIdentifier(strip(e.expression))) return objectValues(constOf((strip(e.expression) as ts.Identifier).text));
    return [];
  };
  const eventsOf = (sf: ts.SourceFile, n: ts.Node): string[] => {
    const out: string[] = [];
    for (const d of decorators(n)) {
      if (!ts.isCallExpression(d.expression) || d.expression.expression.getText(sf) !== 'OnEvent') continue;
      const a = d.expression.arguments[0];
      if (a && ts.isArrayLiteralExpression(a)) for (const e of a.elements) out.push(...stringValues(e, sf));
      else out.push(...stringValues(a, sf));
    }
    return out;
  };

  for (const { sf } of files) {
    for (const node of sf.statements) {
      if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node.members.filter((m) => m.name).map((m) => m.name!.getText(sf)));
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        functions.set(node.name.text, [...(functions.get(node.name.text) ?? []), { body: node.body, sf, params: node.parameters }]);
        declarations.add(`fn:${node.name.text}@${relFile(sf)}`);
        if (node.type) functionReturns.set(node.name.text, cleanType(node.type.getText(sf)));
      }
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
            functions.set(d.name.text, [...(functions.get(d.name.text) ?? []), { body: d.initializer.body, sf, params: d.initializer.parameters }]);
            declarations.add(`fn:${d.name.text}@${relFile(sf)}`);
          }
        }
      }
      if (!ts.isClassDeclaration(node) || !node.name) continue;
      const cls: GraphClass = { file: relFile(sf), props: new Map(), propDecl: new Map(), methods: new Map(), aliases: new Map(), implementsNames: [] };
      // A class name defined twice keeps its first file (both are read: the second under file@name).
      const key = classes.has(node.name.text) ? `${node.name.text}@${cls.file}` : node.name.text;
      for (const h of node.heritageClauses ?? []) {
        for (const t of h.types) {
          if (h.token === ts.SyntaxKind.ExtendsKeyword) cls.extendsName = t.expression.getText(sf);
          else cls.implementsNames.push(t.expression.getText(sf));
        }
      }
      for (const m of node.members) {
        if (ts.isConstructorDeclaration(m)) {
          for (const p of m.parameters) {
            if (!ts.isIdentifier(p.name)) continue;
            const type = injected(sf, p) ?? (p.type ? p.type.getText(sf) : undefined);
            if (type) cls.props.set(p.name.text, cleanType(type));
            if (p.type) cls.propDecl.set(p.name.text, cleanType(p.type.getText(sf)));
          }
        } else if (ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name)) {
          if (m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
            cls.methods.set(m.name.text, m.initializer.body);
            methodParams.set(`${key}.${m.name.text}`, m.initializer.parameters);
            declarations.add(`${key}.${m.name.text}`);
            continue;
          }
          const alias = m.initializer ? modelOf(m.initializer, new Map(), true) : null;
          if (alias) cls.aliases.set(`this.${m.name.text}`, alias);
          const type = injected(sf, m) ?? (m.type ? m.type.getText(sf) : m.initializer && ts.isNewExpression(m.initializer) ? m.initializer.expression.getText(sf) : undefined);
          if (type) cls.props.set(m.name.text, cleanType(type));
          if (m.type) cls.propDecl.set(m.name.text, cleanType(m.type.getText(sf)));
        } else if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m)) && m.body && m.name) {
          const name = m.name.getText(sf);
          cls.methods.set(name, m.body);
          methodParams.set(`${key}.${name}`, m.parameters);
          if (m.type) methodReturns.set(`${key}.${name}`, cleanType(m.type.getText(sf)));
          declarations.add(`${key}.${name}`);
          if (ts.isGetAccessorDeclaration(m)) {
            const ret = m.body.statements.find(ts.isReturnStatement);
            const alias = ret?.expression ? modelOf(ret.expression, new Map(), true) : null;
            if (alias) cls.aliases.set(`this.${name}`, alias);
          }
          if (name === 'execute' && ts.isMethodDeclaration(m) && m.parameters[0]?.type?.getText(sf) === 'ConnectorCommand') keyEntries.push(`${node.name.text}.execute`);
          for (const event of eventsOf(sf, m)) listeners.set(event, [...(listeners.get(event) ?? []), `${key}.${name}`]);
        }
      }
      classes.set(key, cls);
    }
  }

  const supers = (name: string): string[] => {
    const out: string[] = [];
    let c = classes.get(name);
    while (c?.extendsName && !out.includes(c.extendsName)) {
      out.push(c.extendsName);
      c = classes.get(c.extendsName);
    }
    return out;
  };
  const resolveMethod = (cls: string, method: string) => [cls, ...supers(cls)].map((k) => `${k}.${method}`).find((id) => methodBody(id)) ?? null;
  const methodBody = (id: string): ts.Node | undefined => {
    const dot = id.lastIndexOf('.');
    return classes.get(id.slice(0, dot))?.methods.get(id.slice(dot + 1));
  };
  const propType = (cls: string, prop: string) => [cls, ...supers(cls)].map((k) => classes.get(k)?.props.get(prop)).find(Boolean);
  const propDeclType = (cls: string, prop: string) => [cls, ...supers(cls)].map((k) => classes.get(k)?.propDecl.get(prop)).find(Boolean);
  const classAliases = (cls: string) => new Map([cls, ...supers(cls)].reverse().flatMap((k) => [...(classes.get(k)?.aliases ?? [])]));

  // A method only one class defines; a method of an interface several classes implement (connector dispatch).
  const owners = new Map<string, string[]>();
  for (const [name, c] of classes) for (const m of c.methods.keys()) owners.set(m, [...(owners.get(m) ?? []), name]);
  const COMMON = new Set([
    'get', 'set', 'has', 'create', 'update', 'delete', 'find', 'list', 'map', 'filter', 'push', 'then', 'catch', 'emit', 'log', 'warn', 'error', 'send', 'toString', 'add', 'remove', 'run', 'execute', 'handle', 'process',
    // Prisma delegate operations: a call on a chained receiver named so is a query, never a source method
    'findUnique', 'findFirst', 'findMany', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', 'upsert', 'createMany', 'updateMany', 'deleteMany',
  ]);
  const implementers = new Map<string, string[]>();
  for (const name of classes.keys()) {
    for (const k of [name, ...supers(name)]) {
      for (const i of classes.get(k)?.implementsNames ?? []) {
        if (interfaces.has(i) && !(implementers.get(i) ?? []).includes(name)) implementers.set(i, [...(implementers.get(i) ?? []), name]);
      }
    }
  }
  const dispatch = new Map<string, string[]>();
  for (const [iface, impls] of implementers) {
    if (impls.length < 2) continue;
    for (const m of interfaces.get(iface) ?? []) {
      if (COMMON.has(m)) continue;
      for (const c of impls) {
        const target = resolveMethod(c, m);
        if (target && !(dispatch.get(m) ?? []).includes(target)) dispatch.set(m, [...(dispatch.get(m) ?? []), target]);
      }
    }
  }
  /**
   * A method by name: the implementations of an interface method; a method only one class defines; or
   * (round 2, WHP-1) a distinctive name a few classes define, each of them, for a call on a value whose
   * class the reader cannot see (`resolved.connector.pushInvoice(...)`, a QuickBooks or a Xero connector).
   */
  const MAX_NAMESAKES = 4;
  const byName = (m: string): string[] => {
    if (dispatch.has(m)) return dispatch.get(m)!;
    const o = owners.get(m) ?? [];
    return !COMMON.has(m) && o.length >= 1 && o.length <= MAX_NAMESAKES ? o.map((c) => `${c}.${m}`) : [];
  };

  /**
   * Round 3 (CM-2 g01, g02, g03): the methods `method` runs on a value of `type`: a class; the provider
   * classes an injection token is bound to; the implementers of an interface (one is enough). null when
   * the type names none of these.
   */
  const methodsOfType = (type: string | undefined, method: string): string[] | null => {
    if (!type) return null;
    if (classes.has(type)) return [resolveMethod(type, method)].filter((x): x is string => !!x);
    const bound = providers.get(type);
    if (bound?.length) return bound.flatMap((c) => (classes.has(c) ? [resolveMethod(c, method)] : [])).filter((x): x is string => !!x);
    const impls = implementers.get(type);
    if (impls?.length) return impls.map((c) => resolveMethod(c, method)).filter((x): x is string => !!x);
    return null;
  };

  /** Round 3 (CM-2 g02, g03): the class a receiver expression holds, where it can be read. */
  type Locals = ReadonlyMap<string, string>;
  const typeOfExpr = (expr: ts.Expression, cls: string | null, locals: Locals): string | undefined => {
    const e = strip(expr);
    if (ts.isAsExpression(expr) && ts.isTypeReferenceNode(expr.type)) return expr.type.getText();
    if (ts.isPropertyAccessExpression(e) && e.expression.kind === ts.SyntaxKind.ThisKeyword && cls) return propType(cls, e.name.text);
    if (ts.isIdentifier(e)) return locals.get(e.text);
    if (ts.isNewExpression(e)) return e.expression.getText();
    if (ts.isCallExpression(e)) {
      const callee = e.expression;
      // moduleRef.get(X) / .resolve(X) / .create(X): an instance of X
      const first = e.arguments[0] ? strip(e.arguments[0]) : undefined;
      if (ts.isPropertyAccessExpression(callee) && /^(get|resolve|create)$/.test(callee.name.text) && first && ts.isIdentifier(first) && classes.has(first.text)) return first.text;
      if (ts.isIdentifier(callee)) return functionReturns.get(callee.text);
      // a method whose declared return type is a class (`gmailBinding(): Promise<GmailService>`)
      const to = targets(e, cls, locals, true);
      const returns = [...new Set(to.map((t) => methodReturns.get(t)).filter((t): t is string => !!t && classes.has(t)))];
      if (returns.length === 1) return returns[0];
    }
    return undefined;
  };
  /** The typed locals of a body: parameters with a class type, and `const x = <a receiver whose class is known>`. */
  const localTypes = (body: ts.Node, cls: string | null, params: readonly ts.ParameterDeclaration[] = []): Map<string, string> => {
    const out = new Map<string, string>();
    for (const p of params) if (ts.isIdentifier(p.name) && p.type) out.set(p.name.text, cleanType(p.type.getText()));
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
        const t = n.type ? cleanType(n.type.getText()) : n.initializer ? typeOfExpr(n.initializer, cls, out) : undefined;
        if (t) out.set(n.name.text, t);
      }
      n.forEachChild(visit);
    };
    visit(body);
    return out;
  };

  /**
   * The methods a call may run (precise: only through `this`, a typed property or local, or a top-level
   * function, never by name alone). Round 2 (CW-5 M5): a call on any other receiver goes by name too.
   * Round 3: a receiver whose class is known resolves through it, whatever the method's name (a COMMON
   * name such as create, update or delete included); an injection token resolves to its provider or to
   * its interface's implementers; one that resolves to neither goes by name (not precise).
   */
  const targets = (call: ts.CallExpression, cls: string | null, locals: Locals, precise = false): string[] => {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return functions.has(callee.text) ? [`fn:${callee.text}`] : [];
    if (!ts.isPropertyAccessExpression(callee)) return [];
    const method = callee.name.text;
    const recv = callee.expression;
    if (recv.kind === ts.SyntaxKind.ThisKeyword) return cls ? [resolveMethod(cls, method)].filter((x): x is string => !!x) : [];
    const recvProp = strip(recv);
    if (ts.isPropertyAccessExpression(recvProp) && recvProp.expression.kind === ts.SyntaxKind.ThisKeyword && cls) {
      const found = methodsOfType(propType(cls, recvProp.name.text), method) ?? methodsOfType(propDeclType(cls, recvProp.name.text), method);
      if (found) return found;
      return precise ? [] : byName(method);
    }
    const found = methodsOfType(typeOfExpr(recv, cls, locals), method);
    if (found) return found;
    return precise ? [] : byName(method);
  };

  /** Round 2 (CW-5 M8): an event a call emits goes to every listener of it (`@OnEvent('a.b')`, or a pattern `a.*`). Round 3 (CM-2 g04): the name may be a constant. */
  const emitted = (call: ts.CallExpression, scope: ts.Node): string[] => {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee) || !/^emit(Async)?$/.test(callee.name.text)) return [];
    const names = stringValues(call.arguments[0], call.getSourceFile(), scope);
    const out: string[] = [];
    for (const name of names) {
      for (const [event, ids] of listeners) {
        const pattern = new RegExp(`^${event.split('.').map((s) => (s === '*' ? '[^.]+' : s === '**' ? '.+' : s.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&'))).join('\\.')}$`);
        if (event === name || pattern.test(name)) out.push(...ids);
      }
    }
    return [...new Set(out)];
  };

  /** Round 3 (CM-1): the declarations a call resolves to (`Class.method`, `fn:<name>@<file>`), for a check. */
  const declsOf = (call: ts.CallExpression, cls: string | null, locals: Locals): string[] => {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) {
      const sf = call.getSourceFile();
      if (fileConsts.get(sf)?.has(callee.text) || sf.statements.some((s) => ts.isFunctionDeclaration(s) && s.name?.text === callee.text)) return [`fn:${callee.text}@${relFile(sf)}`];
      const imp = imports.get(sf)?.get(callee.text);
      return imp ? [`fn:${imp.name}@${imp.file}`] : [];
    }
    return targets(call, cls, locals, true);
  };

  interface Site {
    cls: string | null;
    body: ts.Node;
    locals: Locals;
    /** The parameter bound to the route's :businessId, if the method has one. */
    routeBusiness?: string;
  }
  /** Round 3 (CM-1): the business a check names is the business the guarded call acts on. */
  const sameBusiness = (arg: ts.Expression | undefined, guarded: ts.Node | undefined, site: Site): boolean => {
    if (!arg) return false;
    const a = textOf(strip(arg)).replace(/\s+/g, '');
    // `command.businessId` checked, `command` handed on whole
    const holder = /^([A-Za-z_$][\w$]*)\.businessId$/.exec(a)?.[1];
    if (site.routeBusiness && (a === site.routeBusiness || holder === site.routeBusiness)) return true;
    if (!guarded) return false;
    const target = ts.isCallExpression(guarded) || ts.isTaggedTemplateExpression(guarded) ? guarded : undefined;
    const text = target ? (ts.isCallExpression(target) ? target.arguments.map(textOf).join(', ') : textOf(target.template)) : textOf(guarded);
    const esc = (s: string) => s.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&');
    const names = (t: string) => {
      const flat = t.replace(/\s+/g, '');
      return new RegExp(`(^|[^\\w$.])${esc(a)}(?![\\w$]|:)`).test(flat) || (!!holder && new RegExp(`(^|[^\\w$.])${esc(holder)}(?![\\w$]|:)`).test(flat));
    };
    if (names(text)) return true;
    // one local between them: `const state = { businessId, ... }; this.signState(state)`
    for (const id of new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
      let init: ts.Expression | undefined;
      const visit = (n: ts.Node) => {
        if (!init && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === id && n.initializer) init = n.initializer;
        if (!init) n.forEachChild(visit);
      };
      visit(site.body);
      if (init && names(textOf(init))) return true;
    }
    return false;
  };

  /** Methods and helpers that always run a pinned check before they return (a wrapper such as assertProfileOwner), with the parameter that names the business it checks (null: none). */
  const wrappers = new Map<string, number | null>();
  /** A call that is a pinned check (resolved to its declaration, carrying its arguments, for the guarded call's business), or a wrapper of one. */
  const isCheck = (call: ts.CallExpression, site: Site, guarded: ts.Node | undefined, gateOk: boolean): boolean => {
    const callee = call.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
    const rule = Object.hasOwn(rules.checks, name) ? rules.checks[name] : undefined;
    if (rule) {
      if (rule.gate && !gateOk) return false;
      const decls = declsOf(call, site.cls, site.locals);
      if (!decls.length || !decls.every((d) => rule.decl.includes(d))) return false;
      if (rule.args && !rule.args.test(call.arguments.map(textOf).join(', '))) return false;
      return rule.biz === undefined || sameBusiness(call.arguments[rule.biz], guarded, site);
    }
    const to = targets(call, site.cls, site.locals, true);
    if (!to.length || !to.every((t) => wrappers.has(t))) return false;
    return to.every((t) => {
      const biz = wrappers.get(t);
      return biz === null || biz === undefined || sameBusiness(call.arguments[biz], guarded, site);
    });
  };
  const callsIn = (n: ts.Node, out: ts.CallExpression[] = [], nested = true): ts.CallExpression[] => {
    n.forEachChild((c) => {
      if (!nested && (ts.isArrowFunction(c) || ts.isFunctionExpression(c) || ts.isFunctionDeclaration(c))) return;
      if (ts.isCallExpression(c)) out.push(c);
      callsIn(c, out, nested);
    });
    return out;
  };
  const rawSqlIn = (n: ts.Node, out: ts.TaggedTemplateExpression[] = []): ts.TaggedTemplateExpression[] => {
    n.forEachChild((c) => {
      if (ts.isTaggedTemplateExpression(c)) out.push(c);
      rawSqlIn(c, out);
    });
    return out;
  };
  const containsReturn = (n: ts.Node): boolean =>
    ts.isReturnStatement(n) || (!ts.isFunctionLike(n) && (n.forEachChild((c) => (containsReturn(c) ? true : undefined)) ?? false));
  /** A branch that ends in return or throw. */
  const exits = (st: ts.Statement): boolean =>
    ts.isReturnStatement(st) || ts.isThrowStatement(st) || (ts.isBlock(st) && st.statements.length > 0 && exits(st.statements[st.statements.length - 1]));
  /** Round 3 (CM-1): a condition that is true when `name` (or a call) is falsy: `!x`, `!x?.y`, `x == null`, `x === undefined`, as one operand of `||`. */
  const falsyOperands = (cond: ts.Expression): ts.Expression[] => {
    const e = strip(cond);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) return [...falsyOperands(e.left), ...falsyOperands(e.right)];
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
      let x = strip(e.operand);
      while (ts.isPropertyAccessExpression(x)) x = strip(x.expression);
      return [x];
    }
    if (ts.isBinaryExpression(e) && /^(==|===)$/.test(e.operatorToken.getText()) && /^(null|undefined)$/.test(e.right.getText())) return [strip(e.left)];
    return [];
  };
  /** A gate: `if (<falsy test of a gate check's result>) throw | return`, the result held in a local an earlier statement of `block` assigned. */
  const gateChecks = (st: ts.Statement, earlier: readonly ts.Statement[], site: Site, guarded: ts.Node | undefined): boolean => {
    if (!ts.isIfStatement(st) || !exits(st.thenStatement)) return false;
    for (const operand of falsyOperands(st.expression)) {
      if (ts.isCallExpression(operand) && isCheck(operand, site, guarded, true)) return true;
      if (!ts.isIdentifier(operand)) continue;
      for (const prev of earlier) {
        if (!ts.isVariableStatement(prev)) continue;
        for (const d of prev.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || d.name.text !== operand.text || !d.initializer) continue;
          if (callsIn(d.initializer, [], false).concat(ts.isCallExpression(strip(d.initializer)) ? [strip(d.initializer) as ts.CallExpression] : []).some((c) => isCheck(c, site, guarded, true))) return true;
        }
      }
    }
    return false;
  };
  /** A branch that runs a check before it can return. */
  const branchChecks = (st: ts.Statement, site: Site, guarded: ts.Node | undefined): boolean => {
    if (!ts.isBlock(st)) return statementChecks(st, [], site, guarded);
    for (let i = 0; i < st.statements.length; i++) {
      const inner = st.statements[i];
      if (statementChecks(inner, st.statements.slice(0, i), site, guarded)) return true;
      if (containsReturn(inner)) return false;
    }
    return false;
  };
  const statementChecks = (st: ts.Statement, earlier: readonly ts.Statement[], site: Site, guarded: ts.Node | undefined): boolean => {
    if (gateChecks(st, earlier, site, guarded)) return true;
    // an `if` counts when its condition runs a (throwing) check, or when each of its branches does (`if (gmail) ownerRuleA else ownerRuleB`)
    if (ts.isIfStatement(st)) {
      return callsIn(st.expression, [], false).some((c) => isCheck(c, site, guarded, false)) || (!!st.elseStatement && branchChecks(st.thenStatement, site, guarded) && branchChecks(st.elseStatement, site, guarded));
    }
    if (ts.isExpressionStatement(st) || ts.isVariableStatement(st) || ts.isReturnStatement(st)) return callsIn(st, [], false).some((c) => isCheck(c, site, guarded, false));
    return false;
  };
  /** A pinned check (or a wrapper of one) is called in an earlier statement of a block enclosing the call, within the method. */
  const dominated = (call: ts.Node, site: Site): boolean => {
    let node: ts.Node = call;
    while (node !== site.body && node.parent) {
      const parent = node.parent;
      if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
        const i = parent.statements.indexOf(node as ts.Statement);
        const before = parent.statements.slice(0, Math.max(i, 0));
        if (before.some((st, j) => statementChecks(st, before.slice(0, j), site, call))) return true;
      }
      if (ts.isIfStatement(parent) && node !== parent.expression && callsIn(parent.expression, [], false).some((c) => isCheck(c, site, call, false))) return true;
      node = parent;
    }
    return false;
  };
  const routeBusinessOf = (params: readonly ts.ParameterDeclaration[] = []): string | undefined =>
    params.find((p) => decorators(p).some((d) => /^Param\(\s*['"]businessId['"]\s*\)$/.test(textOf(d.expression))) && ts.isIdentifier(p.name))?.name.getText();
  const siteOf = (id: string, body: ts.Node, cls: string | null, params?: readonly ts.ParameterDeclaration[]): Site => ({
    cls,
    body,
    locals: localTypes(body, cls, params),
    routeBusiness: routeBusinessOf(params),
  });
  /** The body runs a check in a top-level statement and returns nowhere before it; the answer is the parameter that names the business checked (null: none), or undefined (no wrapper). */
  const alwaysChecks = (site: Site, params: readonly ts.ParameterDeclaration[] = []): number | null | undefined => {
    const body = site.body;
    if (!ts.isBlock(body)) return undefined;
    const names = params.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''));
    for (let i = 0; i < body.statements.length; i++) {
      const st = body.statements[i];
      // a wrapper's check names the business through one of its parameters (or names none)
      for (let k = -1; k < names.length; k++) {
        const probe: Site = { ...site, routeBusiness: k >= 0 ? names[k] : undefined };
        if (statementChecks(st, body.statements.slice(0, i), probe, undefined)) return k >= 0 ? k : null;
      }
      if (containsReturn(st)) return undefined;
    }
    return undefined;
  };
  const sites = new Map<string, { site: Site; params: readonly ts.ParameterDeclaration[] }>();
  for (const [name, c] of classes) for (const [m, body] of c.methods) {
    const params = methodParams.get(`${name}.${m}`) ?? [];
    sites.set(`${name}.${m}`, { site: siteOf(`${name}.${m}`, body, name, params), params });
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, { site, params }] of sites) {
      if (wrappers.has(id)) continue;
      const biz = alwaysChecks(site, params);
      if (biz !== undefined) { wrappers.set(id, biz); changed = true; }
    }
    for (const [name, list] of functions) {
      if (wrappers.has(`fn:${name}`)) continue;
      const each = list.map((f) => alwaysChecks(siteOf(`fn:${name}`, f.body, null, f.params), f.params));
      if (each.every((b) => b !== undefined && b === each[0])) { wrappers.set(`fn:${name}`, each[0]!); changed = true; }
    }
  }

  interface GraphNode {
    leaves: Array<{ write: string; guarded: boolean }>;
    edges: Array<{ to: string; guarded: boolean }>;
  }
  const nodes = new Map<string, GraphNode>();
  const doorWrites = new Map<string, string[]>();
  const ownLeaves = new Map<string, string[]>();
  const add = (id: string, body: ts.Node, cls: string | null, params?: readonly ts.ParameterDeclaration[]) => {
    const sf = body.getSourceFile();
    let mention = textOf(body);
    const fileConstants = fileConsts.get(sf) ?? new Map<string, ts.Expression>();
    for (const ident of new Set(textOf(body).match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [])) {
      const value = fileConstants.get(ident);
      if (value) mention += '\n' + textOf(value);
    }
    if (cls) {
      for (const c of callsIn(body)) {
        const callee = c.expression;
        if (ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const helper = methodBody(resolveMethod(cls, callee.name.text) ?? '');
          if (helper && helper !== body) mention += '\n' + textOf(helper);
        }
      }
    }
    const site = siteOf(id, body, cls, params);
    const ctx: LeafContext = {
      own: textOf(body),
      mention,
      aliases: aliasesIn(body, cls ? classAliases(cls) : new Map()),
      constText: (e) => {
        const values = stringValues(e, sf, body);
        return values.length ? values.join('\n') : textOf(e);
      },
    };
    const node: GraphNode = { leaves: [], edges: [] };
    const whole = rules.leafOfMethod(id, textOf(body), mention);
    if (whole) node.leaves.push({ write: whole, guarded: false });
    for (const sql of rawSqlIn(body)) {
      const leaf = rules.leafOfCall(sql, ctx);
      if (leaf) node.leaves.push({ write: leaf, guarded: dominated(sql, site) });
    }
    for (const call of callsIn(body)) {
      const leaf = rules.leafOfCall(call, ctx);
      if (leaf) node.leaves.push({ write: leaf, guarded: dominated(call, site) });
      for (const to of [...targets(call, cls, site.locals), ...emitted(call, body)]) if (to !== id) node.edges.push({ to, guarded: dominated(call, site) });
    }
    ownLeaves.set(id, node.leaves.map((l) => l.write));
    if (Object.hasOwn(rules.doors, id)) {
      doorWrites.set(id, node.leaves.map((l) => l.write));
      node.leaves = [];
    }
    nodes.set(id, node);
  };
  for (const [name, c] of classes) for (const [m, body] of c.methods) add(`${name}.${m}`, body, name, methodParams.get(`${name}.${m}`));
  for (const [name, list] of functions) for (const f of list) add(`fn:${name}`, f.body, null, f.params);

  // Least fixed points: a method reaches a leaf (any path), and reaches one by a path with no check.
  const solve = (guardedCounts: boolean) => {
    const out = new Map<string, string[]>();
    for (const [id, n] of nodes) {
      const leaf = n.leaves.find((l) => !(guardedCounts && l.guarded));
      if (leaf) out.set(id, [`${id} [${leaf.write}]`]);
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (const [id, n] of nodes) {
        if (out.has(id)) continue;
        const e = n.edges.find((edge) => !(guardedCounts && edge.guarded) && out.has(edge.to));
        if (e) {
          out.set(id, [id, ...out.get(e.to)!]);
          changed = true;
        }
      }
    }
    return out;
  };
  return { classes, keyEntries, unguarded: solve(true), reaches: solve(false), doorWrites, declarations, wrappers: new Set(wrappers.keys()), leaves: ownLeaves };
}

const buildCredentialGraph = (files?: Parsed[]) => buildGraph(CREDENTIAL_RULES, files);
let graphCache: CredentialGraph | null = null;
const credentialGraph = () => (graphCache ??= buildCredentialGraph());
let exportGraphCache: CredentialGraph | null = null;
const exportGraph = () => (exportGraphCache ??= buildGraph(EXPORT_RULES));
/**
 * Round 2 (CW-5): the shapes the round 2 hunt added to a scratch controller, one membership-only
 * handler each, all of which passed CEN-* at e740575c. CEN-10d parses them beside the real source
 * and requires the reader to report each one, and not the settings-admin twins.
 */
const HUNT_EXPECTED_UNGUARDED = [
  'Cen10dHuntController.m1SetCredentials', // M1 this.credentials.setCredentials (direct)
  'Cen10dHuntController.m5ChainedReceiver', // M5 this.registry.get(type)!.disconnect(b)
  'Cen10dHuntController.m6AliasedDelegate', // M6 const repo = this.prisma.client.socialConnection; repo.deleteMany()
  'Cen10dHuntController.m6bDestructuredDelegate', // M6 const { socialConnection } = this.prisma.client
  'Cen10dHuntController.m6cClassAlias', // M6 a class property holding the delegate
  'Cen10dHuntController.m7RawUnsafe', // M7 $executeRawUnsafe('UPDATE social_connections SET token = $1')
  'Cen10dHuntController.m7bRawJsonbSet', // M7b $executeRaw`UPDATE businesses SET meta_data = jsonb_set(..., '{stripeSecretKey}', ...)`
  'Cen10dHuntController.m7cRawDelete', // raw DELETE FROM a credential table
  'Cen10dHuntController.m8EventHop', // M8 this.events.emit('cen10d.bind') -> an @OnEvent listener calling setCredentials
  'Cen10dHuntController.m10DestinationToken', // M10 channelDestination.update({ destinationMeta: { accessToken } })
  'Cen10dHuntController.m11ByokKey', // M11 aiMemory.upsert settings / ai_preferences { byokOpenai }
  'Cen10dHuntController.m12AccountIds', // M12 business.update({ bpAccountId, bpLocationId })
  'Cen10dHuntController.m13MetadataWipe', // M13 connectorStatus.update({ status: 'disconnected', metadata: {} })
  'Cen10dHuntController.m14MetaKeyDelete', // M14 delete meta.gsc; business.update({ metaData: meta })
  // Round 3 (CM-1, CM-2, CM-3): the shapes the round 3 hunt passed through the reader (all 18 CEN cases green with them in the tree).
  'Cen10dHuntController.r3g01InterfaceToken', // CM-2 g01 @Inject(TOKEN) store: <interface>; store.setCredentials
  'Cen10dHuntController.r3g01bProviderToken', // CM-2 g01 @Inject(TOKEN) bound by { provide: TOKEN, useClass: X } to a writer
  'Cen10dHuntController.r3g02CommonNameViaLocal', // CM-2 g02 const conns = this.channelConnections; conns.delete(...)
  'Cen10dHuntController.r3g03CommonNameViaModuleRef', // CM-2 g03 this.moduleRef.get(ChannelConnectionService).update(...)
  'Cen10dHuntController.r3g04EventConstant', // CM-2 g04 emit(CONST) -> @OnEvent(CONST) -> setCredentials
  'Cen10dHuntController.r3g05UpdateManyAndReturn', // CM-2 g05 socialConnection.updateManyAndReturn({ data: { token } })
  'Cen10dHuntController.r3g06NestedRelationWrite', // CM-2 g06 business.update({ data: { socialConns: { deleteMany: {} } } }) (the Business relation to SocialConnection)
  'Cen10dHuntController.r3g07RawSqlConstant', // CM-2 g07 $executeRawUnsafe(SQL_CONST, ...)
  'Cen10dHuntController.r3g08RawUpsertOnConflict', // CM-2 g08 INSERT ... ON CONFLICT DO UPDATE SET metadata = jsonb_set(..., '{encryptedCredentials}', ...)
  'Cen10dHuntController.r3g09MetaAccountId', // CM-3 g09 metaData { wipayAccountNumber, paypalClientId }
  'Cen10dHuntController.r3g10NoopCheckByName', // CM-1 a file-local no-op named assertConfigOwner
  'Cen10dHuntController.r3g11VerifyStateIgnored', // CM-1 verifyState(state) whose null result gates nothing
  'Cen10dHuntController.r3g12CheckOtherBusiness', // CM-1 settings admin checked on another business than the one written
  'Cen10dHuntController.r3g13ConnectedLift', // CM-3 g13 connectorStatus.update({ status: 'connected' })
  'Cen10dHuntController.r3g14ChannelHealthState', // CM-3 g14 channelConnection.updateMany({ healthState: 'Disabled' })
];
const HUNT_EXPECTED_GUARDED = [
  'Cen10dHuntController.g1SettingsAdminCheck', // the M1 write after assertMemberModuleLevel(settings, admin)
  'Cen10dHuntController.g2SettingsAdminRoute', // the M5 write under an enforced settings admin scope
  'Cen10dHuntController.r3t11VerifyStateGated', // the g11 write after `if (!state) throw` on the pinned verifyState's result
  'Cen10dHuntController.r3t12CheckSameBusiness', // the g12 write after settings admin on the route's own :businessId
];
function HUNT_SHAPES(): Parsed {
  const text = `
import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { assertMemberModuleLevel } from '../../core/auth/member-module-level';

export const CEN10D_CRED_STORE = 'CEN10D_CRED_STORE';
export const CEN10D_BOUND_STORE = 'CEN10D_BOUND_STORE';
export const CEN10D_BIND_EVENT = 'cen10d.r3.bind';
const CEN10D_SET_TOKEN_SQL = 'UPDATE social_connections SET token = $1 WHERE business_id = $2';

export interface Cen10dCredentialStore {
  setCredentials(businessId: string, type: string, values: Record<string, string>): Promise<void>;
}

/** a no-op that carries a pinned check's name (round 3, CM-1) */
function assertConfigOwner(_businessId: string, _actor: unknown): void {
  return;
}

export class Cen10dBoundStore {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async set(businessId: string, token: string) {
    await this.prisma.client.socialConnection.updateMany({ where: { businessId }, data: { token } });
  }
}

export const CEN10D_PROVIDERS = [{ provide: CEN10D_BOUND_STORE, useClass: Cen10dBoundStore }];

@Controller('cen10d-hunt')
@UseGuards(AuthGuard, BusinessGuard)
export class Cen10dHuntController {
  private readonly socialRepo = this.prisma.client.socialConnection;
  constructor(
    @Inject(ConnectorCredentialsService) private readonly credentials: ConnectorCredentialsService,
    @Inject(ConnectorRegistryService) private readonly registry: ConnectorRegistryService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CEN10D_CRED_STORE) private readonly store: Cen10dCredentialStore,
    @Inject(CEN10D_BOUND_STORE) private readonly bound: unknown,
    @Inject(ChannelConnectionService) private readonly channelConnections: ChannelConnectionService,
    @Inject(CalendarService) private readonly calendar: CalendarService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  @Get('businesses/:businessId/r3g01')
  async r3g01InterfaceToken(@Param('businessId') businessId: string, @Query('t') t: string) {
    await this.store.setCredentials(businessId, 'shopify', { shopDomain: 'x', accessToken: t });
  }

  @Get('businesses/:businessId/r3g01b')
  async r3g01bProviderToken(@Param('businessId') businessId: string, @Query('t') t: string) {
    await (this.bound as any).set(businessId, t);
  }

  @Get('businesses/:businessId/r3g02')
  async r3g02CommonNameViaLocal(@Param('businessId') businessId: string, @Query('id') id: string) {
    const conns = this.channelConnections;
    await conns.delete(businessId, id);
  }

  @Get('businesses/:businessId/r3g03')
  async r3g03CommonNameViaModuleRef(@Param('businessId') businessId: string, @Query('id') id: string, @Query('t') t: string) {
    await this.moduleRef.get(ChannelConnectionService, { strict: false }).update(businessId, id, { token: t });
  }

  @Get('businesses/:businessId/r3g04')
  r3g04EventConstant(@Param('businessId') businessId: string, @Query('t') t: string) {
    this.events.emit(CEN10D_BIND_EVENT, { businessId, t });
  }

  @Get('businesses/:businessId/r3g05')
  async r3g05UpdateManyAndReturn(@Param('businessId') businessId: string, @Query('t') t: string) {
    await this.prisma.client.socialConnection.updateManyAndReturn({ where: { businessId }, data: { token: t } });
  }

  @Get('businesses/:businessId/r3g06')
  async r3g06NestedRelationWrite(@Param('businessId') businessId: string) {
    await this.prisma.client.business.update({ where: { id: businessId }, data: { socialConns: { deleteMany: {} } } });
  }

  @Get('businesses/:businessId/r3g07')
  async r3g07RawSqlConstant(@Param('businessId') businessId: string, @Query('t') t: string) {
    await this.prisma.client.$executeRawUnsafe(CEN10D_SET_TOKEN_SQL, t, businessId);
  }

  @Get('businesses/:businessId/r3g08')
  async r3g08RawUpsertOnConflict(@Param('businessId') businessId: string, @Query('t') t: string) {
    await this.prisma.client.$executeRaw\`INSERT INTO connector_statuses (id, business_id, connector_type, status, updated_at) VALUES (gen_random_uuid()::text, \${businessId}, 'shopify', 'connected', now()) ON CONFLICT (business_id, connector_type) DO UPDATE SET metadata = jsonb_set(coalesce(connector_statuses.metadata, '{}'::jsonb), '{encryptedCredentials}', to_jsonb(\${t}::text))\`;
  }

  @Get('businesses/:businessId/r3g09')
  async r3g09MetaAccountId(@Param('businessId') businessId: string, @Query('acct') acct: string) {
    const row = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { metaData: true } });
    const meta = (row?.metaData as Record<string, unknown>) ?? {};
    await this.prisma.client.business.update({ where: { id: businessId }, data: { metaData: { ...meta, wipayAccountNumber: acct, paypalClientId: acct } } });
  }

  @Get('businesses/:businessId/r3g10')
  async r3g10NoopCheckByName(@Param('businessId') businessId: string, @Query('t') t: string, @Req() req: any) {
    assertConfigOwner(businessId, req.user);
    await this.credentials.setCredentials(businessId, 'shopify', { shopDomain: 'x', accessToken: t });
  }

  @Get('businesses/:businessId/r3g11')
  async r3g11VerifyStateIgnored(@Param('businessId') businessId: string, @Query('state') state: string, @Query('t') t: string) {
    this.calendar.verifyState(state);
    await this.credentials.setCredentials(businessId, 'shopify', { shopDomain: 'x', accessToken: t });
  }

  @Get('businesses/:businessId/r3t11')
  async r3t11VerifyStateGated(@Query('state') state: string, @Query('t') t: string) {
    const parsed = this.calendar.verifyState(state);
    if (!parsed) throw new Error('invalid state');
    await this.credentials.setCredentials(parsed.businessId, 'shopify', { shopDomain: 'x', accessToken: t });
  }

  @Get('businesses/:businessId/r3g12')
  async r3g12CheckOtherBusiness(@Param('businessId') businessId: string, @Query('other') other: string, @Query('t') t: string, @Req() req: any) {
    await assertMemberModuleLevel(this.prisma, other, req.user, 'settings', 'admin');
    await this.credentials.setCredentials(businessId, 'shopify', { shopDomain: 'x', accessToken: t });
  }

  @Get('businesses/:businessId/r3t12')
  async r3t12CheckSameBusiness(@Param('businessId') businessId: string, @Query('t') t: string, @Req() req: any) {
    await assertMemberModuleLevel(this.prisma, businessId, req.user, 'settings', 'admin');
    await this.credentials.setCredentials(businessId, 'shopify', { shopDomain: 'x', accessToken: t });
  }

  @Get('businesses/:businessId/r3g13')
  async r3g13ConnectedLift(@Param('businessId') businessId: string) {
    await this.prisma.client.connectorStatus.update({
      where: { businessId_connectorType: { businessId, connectorType: 'stripe' } },
      data: { status: 'connected', connectedAt: new Date() },
    });
  }

  @Get('businesses/:businessId/r3g14')
  async r3g14ChannelHealthState(@Param('businessId') businessId: string, @Query('id') id: string) {
    await this.prisma.client.channelConnection.updateMany({ where: { id, businessId }, data: { healthState: 'Disabled' } });
  }

  @Post('businesses/:businessId/m1')
  async m1SetCredentials(@Param('businessId') businessId: string, @Body() body: any) {
    await this.credentials.setCredentials(businessId, 'shopify', body.values);
  }

  @Post('businesses/:businessId/m5')
  async m5ChainedReceiver(@Param('businessId') businessId: string, @Body() body: any) {
    await this.registry.get(body.type)!.disconnect(businessId);
  }

  @Post('businesses/:businessId/m6')
  async m6AliasedDelegate(@Param('businessId') businessId: string) {
    const repo = this.prisma.client.socialConnection;
    await repo.deleteMany({ where: { businessId } });
  }

  @Post('businesses/:businessId/m6b')
  async m6bDestructuredDelegate(@Param('businessId') businessId: string) {
    const { socialConnection } = this.prisma.client;
    await socialConnection.deleteMany({ where: { businessId } });
  }

  @Post('businesses/:businessId/m6c')
  async m6cClassAlias(@Param('businessId') businessId: string) {
    await this.socialRepo.deleteMany({ where: { businessId } });
  }

  @Post('businesses/:businessId/m7')
  async m7RawUnsafe(@Param('businessId') businessId: string, @Body() body: any) {
    await this.prisma.client.$executeRawUnsafe('UPDATE social_connections SET token = $1 WHERE business_id = $2', body.token, businessId);
  }

  @Post('businesses/:businessId/m7b')
  async m7bRawJsonbSet(@Param('businessId') businessId: string, @Body() body: any) {
    await this.prisma.client.$executeRaw\`UPDATE businesses SET meta_data = jsonb_set(coalesce(meta_data, '{}'::jsonb), '{stripeSecretKey}', to_jsonb(\${body.key}::text)) WHERE id = \${businessId}\`;
  }

  @Post('businesses/:businessId/m7c')
  async m7cRawDelete(@Param('businessId') businessId: string) {
    await this.prisma.client.$executeRaw\`DELETE FROM channel_connections WHERE business_id = \${businessId}\`;
  }

  @Post('businesses/:businessId/m8')
  m8EventHop(@Param('businessId') businessId: string, @Body() body: any) {
    this.events.emit('cen10d.bind', { businessId, values: body.values });
  }

  @Post('businesses/:businessId/m10')
  async m10DestinationToken(@Body() body: any) {
    await this.prisma.client.channelDestination.update({ where: { id: body.id }, data: { destinationMeta: { accessToken: body.token } } });
  }

  @Post('businesses/:businessId/m11')
  async m11ByokKey(@Param('businessId') businessId: string, @Body() body: any) {
    await this.prisma.client.aiMemory.upsert({
      where: { businessId_category_key: { businessId, category: 'settings', key: 'ai_preferences' } },
      create: { businessId, category: 'settings', key: 'ai_preferences', value: { byokOpenai: body.key } },
      update: { value: { byokOpenai: body.key } },
    });
  }

  @Post('businesses/:businessId/m12')
  async m12AccountIds(@Param('businessId') businessId: string, @Body() body: any) {
    await this.prisma.client.business.update({ where: { id: businessId }, data: { bpAccountId: body.accountId, bpLocationId: body.locationId } });
  }

  @Post('businesses/:businessId/m13')
  async m13MetadataWipe(@Param('businessId') businessId: string, @Body() body: any) {
    await this.prisma.client.connectorStatus.update({
      where: { businessId_connectorType: { businessId, connectorType: body.type } },
      data: { status: 'disconnected', metadata: {} },
    });
  }

  @Post('businesses/:businessId/m14')
  async m14MetaKeyDelete(@Param('businessId') businessId: string) {
    const row = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { metaData: true } });
    const meta = { ...((row?.metaData as Record<string, unknown>) ?? {}) };
    delete meta.gsc;
    await this.prisma.client.business.update({ where: { id: businessId }, data: { metaData: meta } });
  }

  @Post('businesses/:businessId/g1')
  async g1SettingsAdminCheck(@Param('businessId') businessId: string, @Body() body: any, @Req() req: any) {
    await assertMemberModuleLevel(this.prisma, businessId, req.user, 'settings', 'admin');
    await this.credentials.setCredentials(businessId, 'shopify', body.values);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  @Post('businesses/:businessId/g2')
  async g2SettingsAdminRoute(@Param('businessId') businessId: string, @Body() body: any) {
    await this.registry.get(body.type)!.disconnect(businessId);
  }
}

export class Cen10dHuntListener {
  constructor(@Inject(ConnectorCredentialsService) private readonly credentials: ConnectorCredentialsService) {}

  @OnEvent(CEN10D_BIND_EVENT)
  async onBindConst(payload: { businessId: string; t: string }) {
    await this.credentials.setCredentials(payload.businessId, 'shopify', { shopDomain: 'x', accessToken: payload.t });
  }

  @OnEvent('cen10d.bind')
  async onBind(payload: { businessId: string; values: Record<string, string> }) {
    await this.credentials.setCredentials(payload.businessId, 'shopify', payload.values);
  }
}
`;
  const file = join(SRC, 'modules/cen10d-hunt/cen10d-hunt.controller.ts');
  return { file, text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) };
}

const settingsAdminEnforced = (r: Route) => enforced(r) && r.scope?.module === 'settings' && r.scope?.minLevel === 'admin';

describe('REST scope census (SWEEP-P0-SCOPES)', () => {
  const all = routes();
  const byKey = new Map(all.map((r) => [r.key, r]));
  // Round 1 class repair (CLASS B): a member route of any verb whose handler reaches a provider credential write (the call graph) joins too.
  const population = all.filter(
    (r) => (WRITE_VERBS.has(r.verb) || (r.verb === 'GET' && isBindingStart(r)) || credentialGraph().reaches.has(r.key)) && isMember(r) && !enforced(r),
  );

  it('the reader sees the controllers (guards the guard)', () => {
    expect(all.length).toBeGreaterThan(2000);
    expect(byKey.get('WebhooksController.create')?.scope).toEqual({ module: 'settings', minLevel: 'write' });
    expect(byKey.get('ApiKeysController.revoke')?.guards).toContain('ModuleScopeGuard');
    // a class-level guard reaches every handler
    expect(byKey.get('ProjectsController.createProject')?.guards).toEqual(['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']);
    // a declaration without the guard is inert: still membership-only
    expect(population.map((r) => r.key)).toContain('PushNotificationController.subscribe');
    // review SEC-1: controllers outside modules/ are read too (core/connectors)
    expect(byKey.get('ConnectorController.saveCredentials')?.file).toBe('core/connectors/connector.controller.ts');
    expect(byKey.get('ConnectorController.getWebhookInfo')?.verb).toBe('GET');
    // second review SV-3: the credential-binding GETs are seen (an auth-URL start, by path and by handler name)
    const bindingGets = all.filter((r) => r.verb === 'GET' && isMember(r) && isBindingStart(r)).map((r) => r.key).sort();
    expect(bindingGets).toEqual(expect.arrayContaining([
      'BookingsController.getCalendarAuthUrl',
      'CommerceController.getGmailAuthUrl',
      'CrmGoogleController.getGoogleAuthUrl',
      'GoogleDriveController.getAuthUrl',
      'MicrosoftOAuthController.buildAuthUrl',
    ]));
    expect(isBindingStart(byKey.get('SocialController.oauthStart')!)).toBe(true);
    expect(isBindingStart(byKey.get('SocialController.oauthAvailability')!)).toBe(false);
    expect(isBindingStart(byKey.get('CommunicationsController.listConnections')!)).toBe(false);
  });

  it('[CEN-01] the census doc parses: unique rows, known dispositions, a reason on every row', () => {
    expect(existsSync(CENSUS), CENSUS).toBe(true);
    const rows = censusRows();
    expect(rows.length).toBeGreaterThan(population.length);
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const r of rows) {
      if (seen.has(r.key)) problems.push(`line ${r.line}: ${r.key} is listed twice`);
      seen.add(r.key);
      if (!DISPOSITIONS.has(r.disposition)) problems.push(`line ${r.line}: ${r.key} has unknown disposition ${r.disposition}`);
      if (!r.reason.trim()) problems.push(`line ${r.line}: ${r.key} gives no reason`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-02] every membership-only write route is in the census (a new one must be gated or listed)', () => {
    const listed = new Set(censusRows().filter((r) => r.disposition !== 'applied' && r.disposition !== 'secret-read').map((r) => r.key));
    const missing = population.filter((r) => !listed.has(r.key)).map((r) => `${r.key} (${r.verb} ${r.path}, ${r.file})`);
    expect(missing).toEqual([]);
  });

  it('[CEN-03] every census row names a real route with its verb and path; a row still to act on is still membership-only', () => {
    const inPopulation = new Set(population.map((r) => r.key));
    const problems: string[] = [];
    for (const row of censusRows()) {
      const r = byKey.get(row.key);
      if (!r) { problems.push(`line ${row.line}: ${row.key} is not a route`); continue; }
      if (r.verb !== row.verb || r.path !== row.path) problems.push(`line ${row.line}: ${row.key} is ${r.verb} ${r.path}, not ${row.verb} ${row.path}`);
      const stays = !['applied', 'deferred', 'secret-read'].includes(row.disposition);
      if (stays && !inPopulation.has(row.key)) problems.push(`line ${row.line}: ${row.key} (${row.disposition}) is no longer membership-only: move it to applied or drop it`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-04] every applied row carries exactly the enforced scope it names', () => {
    const problems: string[] = [];
    for (const row of censusRows().filter((r) => r.disposition === 'applied')) {
      const r = byKey.get(row.key);
      const named = /`?([a-z]+):(read|write|admin)`?/.exec(row.reason);
      if (!r || !named) { problems.push(`line ${row.line}: ${row.key} names no route or scope`); continue; }
      if (!enforced(r) || r.scope?.module !== named[1] || r.scope?.minLevel !== named[2]) {
        problems.push(`line ${row.line}: ${row.key} carries ${r.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no scope'}${enforced(r) ? '' : ' (not enforced)'}, not ${named[1]}:${named[2]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-05] every exempt-check row names a check its handler uses or its module defines', () => {
    const problems: string[] = [];
    const moduleSource = new Map<string, string>();
    const sourceOf = (file: string) => {
      const dir = join(SRC, file.split('/').slice(0, 2).join('/'));
      if (!moduleSource.has(dir)) moduleSource.set(dir, walk(dir).map((f) => readFileSync(f, 'utf8')).join('\n'));
      return moduleSource.get(dir)!;
    };
    for (const row of censusRows().filter((r) => r.disposition === 'exempt-check' || (r.disposition === 'secret-read' && /check:/.test(r.reason)))) {
      const r = byKey.get(row.key);
      const handlerChecks = [...row.reason.matchAll(/(?<![a-z-])check:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
      const serviceChecks = [...row.reason.matchAll(/service-check:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
      if (!handlerChecks.length && !serviceChecks.length) { problems.push(`line ${row.line}: ${row.key} names no check:<name> or service-check:<name>`); continue; }
      for (const c of handlerChecks) if (!new RegExp(`\\b${c}\\b`).test(r?.body ?? '')) problems.push(`line ${row.line}: ${row.key} does not use ${c}`);
      for (const c of serviceChecks) if (!r || !new RegExp(`\\b${c}\\b`).test(sourceOf(r.file))) problems.push(`line ${row.line}: ${row.key}'s module defines no ${c}`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-06] every exempt-guard row names a guard its route runs', () => {
    const problems: string[] = [];
    for (const row of censusRows().filter((r) => r.disposition === 'exempt-guard')) {
      const guards = [...row.reason.matchAll(/guard:([A-Za-z]+)/g)].map((m) => m[1]);
      if (!guards.length) { problems.push(`line ${row.line}: ${row.key} names no guard:<Name>`); continue; }
      const chain = byKey.get(row.key)?.guards ?? [];
      for (const g of guards) if (!chain.includes(g)) problems.push(`line ${row.line}: ${row.key} does not run ${g}`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-08] every secret-read row whose reason starts with a scope carries exactly that enforced scope', () => {
    const problems: string[] = [];
    for (const row of censusRows().filter((r) => r.disposition === 'secret-read')) {
      const named = /^`?([a-z]+):(read|write|admin)`?/.exec(row.reason);
      if (!named) continue;
      const r = byKey.get(row.key);
      if (!r || !enforced(r) || r.scope?.module !== named[1] || r.scope?.minLevel !== named[2]) {
        problems.push(`line ${row.line}: ${row.key} carries ${r?.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no scope'}${r && enforced(r) ? '' : ' (not enforced)'}, not ${named[1]}:${named[2]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-09] no credential-binding start is left membership-only on purpose: its row gates it (applied, exempt-check, exempt-guard, exempt-ruled), never open or deferred', () => {
    const rows = new Map(censusRows().map((r) => [r.key, r]));
    const problems: string[] = [];
    for (const r of all.filter((x) => isMember(x) && isBindingStart(x) && (WRITE_VERBS.has(x.verb) || x.verb === 'GET'))) {
      const row = rows.get(r.key);
      if (enforced(r)) continue;
      if (!row) { problems.push(`${r.key} (${r.verb} ${r.path}) starts a credential binding and has no row`); continue; }
      if (!['exempt-check', 'exempt-guard', 'exempt-ruled'].includes(row.disposition)) {
        problems.push(`line ${row.line}: ${r.key} (${r.verb} ${r.path}) starts a credential binding and is ${row.disposition}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-07] every exempt-ruled row cites an owner ruling', () => {
    const problems = censusRows()
      .filter((r) => r.disposition === 'exempt-ruled' && !/\bD-\d+\b/.test(r.reason))
      .map((r) => `line ${r.line}: ${r.key} cites no ruling`);
    expect(problems).toEqual([]);
  });
  it('[CEN-10] the credential call graph sees the writers the reviews found, and its pinned doors and checks are real', () => {
    const g = credentialGraph();
    const reaches = [...g.reaches.keys()];
    // guards the guard: each writer the reviews found by hand is found by the call graph
    expect(reaches).toEqual(expect.arrayContaining([
      'ConnectorController.saveCredentials', // SEC-1: ConnectorCredentialsService.setCredentials
      'ConnectorController.deleteCredentials', // SEC-1: clearCredentials
      'ConnectorController.getWebhookInfo', // SEC-1: a GET that writes the inbound webhook secret
      'CommunicationsController.createConnection', // SV-2: ChannelConnectionService.create
      'CommunicationsController.updateConnection', // SV-2: ChannelConnectionService.update
      'SocialController.manualConnect', // SV-2: SocialConnectionsService.upsertConnection
      'SocialController.oauthStart', // SV-2: an OAuth session store (a consent start)
      'MicrosoftOAuthController.buildAuthUrl', // SV-3: a GET that signs a consent state
      'ShopifyController.connect', // RC-2: setCredentials from the body
      'SupplierController.createConnection', // RC-2 sibling: SupplierConnection.credentials
      'FinanceController.createBankConnection', // BankConnection.accessToken
      'MicrosoftOAuthController.callback', // a public callback storing the Outlook tokens
    ]));
    // a read that writes nothing is not a writer
    for (const key of ['WebhooksController.list', 'CommunicationsController.listConnections', 'ShopifyController.test']) expect(g.reaches.has(key), key).toBe(false);
    const problems: string[] = [];
    for (const [door, why] of Object.entries(REFRESH_DOORS)) {
      if (!why.trim()) problems.push(`${door} names no reason`);
      if (!(g.doorWrites.get(door) ?? []).length) problems.push(`${door} is not a credential writer (any more): drop it from REFRESH_DOORS`);
    }
    // Round 3 (CM-1): a check is its pinned declarations; each must exist (a renamed or moved check fails here, never silently by name).
    for (const [name, rule] of Object.entries(CREDENTIAL_CHECKS)) {
      if (!rule.decl.length) problems.push(`CREDENTIAL_CHECKS ${name} pins no declaration`);
      for (const d of rule.decl) if (!g.declarations.has(d)) problems.push(`CREDENTIAL_CHECKS ${name} pins ${d}, which no source declares`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-10b] every route that reaches a provider credential write (call graph, any verb, member or public) reaches it only through settings admin or a pinned owner rule that dominates the call; a route whose file another branch holds is a deferred row naming held:', () => {
    const g = credentialGraph();
    const rows = new Map(censusRows().map((r) => [r.key, r]));
    const problems: string[] = [];
    for (const r of all) {
      const path = g.unguarded.get(r.key);
      if (!path || settingsAdminEnforced(r)) continue;
      const row = rows.get(r.key);
      if (row?.disposition === 'deferred' && /\bheld:/.test(row.reason)) continue;
      problems.push(`${r.key} (${r.verb} ${r.path}; ${isMember(r) ? r.guards.join('+') + (r.scope ? ` ${r.scope.module}:${r.scope.minLevel}` : '') : 'public'}): ${path.join(' -> ')}`);
    }
    expect(problems).toEqual([]);
  });
  it('[CEN-10c] every KEY module action (a KeyCortex connector adapter execute, the door KEY flows, plans and the key_connector organ dispatch through) that reaches a provider credential write reaches it only through a pinned check that dominates the call', () => {
    const g = credentialGraph();
    expect(g.keyEntries.length).toBeGreaterThan(10);
    expect(g.keyEntries).toEqual(expect.arrayContaining(['SocialAdapterService.execute', 'SettingsAdapterService.execute']));
    const problems = g.keyEntries.filter((k) => g.unguarded.has(k)).map((k) => g.unguarded.get(k)!.join(' -> '));
    expect(problems).toEqual([]);
  });
  it('[CEN-10d] (round 2, CW-5; round 3, CM-1..CM-3) guards the guard: the reader reports, as unguarded, a membership-only handler for every credential-writer shape the round 2 and round 3 hunts passed through it, and not its guarded twin', () => {
    const synthetic = HUNT_SHAPES();
    const g = buildCredentialGraph([...parsed(), synthetic]);
    const hunt = routes([synthetic]);
    expect(hunt.map((r) => r.key).sort()).toEqual([...HUNT_EXPECTED_UNGUARDED, ...HUNT_EXPECTED_GUARDED].sort());
    // a route is unguarded as CEN-10b reads it: an unguarded path, and no settings admin enforced on the route
    const routeUnguarded = (key: string) => g.unguarded.has(key) && !settingsAdminEnforced(hunt.find((r) => r.key === key)!);
    const missed = HUNT_EXPECTED_UNGUARDED.filter((key) => !routeUnguarded(key));
    expect(missed, 'shapes the reader does not see').toEqual([]);
    const overReported = HUNT_EXPECTED_GUARDED.filter((key) => routeUnguarded(key));
    expect(overReported, 'guarded twins reported unguarded').toEqual([]);
    for (const key of HUNT_EXPECTED_GUARDED) expect(g.reaches.has(key), `${key} still reaches its write`).toBe(true);
  });

  it('[CEN-10e] (round 2, CW-5) the credential leaves are the schema\'s: every secret-named column is a leaf or excused by name, every excuse names a real column, and the binding rules name real delegates', () => {
    const models = credentialModels();
    const problems: string[] = [];
    const delegates = new Set([...schemaModels().values()].map((m) => m.delegate));
    for (const [key, why] of Object.entries(NOT_PROVIDER_CREDENTIALS)) {
      const [model, field] = key.split('.');
      if (!why.trim()) problems.push(`${key} names no reason`);
      if (!schemaModels().get(model)?.fields.has(field)) problems.push(`NOT_PROVIDER_CREDENTIALS names ${key}, which the schema does not have`);
    }
    for (const delegate of Object.keys(BINDING_RULES)) if (!delegates.has(delegate)) problems.push(`BINDING_RULES names ${delegate}, which is no Prisma delegate`);
    for (const [id, why] of Object.entries(BINDING_WRITERS)) if (!why.trim()) problems.push(`${id} names no reason`);
    expect(problems).toEqual([]);
    // guards the guard: the schema reader sees the credential columns the reviews found by hand
    expect(models.business).toEqual(expect.arrayContaining(['gmailRefreshToken', 'msContactsAccessToken', 'bpRefreshToken', 'bpAccountId', 'bpLocationId', 'calendarId']));
    expect(models.channelConnection).toEqual(expect.arrayContaining(['token', 'refreshToken']));
    expect(models.supplierConnection).toEqual(expect.arrayContaining(['credentials']));
    expect(models.integrationConnection).toEqual(expect.arrayContaining(['authData', 'authDataRef']));
    expect(models.connectorAccount).toEqual(expect.arrayContaining(['accessTokenEncrypted', 'refreshTokenEncrypted']));
    expect(models.channelDestination).toEqual(expect.arrayContaining(['destinationMeta']));
    expect(models.aiMemory).toEqual(expect.arrayContaining(['byokOpenai', 'byokAnthropic', 'byokXai']));
    expect(models.paymentLink, 'an app-issued token is not a provider credential').toBeUndefined();
    const g = credentialGraph();
    for (const id of Object.keys(BINDING_WRITERS)) expect((g.leaves.get(id) ?? []).length, `${id} still writes`).toBeGreaterThan(0);
    // the round 2 finds, by the graph (CW-1, CW-2, CW-3, CW-4)
    expect([...g.reaches.keys()]).toEqual(expect.arrayContaining([
      'AiController.updateAiPreferences',
      'CommunicationsController.createDestination',
      'CommunicationsController.toggleDestination',
      'ConnectController.setBpActiveLocation',
      'ConnectorController.authenticate',
      'ConnectorController.smoke',
    ]));
  });

  it('[CEN-10f] (round 2, CW-4) a connector whose provider check records a binding is named in CONNECTORS_BINDING_ON_CHECK, so POST smoke/:type holds it to the Connect rule: every connector class whose smokeTest reaches a credential or binding write on the call graph', () => {
    const g = credentialGraph();
    const file = join(SRC, 'core/connectors/connector-binding.ts');
    const named = existsSync(file) ? new Set([...readFileSync(file, 'utf8').matchAll(/new Set\(\[([^\]]*)\]\)/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))) : new Set<string>();
    const binding = [...g.reaches.keys()].filter((id) => id.endsWith('.smokeTest')).map((id) => id.slice(0, -'.smokeTest'.length));
    expect(binding, 'guards the guard: the WhatsApp check records a binding').toContain('WhatsAppConnector');
    const problems: string[] = [];
    for (const cls of binding) {
      const text = readFileSync(join(SRC, g.classes.get(cls)!.file), 'utf8');
      const type = /const CONNECTOR_TYPE\s*=\s*'([a-z_]+)'/.exec(text)?.[1] ?? /\btype:\s*'([a-z_]+)'/.exec(text)?.[1];
      if (!type || !named.has(type)) problems.push(`${cls} (${type ?? 'no type'}): its smoke test reaches ${g.reaches.get(`${cls}.smokeTest`)!.join(' -> ')}`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-10h] (round 3, CM-3 g13) a status door lifts no disconnect: it still writes a status lift, and its connector\'s disconnect removes the credentials (a credential write that is no deactivation, or clearCredentials) or its connectedness is read from the credentials, never from the stored status', () => {
    const g = credentialGraph();
    const problems: string[] = [];
    for (const [door, { connector, why }] of Object.entries(STATUS_DOORS)) {
      if (!why.trim()) problems.push(`${door} names no reason`);
      if (!(g.doorWrites.get(door) ?? []).some((w) => /status lift/.test(w))) problems.push(`${door} writes no status lift (any more): drop it from STATUS_DOORS`);
      const cls = g.classes.get(connector);
      const disconnect = cls?.methods.get('disconnect');
      const health = cls?.methods.get('healthCheck');
      if (!cls || !disconnect || !health) { problems.push(`${door}: ${connector} has no disconnect and healthCheck`); continue; }
      const clears = (g.leaves.get(`${connector}.disconnect`) ?? []).some((l) => !/\((deactivate|status lift)\)/.test(l)) || /\bclearCredentials\(/.test(textOf(disconnect));
      const readsCredentials = !/\bstored\??\.status\b|\bstatus\s*===\s*['"]connected['"]/.test(textOf(health));
      if (!clears && !readsCredentials) problems.push(`${door}: ${connector}'s disconnect keeps the credentials and its health reads the stored status, so this write lifts a disconnect`);
    }
    // guards the guard: WhatsApp's health reads the stored status (its disconnect is a record), so it could never be pinned here
    const wa = g.classes.get('WhatsAppConnector')?.methods.get('healthCheck');
    expect(wa && /\bstored\??\.status\b/.test(textOf(wa))).toBe(true);
    expect(problems).toEqual([]);
  });

  it('[CEN-11] (round 2, CLASS A: WHP-1, WHP-2) every route (member or public, any verb) and every KEY module action that reaches a send of the business\'s people or money rows to an account outside the server reaches it only through the export read check (or the owner rule) that dominates the call, or the send is a pinned destination every reader of those rows may receive', () => {
    const g = exportGraph();
    const exports = [...g.leaves].filter(([, l]) => l.length).map(([id]) => id);
    // guards the guard: the integration pushes the review found
    expect(exports).toEqual(expect.arrayContaining([
      'QuickbooksConnector.pushInvoice',
      'QuickbooksConnector.pushCustomer',
      'XeroConnector.pushInvoice',
      'XeroConnector.pushCustomer',
      'MailchimpConnector.subscribeContacts',
      'KlaviyoConnector.subscribeContacts',
      // round 3: the Outlook contacts push (WPH2-1) and a Drive share of a stored file (WPH2-2)
      'OutlookContactsSyncService.pushContact',
      'GoogleDriveService.shareFile',
    ]));
    for (const key of ['AccountingController.pushInvoice', 'AccountingController.pushCustomers', 'MarketingSyncController.pushContacts']) expect(g.reaches.has(key), key).toBe(true);
    // round 3: every edit of a contact reaches the Outlook push (contact.updated -> ContactSyncService.onContactUpdated), and the Drive share route reaches its grant
    for (const key of ['CrmController.updateContact', 'GoogleDriveController.share']) expect(g.reaches.has(key), key).toBe(true);
    const problems: string[] = [];
    for (const [door, why] of Object.entries(OUTBOUND_DESTINATIONS)) {
      if (!why.trim()) problems.push(`${door} names no reason`);
      if (!(g.doorWrites.get(door) ?? []).length) problems.push(`${door} sends no records out (any more): drop it from OUTBOUND_DESTINATIONS`);
    }
    for (const [name, rule] of Object.entries(EXPORT_CHECKS)) {
      if (!rule.decl.length) problems.push(`EXPORT_CHECKS ${name} pins no declaration`);
      for (const d of rule.decl) if (!g.declarations.has(d)) problems.push(`EXPORT_CHECKS ${name} pins ${d}, which no source declares`);
    }
    const rows = new Map(censusRows().map((r) => [r.key, r]));
    for (const r of all) {
      const path = g.unguarded.get(r.key);
      if (!path) continue;
      const row = rows.get(r.key);
      if (row?.disposition === 'deferred' && /\bheld:/.test(row.reason)) continue;
      problems.push(`${r.key} (${r.verb} ${r.path}; ${isMember(r) ? r.guards.join('+') : 'public'}): ${path.join(' -> ')}`);
    }
    for (const k of g.keyEntries) if (g.unguarded.has(k)) problems.push(`KEY ${g.unguarded.get(k)!.join(' -> ')}`);
    expect(problems).toEqual([]);
  });

  it('[CEN-11b] (round 2, CLASS A: WHP-1, WHP-2) an export connector\'s account is bound only by a member who reads what it exports: every connector class an export leaf sits in names its reads in CONNECTOR_EXPORT_READS, and the credentials route checks them', () => {
    const g = exportGraph();
    const exportFile = join(SRC, 'core/connectors/connector-exports.ts');
    const problems: string[] = [];
    const declared = existsSync(exportFile)
      ? new Set([...readFileSync(exportFile, 'utf8').matchAll(/^\s+([a-z_]+):\s*\[/gm)].map((m) => m[1]))
      : new Set<string>();
    if (!existsSync(exportFile)) problems.push('core/connectors/connector-exports.ts (CONNECTOR_EXPORT_READS) does not exist');
    const exportClasses = new Set([...g.leaves].filter(([id, l]) => l.length && !Object.hasOwn(OUTBOUND_DESTINATIONS, id)).map(([id]) => id.slice(0, id.lastIndexOf('.'))));
    const byKey = new Map(all.map((r) => [r.key, r]));
    for (const cls of exportClasses) {
      const file = g.classes.get(cls)?.file;
      const text = file ? readFileSync(join(SRC, file), 'utf8') : '';
      const account = Object.hasOwn(EXPORT_ACCOUNTS, cls) ? EXPORT_ACCOUNTS[cls] : undefined;
      const type = account?.type ?? /const CONNECTOR_TYPE\s*=\s*'([a-z_]+)'/.exec(text)?.[1] ?? /\btype:\s*'([a-z_]+)'/.exec(text)?.[1];
      if (!type) { problems.push(`${cls} exports records and is neither a connector nor an EXPORT_ACCOUNTS entry naming the account it sends to and the routes that bind it`); continue; }
      if (!account) {
        if (!declared.has(type)) problems.push(`${cls} (${type}) exports records and CONNECTOR_EXPORT_READS does not name its reads`);
        continue;
      }
      // Round 3 (WPH2-1, WPH2-2): a service that sends to an account bound elsewhere (an OAuth consent): the routes that bind it
      // check the binder's reads of what it receives (assertMayBindExport, with its type in CONNECTOR_EXPORT_READS) or the owner rule.
      for (const bind of account.binds) {
        const body = byKey.get(bind)?.body ?? '';
        if (!byKey.has(bind)) problems.push(`${cls}: its account's binding route ${bind} is not a route`);
        else if (/\bassertGoogleConnectOwner\b/.test(body)) continue;
        else if (!/\bassertMayBindExport\b/.test(body)) problems.push(`${cls} (${type}): ${bind} binds the account it sends to without checking the binder reads what it receives (assertMayBindExport)`);
        else if (!declared.has(type)) problems.push(`${cls} (${type}) exports records and CONNECTOR_EXPORT_READS does not name its reads`);
      }
      // the callback that completes the binding records the binder, the receiver every later send is checked for
      if (account.recordsBinder) {
        const [c, m] = account.recordsBinder.split('.');
        const body = g.classes.get(c)?.methods.get(m);
        if (!body || !/\bboundBy\b/.test(textOf(body))) problems.push(`${cls} (${type}): ${account.recordsBinder} does not record the binder (metadata.boundBy)`);
      }
    }
    const save = all.find((r) => r.key === 'ConnectorController.saveCredentials');
    if (!/\bassertMayBindExport\b/.test(save?.body ?? '')) problems.push('ConnectorController.saveCredentials does not check the export reads of the connector it binds (assertMayBindExport)');
    expect(problems).toEqual([]);
  });
});
