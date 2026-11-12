/**
 * W11-TRPC-MEMBERSHIP static census: no Business.ownerId arm in a tRPC access
 * predicate (owner rulings D-104, D-116, D-125).
 *
 * D-104 makes Membership the single rule for business access, D-116 makes a
 * recorded owner holding only ADMIN or STAFF that role, and D-125 reads the
 * owner rule as "holds an OWNER membership of this business": the recorded-owner
 * field grants nothing on its own. lib/access.spec.ts proves the two helpers and
 * identity.listBusinesses behave that way; this census keeps the shape from
 * coming back anywhere else under packages/api/src.
 *
 * It flags, in every non-spec .ts file (comments blanked first):
 *
 *   1. an `OR: [...]` whose arms name `ownerId:`      (the "owner OR member" arm)
 *   2. `ownerId: ctx.user...` / `ownerId: userId` at ANY key position of an
 *      object, also through `{ equals: ... }` or `{ in: [...] }`, so
 *      `{ id: businessId, ownerId: ctx.user.id }`, the findUnique compound
 *      `{ id, ownerId: userId }` and `business: { id, ownerId: userId }` on
 *      another model are caught, not only the first-key spelling
 *                                                      (an owner-keyed predicate;
 *                                                      review SEC-W11TM-1 / CR-W11TM-1)
 *   3. `x.ownerId === userId` / `=== ctx.user.id` and the reversed and `!==`
 *      forms                                           (role resolved from ownerId)
 *
 * Contact owner filters are excluded BY RECEIVER. Contact, BusinessInitiative,
 * BusinessRisk and CommandItem carry their own ownerId column (the record's
 * owner, not the business's), so forms 1 and 2 inside a `.contact.findMany(`
 * call (or one of the others) are that record's filter, and form 3 on a
 * receiver named after one of those models is that record's comparison. A
 * match inside a `business: { ... }` relation filter is a Business arm whatever
 * the receiver, a match inside `data: { ... }` is a write payload (createBusiness
 * records Business.ownerId, which D-104 keeps), and a match with no enclosing
 * query call or on an unknown receiver is flagged: the census fails closed.
 *
 * Known limit, stated per gate-vacuity culture: the check is text-local and
 * names the caller as `ctx.user.id` or `userId`. It misses a predicate
 * assembled through a helper in another file; a caller id held under another
 * name, including the shorthand `{ id, ownerId }` over a local `ownerId`
 * variable; a computed key (`[field]: userId`); and a Prisma operator other
 * than `equals` / `in`. The behavioural backstop is lib/access.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname);

/** Models whose own `ownerId` column is the record's owner, not the business's. */
const OWNED_RECORD_MODELS = ['contact', 'businessInitiative', 'businessRisk', 'commandItem'];

const QUERY_METHODS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
];

/** The caller's id, as the routers spell it. */
const CALLER_ID = String.raw`\b(?:ctx\.user\s*(?:\?|!)?\.\s*id|userId)\b`;

interface Finding {
  file: string;
  line: number;
  kind: 'OR arm naming ownerId' | 'ownerId keyed to the caller' | 'ownerId compared with the caller';
  text: string;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Blank out // and block comments, preserving string contents and offsets (the
 * stripComments of no-raw-records.spec.ts): a commented-out arm is not an arm,
 * and line numbers still point at real code.
 */
function stripComments(src: string): string {
  const out = src.split('');
  let state: 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = i + 1 < src.length ? src[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out[i] = out[i + 1] = ' '; i++; continue; }
      if (c === '/' && n === '*') { state = 'block'; out[i] = out[i + 1] = ' '; i++; continue; }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      continue;
    }
    if (state === 'line') { if (c === '\n') state = 'code'; else out[i] = ' '; continue; }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; out[i] = out[i + 1] = ' '; i++; }
      else if (c !== '\n') out[i] = ' ';
      continue;
    }
    if (c === '\\') { i++; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
  }
  return out.join('');
}

