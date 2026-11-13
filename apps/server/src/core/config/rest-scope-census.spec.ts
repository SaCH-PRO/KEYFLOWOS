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

function routes(): Route[] {
  const out: Route[] = [];
  for (const { file, text, sf } of parsed()) {
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
// Round 1 class repair (CLASS B): the credential-writer call graph.
//
// The reviews found the SEC-1 class one instance at a time (connector credentials, then channel and
// social connections, then the Outlook consent start, then Shopify connect), each a route whose path
// and handler name said nothing about credentials. This reader finds them by what the handler does:
// it follows the handler's calls through injected services (constructor and property injection,
// superclasses), same-class helpers, top-level helper functions, connector dispatch (a call on a
// local of an interface several classes implement goes to every implementation) and a method name
// only one class defines, down to the code that writes a provider credential:
//   - a Prisma write (create, update, upsert, delete and their Many forms) on a model that stores a
//     credential (CREDENTIAL_MODELS) whose data names one of its credential columns (in the call, or,
//     when the data is built elsewhere, in the method and the same-class helpers it calls), or that
//     deletes or deactivates such a row (isActive, a DISCONNECTED status);
//   - a Business write whose metaData carries a credential key (WhatsApp, payment and SEO secrets);
//   - raw SQL that SETs a token column;
//   - a consent start: an OAuth state signer (createHmac over a state, in a method that does not
//     verify one) or an OAuth session store (store...OAuthSession / ...OAuthState).
// A writer that only persists the provider's answer for a binding that already exists (a refreshed
// access token, a rotated refresh token) or clears what no binding holds is a REFRESH_DOOR: it is
// pinned by name below with its reason, must still exist and still write, and is not a binding write.
//
// A path to a credential write is GUARDED when settings admin is enforced on the route
// (ModuleScopeGuard with @RequireModuleScope('settings', 'admin')) or when one of the pinned
// authority checks (CREDENTIAL_CHECKS: settings admin as ModuleScopeGuard reads it, or the owner
// rule where a ruling sets one, D-11, D-42, D-94, D-99, D-111 with D-114) dominates the call that
// leads there in some method on the path: the check is called in an earlier statement of a block
// that encloses the call (an `if` condition counts; a check inside a sibling branch does not). For a
// public route (a provider callback) the check is the signed-state verification its start minted.
// CEN-10 fails for every route with an unguarded path, naming the path.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Prisma delegate -> the columns that hold a credential; `*delete` / `*create`: deleting / creating a row is a binding write. */
const CREDENTIAL_MODELS: Record<string, string[]> = {
  business: ['bpAccessToken', 'bpRefreshToken', 'calendarAccessToken', 'calendarRefreshToken', 'contactsAccessToken', 'contactsRefreshToken', 'driveAccessToken', 'driveRefreshToken', 'formsAccessToken', 'formsRefreshToken', 'gmailAccessToken', 'gmailRefreshToken', 'msContactsAccessToken', 'msContactsRefreshToken'],
  bankConnection: ['accessToken', 'providerItemId', '*delete', '*deactivate'],
  channelConnection: ['token', 'refreshToken', '*delete', '*create', '*deactivate'],
  connectorAccount: ['accessTokenEncrypted', 'refreshTokenEncrypted', '*delete'],
  socialConnection: ['token', 'refreshToken', '*delete', '*create', '*deactivate'],
  supplierConnection: ['credentials', '*delete', '*deactivate'],
  integrationConnection: ['authData', 'authDataRef', '*delete', '*deactivate'],
  connectorStatus: ['encryptedCredentials'],
};
const CREDENTIAL_WRITE_OPS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
/** Business.metaData keys that hold a credential (core/security/sanitize-business.ts: WhatsApp, payment and SEO secrets). */
const META_CREDENTIAL_KEYS = /\b(stripeSecretKey|stripeWebhookSecret|paypalClientSecret|wipayApiKey|accessToken|authToken|refreshToken|accountSid)\b/;
const DEACTIVATES = /\bisActive\b|['"](DISCONNECTED|disconnected|REVOKED|revoked)['"]/;
const OAUTH_SESSION_STORE = /^(store|save|put|create|issue|mint)\w*O[Aa]uth\w*(Session|State)s?$/;

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
 * Authority checks that guard a credential write when they dominate it: name -> the arguments the call
 * must carry (if any) and why it counts. A role-only check is not one (KeyConnectorController's
 * requireConnectorWriter admits every ADMIN, and D-114 binds an ADMIN to an explicit map): the route
 * must also hold settings admin by the map. A method or helper that always runs one of these before
 * it can return (assertProfileOwner, assertConnectorSettingsAdmin) counts as one (wrappers, below).
 */
const CREDENTIAL_CHECKS: Record<string, { args?: RegExp; why: string }> = {
  assertMemberModuleLevel: { args: /['"]settings['"]\s*,\s*['"]admin['"]/, why: 'settings admin, read as ModuleScopeGuard reads it' },
  assertConnectorSettingsAdmin: { why: 'settings admin; gmail and the Google Suite connections answer their owner rules (D-11, D-99)' },
  assertGoogleConnectOwner: { why: 'D-99: every Google connection is the owner\'s' },
  assertConnectAuthority: { why: 'D-11, D-42: the business mailbox is the owner\'s (GMAIL_OWNER_ONLY)' },
  connectStanding: { why: 'D-11, D-42: the Gmail owner rule assertConnectAuthority runs, answering the standing for the audit row' },
  assertBusinessOwner: { why: 'D-11: the business profile and its stored secrets are the owner\'s' },
  assertConfigOwner: { why: 'D-11: the WhatsApp sending identity is the owner\'s' },
  assertConnectorOwner: { why: 'D-94: GA4 and Search Console are the owner\'s' },
  assertCommandActorModuleLevel: { args: /['"]settings['"]\s*,\s*['"]admin['"]/, why: 'settings admin for a KEY command\'s human actor, read as ModuleScopeGuard reads it' },
  verifyState: { why: 'a public provider callback: the signed state its (guarded) start minted' },
  consumeOAuthSession: { why: 'a provider callback: the OAuth session its (guarded) start stored' },
};

interface GraphClass {
  file: string;
  props: Map<string, string>;
  methods: Map<string, ts.Node>;
  extendsName?: string;
  implementsNames: string[];
}

interface CredentialGraph {
  classes: Map<string, GraphClass>;
  /** KEY connector adapters: Class.execute(command: ConnectorCommand), the door every KEY module action goes through. */
  keyEntries: string[];
  /** method id -> why it is unguarded (a path), or absent when every path from it to a credential write is guarded. */
  unguarded: Map<string, string[]>;
  /** method id -> some path to a credential write, guarded or not. */
  reaches: Map<string, string[]>;
  refreshDoorWrites: Map<string, string[]>;
  checkNames: Set<string>;
  /** Methods that always run a pinned check before they return. */
  wrappers: Set<string>;
}

function buildCredentialGraph(): CredentialGraph {
  const classes = new Map<string, GraphClass>();
  const interfaces = new Map<string, string[]>();
  const functions = new Map<string, Array<{ body: ts.Node; sf: ts.SourceFile }>>();
  const definedNames = new Set<string>();
  const keyEntries: string[] = [];
  const decorators = (n: ts.Node) => (ts.canHaveDecorators(n) ? ts.getDecorators(n) ?? [] : []);
  const injected = (sf: ts.SourceFile, n: ts.Node) => {
    const inj = decorators(n).find((d) => ts.isCallExpression(d.expression) && d.expression.expression.getText(sf) === 'Inject');
    const a = inj && ts.isCallExpression(inj.expression) ? inj.expression.arguments[0] : undefined;
    if (!a) return undefined;
    if (ts.isIdentifier(a)) return a.text;
    if (ts.isArrowFunction(a)) return a.body.getText(sf);
    return undefined;
  };
  const cleanType = (t: string) => t.replace(/\s*\|\s*(undefined|null)/g, '').trim();

  for (const { sf } of parsed()) {
    for (const node of sf.statements) {
      if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node.members.filter((m) => m.name).map((m) => m.name!.getText(sf)));
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        functions.set(node.name.text, [...(functions.get(node.name.text) ?? []), { body: node.body, sf }]);
        definedNames.add(node.name.text);
      }
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
            functions.set(d.name.text, [...(functions.get(d.name.text) ?? []), { body: d.initializer.body, sf }]);
            definedNames.add(d.name.text);
          }
        }
      }
      if (!ts.isClassDeclaration(node) || !node.name) continue;
      const cls: GraphClass = { file: relative(SRC, sf.fileName), props: new Map(), methods: new Map(), implementsNames: [] };
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
          }
        } else if (ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name)) {
          if (m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
            cls.methods.set(m.name.text, m.initializer.body);
            definedNames.add(m.name.text);
            continue;
          }
          const type = injected(sf, m) ?? (m.type ? m.type.getText(sf) : m.initializer && ts.isNewExpression(m.initializer) ? m.initializer.expression.getText(sf) : undefined);
          if (type) cls.props.set(m.name.text, cleanType(type));
        } else if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m)) && m.body && m.name) {
          cls.methods.set(m.name.getText(sf), m.body);
          definedNames.add(m.name.getText(sf));
          if (m.name.getText(sf) === 'execute' && m.parameters[0]?.type?.getText(sf) === 'ConnectorCommand') keyEntries.push(`${node.name.text}.execute`);
        }
      }
      // A class name defined twice keeps its first file (both are read: the second under file@name).
      classes.set(classes.has(node.name.text) ? `${node.name.text}@${cls.file}` : node.name.text, cls);
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
  const resolve = (cls: string, method: string) => [cls, ...supers(cls)].map((k) => `${k}.${method}`).find((id) => methodBody(id)) ?? null;
  const methodBody = (id: string): ts.Node | undefined => {
    const dot = id.lastIndexOf('.');
    return classes.get(id.slice(0, dot))?.methods.get(id.slice(dot + 1));
  };
  const propType = (cls: string, prop: string) => [cls, ...supers(cls)].map((k) => classes.get(k)?.props.get(prop)).find(Boolean);

  // A method only one class defines; a method of an interface several classes implement (connector dispatch).
  const owners = new Map<string, string[]>();
  for (const [name, c] of classes) for (const m of c.methods.keys()) owners.set(m, [...(owners.get(m) ?? []), name]);
  const COMMON = new Set(['get', 'set', 'has', 'create', 'update', 'delete', 'find', 'list', 'map', 'filter', 'push', 'then', 'catch', 'emit', 'log', 'warn', 'error', 'send', 'toString', 'add', 'remove', 'run', 'execute', 'handle', 'process']);
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
        const target = resolve(c, m);
        if (target && !(dispatch.get(m) ?? []).includes(target)) dispatch.set(m, [...(dispatch.get(m) ?? []), target]);
      }
    }
  }
  const byName = (m: string): string[] => {
    if (dispatch.has(m)) return dispatch.get(m)!;
    const o = owners.get(m) ?? [];
    return !COMMON.has(m) && o.length === 1 ? [`${o[0]}.${m}`] : [];
  };

  /** The methods a call may run (precise: only through `this`, a typed injected property or a top-level function, never by name alone). */
  const targets = (call: ts.CallExpression, cls: string | null, precise = false): string[] => {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return functions.has(callee.text) ? [`fn:${callee.text}`] : [];
    if (!ts.isPropertyAccessExpression(callee)) return [];
    const method = callee.name.text;
    const recv = callee.expression;
    if (recv.kind === ts.SyntaxKind.ThisKeyword) return cls ? [resolve(cls, method)].filter((x): x is string => !!x) : [];
    if (ts.isPropertyAccessExpression(recv) && recv.expression.kind === ts.SyntaxKind.ThisKeyword && cls) {
      const type = propType(cls, recv.name.text);
      if (type && classes.has(type)) return [resolve(type, method)].filter((x): x is string => !!x);
      if (type || precise) return [];
      return byName(method);
    }
    if (ts.isIdentifier(recv) && !precise) return byName(method);
    return [];
  };

  const textOf = (n: ts.Node) => n.getText(n.getSourceFile());
  /** The credential write a call makes itself, or null. */
  const leafOf = (call: ts.CallExpression | ts.TaggedTemplateExpression, mention: string): string | null => {
    if (ts.isTaggedTemplateExpression(call)) {
      const tag = textOf(call.tag);
      return /\$executeRaw(Unsafe)?$/.test(tag) && /\bSET\b[^;]*\b\w*(access_token|refresh_token)\w*\s*=/i.test(textOf(call.template)) ? 'raw SQL SET token' : null;
    }
    const callee = call.expression;
    const argsText = call.arguments.map(textOf).join(', ');
    if (ts.isPropertyAccessExpression(callee) && CREDENTIAL_WRITE_OPS.has(callee.name.text) && ts.isPropertyAccessExpression(callee.expression)) {
      const model = callee.expression.name.text;
      const op = callee.name.text;
      const cols = Object.hasOwn(CREDENTIAL_MODELS, model) ? CREDENTIAL_MODELS[model] : undefined;
      if (!cols) return null;
      // the data is built elsewhere: a data / create / update / metadata value that is not an object literal, a shorthand, or a spread
      // (a parenthesised spread, `...(cond && { col: v })`, is still written out in the call)
      // and a computed column name, `[fields.access]: token`, is named elsewhere too
      const indirect = /\b(data|create|update|metadata|metaData)\s*(:\s*(?![{\s])|[,}])|\.\.\.[A-Za-z_$]|\[[A-Za-z_$][\w$.]*\]\s*:/.test(argsText);
      const scope = indirect ? mention : argsText;
      const hit = cols.filter((c) => !c.startsWith('*') && new RegExp(`\\b${c}\\b`).test(scope));
      if (hit.length) return `${model}.${op}(${hit.join(', ')})`;
      if (op.startsWith('delete') && cols.includes('*delete')) return `${model}.${op}`;
      if ((op === 'create' || op === 'createMany' || op === 'upsert') && cols.includes('*create')) return `${model}.${op}`;
      if (op.startsWith('update') && cols.includes('*deactivate') && DEACTIVATES.test(argsText)) return `${model}.${op}(deactivate)`;
      if (model === 'business' && /\bmetaData\b/.test(indirect ? mention : argsText) && META_CREDENTIAL_KEYS.test(mention)) return 'business.metaData(credential keys)';
      return null;
    }
    if (ts.isPropertyAccessExpression(callee) && /^\$executeRaw/.test(callee.name.text) && /\bSET\b[^;`]*\b\w*(access_token|refresh_token)\w*\s*=/i.test(argsText)) return 'raw SQL SET token';
    return null;
  };
  /** Methods and helpers that always run a pinned check before they return (a wrapper such as assertProfileOwner). */
  const wrappers = new Set<string>();
  const isCheck = (call: ts.CallExpression, cls: string | null): boolean => {
    const callee = call.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
    const rule = Object.hasOwn(CREDENTIAL_CHECKS, name) ? CREDENTIAL_CHECKS[name] : undefined;
    if (rule) return !rule.args || rule.args.test(call.arguments.map(textOf).join(', '));
    const to = targets(call, cls, true);
    return to.length > 0 && to.every((t) => wrappers.has(t));
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
  /** A branch that runs a check before it can return. */
  const branchChecks = (st: ts.Statement, cls: string | null): boolean => {
    if (!ts.isBlock(st)) return statementChecks(st, cls);
    for (const inner of st.statements) {
      if (statementChecks(inner, cls)) return true;
      if (containsReturn(inner)) return false;
    }
    return false;
  };
  const statementChecks = (st: ts.Statement, cls: string | null): boolean => {
    // an `if` counts when its condition runs a check, or when each of its branches does (`if (gmail) ownerRuleA else ownerRuleB`)
    if (ts.isIfStatement(st)) {
      return callsIn(st.expression, [], false).some((c) => isCheck(c, cls)) || (!!st.elseStatement && branchChecks(st.thenStatement, cls) && branchChecks(st.elseStatement, cls));
    }
    if (ts.isExpressionStatement(st) || ts.isVariableStatement(st) || ts.isReturnStatement(st)) return callsIn(st, [], false).some((c) => isCheck(c, cls));
    return false;
  };
  /** A pinned check (or a wrapper of one) is called in an earlier statement of a block enclosing the call, within the method. */
  const dominated = (call: ts.Node, body: ts.Node, cls: string | null): boolean => {
    let node: ts.Node = call;
    while (node !== body && node.parent) {
      const parent = node.parent;
      if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
        const i = parent.statements.indexOf(node as ts.Statement);
        if (parent.statements.slice(0, Math.max(i, 0)).some((st) => statementChecks(st, cls))) return true;
      }
      if (ts.isIfStatement(parent) && node !== parent.expression && callsIn(parent.expression, [], false).some((c) => isCheck(c, cls))) return true;
      node = parent;
    }
    return false;
  };
  /** The body runs a check in a top-level statement and returns nowhere before it. */
  const alwaysChecks = (body: ts.Node, cls: string | null) => {
    if (!ts.isBlock(body)) return false;
    for (const st of body.statements) {
      if (statementChecks(st, cls)) return true;
      if (containsReturn(st)) return false;
    }
    return false;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, c] of classes) {
      for (const [m, body] of c.methods) {
        const id = `${name}.${m}`;
        if (!wrappers.has(id) && alwaysChecks(body, name)) { wrappers.add(id); changed = true; }
      }
    }
    for (const [name, list] of functions) {
      if (!wrappers.has(`fn:${name}`) && list.every((f) => alwaysChecks(f.body, null))) { wrappers.add(`fn:${name}`); changed = true; }
    }
  }

  interface GraphNode {
    leaves: Array<{ write: string; guarded: boolean }>;
    edges: Array<{ to: string; guarded: boolean }>;
  }
  const nodes = new Map<string, GraphNode>();
  const refreshDoorWrites = new Map<string, string[]>();
  // Top-level constants by file (a field list such as CONNECTION_UPDATE_FIELDS names the columns a write keeps).
  const constants = new Map<ts.SourceFile, Map<string, string>>();
  const constantsOf = (sf: ts.SourceFile) => {
    if (!constants.has(sf)) {
      const m = new Map<string, string>();
      for (const st of sf.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) m.set(d.name.text, d.initializer.getText(sf));
      }
      constants.set(sf, m);
    }
    return constants.get(sf)!;
  };
  const add = (id: string, body: ts.Node, cls: string | null) => {
    let mention = textOf(body);
    const fileConstants = constantsOf(body.getSourceFile());
    for (const ident of new Set(textOf(body).match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [])) {
      const value = fileConstants.get(ident);
      if (value) mention += '\n' + value;
    }
    if (cls) {
      for (const c of callsIn(body)) {
        const callee = c.expression;
        if (ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const helper = methodBody(resolve(cls, callee.name.text) ?? '');
          if (helper && helper !== body) mention += '\n' + textOf(helper);
        }
      }
    }
    const node: GraphNode = { leaves: [], edges: [] };
    const method = id.slice(id.lastIndexOf('.') + 1);
    const own = textOf(body);
    if ((/createHmac\(/.test(own) && /\bstate\b/.test(own) && !/verify|validate|check|parse|decode/i.test(method)) || OAUTH_SESSION_STORE.test(method)) {
      node.leaves.push({ write: 'consent start (OAuth state)', guarded: false });
    }
    for (const sql of rawSqlIn(body)) {
      const leaf = leafOf(sql, mention);
      if (leaf) node.leaves.push({ write: leaf, guarded: dominated(sql, body, cls) });
    }
    for (const call of callsIn(body)) {
      const leaf = leafOf(call, mention);
      if (leaf) node.leaves.push({ write: leaf, guarded: dominated(call, body, cls) });
      for (const to of targets(call, cls)) if (to !== id) node.edges.push({ to, guarded: dominated(call, body, cls) });
    }
    if (Object.hasOwn(REFRESH_DOORS, id)) {
      refreshDoorWrites.set(id, node.leaves.map((l) => l.write));
      node.leaves = [];
    }
    nodes.set(id, node);
  };
  for (const [name, c] of classes) for (const [m, body] of c.methods) add(`${name}.${m}`, body, name);
  for (const [name, list] of functions) for (const f of list) add(`fn:${name}`, f.body, null);

  // Least fixed points: a method reaches a credential write (any path), and reaches one by a path with no check.
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
  return { classes, keyEntries, unguarded: solve(true), reaches: solve(false), refreshDoorWrites, checkNames: definedNames, wrappers };
}

let graphCache: CredentialGraph | null = null;
const credentialGraph = () => (graphCache ??= buildCredentialGraph());
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
      if (!(g.refreshDoorWrites.get(door) ?? []).length) problems.push(`${door} is not a credential writer (any more): drop it from REFRESH_DOORS`);
    }
    for (const name of Object.keys(CREDENTIAL_CHECKS)) if (!g.checkNames.has(name)) problems.push(`CREDENTIAL_CHECKS names ${name}, which no source defines`);
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
});
