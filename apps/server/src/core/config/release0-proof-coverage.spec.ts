/**
 * R0-35-EXIT-PROOF: the Release 0 exit proof is complete.
 *
 * BUILD-MAP-001 section (d), "R0 exit gate": every Release 0 server suite is
 * bound by a K12 case manifest (scripts/proof-admission/manifests/*.json,
 * judged by scripts/proof-admission/run-manifests.mjs), and `proof:release0` is
 * green at the exact head with zero unexplained skips. A green aggregate run
 * cannot show either: a suite nobody bound, or a case parked as it.todo, leaves
 * every manifest SATISFIED.
 *
 * scripts/proof-admission/release0-index.json is the record this spec checks:
 *
 *   packets    every R0 row of BUILD-MAP section (c), each with the server
 *              suites its own records name (the queue's tests_first, the files
 *              its branches created, the suites of manifests whose packageId
 *              names it or an R0 follow-up landed under it). A web-only packet
 *              says so in noServerSuite.
 *   suites     every Release 0 server suite (path relative to apps/server) and
 *              the Release 0 manifests that bind it.
 *   manifests  the Release 0 manifests: the ones proof:release0 runs.
 *   journey    issue #186's seven steps (BUILD-MAP section (b)), each with its
 *              case prefix in release0-journey.json.
 *   explained  every it.skip / it.todo / describe.skip (and skipIf, runIf,
 *              fails, x-forms) in a Release 0 suite, with its reason and the
 *              packet or ruling that owns it.
 *   editedOnly suites an R0 packet edited but neither created nor declared:
 *              they stay with the packet that created them.
 *
 * It fails when a Release 0 suite is not bound, when a manifest names a suite
 * that does not exist, when a Release 0 suite has a skip or todo the index does
 * not explain, and when the index names a packet BUILD-MAP does not list (or
 * misses one it lists). An explained entry that is no longer in its suite is
 * REPORTED, not failed, so a later packet can close a todo without touching
 * this index first.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const SERVER = join(__dirname, '..', '..', '..');
const REPO = join(SERVER, '..', '..');
const PROOF_DIR = join(REPO, 'scripts', 'proof-admission');
const MANIFESTS_DIR = join(PROOF_DIR, 'manifests');
const INDEX_PATH = join(PROOF_DIR, 'release0-index.json');
const BUILD_MAP = join(REPO, 'docs', 'reconstruction', 'BUILD-MAP-001.md');
const BUILD_QUEUE = join(REPO, 'docs', 'reconstruction', 'BUILD-QUEUE-001.json');
const SERVER_PACKAGE = join(SERVER, 'package.json');
const CI_WORKFLOW = join(REPO, '.github', 'workflows', 'ci-cd.yml');
const THIS_SPEC = 'src/core/config/release0-proof-coverage.spec.ts';

// ---------------------------------------------------------------------------
// The skip scanner.
// ---------------------------------------------------------------------------

export type SkipCall = { kind: string; title: string | null; line: number };

const REGEX_BEFORE = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/;

/**
 * The source with every comment, string, template-literal text and regex
 * literal body replaced by spaces (newlines kept, so offsets and line numbers
 * stay the same). A skip named in a comment or inside a test title ("... was
 * it.todo") is then not a skip.
 */