/** End offset (exclusive) of the bracketed span opening at `open`, string-aware. */
function spanEnd(src: string, open: number): number {
  let depth = 0;
  let state: 'code' | 'sq' | 'dq' | 'tpl' = 'code';
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (state !== 'code') {
      if (c === '\\') { i++; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
      continue;
    }
    if (c === "'") state = 'sq';
    else if (c === '"') state = 'dq';
    else if (c === '`') state = 'tpl';
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

interface Span {
  start: number;
  end: number;
  model?: string;
}

/** Spans opened by `re`, whose last character must be the opening bracket. */
function spans(src: string, re: RegExp, model?: (m: RegExpExecArray) => string): Span[] {
  const out: Span[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, 'g');
  while ((m = g.exec(src)) !== null) {
    const open = g.lastIndex - 1;
    out.push({ start: open, end: spanEnd(src, open), model: model?.(m) });
  }
  return out;
}

const innermost = (all: Span[], at: number) =>
  all.filter((s) => s.start <= at && at < s.end).sort((a, b) => b.start - a.start)[0];

/** Census one source text: the list of offending matches, by line. */
function census(file: string, raw: string): Finding[] {
  const src = stripComments(raw);
  const lineOf = (at: number) => src.slice(0, at).split('\n').length;
  const textAt = (at: number) => raw.split('\n')[lineOf(at) - 1].trim();

  const calls = spans(src, new RegExp(String.raw`\.(\w+)\s*\.\s*(?:${QUERY_METHODS.join('|')})\s*\(`), (m) => m[1]);
  const businessRelations = spans(src, /\bbusiness\s*:\s*\{/);
  const payloads = spans(src, /\b(?:data|create)\s*:\s*\{/);

  /** Is a predicate match at `at` a Business ownerId arm? (forms 1 and 2) */
  const isBusinessArm = (at: number): boolean => {
    const call = innermost(calls, at);
    const relation = innermost(businessRelations, at);
    if (relation && (!call || relation.start > call.start)) return true; // business: { ... } filter
    const payload = innermost(payloads, at);
    if (payload && (!call || payload.start > call.start)) return false; // a write payload, not a predicate
    if (!call) return true; // built outside any query call: no receiver to excuse it
    return !OWNED_RECORD_MODELS.includes(call.model!); // business or unknown receiver
  };

  const out: Finding[] = [];
  const seen = new Set<string>();
  const push = (at: number, kind: Finding['kind']) => {
    const key = `${lineOf(at)}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ file, line: lineOf(at), kind, text: textAt(at) });
  };

  // Form 1: an OR whose arms name ownerId.
  for (const s of spans(src, /\bOR\s*:\s*\[/)) {
    if (/\bownerId\s*:/.test(src.slice(s.start, s.end)) && isBusinessArm(s.start)) push(s.start, 'OR arm naming ownerId');
  }

  // Form 2: an ownerId key at any position of an object, valued with the
  // caller's id directly or through `{ equals: ... }` / `{ in: [...] }`
  // (D-104; review SEC-W11TM-1 / CR-W11TM-1: the first-key-only spelling let
  // `{ id: businessId, ownerId: ctx.user.id }` through).
  const ownerKey = String.raw`\bownerId['"]?\s*:\s*(?:\{\s*(?:equals\s*:\s*|in\s*:\s*\[\s*(?:[^\]]*,\s*)?))?`;
  for (const m of src.matchAll(new RegExp(ownerKey + CALLER_ID, 'g'))) {
    if (isBusinessArm(m.index!)) push(m.index!, 'ownerId keyed to the caller');
  }

  // Form 3: ownerId compared with the caller's id, either way round.
  const receiverOwned = (receiver: string) => {
    const last = receiver.split(/\??\./).filter(Boolean).pop() ?? '';
    return OWNED_RECORD_MODELS.some((model) => new RegExp(`^${model}s?$`, 'i').test(last));
  };
  const cmp = String.raw`(?:===|!==|==|!=)`;
  const forward = new RegExp(String.raw`([\w$]+(?:\s*\??\.\s*[\w$]+)*)\s*\??\.\s*ownerId\s*${cmp}\s*${CALLER_ID}`, 'g');
  const reverse = new RegExp(String.raw`${CALLER_ID}\s*${cmp}\s*([\w$]+(?:\s*\??\.\s*[\w$]+)*)\s*\??\.\s*ownerId\b`, 'g');
  for (const re of [forward, reverse]) {
    for (const m of src.matchAll(re)) {
      if (!receiverOwned(m[1].replace(/\s+/g, ''))) push(m.index!, 'ownerId compared with the caller');
    }
  }

  return out.sort((a, b) => a.line - b.line);
}

function scan(): { findings: Finding[]; files: string[]; businessCalls: number } {
  const files = tsFiles(SRC);
  const findings: Finding[] = [];
  let businessCalls = 0;
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    const rel = path.relative(SRC, f).split(path.sep).join('/');
    findings.push(...census(rel, raw));
    businessCalls += [...stripComments(raw).matchAll(/\.business\s*\.\s*(?:findUnique|findFirst|findMany)\s*\(/g)].length;
  }
  return { findings, files: files.map((f) => path.relative(SRC, f).split(path.sep).join('/')), businessCalls };
}

const show = (found: Finding[]) => found.map((f) => `${f.file}:${f.line} ${f.kind}: ${f.text}`);

describe('no Business.ownerId arm in a tRPC access predicate (W11-TRPC-MEMBERSHIP, D-104, D-116, D-125)', () => {
  const { findings, files, businessCalls } = scan();

  it('the census saw the surface (anti-vacuity)', () => {
    expect(files.length, 'too few source files: the walk is blind').toBeGreaterThanOrEqual(12);
    expect(files).toEqual(expect.arrayContaining(['lib/access.ts', 'routers/identity.ts']));
    expect(businessCalls, 'no Business reads found at all: the regex is blind, not the code clean').toBeGreaterThanOrEqual(3);
  });

  it('[D-104] no non-spec file under packages/api/src admits or ranks a caller by Business.ownerId', () => {
    expect(
      show(findings),
      'Membership is the single rule (D-104) and the role comes from the membership (D-116, ' +
        'D-125): filter on `members: { some: { userId } }` and read `members[0].role`.',
    ).toEqual([]);
  });

  describe('the census flags the shapes this packet removed and excuses what it must', () => {
    it('[D-104] flags the pre-W11 assertBusinessAccess and listBusinesses OR arms', () => {
      const access = `const b = await ctx.db.business.findFirst({
        where: { id: businessId, OR: [{ ownerId: ctx.user.id }, { members: { some: { userId: ctx.user.id } } }] },
      });`;
      expect(census('x.ts', access).map((f) => f.kind)).toEqual(['OR arm naming ownerId', 'ownerId keyed to the caller']);
      const list = `return ctx.db.business.findMany({
        where: { deletedAt: null, OR: [{ members: { some: { userId } } }, { ownerId: userId }] },
      });`;
      expect(census('x.ts', list).map((f) => f.kind)).toEqual(['OR arm naming ownerId', 'ownerId keyed to the caller']);
    });

    it('[D-116] flags the pre-W11 assertBusinessRole role resolution, either way round', () => {
      expect(census('x.ts', "const role = business.ownerId === userId ? 'OWNER' : business.members[0]?.role;")).toHaveLength(1);
      expect(census('x.ts', 'if (ctx.user?.id !== biz.ownerId) throw new Error();')).toHaveLength(1);
    });

    it('flags a Business ownerId arm reached through a relation filter on another model, and one built outside any call', () => {
      expect(census('x.ts', 'ctx.db.membership.findFirst({ where: { business: { ownerId: userId } } })')).toHaveLength(1);
      expect(census('x.ts', 'ctx.db.supplier.findMany({ where: { business: { id: businessId, ownerId: userId } } })')).toHaveLength(1);
      expect(census('x.ts', 'ctx.db.contact.findMany({ where: { business: { id: businessId, ownerId: ctx.user.id } } })')).toHaveLength(1);
      expect(census('x.ts', 'const where = { OR: [{ ownerId: userId }, { members: { some: { userId } } }] };')).toHaveLength(2);
      expect(census('x.ts', 'const where = { id: businessId, ownerId: ctx.user.id };')).toHaveLength(1);
    });

    it('[D-104] flags an owner-keyed Business predicate at any key position and through equals or in (SEC-W11TM-1, CR-W11TM-1)', () => {
      const kinds = (s: string) => census('x.ts', s).map((f) => f.kind);
      const owner: Finding['kind'][] = ['ownerId keyed to the caller'];
      expect(kinds('ctx.db.business.findFirst({ where: { id: businessId, ownerId: ctx.user.id } })')).toEqual(owner);
      expect(kinds('ctx.db.business.findFirst({ where: { ownerId: ctx.user.id, id: businessId } })')).toEqual(owner);
      expect(kinds('ctx.db.business.findMany({ where: { deletedAt: null, ownerId: userId } })')).toEqual(owner);
      expect(kinds('ctx.db.business.findUnique({ where: { id, ownerId: userId } })')).toEqual(owner);
      expect(kinds('ctx.db.business.update({ where: { id: input.businessId, ownerId: userId }, data: { name } })')).toEqual(owner);
      expect(kinds('ctx.db.business.findFirst({ where: { ownerId: { equals: ctx.user.id } } })')).toEqual(owner);
      expect(kinds('ctx.db.business.findMany({ where: { ownerId: { in: [userId] } } })')).toEqual(owner);
      expect(kinds('ctx.db.business.findFirst({ where: { id, ownerId: ctx.user?.id } })')).toEqual(owner);
      expect(kinds(`ctx.db.business.findFirst({ where: { 'ownerId': userId, id } })`)).toEqual(owner);
      expect(kinds(`ctx.db.business.findFirst({
        where: {
          id: businessId,
          deletedAt: null,
          ownerId:
            ctx.user.id,
        },
      })`)).toEqual(owner);
    });

    it('excuses contact owner filters by receiver', () => {
      const contact = `ctx.db.contact.findMany({
        where: { businessId, OR: [{ ownerId: userId }, { shares: { some: { userId } } }] },
      });`;
      expect(census('x.ts', contact)).toEqual([]);
      expect(census('x.ts', 'if (contact.ownerId === userId) return contact;')).toEqual([]);
      expect(census('x.ts', 'ctx.db.commandItem.findMany({ where: { ownerId: ctx.user.id } })')).toEqual([]);
      expect(census('x.ts', 'ctx.db.contact.findMany({ where: { businessId, ownerId: userId } })')).toEqual([]);
      expect(census('x.ts', 'ctx.db.businessRisk.findMany({ where: { businessId, ownerId: { equals: ctx.user.id } } })')).toEqual([]);
    });

    it('excuses the createBusiness write payload and the membership-only predicates', () => {
      const create = `ctx.db.business.create({
        data: { ownerId: userId, name, members: { create: { userId: ownerId, role: 'OWNER' } } },
      });`;
      expect(census('x.ts', create)).toEqual([]);
      expect(census('x.ts', "ctx.db.business.create({ data: { name, slug, ownerId: userId, members: { create: { userId, role: 'OWNER' } } } })")).toEqual([]);
      expect(census('x.ts', 'ctx.db.business.findFirst({ where: { id: businessId, members: { some: { userId } } } })')).toEqual([]);
      expect(census('x.ts', 'ctx.db.business.findFirst({ where: { id }, select: { ownerId: true } })')).toEqual([]);      expect(census('x.ts', "const role = business.members[0]?.role;")).toEqual([]);
    });

    it('a commented-out arm is not counted', () => {
      expect(census('x.ts', '// where: { OR: [{ ownerId: userId }] }\n/* business.ownerId === userId */')).toEqual([]);
    });
  });
});
