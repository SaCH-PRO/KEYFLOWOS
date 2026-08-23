/**
 * No raw records with secret fields across the tRPC boundary.
 *
 * social.listConnections took a client-supplied businessId and returned raw
 * SocialConnection rows — and because the token-encryption extension DECRYPTS
 * on read, "raw" meant live Facebook/Instagram/LinkedIn/Twitter tokens. The
 * only thing that prevented shipping it was the broken /trpc mount
 * (architecture/VERIFIED_STATE_2026-08-11.md § "The tRPC surface is mounted
 * but unreachable"). The fix added an explicit `select:`; this gate makes the
 * pattern load-bearing for every procedure.
 *
 * Rule: any query on a model the encryption extension covers (business,
 * socialConnection, channelConnection, webhook — their read results contain
 * DECRYPTED secrets) must carry an explicit `select:` in the same call
 * expression, or be acknowledged in RAW_RECORD_DEBT below.
 *
 * Known limit, stated per gate-vacuity culture: the check is call-expression-
 * local. A wrapper helper that hides the query behind another function
 * escapes it; the runtime backstop is the server-side disclosure attack
 * tests. The ledger is shrink-only: entries leave when the call gains a
 * select (or the code is deleted), and a NEW select-less call arrives as a
 * failing test, not a silent leak.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PKG = path.resolve(__dirname, '..');
const SRC = path.join(PKG, 'src');

// Models whose read results the token-encryption extension decrypts.
const SECRET_MODELS = ['business', 'socialConnection', 'channelConnection', 'webhook'];
const METHODS = ['findUnique', 'findFirst', 'findMany', 'create', 'update', 'upsert'];

/**
 * Acknowledged select-less calls on secret models. A DEBT LEDGER, not an
 * allowlist — each returns fully-decrypted records past the router boundary
 * and is tolerable only while the /trpc mount stays broken. Shrink by adding
 * a `select:`; never add an entry without saying what stands in for it.
 * Key: <file>#<model>.<method>#<ordinal among that file's offenders>.
 */
const RAW_RECORD_DEBT = new Set<string>([
  // assertBusinessAccess returns the full Business (16 token columns,
  // decrypted) to callers that only need to know "yes/no".
  'lib/access.ts#business.findFirst#0',
  // listBusinesses ships every OAuth token the owner has connected to the
  // browser; createBusiness echoes the created row the same way.
  'routers/identity.ts#business.findMany#0',
  'routers/identity.ts#business.create#0',
]);

interface CallSite {
  key: string;
  file: string;
  model: string;
  method: string;
  hasSelect: boolean;
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
 * Blank out // and block comments, preserving string contents and byte
 * offsets (comments become spaces, not deletions). Without this, a
 * commented-out `select:` inside a call's argument span reads as a real
 * select — silently acknowledging a leak in the gate built to catch leaks —
 * and a commented-out query invents a phantom call site. Offsets are
 * preserved so the model/method regex still points at real code.
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
    // inside a string literal
    if (c === '\\') { i++; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
  }
  return out.join('');
}

/** Capture a call's argument span by depth counting, string-aware. */
function argSpan(src: string, openParen: number): string {
  let depth = 0;
  let state: 'code' | 'sq' | 'dq' | 'tpl' = 'code';
  for (let i = openParen; i < src.length; i++) {
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
      if (depth === 0) return src.slice(openParen, i + 1);
    }
  }
  return src.slice(openParen);
}

function scan(): { sites: CallSite[]; filesScanned: number } {
  const sites: CallSite[] = [];
  const files = tsFiles(SRC);
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    const rel = path.relative(SRC, f).split(path.sep).join('/');
    const offendersPerKey: Record<string, number> = {};
    const re = new RegExp(`\\.(${SECRET_MODELS.join('|')})\\.(${METHODS.join('|')})\\s*\\(`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const [, model, method] = m;
      const span = argSpan(src, re.lastIndex - 1);
      const hasSelect = /\bselect\s*:/.test(span);
      const base = `${rel}#${model}.${method}`;
      let key = '';
      if (!hasSelect) {
        const n = offendersPerKey[base] ?? 0;
        offendersPerKey[base] = n + 1;
        key = `${base}#${n}`;
      }
      sites.push({ key, file: rel, model, method, hasSelect });
    }
  }
  return { sites, filesScanned: files.length };
}

describe('no raw secret-model records cross the tRPC boundary', () => {
  const { sites, filesScanned } = scan();

  it('the scanner saw the surface (anti-vacuity)', () => {
    // 12 routers + root + trpc + lib. A router that vanishes from this floor
    // is a restructure someone should look at, not a quiet green.
    expect(filesScanned).toBeGreaterThanOrEqual(12);
    expect(
      sites.length,
      'no queries on secret models found at all — the regex is blind, not the code clean',
    ).toBeGreaterThanOrEqual(3);
  });

  it('every select-less call on a secret model is acknowledged — no new ones', () => {
    const offenders = sites.filter((s) => !s.hasSelect);
    const unacknowledged = offenders.filter((s) => !RAW_RECORD_DEBT.has(s.key));
    expect(
      unacknowledged.map((s) => s.key),
      'these return fully-decrypted records past the router boundary. Add an explicit ' +
        '`select:` naming what the caller needs — the social.listConnections fix is the model.',
    ).toEqual([]);
  });

  it('the ledger names no ghosts — a call that gained a select leaves the debt', () => {
    const offenderKeys = new Set(sites.filter((s) => !s.hasSelect).map((s) => s.key));
    const stale = [...RAW_RECORD_DEBT].filter((k) => !offenderKeys.has(k));
    expect(
      stale,
      'acknowledged entries that are no longer select-less (fixed or deleted) — remove them ' +
        'so the ledger keeps meaning what it says',
    ).toEqual([]);
  });

  it('a commented-out select: does not satisfy the gate (comment-strip control)', () => {
    // The masked-leak case: a select-less query whose only `select:` sits in a
    // comment. Before stripComments this read as covered. detect() reproduces
    // scan()'s per-call logic on a synthetic source.
    const detect = (call: string) => {
      const clean = stripComments(call);
      const re = /\.(socialConnection)\.(findMany)\s*\(/g;
      const m = re.exec(clean)!;
      return /\bselect\s*:/.test(argSpan(clean, re.lastIndex - 1));
    };
    expect(detect('ctx.db.socialConnection.findMany({ where: { businessId } })')).toBe(false);
    expect(detect('ctx.db.socialConnection.findMany({ /* select: {id:true} later */ where: { businessId } })')).toBe(false);
    expect(detect('ctx.db.socialConnection.findMany({ where: { businessId }, // select: pending\n })')).toBe(false);
    // A real select still passes — the control must not over-correct.
    expect(detect('ctx.db.socialConnection.findMany({ select: { id: true }, where: { businessId } })')).toBe(true);
  });

  it('a commented-out query is not counted as a call site', () => {
    const clean = stripComments('// const x = ctx.db.business.findMany({ where: {} })');
    expect(/\.business\.findMany\s*\(/.test(clean)).toBe(false);
  });
});
