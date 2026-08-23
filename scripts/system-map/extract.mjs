// Static extractor for the KEYFLOWOS system map.
//
// Reads every tracked source file once and pulls out the structural facts the
// map is built from: module graph, routes, guards, DI edges, events, Prisma
// model access, and the paths the web app fetches.
//
// This is regex-based, not a type-aware parse. That is a deliberate trade:
// it runs in seconds over 4,367 files with no build step, and every row it
// emits carries the evidence string it was derived from so a human can check
// it. Where it cannot be certain it says so rather than guessing — see the
// `confidence` column on edges and the LIMITS block at the bottom of this file.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export const REPO = process.env.KF_REPO || process.cwd();

export function tracked() {
  const out = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').filter(Boolean).map((p) => p.trim());
}

export function read(rel) {
  try {
    return readFileSync(join(REPO, rel), 'utf8');
  } catch {
    return null;
  }
}

// ── classification ──────────────────────────────────────────────────────────

export function workspaceOf(p) {
  const m = /^(apps|packages)\/([^/]+)\//.exec(p);
  return m ? `${m[1]}/${m[2]}` : '(root)';
}

export function serverModuleOf(p) {
  const m = /^apps\/server\/src\/modules\/([^/]+)\//.exec(p);
  if (m) return m[1];
  const c = /^apps\/server\/src\/core\/([^/]+)\//.exec(p);
  if (c) return `core/${c[1]}`;
  if (p.startsWith('apps/server/src/')) return '(server root)';
  return '';
}

export function kindOf(p) {
  const base = p.split('/').pop();
  if (/\.spec\.ts$/.test(base) || /\.test\.tsx?$/.test(base)) return 'spec';
  if (/\.module\.ts$/.test(base)) return 'nest-module';
  if (/\.controller\.ts$/.test(base)) return 'controller';
  if (/\.service\.ts$/.test(base)) return 'service';
  if (/\.guard\.ts$/.test(base)) return 'guard';
  if (/\.listener\.ts$/.test(base)) return 'listener';
  if (/\.interceptor\.ts$/.test(base)) return 'interceptor';
  if (/\.filter\.ts$/.test(base)) return 'filter';
  if (/\.dto\.ts$/.test(base)) return 'dto';
  if (/\.types?\.ts$/.test(base)) return 'types';
  if (base === 'page.tsx') return 'page';
  if (base === 'layout.tsx') return 'layout';
  if (base === 'route.ts') return 'route-handler';
  if (/\.stories\.tsx$/.test(base)) return 'story';
  if (/\.tsx$/.test(base)) return 'component';
  if (/\.ts$/.test(base)) return 'ts';
  return base.split('.').pop() || 'other';
}

export function lineCount(src) {
  if (src == null) return 0;
  return src.length === 0 ? 0 : src.split('\n').length;
}

// ── strip comments so decorators inside doc-blocks don't register ───────────

/**
 * Remove comments while leaving strings, template literals and regex literals
 * intact, preserving every brace so the result can be brace-matched.
 *
 * A naive regex version ate the tail of this real line:
 *
 *   if (/^https?:\/\//.test(redirectUrl)) {
 *
 * because the regex literal ends in `//`. That swallowed the closing braces
 * after it and truncated the enclosing class body, silently dropping 26 routes
 * from one controller. Comment stripping has to be a scanner, not a regex.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  // Whether a `/` here starts a regex literal rather than division: true after
  // an operator, an opening bracket, or a keyword — not after a value.
  let prevMeaningful = '';
  const startsRegex = () => prevMeaningful === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prevMeaningful) || /\breturn$|\btypeof$|\bcase$|\bin$|\bof$|\bdo$|\belse$/.test(out);

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      prevMeaningful = quote;
      continue;
    }
    if (c === '/' && startsRegex()) {
      out += c;
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        out += src[i];
        if (src[i] === '/' && !inClass) {
          i++;
          break;
        }
        if (src[i] === '\n') {
          i++;
          break; // not a regex after all; bail rather than run away
        }
        i++;
      }
      prevMeaningful = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prevMeaningful = c;
    i++;
  }
  return out;
}

// ── extraction ──────────────────────────────────────────────────────────────

export function imports(src) {
  const out = [];
  const re = /import\s+(?:type\s+)?(?:[\s\S]{0,400}?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/** Resolve a relative import specifier to a repo-relative path (best effort). */
export function resolveImport(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const dir = posix.dirname(fromRel);
  let base = posix.normalize(posix.join(dir, spec));
  return base;
}