export function blankNonCode(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  // Mode stack: 'code' (with a brace depth when inside a template ${...}) or 'tmpl'.
  const stack: Array<{ mode: 'code' | 'tmpl'; depth: number }> = [{ mode: 'code', depth: 0 }];
  let lastCode = '';
  let lastWord = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = source[i];
    if (top.mode === 'tmpl') {
      if (c === '\\') {
        blank(i, Math.min(i + 2, n));
        i += 2;
      } else if (c === '`') {
        stack.pop();
        lastCode = '`';
        i += 1;
      } else if (c === '$' && source[i + 1] === '{') {
        stack.push({ mode: 'code', depth: 0 });
        lastCode = '{';
        i += 2;
      } else {
        blank(i, i + 1);
        i += 1;
      }
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      lastCode = c;
      lastWord = '';
      continue;
    }
    if (c === '`') {
      stack.push({ mode: 'tmpl', depth: 0 });
      i += 1;
      continue;
    }
    if (c === '/' && (lastCode === '' || REGEX_BEFORE.has(lastCode) || REGEX_KEYWORDS.test(lastWord))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n') {
        const d = source[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j += 1;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      lastCode = '/';
      lastWord = '';
      continue;
    }
    if (c === '{') top.depth += 1;
    if (c === '}') {
      if (stack.length > 1 && top.depth === 0) {
        stack.pop();
        i += 1;
        continue;
      }
      top.depth -= 1;
    }
    if (!/\s/.test(c)) {
      lastCode = c;
      lastWord = /[\w$]/.test(c) ? (/[\w$]$/.test(lastWord) ? lastWord + c : c) : '';
    }
    i += 1;
  }
  return out.join('');
}

