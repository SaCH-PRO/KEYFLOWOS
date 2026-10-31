/**
 * R0-00-WT-ISOLATION: every fixture prefix is registered, unique, and cleaned
 * up with a LIKE pattern that cannot reach another suite's rows.
 *
 * Real-DB suites seed rows whose ids start with a short prefix (`const P =
 * 'rva_'`) and hard-delete them with `... WHERE id LIKE '${P}%'`. Two defects
 * sat in that convention at c2f6f46d:
 *
 *   1. Nothing kept prefixes unique. 'rva_' is declared by both
 *      revenue-authorization.integration.test.ts and
 *      commerce-authorization.e2e.test.ts.
 *   2. In LIKE, '_' matches ANY character. release0-journey cleans up with
 *      `LIKE 'r0_%'`, which also deletes every row of a suite whose prefix is
 *      'r0q_' (release0-journey.integration.test.ts:210-245). Two packets in
 *      parallel would delete each other's fixtures mid-run.
 *
 * apps/server/test/helpers/fixture-prefixes.json is the registry. New prefixes
 * are a 4-character head plus '_' (k<NN><a-z>_ for R0, v<NN><a-z>_ for V1, NN =
 * the packet number), so no registered head is a wildcard-prefix of another.
 * New suites clean up with sqlLikePrefix() (test/helpers/sql-like.js), which
 * escapes '_' and '%' and adds ESCAPE, and embed their prefix in every literal
 * that lands in a globally unique column.
 *
 * Review repair (SEC-R000-2): prefixes were found only as `const P = '...'`, so
 * 'kab_' and 'kas_' (passed straight to buildBoundaryFixture()) were invisible,
 * and a suite could bypass every check by naming its constant PREFIX. The
 * scanner now also reads `const <UPPER_NAME> = '<x>_'` and a prefix-shaped
 * string passed as a call's first argument, and every real-DB suite
 * (*.integration.test.ts) must either own a registered prefix or be listed in
 * noPrefixSuites with a reason, so a form the scanner misses still fails here.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER = join(__dirname, '..', '..', '..');
const REPO = join(SERVER, '..', '..');
const TEST_DIR = join(SERVER, 'test');
const REGISTRY = join(TEST_DIR, 'helpers', 'fixture-prefixes.json');
const SQL_LIKE = join(TEST_DIR, 'helpers', 'sql-like.js');

/**
 * The prefixes in use before R0-00 landed: those at c2f6f46d ('kab_' and
 * 'kas_' among them, which the first scanner missed) plus 'ab_', which R0-05's
 * identity-boundary suite landed on the integration branch (5787c722) while
 * R0-00 was in review. They predate the k/v format and keep their names. This
 * list may shrink (a suite renamed to a new prefix) but never grow: a new suite
 * registers a k<NN><a-z>_ or v<NN><a-z>_ prefix.
 */
const LEGACY = new Set([
  'ab_', 'ainv_', 'cid_', 'cie_', 'cpi_', 'cqv_', 'fcs_', 'kab_', 'kas_', 'pya_',
  'r0_', 'rva_', 't2b_', 't2d_', 't2i1_', 't3_', 't4_', 't6_', 'tca_', 'tcc_',
  'tcd_', 'tcr_', 'tcv_', 'tfw_', 'tgen_', 'tss_', 'zz_credit_', 'zz_ctxv2_',
  'zz_gdpr_', 'zz_ingest_', 'zz_obl_', 'zz_tse_', 'zz_wl_',
]);

const NEW_PREFIX = /^[kv]\d{2}[a-z]_$/;

/** Columns with a global unique index: a literal written there must embed the prefix. */
const UNIQUE_LITERAL_KEYS = ['email', 'slug', 'providerPaymentId', 'token', 'subdomain'];