export function classNames(src) {
  const out = [];
  const re = /export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/** Contents of a decorator-array field like `imports: [A, B]` inside @Module({...}). */
export function moduleArray(src, field) {
  const re = new RegExp(`${field}\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'm');
  const m = re.exec(src);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .map((s) => {
      // forwardRef(() => XModule) / XModule.forRoot() / XModule
      const f = /(?:forwardRef\s*\(\s*\(\)\s*=>\s*)?([A-Za-z0-9_]+)/.exec(s);
      return f ? f[1] : '';
    })
    .filter(Boolean);
}

export function controllerPrefix(src) {
  const m = /@Controller\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/.exec(src);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

// @Sse registers a GET route in Nest, so it belongs here — leaving it out
// reported every server-sent-events endpoint as a path the server does not serve.
const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All', 'Sse'];

/**
 * Route handlers in a controller, each with its own guards plus the
 * class-level guards that apply to all of them.
 */
/**
 * Skip whitespace and any run of decorators starting at `i`, returning the
 * identifier that follows and the decorator text that was skipped.
 *
 * Handlers are commonly written as
 *   @Get('rates')
 *   @RequireModuleScope('operations', 'read')
 *   listRates(...)
 * so the token straight after the HTTP decorator is another decorator, not the
 * method. A regex that grabbed "the next identifier" recorded `UseGuards` as a
 * handler name and dropped the guards it should have collected.
 */
/**
 * Every decorated member in a class body, as (decorator run, member name).
 *
 * Decorator ORDER is free in TypeScript, and both of these appear in this
 * codebase:
 *
 *   @Get('rates') @RequireModuleScope(…) listRates()   // guard after
 *   @UseGuards(AuthGuard) @Patch('me')   updateMe()    // guard BEFORE
 *
 * Scanning only forward from the HTTP decorator missed every guard written in
 * the second form and reported those routes as unguarded. Collecting the whole
 * run per member is order-independent.
 */
function scanMembers(body) {
  const members = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] !== '@') {
      i++;
      continue;
    }
    const decorators = [];
    while (body[i] === '@') {
      const start = i;
      i++;
      while (i < body.length && /[\w.]/.test(body[i])) i++;
      if (body[i] === '(') {
        let depth = 0;
        do {
          if (body[i] === '(') depth++;
          else if (body[i] === ')') depth--;
          i++;
        } while (i < body.length && depth > 0);
      }
      decorators.push(body.slice(start, i));
      while (i < body.length && /\s/.test(body[i])) i++;
    }
    while (/^(?:public|private|protected|readonly|async|static|override)\s/.test(body.slice(i))) {
      const sp = body.indexOf(' ', i);
      if (sp < 0) break;
      i = sp + 1;
      while (i < body.length && /\s/.test(body[i])) i++;
    }
    const m = /^([A-Za-z_$][\w$]*)/.exec(body.slice(i));
    if (m) {
      // Body of the member, for detecting auth enforced in code rather than
      // by a decorator (`@CurrentUser()` plus an explicit throw).
      const openParen = body.indexOf('(', i);
      members.push({ decorators, name: m[1], tail: body.slice(i, i + 900), at: openParen });
      i += m[1].length;
    }
  }
  return members;
}

/** Auth enforced inside the handler instead of by a guard decorator. */
function inBodyAuthCheck(text) {
  return /@CurrentUser\(|UnauthorizedException|ForbiddenException|req\.user|request\.user/.test(text);
}

/**
 * Route handlers, one entry per HTTP method decorator.
 *
 * A file may declare more than one controller — feature-flags.controller.ts
 * holds both `api/feature-flags` and `api/admin/feature-flags` — so the source
 * is split per `@Controller(...)` and each segment resolved against its own
 * prefix. Reading only the first prefix silently dropped every route belonging
 * to the second class.
 */
/** Read a run of consecutive decorators starting at `i`. */
function readDecoratorRun(text, i) {
  const decorators = [];
  while (text[i] === '@') {
    const start = i;
    i++;
    while (i < text.length && /[\w.]/.test(text[i])) i++;
    if (text[i] === '(') {
      let depth = 0;
      do {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        i++;
      } while (i < text.length && depth > 0);
    }
    decorators.push(text.slice(start, i));
    while (i < text.length && /\s/.test(text[i])) i++;
  }
  return { decorators, endIndex: i };
}

/** Text of the `{…}` block starting at `open`, brace-balanced. */
function balancedBlock(text, open) {
  if (text[open] !== '{') return '';
  let depth = 0;
  let i = open;
  do {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  } while (i < text.length && depth > 0);
  return text.slice(open, i);
}

export function routes(src) {
  const clean = stripComments(src);
  const out = [];
  const httpRe = new RegExp(`^@(${HTTP_DECORATORS.join('|')})\\(\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`)?\\s*\\)$`);

  let i = 0;
  while (i < clean.length) {
    if (clean[i] !== '@') {
      i++;
      continue;
    }
    // A class's decorators may be written in ANY order —
    //   @UseGuards(AuthGuard, BusinessGuard)
    //   @Controller('keystore/admin')
    // is real code here. Reading the run as a whole, rather than slicing from
    // @Controller onwards, is what makes those class-level guards visible;
    // missing them reported six authenticated admin routes as wide open.
    const { decorators, endIndex } = readDecoratorRun(clean, i);
    const decl = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+[A-Za-z0-9_$]+/.exec(clean.slice(endIndex));
    if (!decl) {
      i = endIndex > i ? endIndex : i + 1;
      continue;
    }
    const run = decorators.join('\n');
    const ctrl = /@Controller\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/.exec(run);
    const braceAt = clean.indexOf('{', endIndex + decl[0].length);
    const body = braceAt > -1 ? balancedBlock(clean, braceAt) : '';

    if (ctrl) {
      const prefix = (ctrl[1] ?? ctrl[2] ?? ctrl[3] ?? '').trim();
      const classGuards = guardsIn(run);
      for (const member of scanMembers(body)) {
        const mrun = member.decorators.join('\n');
        for (const dec of member.decorators) {
          const m = httpRe.exec(dec.replace(/\s+/g, ' ').trim());
          if (!m) continue;
          const guards = dedupe([...classGuards, ...guardsIn(mrun)]);
          out.push({
            method: m[1].toUpperCase(),
            path: joinRoute(prefix, (m[2] ?? m[3] ?? m[4] ?? '').trim()),
            handler: member.name,
            guards,
            scopes: scopesIn(mrun),
            // Only meaningful when guards is empty — distinguishes a route that
            // is genuinely open from one that checks auth in its own body.
            bodyAuth: guards.length === 0 && inBodyAuthCheck(member.tail),
          });
        }
      }
    }
    i = braceAt > -1 ? braceAt + body.length : endIndex;
  }
  return out;
}

export function joinRoute(prefix, sub) {
  const a = String(prefix || '').replace(/^\/+|\/+$/g, '');
  const b = String(sub || '').replace(/^\/+|\/+$/g, '');
  const joined = [a, b].filter(Boolean).join('/');
  return '/' + joined;
}

export function guardsIn(text) {
  const out = [];
  const re = /@UseGuards\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(text))) {
    for (const g of m[1].split(',')) {
      const t = g.trim().replace(/\(.*$/, '');
      if (t) out.push(t);
    }
  }
  return out;
}

export function scopesIn(text) {
  const out = [];
  const re = /@Require(?:ModuleScope|Scopes?|Roles?|Permission)\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1].replace(/['"\s]/g, ''));
  return out;
}

/** Constructor-injected types — the real DI edges. */
export function injections(src) {
  const clean = stripComments(src);
  const ctor = /constructor\s*\(([\s\S]*?)\)\s*\{/.exec(clean);
  const out = [];
  if (ctor) {
    for (const part of splitParams(ctor[1])) {
      const t = /:\s*([A-Za-z0-9_]+)/.exec(part);
      if (t) out.push(t[1]);
    }
  }
  // moduleRef.get(X) — lazy resolution, still a real dependency
  const re = /moduleRef\.get\(\s*([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(clean))) out.push(m[1]);
  return dedupe(out);
}

function splitParams(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('([{<'.includes(ch)) depth++;
    if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** `orders.paid`, `content_request.created`, `key.action.executed` … */
const EVENT_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_*]+)+$/i;

/**
 * Event names passed to anything emit-shaped.
 *
 * The name is NOT always the first argument. This codebase wraps the emitter:
 *
 *   this.emitEvent(input.businessId, 'content_request.created', request)
 *
 * An earlier version of this function required the literal to sit directly
 * after `emit(`, so it saw none of those and reported eleven live events as
 * "listened but never emitted". Scan the leading arguments instead and take
 * the first that is shaped like an event name.
 */
export function eventsEmitted(src) {
  const out = [];
  const re = /\bemit[A-Za-z]*\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const args = src.slice(re.lastIndex, re.lastIndex + 240);
    for (const lit of stringLiterals(args)) {
      if (EVENT_NAME.test(lit)) {
        out.push(lit);
        break;
      }
    }
  }
  return dedupe(out);
}

/**
 * Quoted/backtick literals in an argument list, with `${…}` collapsed to `*`
 * so a computed suffix becomes a matchable prefix pattern:
 * `content_request.${status}` -> `content_request.*`.
 */
function stringLiterals(text) {
  const out = [];
  const re = /'([^']*)'|"([^"]*)"|`([^`]*)`/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    out.push(raw.replace(/\$\{[^}]*\}/g, '*'));
  }
  return out;
}