function readStringLiteral(source: string, at: number): { value: string; end: number } | null {
  const q = source[at];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let j = at + 1;
  let raw = '';
  while (j < source.length && source[j] !== q) {
    if (source[j] === '\\') {
      raw += source.slice(j, j + 2);
      j += 2;
      continue;
    }
    raw += source[j];
    j += 1;
  }
  const value = raw.replace(/\\(.)/gs, (_m, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
  return { value, end: j + 1 };
}

/** The title argument starting at `at`: string literals joined by `+`, or null when it is not one. */
function readTitle(source: string, at: number): string | null {
  let i = at;
  const skipWs = () => {
    while (i < source.length && /\s/.test(source[i])) i += 1;
  };
  skipWs();
  let title = '';
  let first = true;
  for (;;) {
    const lit = readStringLiteral(source, i);
    if (!lit) return first ? null : title;
    title += lit.value;
    first = false;
    i = lit.end;
    skipWs();
    if (source[i] !== '+') return title;
    i += 1;
    skipWs();
  }
}

/** The index just past the parenthesis that closes the one at `open` (in blanked code). */
function closeParen(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k += 1) {
    if (code[k] === '(') depth += 1;
    else if (code[k] === ')') {
      depth -= 1;
      if (depth === 0) return k + 1;
    }
  }
  return code.length;
}

const SKIP_PATTERN = /(?<![\w$.])(?:(it|test|describe|suite)\s*\.\s*(skip|todo|skipIf|runIf|only|fails)|(xit|xdescribe|xtest))(?![\w$])/g;

/** Every skip-like call in a test file: it/test/describe/suite .skip .todo .skipIf .runIf .only .fails, and xit/xdescribe/xtest. */
export function findSkipCalls(source: string): SkipCall[] {
  const code = blankNonCode(source);
  const found: SkipCall[] = [];
  for (const m of code.matchAll(SKIP_PATTERN)) {
    const kind = m[3] ?? `${m[1]}.${m[2]}`;
    let i = (m.index ?? 0) + m[0].length;
    const skipWs = () => {
      while (i < code.length && /\s/.test(code[i])) i += 1;
    };
    skipWs();
    let title: string | null = null;
    if (code[i] === '(') {
      if (m[2] === 'skipIf' || m[2] === 'runIf') {
        i = closeParen(code, i);
        skipWs();
        if (code[i] === '(') title = readTitle(source, i + 1);
      } else {
        title = readTitle(source, i + 1);
      }
    }
    const line = source.slice(0, m.index ?? 0).split('\n').length;
    found.push({ kind, title: title === null ? null : normalize(title), line });
  }
  return found;
}

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// The records.
// ---------------------------------------------------------------------------

type IndexSuiteRef = { path: string; via?: string };
type IndexPacket = {
  id: string;
  suites: IndexSuiteRef[];
  noServerSuite?: string;
  queueSuitesLandedAs?: Array<{ planned: string; landedAs: string; evidence: string }>;
};
type Explained = { suite: string; kind: string; titleStartsWith: string; reason: string; owner: string };
type Release0Index = {
  indexVersion: number;
  packetId: string;
  manifests: string[];
  suites: Record<string, { manifests: string[] }>;
  packets: IndexPacket[];
  journey: {
    suite: string;
    manifest: string;
    steps: Array<{ step: number; title: string; casePrefix: string }>;
  };
  explained: Explained[];
  editedOnly: Array<{ suite: string; editedBy: string[]; createdBy: string }>;
};

type Manifest = Record<string, unknown> & { packageId?: string; requiredCases?: string[] };
type LoadedManifest = { file: string; manifest: Manifest; type: string; suites: string[] };

function loadIndex(): Release0Index {
  if (!existsSync(INDEX_PATH)) {
    throw new Error(`${INDEX_PATH} does not exist: R0-35-EXIT-PROOF has not indexed the Release 0 suites`);
  }
  return JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as Release0Index;
}

/** The R0 rows of BUILD-MAP section (c), the ordered packet queue. */
function buildMapR0Packets(): string[] {
  const text = readFileSync(BUILD_MAP, 'utf8');
  const start = text.indexOf('## (c) Ordered packet queue');
  const end = text.indexOf('## (d)', start);
  expect(start, 'BUILD-MAP section (c) not found').toBeGreaterThan(-1);
  const ids: string[] = [];
  for (const line of text.slice(start, end).split('\n')) {
    const row = /^\|\s*\d+\s*\|\s*`([A-Za-z0-9-]+)`\s*\|[^|]*\|\s*(R0|V1)\s*\|/.exec(line);
    if (row && row[2] === 'R0') ids.push(row[1]);
  }
  return ids;
}

/** The step numbers of BUILD-MAP section (b), the Release 0 journey table. */
function buildMapJourneySteps(): number[] {
  const text = readFileSync(BUILD_MAP, 'utf8');
  const start = text.indexOf('## (b) Release 0 journey status');
  const end = text.indexOf('## (c)', start);
  expect(start, 'BUILD-MAP section (b) not found').toBeGreaterThan(-1);
  const steps: number[] = [];
  for (const line of text.slice(start, end).split('\n')) {
    const row = /^\|\s*([0-9]+)\s*\|/.exec(line);
    if (row) steps.push(Number(row[1]));
  }
  return steps;
}

const SERVER_SUITE = /^apps\/server\/((?:test\/.+\.test\.ts)|(?:src\/.+\.spec\.ts))$/;

/** Each R0 queue entry's tests_first server suites (paths relative to apps/server). */
function queueTestsFirst(): Map<string, string[]> {
  const queue = JSON.parse(readFileSync(BUILD_QUEUE, 'utf8')) as Array<{ id: string; tests_first?: string[] }>;
  const out = new Map<string, string[]>();
  for (const entry of queue) {
    if (!String(entry.id).startsWith('R0-')) continue;
    const suites = (entry.tests_first ?? [])
      .map((f) => SERVER_SUITE.exec(f)?.[1])
      .filter((s): s is string => typeof s === 'string');
    out.set(entry.id, suites);
  }
  return out;
}

let manifestSuites: (m: unknown) => { suites?: Array<{ path: string }>; error?: string };
let classify: (m: unknown) => string;

beforeAll(async () => {
  ({ manifestSuites } = (await import(pathToFileURL(join(PROOF_DIR, 'evaluate.mjs')).href)) as {
    manifestSuites: typeof manifestSuites;
  });
  ({ classify } = (await import(pathToFileURL(join(PROOF_DIR, 'run-manifests.mjs')).href)) as {
    classify: typeof classify;
  });
});

/** Every manifest in the directory, typed as run-manifests.mjs types it, with the suites evaluate.mjs says it binds. */
function loadManifests(): LoadedManifest[] {
  return readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const manifest = JSON.parse(readFileSync(join(MANIFESTS_DIR, file), 'utf8')) as Manifest;
      const type = classify(manifest);
      const bound = type === 'case' || type === 'negative-controls' ? manifestSuites(manifest) : { suites: [] };
      return { file, manifest, type, suites: (bound.suites ?? []).map((s) => s.path) };
    });
}