interface Entry { prefix: string; owner: string; legacy?: boolean; packet?: string }
interface PendingRename { prefix: string; file: string; owner: string; reason: string }
interface NoPrefixSuite { file: string; reason: string }
interface Registry { prefixes: Entry[]; pendingRenames: PendingRename[]; noPrefixSuites: NoPrefixSuite[] }

function rel(file: string): string {
  return file.slice(REPO.length + 1).split(sep).join('/');
}

/** The registry, or an empty one if it does not exist yet (so cases fail on content, not ENOENT). */
function registry(): Registry {
  if (!existsSync(REGISTRY)) return { prefixes: [], pendingRenames: [], noPrefixSuites: [] };
  const raw = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  return { prefixes: raw.prefixes ?? [], pendingRenames: raw.pendingRenames ?? [], noPrefixSuites: raw.noPrefixSuites ?? [] };
}

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules') return [];
    const p = join(dir, e.name);
    if (e.isDirectory()) return testFiles(p);
    return /\.(test|spec)\.ts$/.test(e.name) ? [p] : [];
  });
}

/** A fixture prefix: lower-case head, ending in '_' ('r0_', 'zz_credit_', 'k12a_'). */
const PREFIX_SHAPE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_$/;

/**
 * String and matcher methods whose first argument is a value being inspected,
 * not a prefix being declared (`id.startsWith('r0_')`, `toContain('cid_')`).
 */
const NON_DECLARING_CALLS = new Set([
  'startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf', 'split', 'replace', 'replaceAll',
  'match', 'matchAll', 'search', 'concat', 'padStart', 'padEnd', 'join', 'test',
  'toBe', 'toEqual', 'toStrictEqual', 'toContain', 'toMatch', 'toHaveProperty', 'stringContaining', 'stringMatching',
]);

/**
 * The fixture prefixes a source declares, in any of the forms suites use:
 *   const P = '<anything>'               (the convention; any value)
 *   const <UPPER_NAME> = '<x>_'          (PREFIX, FIXTURE_PREFIX, ...)
 *   <builder>('<x>_', ...)               (buildBoundaryFixture('kab_'))
 */
function prefixesIn(src: string): string[] {
  const out: string[] = [];
  const assigned = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*(?::\s*string\s*)?=\s*(['"`])([^'"`$]+)\2/gm;
  for (const m of src.matchAll(assigned)) {
    if (m[1] === 'P' || PREFIX_SHAPE.test(m[3])) out.push(m[3]);
  }
  const passed = /([A-Za-z_$][\w$]*)\s*\(\s*(['"`])([^'"`$]+)\2\s*[,)]/g;
  for (const m of src.matchAll(passed)) {
    if (PREFIX_SHAPE.test(m[3]) && !NON_DECLARING_CALLS.has(m[1])) out.push(m[3]);
  }
  return [...new Set(out)];
}

/** Every fixture prefix declared under apps/server/test, as { prefix, file }. */
function declarations(): Array<{ prefix: string; file: string }> {
  const out: Array<{ prefix: string; file: string }> = [];
  for (const file of testFiles(TEST_DIR)) {
    for (const prefix of prefixesIn(readFileSync(file, 'utf8'))) out.push({ prefix, file: rel(file) });
  }
  return out;
}

/** The real-DB suites: every *.integration.test.ts under apps/server/test. */
function realDbSuites(): string[] {
  return testFiles(TEST_DIR).filter((f) => f.endsWith('.integration.test.ts')).map(rel);
}

/**
 * The helper modules a suite imports from apps/server/test, transitively, so a
 * cleanup written inside a fixture builder is judged with the suite that calls
 * it. sql-like.js is the escaping helper itself and is not a cleanup.
 */
function helperSources(file: string, seen = new Set<string>()): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
    const base = resolve(dirname(file), m[2]);
    const target = ['', '.js', '.ts', '.mjs', '/index.js', '/index.ts'].map((ext) => base + ext).find((p) => existsSync(p) && statSync(p).isFile());
    if (!target || seen.has(target) || !target.startsWith(TEST_DIR + sep) || target === SQL_LIKE) continue;
    if (/\.(test|spec)\.ts$/.test(target)) continue;
    seen.add(target);
    out.push({ file: target, src: readFileSync(target, 'utf8') }, ...helperSources(target, seen));
  }
  return out;
}

/**
 * Can the UNESCAPED pattern `${a}%` match some string that begins with `b`?
 * '_' matches any one character, '%' any run. Conservative on purpose: if `b`
 * is shorter than `a`, a fixture value `b + suffix` can still be matched.
 */
function unescapedPatternReaches(a: string, b: string): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '%') return true;
    if (i >= b.length) return true;
    if (a[i] !== '_' && a[i] !== b[i]) return false;
  }
  return true;
}