/**
 * Does an emitted name cover a subscribed one? Handles the wildcard produced
 * above and the `*`/`**` wildcards EventEmitter2 itself supports.
 */
export function eventMatches(emitted, listened) {
  if (emitted === listened) return true;
  const toRe = (s) => new RegExp('^' + s.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^.]*') + '$');
  if (emitted.includes('*') && toRe(emitted).test(listened)) return true;
  if (listened.includes('*') && toRe(listened).test(emitted)) return true;
  return false;
}

export function eventsHandled(src) {
  const out = [];
  const re = /@OnEvent\(\s*(?:'([^']+)'|"([^"]+)"|`([^`$]+)`)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2] ?? m[3]);
  return dedupe(out);
}

export function cronJobs(src) {
  const out = [];
  const re = /@Cron\(\s*([^)]*)\)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1].replace(/\s+/g, ' ').trim());
  return out;
}

/** Prisma models touched, via `prisma.client.foo` / `prisma.foo` / `tx.foo`. */
export function prismaModels(src) {
  const out = [];
  const re = /\b(?:prisma|tx|client|db)\s*\.\s*(?:client\s*\.\s*)?([a-z][A-Za-z0-9_]*)\s*\.\s*(findFirst|findUnique|findMany|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\b/g;
  let m;
  while ((m = re.exec(src))) out.push({ model: m[1], op: m[2] });
  return out;
}

const WRITE_OPS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
export const isWrite = (op) => WRITE_OPS.has(op);

/**
 * `const basePath = \`/marketplace/businesses/${businessId}\`` — a path prefix
 * held in a local. Components build most of their URLs this way, so without
 * substituting these, every such call normalizes to its tail (`/warehouses`)
 * and looks like a route the server does not serve.
 */
export function localPathConsts(src) {
  const map = new Map();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,80})?=\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)\s*[;,\n]/g;
  let m;
  while ((m = re.exec(src))) {
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    if (val.startsWith('/') || val.includes('${')) map.set(m[1], val);
  }
  // Arrow helpers that return a path, e.g.
  //   const finBase = (businessId: string) => `/finance/businesses/${…}`
  // These are as common as plain consts here and produce whole route families.
  const fn = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,120})?=\s*\([^)]*\)\s*(?::[^=]{0,60})?=>\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g;
  while ((m = fn.exec(src))) {
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    if (val.startsWith('/')) map.set(m[1], val);
  }
  return map;
}