const isRelease0PackageId = (id: unknown) => typeof id === 'string' && id.startsWith('R0-');

function release0SuiteSet(index: Release0Index): Set<string> {
  return new Set(Object.keys(index.suites));
}

function skipsBySuite(index: Release0Index): Map<string, SkipCall[]> {
  const out = new Map<string, SkipCall[]>();
  for (const suite of Object.keys(index.suites).sort()) {
    const path = join(SERVER, suite);
    if (!existsSync(path)) continue; // [R035-03] reports it
    out.set(suite, findSkipCalls(readFileSync(path, 'utf8')));
  }
  return out;
}

/** Which explanation covers a skip (by suite, kind and title prefix), or none. */
function matchExplanations(index: Release0Index) {
  const skips = skipsBySuite(index);
  const unexplained: Array<{ suite: string } & SkipCall> = [];
  const ambiguous: Array<{ suite: string; title: string | null; matches: number }> = [];
  const used = new Set<number>();
  for (const [suite, calls] of skips) {
    for (const call of calls) {
      const matches = index.explained
        .map((e, k) => ({ e, k }))
        .filter(
          ({ e }) =>
            e.suite === suite &&
            e.kind === call.kind &&
            (call.title === null ? e.titleStartsWith === '<dynamic>' : call.title.startsWith(normalize(e.titleStartsWith))),
        );
      if (matches.length === 0) unexplained.push({ suite, ...call });
      if (matches.length > 1) ambiguous.push({ suite, title: call.title, matches: matches.length });
      for (const { k } of matches) used.add(k);
    }
  }
  const stale = index.explained.filter((_e, k) => !used.has(k));
  return { skips, unexplained, ambiguous, stale };
}

// ---------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------