function collisions(prefixes: string[]): string[] {
  const uniq = [...new Set(prefixes)];
  const out: string[] = [];
  for (const a of uniq) {
    for (const b of uniq) {
      if (a !== b && unescapedPatternReaches(a, b)) out.push(`LIKE '${a}%' reaches '${b}'`);
    }
  }
  return out;
}

/** Postgres LIKE semantics as a RegExp. Backslash is the default escape. */
function likeToRegExp(pattern: string, escape = '\\'): RegExp {
  let re = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === escape) {
      i += 1;
      re += (pattern[i] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (c === '%') re += '[\\s\\S]*';
    else if (c === '_') re += '[\\s\\S]';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${re}$`);
}

/** Parse the SQL fragment sqlLikePrefix() returns: `'<pattern>' ESCAPE '<c>'`. */
function parseLikeFragment(fragment: string): RegExp {
  const m = /^'((?:[^']|'')*)' ESCAPE '(.)'$/.exec(fragment);
  if (!m) throw new Error(`not a LIKE fragment with ESCAPE: ${fragment}`);
  return likeToRegExp(m[1].replace(/''/g, "'"), m[2]);
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

/** Every LIKE in a suite's source not immediately built by sqlLikePrefix(). */
function likeWithoutHelper(src: string): number[] {
  const lines: number[] = [];
  for (const m of src.matchAll(/\bI?LIKE\b/g)) {
    const after = src.slice((m.index ?? 0) + m[0].length);
    if (!/^\s*\$\{\s*sqlLikePrefix\(/.test(after)) lines.push(lineOf(src, m.index ?? 0));
  }
  return lines;
}

/** Literal values for globally unique columns that do not embed the prefix. */
function uniqueLiteralsWithoutPrefix(src: string, prefix: string): string[] {
  const re = new RegExp(`\\b(${UNIQUE_LITERAL_KEYS.join('|')})\\s*:\\s*(['"\`])((?:\\\\.|(?!\\2)[^\\\\])*)\\2`, 'g');
  const out: string[] = [];
  for (const m of src.matchAll(re)) {
    const value = m[3];
    if (value.includes('${P}') || value.includes(prefix)) continue;
    out.push(`line ${lineOf(src, m.index ?? 0)}: ${m[1]}: ${m[2]}${value}${m[2]}`);
  }
  return out;
}

async function sqlLike(): Promise<{ sqlLikePrefix: (p: string) => string; escapeLikePattern: (v: string) => string }> {
  return import(SQL_LIKE);
}

describe('fixture prefixes are registered and unique (R0-00)', () => {
  it('finds the declarations and the registry: this gate is not vacuous', () => {
    expect(declarations().length, '`const P = ...` declarations not being found').toBeGreaterThan(25);
    expect(registry().prefixes.length, 'apps/server/test/helpers/fixture-prefixes.json is missing or empty').toBeGreaterThan(25);
  });

  it('no prefix is declared by two files, except a ledgered pending rename', () => {
    const byPrefix = new Map<string, string[]>();
    for (const d of declarations()) byPrefix.set(d.prefix, [...(byPrefix.get(d.prefix) ?? []), d.file]);
    const duplicates = [...byPrefix.entries()].filter(([, files]) => files.length > 1);

    const ledger = registry().pendingRenames;
    const unledgered = duplicates
      .map(([prefix, files]) => ({ prefix, files: files.filter((f) => !ledger.some((l) => l.prefix === prefix && l.file === f)) }))
      .filter(({ files }) => files.length > 1)
      .map(({ prefix, files }) => `${prefix}: ${files.join(', ')}`);
    expect(
      unledgered,
      'two suites declare the same fixture prefix, so each one\'s cleanup deletes the other\'s rows. ' +
        'Register one owner in fixture-prefixes.json and rename the other suite to a new k<NN><a-z>_ / v<NN><a-z>_ prefix.',
    ).toEqual([]);

    // Ratchet: a ledger entry that no longer describes a real duplicate must be deleted.
    for (const l of ledger) {
      expect(byPrefix.get(l.prefix) ?? [], `stale pendingRenames entry for ${l.prefix} in ${l.file}`).toContain(l.file);
      expect(byPrefix.get(l.prefix) ?? [], `pendingRenames owner ${l.owner} no longer declares ${l.prefix}`).toContain(l.owner);
    }
  });

  it.todo(
    "commerce-authorization.e2e.test.ts renames its 'rva_' prefix to a new k<NN><a-z>_ prefix and the pendingRenames entry is deleted " +
      '(outside the R0-00 write set; owed by the next packet that writes that file, R0-27 or R0-28)',
  );

  it('every declared prefix is registered to the file that declares it', () => {
    const entries = registry().prefixes;
    const ledger = registry().pendingRenames;
    const problems: string[] = [];
    for (const d of declarations()) {
      if (ledger.some((l) => l.prefix === d.prefix && l.file === d.file)) continue;
      const e = entries.find((x) => x.prefix === d.prefix);
      if (!e) problems.push(`${d.prefix} (${d.file}) is not registered`);
      else if (e.owner !== d.file) problems.push(`${d.prefix} is registered to ${e.owner} but declared by ${d.file}`);
    }
    expect(problems, 'add the suite to apps/server/test/helpers/fixture-prefixes.json').toEqual([]);
  });

  it('every real-DB suite owns a registered prefix or is listed in noPrefixSuites with a reason (SEC-R000-2)', () => {
    // The backstop for any declaration form the scanner does not read: a new
    // *.integration.test.ts fails here until it is registered, whatever it
    // calls its prefix.
    const { prefixes, noPrefixSuites } = registry();
    const owners = new Set(prefixes.map((e) => e.owner));
    const exempt = new Map(noPrefixSuites.map((s) => [s.file, s.reason]));
    const problems: string[] = [];
    for (const suite of realDbSuites()) {
      if (owners.has(suite)) continue;
      if (!exempt.has(suite)) problems.push(`${suite} owns no registered prefix and is not in noPrefixSuites`);
      else if (!String(exempt.get(suite) ?? '').trim()) problems.push(`${suite}: noPrefixSuites entry has no reason`);
    }
    expect(problems, 'register the suite\'s prefix in apps/server/test/helpers/fixture-prefixes.json').toEqual([]);
  });

  it('a noPrefixSuites entry exists, is a real-DB suite, and declares no prefix', () => {
    const suites = new Set(realDbSuites());
    const declared = declarations();
    const owners = new Set(registry().prefixes.map((e) => e.owner));
    const problems: string[] = [];
    for (const { file } of registry().noPrefixSuites) {
      if (!suites.has(file)) problems.push(`${file} is not an existing *.integration.test.ts`);
      if (owners.has(file)) problems.push(`${file} owns a registered prefix; remove it from noPrefixSuites`);
      for (const d of declared.filter((x) => x.file === file)) problems.push(`${file} declares ${d.prefix}; register it`);
    }
    expect(problems).toEqual([]);
  });

  it('the scanner reads every declaration form suites use (self-test)', () => {
    // The review probe: none of these were seen by the `const P` scan.
    expect(prefixesIn("const P = 'cid_';")).toEqual(['cid_']);
    expect(prefixesIn("const PREFIX = 'r0q_';")).toEqual(['r0q_']);
    expect(prefixesIn("export const FIXTURE_PREFIX: string = 'k12a_';")).toEqual(['k12a_']);
    expect(prefixesIn("fx = await buildBoundaryFixture('kab_');")).toEqual(['kab_']);
    expect(prefixesIn('const w = makeWorld("zz_probe_", { seed: 1 });')).toEqual(['zz_probe_']);
    // Values inspected, not declared, and identifiers that are not prefixes.
    expect(prefixesIn("expect(id.startsWith('r0_')).toBe(true); expect(ids).toContain('cid_');")).toEqual([]);
    expect(prefixesIn("const CANARY = 'CID_SECRET_'; const HEADER = 'x-cid-user'; createId('thread');")).toEqual([]);
    expect(prefixesIn('const label = `${P}owner`;')).toEqual([]);
  });

  it('every registry entry is unique, has an existing owner, and that owner declares it', () => {
    const entries = registry().prefixes;
    const seen = new Set<string>();
    const problems: string[] = [];
    const declared = declarations();
    for (const e of entries) {
      if (seen.has(e.prefix)) problems.push(`${e.prefix} registered twice`);
      seen.add(e.prefix);
      if (!existsSync(join(REPO, e.owner))) problems.push(`${e.prefix}: owner ${e.owner} does not exist`);
      else if (!declared.some((d) => d.prefix === e.prefix && d.file === e.owner)) problems.push(`${e.prefix}: ${e.owner} does not declare it`);
    }
    expect(problems).toEqual([]);
  });

  it('every new prefix is a 4-character head plus "_" (k<NN><a-z>_ or v<NN><a-z>_); the legacy set only shrinks', () => {
    const problems: string[] = [];
    for (const e of registry().prefixes) {
      if (e.legacy) {
        if (!LEGACY.has(e.prefix)) problems.push(`${e.prefix} claims legacy but was not in use at c2f6f46d`);
      } else if (!NEW_PREFIX.test(e.prefix)) {
        problems.push(`${e.prefix} is not k<NN><a-z>_ or v<NN><a-z>_`);
      } else if (e.packet && !new RegExp(`^${e.prefix[0] === 'k' ? 'R0' : 'V1'}-${e.prefix.slice(1, 3)}\\b`).test(e.packet)) {
        problems.push(`${e.prefix}: NN does not match packet ${e.packet}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('cleanup LIKE patterns cannot reach another suite (R0-00)', () => {
  it("characterizes the hazard: the journey's LIKE 'r0_%' deletes a probe suite's 'r0q_' rows", () => {
    // '_' is a wildcard. This is the defect, pinned so the checker below is
    // known to see it.
    expect(likeToRegExp('r0_%').test('r0q_owner')).toBe(true);
    expect(collisions([...declarations().map((d) => d.prefix), 'r0q_'])).toContain("LIKE 'r0_%' reaches 'r0q_'");
  });

  it('no registered or declared prefix is reached by another prefix\'s unescaped LIKE pattern', () => {
    const all = [...registry().prefixes.map((e) => e.prefix), ...declarations().map((d) => d.prefix)];
    expect(
      collisions(all),
      "a suite's `LIKE '<prefix>%'` cleanup would delete another suite's rows ('_' matches any character)",
    ).toEqual([]);
  });

  it('sqlLikePrefix() escapes "_" and "%", adds ESCAPE, and matches only its own prefix', async () => {
    const { sqlLikePrefix } = await sqlLike();
    expect(sqlLikePrefix('r0_')).toBe("'r0\\_%' ESCAPE '\\'");
    const r0 = parseLikeFragment(sqlLikePrefix('r0_'));
    expect(r0.test('r0_owner')).toBe(true);
    expect(r0.test('r0q_owner'), "escaped 'r0_' still reaches 'r0q_'").toBe(false);

    const pct = parseLikeFragment(sqlLikePrefix('a%b_'));
    expect(pct.test('a%b_x')).toBe(true);
    expect(pct.test('aXXb_x')).toBe(false);

    expect(() => sqlLikePrefix("x'; DROP TABLE users; --")).toThrow();
    expect(() => sqlLikePrefix('')).toThrow();
  });

  it('a new suite cleans up with sqlLikePrefix(), never a hand-written LIKE, in its own file or a helper it imports', () => {
    // A legacy builder such as key-action-boundary.fixture.js cleans up with
    // `LIKE '${P}%'`; a new suite that hands it a prefix inherits that hazard.
    const problems: string[] = [];
    for (const e of registry().prefixes.filter((x) => !x.legacy)) {
      const owner = join(REPO, e.owner);
      for (const { file, src } of [{ file: owner, src: readFileSync(owner, 'utf8') }, ...helperSources(owner)]) {
        for (const line of likeWithoutHelper(src)) problems.push(`${e.owner} -> ${rel(file)}:${line}`);
      }
    }
    expect(problems, "use `LIKE ${sqlLikePrefix(P)}` from test/helpers/sql-like.js").toEqual([]);
  });

  it('the helper walk reaches a legacy fixture builder with a hand-written LIKE (self-test)', () => {
    const suite = join(TEST_DIR, 'key-action-boundary.integration.test.ts');
    const helpers = helperSources(suite).map((h) => rel(h.file));
    expect(helpers).toContain('apps/server/test/helpers/key-action-boundary.fixture.js');
    const builder = helperSources(suite).find((h) => h.file.endsWith('key-action-boundary.fixture.js'));
    expect(likeWithoutHelper(builder?.src ?? '').length).toBeGreaterThan(0);
  });

  it('a new suite embeds its prefix in every literal it writes to a globally unique column', () => {
    const problems: string[] = [];
    for (const e of registry().prefixes.filter((x) => !x.legacy)) {
      const src = readFileSync(join(REPO, e.owner), 'utf8');
      for (const p of uniqueLiteralsWithoutPrefix(src, e.prefix)) problems.push(`${e.owner} ${p}`);
    }
    expect(
      problems,
      'User.email, Business.slug, Payment.providerPaymentId, PaymentLink.token and Site.subdomain are unique ' +
        'across the whole database: a literal shared by two suites collides when they run in parallel',
    ).toEqual([]);
  });

  it('the two new-suite checkers flag what they should and pass what they should (self-test)', () => {
    // Synthetic sources, so the checks above are known to bite before any new suite exists.
    const handWritten = "await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE '${P}%'`);";
    const helper = 'await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);';
    const ilike = "await db.$executeRawUnsafe(`DELETE FROM users WHERE email ILIKE 'k12a%'`);";
    expect(likeWithoutHelper(handWritten)).toEqual([1]);
    expect(likeWithoutHelper(helper)).toEqual([]);
    expect(likeWithoutHelper(ilike)).toEqual([1]);

    expect(uniqueLiteralsWithoutPrefix("{ email: 'owner@test.local' }", 'k12a_')).toHaveLength(1);
    expect(uniqueLiteralsWithoutPrefix("{ slug: 'shop' }", 'k12a_')).toHaveLength(1);
    expect(uniqueLiteralsWithoutPrefix("{ providerPaymentId: \"pi_1\" }", 'k12a_')).toHaveLength(1);
    expect(uniqueLiteralsWithoutPrefix('{ email: `${P}owner@test.local` }', 'k12a_')).toEqual([]);
    expect(uniqueLiteralsWithoutPrefix("{ token: 'k12a_tok', subdomain: 'k12a_site' }", 'k12a_')).toEqual([]);
  });
});