/**
 * Names that denote an ORIGIN (dropping it leaves the real path) rather than a
 * path PREFIX (dropping it leaves a meaningless tail).
 *
 * The first version of this was /(?:API|BASE|URL|ORIGIN|HOST|ENDPOINT)/i, which
 * matches `basePath` — a variable holding `/marketplace/businesses/${id}`.
 * Every call built on it was silently reduced to its tail (`/inventory/summary`)
 * and reported as an endpoint the server does not serve. Nine working calls on
 * one screen, condemned by a substring.
 *
 * So: SCREAMING_SNAKE constants naming a base, or camelCase ending in a word
 * that means "origin". `basePath` ends in Path and is correctly excluded.
 */
const BASE_URL_NAME = /^[A-Z0-9_]*(?:API|BASE|URL|ORIGIN|HOST|ENDPOINT)[A-Z0-9_]*$|(?:Url|URL|Origin|Host|Endpoint|BaseUrl)$/;

/**
 * Substitute a leading `${ident}` from local consts, up to a few hops.
 *
 * Returns whether the leading interpolation was left UNRESOLVED. That matters:
 * `apiGet(\`${basePath}/inventory\`)` where basePath is a React PROP cannot be
 * resolved here, and dropping it yields the fragment `/inventory` — which
 * matches no server route and reads as a broken call, when the real path is
 * `/marketplace/businesses/:id/inventory` and works fine. A fragment is not
 * evidence of a defect, so callers must be able to tell the two apart.
 */
function expandLeading(raw, consts) {
  let s = raw;
  for (let i = 0; i < 4; i++) {
    // `${ident}` or `${helper(args)}` — the call form is how path helpers are used.
    const m = /^\$\{\s*([A-Za-z_$][\w$]*)\s*(\([^{}]*\))?\s*\}/.exec(s);
    if (!m) break;
    const name = m[1];
    if (consts.has(name)) {
      s = consts.get(name) + s.slice(m[0].length);
      continue;
    }
    if (BASE_URL_NAME.test(name)) {
      s = s.slice(m[0].length); // an origin — dropping it yields the real path
      continue;
    }
    return { text: s.slice(m[0].length), unresolved: true };
  }
  return { text: s, unresolved: false };
}