describe('R0-35-EXIT-PROOF release0-index.json binds every Release 0 server suite', () => {
  it('[R035-01] the index lists every R0 packet of BUILD-MAP section (c) exactly once and names no packet BUILD-MAP does not list', () => {
    const index = loadIndex();
    const listed = buildMapR0Packets();
    expect(listed.length, 'BUILD-MAP section (c) lists the R0 rows').toBeGreaterThan(0);
    const named = index.packets.map((p) => p.id);
    const duplicated = named.filter((id, k) => named.indexOf(id) !== k);
    expect(duplicated, 'packets the index lists twice').toEqual([]);
    expect(
      named.filter((id) => !listed.includes(id)),
      'packets the index names that BUILD-MAP section (c) does not list as R0',
    ).toEqual([]);
    expect(
      listed.filter((id) => !named.includes(id)),
      'R0 packets of BUILD-MAP section (c) the index does not list',
    ).toEqual([]);
  });

  it('[R035-02] every packet either names its server suites or says why it has none, and every suite it names is a Release 0 suite of the index', () => {
    const index = loadIndex();
    const suites = release0SuiteSet(index);
    const problems: string[] = [];
    for (const packet of index.packets) {
      const hasSuites = Array.isArray(packet.suites) && packet.suites.length > 0;
      const why = typeof packet.noServerSuite === 'string' ? packet.noServerSuite.trim() : '';
      if (hasSuites === (why.length > 0)) {
        problems.push(`${packet.id}: name its suites or give noServerSuite, exactly one`);
      }
      for (const ref of packet.suites ?? []) {
        if (!suites.has(ref.path)) problems.push(`${packet.id}: ${ref.path} is not in the index's suites`);
      }
    }
    const named = new Set(index.packets.flatMap((p) => (p.suites ?? []).map((s) => s.path)));
    for (const suite of suites) {
      if (!named.has(suite)) problems.push(`${suite} is in suites but no packet names it`);
    }
    expect(problems).toEqual([]);
  });

  it("[R035-03] every Release 0 packet's queue tests_first server suite is indexed under it, or recorded as landed under another indexed name", () => {
    const index = loadIndex();
    const testsFirst = queueTestsFirst();
    const problems: string[] = [];
    for (const packet of index.packets) {
      const own = new Set((packet.suites ?? []).map((s) => s.path));
      const landed = new Map((packet.queueSuitesLandedAs ?? []).map((l) => [l.planned, l]));
      for (const planned of testsFirst.get(packet.id) ?? []) {
        if (own.has(planned)) continue;
        const sub = landed.get(planned);
        if (!sub) problems.push(`${packet.id}: queue tests_first ${planned} is not indexed under it`);
        else if (!own.has(sub.landedAs)) problems.push(`${packet.id}: ${planned} landed as ${sub.landedAs}, which it does not index`);
        else if (existsSync(join(SERVER, planned))) problems.push(`${packet.id}: ${planned} exists, so index it rather than a substitute`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[R035-04] every suite the index names exists under apps/server', () => {
    const index = loadIndex();
    const named = new Set([
      ...Object.keys(index.suites),
      ...index.packets.flatMap((p) => (p.suites ?? []).map((s) => s.path)),
      index.journey.suite,
      ...index.explained.map((e) => e.suite),
      ...index.editedOnly.map((e) => e.suite),
    ]);
    expect([...named].filter((s) => !existsSync(join(SERVER, s)))).toEqual([]);
  });

  it('[R035-05] every Release 0 suite is bound by a Release 0 manifest, and the index names exactly the Release 0 manifests that bind it', () => {
    const index = loadIndex();
    const manifests = loadManifests();
    const release0 = manifests.filter((m) => index.manifests.includes(m.file));
    const problems: string[] = [];
    for (const [suite, entry] of Object.entries(index.suites)) {
      const binding = release0.filter((m) => m.suites.includes(suite)).map((m) => m.file).sort();
      if (binding.length === 0) problems.push(`${suite} is bound by no Release 0 manifest`);
      const claimed = [...(entry.manifests ?? [])].sort();
      if (JSON.stringify(claimed) !== JSON.stringify(binding)) {
        problems.push(`${suite}: the index says ${JSON.stringify(claimed)}, the manifests that bind it are ${JSON.stringify(binding)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[R035-06] the Release 0 manifests are every manifest with an R0 packageId plus those the index adds, each exists, is a case manifest, binds a Release 0 suite, and binds only indexed suites', () => {
    const index = loadIndex();
    const manifests = loadManifests();
    const byFile = new Map(manifests.map((m) => [m.file, m]));
    const suites = release0SuiteSet(index);
    const problems: string[] = [];
    const duplicated = index.manifests.filter((f, k) => index.manifests.indexOf(f) !== k);
    if (duplicated.length > 0) problems.push(`listed twice: ${duplicated.join(', ')}`);
    for (const m of manifests) {
      if (isRelease0PackageId(m.manifest.packageId) && !index.manifests.includes(m.file)) {
        problems.push(`${m.file} (packageId ${String(m.manifest.packageId)}) is a Release 0 manifest proof:release0 would not run`);
      }
    }
    for (const file of index.manifests) {
      const m = byFile.get(file);
      if (!m) {
        problems.push(`${file} does not exist`);
        continue;
      }
      if (m.type !== 'case') problems.push(`${file} is a ${m.type} manifest, not a case manifest`);
      if (!m.suites.some((s) => suites.has(s))) problems.push(`${file} binds no Release 0 suite`);
      for (const s of m.suites) {
        if (!suites.has(s)) problems.push(`${file} binds ${s}, which the index does not list as a Release 0 suite`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[R035-07] no manifest names a suite that does not exist', () => {
    const missing = loadManifests().flatMap((m) =>
      m.suites.filter((s) => !existsSync(join(SERVER, s))).map((s) => `${m.file}: ${s}`),
    );
    expect(missing).toEqual([]);
  });

  it('[R035-08] no Release 0 suite has a skip or todo the index does not explain, none matches two explanations, and none is .only', () => {
    const index = loadIndex();
    const { skips, unexplained, ambiguous } = matchExplanations(index);
    const only = [...skips].flatMap(([suite, calls]) =>
      calls.filter((c) => /\.only$/.test(c.kind)).map((c) => `${suite}:${c.line} ${c.kind}`),
    );
    expect(only, '.only silently skips every other case of its suite; it is never explained').toEqual([]);
    expect(ambiguous, 'skips more than one explanation matches').toEqual([]);
    if (unexplained.length > 0) {
      // The whole title, which the assertion diff below may cut: what an explanation's titleStartsWith matches.
      console.error(
        `release0-index.json does not explain:\n${unexplained.map((u) => JSON.stringify({ suite: u.suite, line: u.line, kind: u.kind, title: u.title })).join('\n')}`,
      );
    }
    expect(
      unexplained.map((u) => `${u.suite}:${u.line} ${u.kind}(${JSON.stringify(u.title)})`),
      'skips and todos in Release 0 suites that release0-index.json does not explain',
    ).toEqual([]);
  });

  it('[R035-09] every explanation names a Release 0 suite, its kind, a title prefix, its reason and the packet or ruling that owns it', () => {
    const index = loadIndex();
    const suites = release0SuiteSet(index);
    const problems: string[] = [];
    index.explained.forEach((e, k) => {
      const at = `explained[${k}] (${e.suite})`;
      if (!suites.has(e.suite)) problems.push(`${at}: not a Release 0 suite of the index`);
      if (!/^(?:(?:it|test|describe|suite)\.(?:skip|todo|skipIf|runIf|fails)|xit|xdescribe|xtest)$/.test(e.kind ?? '')) {
        problems.push(`${at}: kind ${JSON.stringify(e.kind)}`);
      }
      if (typeof e.titleStartsWith !== 'string' || normalize(e.titleStartsWith).length < 12) {
        problems.push(`${at}: titleStartsWith must be at least 12 characters of the title`);
      }
      if (typeof e.reason !== 'string' || e.reason.trim().length < 20) problems.push(`${at}: reason`);
      if (typeof e.owner !== 'string' || !/\b(?:R0|V1|W\d|D)-[A-Za-z0-9]/.test(e.owner)) {
        problems.push(`${at}: owner must name a packet (R0-*, V1-*, W<n>-*) or a ruling (D-<n>)`);
      }
    });
    expect(problems).toEqual([]);
  });

  it('[R035-10] an explained entry no longer present in its suite is reported, not failed (a later packet may close a todo first)', () => {
    const index = loadIndex();
    const { stale } = matchExplanations(index);
    if (stale.length > 0) {
      console.warn(
        `release0-index.json: ${stale.length} explained entr${stale.length === 1 ? 'y is' : 'ies are'} no longer present ` +
          `(remove ${stale.length === 1 ? 'it' : 'them'} from "explained"):\n` +
          stale.map((e) => `  ${e.suite} ${e.kind} ${JSON.stringify(e.titleStartsWith)}`).join('\n'),
      );
    }
    expect(stale.every((e) => typeof e.suite === 'string')).toBe(true);
  });

  it("[R035-11] the journey: BUILD-MAP section (b)'s seven steps, each with a required case in the journey manifest, which binds the journey suite", () => {
    const index = loadIndex();
    const steps = buildMapJourneySteps();
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(index.journey.steps.map((s) => s.step)).toEqual(steps);
    const journey = loadManifests().find((m) => m.file === index.journey.manifest);
    expect(journey, `${index.journey.manifest} exists`).toBeDefined();
    expect(index.manifests).toContain(index.journey.manifest);
    expect(journey?.suites).toContain(index.journey.suite);
    expect(release0SuiteSet(index).has(index.journey.suite)).toBe(true);
    const required = (journey?.manifest.requiredCases ?? []).map(normalize);
    const uncovered = index.journey.steps.filter(
      (s) => !s.casePrefix.startsWith(`step ${s.step} `) || !required.some((c) => c.startsWith(normalize(s.casePrefix))),
    );
    expect(uncovered.map((s) => s.step), 'steps with no required case').toEqual([]);
  });

  it('[R035-12] editedOnly suites exist and are not Release 0 suites (a suite is listed once, where its records put it)', () => {
    const index = loadIndex();
    const suites = release0SuiteSet(index);
    const problems = index.editedOnly
      .filter((e) => suites.has(e.suite) || !Array.isArray(e.editedBy) || e.editedBy.length === 0 || !e.createdBy)
      .map((e) => e.suite);
    expect(problems).toEqual([]);
  });

  it('[R035-13] proof:release0 runs run-manifests.mjs over exactly the index manifests and then this spec, and CI runs it next to the manifest step', () => {
    const index = loadIndex();
    expect(index.packetId).toBe('R0-35-EXIT-PROOF');
    expect(release0SuiteSet(index).has(THIS_SPEC)).toBe(true);
    const scripts = (JSON.parse(readFileSync(SERVER_PACKAGE, 'utf8')) as { scripts: Record<string, string> }).scripts;
    const script = scripts['proof:release0'] ?? '';
    expect(script, 'apps/server package.json has a proof:release0 script').not.toBe('');
    const runner = script.indexOf('run-manifests.mjs');
    const indexRead = script.indexOf('release0-index.json');
    const spec = script.indexOf(THIS_SPEC);
    expect(runner).toBeGreaterThan(-1);
    expect(indexRead, 'the --only list is read from the index, so it cannot drift').toBeGreaterThan(-1);
    expect(script).toContain('--only');
    expect(spec, 'the coverage spec runs after run-manifests').toBeGreaterThan(runner);
    const ci = readFileSync(CI_WORKFLOW, 'utf8');
    const manifestStep = ci.indexOf('node scripts/proof-admission/run-manifests.mjs --skip-build');
    const release0Step = ci.indexOf('proof:release0');
    expect(manifestStep).toBeGreaterThan(-1);
    expect(release0Step, 'ci-cd.yml runs proof:release0').toBeGreaterThan(-1);
    const between = ci.slice(manifestStep, release0Step);
    expect((between.match(/\n\s+- name:/g) ?? []).length, 'the step right after the manifest step').toBe(1);
  });
});

describe('R0-35-EXIT-PROOF skip scanner', () => {
  it('[R035-S1] finds it.todo, it.skip, describe.skip, test.skip, skipIf and x-forms with their titles, concatenated titles included', () => {
    const source = [
      "it.todo('plain todo');",
      'describe.skip("a skipped block", () => {});',
      'test.skip(`template title`, () => {});',
      'it.skipIf(process.env.X === "1")("conditional", () => {});',
      'xit("old style", () => {});',
      'it.todo(',
      "  'first half - ' +",
      '    "second half",',
      ');',
      'const maybe = it.skip;',
    ].join('\n');
    expect(findSkipCalls(source)).toEqual([
      { kind: 'it.todo', title: 'plain todo', line: 1 },
      { kind: 'describe.skip', title: 'a skipped block', line: 2 },
      { kind: 'test.skip', title: 'template title', line: 3 },
      { kind: 'it.skipIf', title: 'conditional', line: 4 },
      { kind: 'xit', title: 'old style', line: 5 },
      { kind: 'it.todo', title: 'first half - second half', line: 6 },
      { kind: 'it.skip', title: null, line: 10 },
    ]);
  });

  it('[R035-S2] a skip named in a comment, a string, a template literal or a regex is not a skip', () => {
    const source = [
      '// it.todo("in a line comment")',
      '/* describe.skip("in a block comment") */',
      "it('EF-14 (was it.todo): a real case', () => {",
      "  const s = 'it.skip(\"in a string\")';",
      '  const t = `it.todo(${"x"}) in a template`;',
      "  expect(s).toMatch(/it\\.skip\\('/);",
      '});',
      "it.todo('the one real todo');",
    ].join('\n');
    expect(findSkipCalls(source)).toEqual([{ kind: 'it.todo', title: 'the one real todo', line: 8 }]);
  });
});