/**
 * API paths the web app requests, as `{ path, fragment }`.
 *
 * `fragment: true` means the leading `${…}` could not be resolved (a prop, an
 * import, a field) so `path` is only the TAIL of the real URL. Such a row can
 * never be matched against server routes and must not be reported as a missing
 * endpoint.
 */
export function webCalls(src) {
  const out = [];
  const consts = localPathConsts(src);
  const add = (raw) => {
    const { text, unresolved } = expandLeading(raw, consts);
    const path = norm(text);
    if (path) out.push({ path, fragment: unresolved });
  };
  // apiGet<T>(`/x/y`) | apiPost({ path: `/x/y` }) | apiFetch("/x")
  // The trailing [A-Za-z]* matters: ./api is imported under aliases —
  // `apiGet as apiGetSimple`, `apiPostSimple` — and client.ts alone calls
  // apiGetSimple 257 times. Anchoring on the bare names measured none of them.
  const re1 = /\bapi(?:Get|Post|Put|Patch|Delete|Fetch)[A-Za-z]*\s*(?:<[^>]*>)?\s*\(\s*\{?\s*(?:path\s*:\s*)?(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g;
  let m;
  while ((m = re1.exec(src))) add(m[1] ?? m[2] ?? m[3]);
  // fetch(`${API_BASE}/x/y`) and friends
  const re2 = /fetch\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g;
  while ((m = re2.exec(src))) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (/^\$\{[^}]*\}\//.test(raw) || raw.startsWith('/')) add(raw);
  }
  const seen = new Set();
  return out.filter((c) => (seen.has(c.path) ? false : seen.add(c.path)));
}

/**
 * Collapse every `${...}` interpolation to `:param`, brace-depth aware so an
 * expression containing braces or a nested template does not end the match
 * early. Must run BEFORE the query string is trimmed: `${a ?? "b"}` contains a
 * `?`, and splitting first truncated the path mid-expression.
 */
export function collapseInterpolations(p) {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '$' && p[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < p.length && depth > 0) {
        if (p[i] === '{') depth++;
        else if (p[i] === '}') depth--;
        if (depth > 0) i++;
      }
      out += ':param';
    } else out += p[i];
  }
  return out;
}

/** Hosts the web app talks to that are not our API. Not defects. */
const EXTERNAL_PREFIXES = [/^\/auth\/v1\//, /^\/rest\/v1\//, /^\/storage\/v1\//, /^\/realtime\/v1\//];
export const isExternalPath = (p) => EXTERNAL_PREFIXES.some((re) => re.test(p));

/** Normalize a template path to a comparable shape: `${x}` -> :param. */
function norm(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return ''; // absolute URL to a third party
  let s = collapseInterpolations(p);
  if (s.startsWith(':param')) s = s.slice(':param'.length); // leading base-url
  s = s.split('?')[0].split('#')[0];
  // An interpolation glued to the end of a segment — `/reviews${query}` — is a
  // query string or suffix, never a path segment of its own. Only a `${…}`
  // that follows a slash is a real path parameter. Without this, every
  // `/x/y${qs}` call was reported as a route the server does not serve.
  s = s.replace(/([^/]):param/g, '$1');
  s = s.replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) return '';
  return s.replace(/\/+$/, '') || '/';
}

/** Same normalization for a Nest route so the two can be compared. */
export function normRoute(p) {
  return (p || '')
    .split('?')[0]
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\/+$/, '') || '/';
}

export const dedupe = (a) => [...new Set(a)];

// ── csv ─────────────────────────────────────────────────────────────────────

export function csv(rows, headers) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  return lines.join('\r\n') + '\r\n';
}

/*
LIMITS — read before trusting a row.

1. Regex, not a type graph. A service injected through a custom provider token,
   or resolved dynamically by string, is not seen. DI edges are therefore a
   lower bound.
2. Route paths are literal-only. A controller whose prefix is built from a
   constant or template is recorded with that template text, not its value.
3. `mounted` is computed from the static @Module import graph reachable from
   AppModule. A module attached at runtime would be reported unmounted.
4. Event names built by concatenation are not captured; the events table is a
   lower bound on both emitters and listeners.
5. Prisma access via a repository wrapper is attributed to the wrapper, not to
   the calling module.
*/
