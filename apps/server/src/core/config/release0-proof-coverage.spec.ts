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
 *              fails, x-forms, a skip after a modifier such as
 *              it.concurrent.skip, the options form { skip: true } and a test
 *              context's skip()) in a Release 0 suite, with its reason, the
 *              packet or ruling that owns it and its status: CLOSED (closedBy
 *              names a proof proof:release0 runs), RULED or DEFERRED (a
 *              BUILD-MAP ruling), V1-SCOPE (a queued V1 packet's residual) or
 *              OPEN (the gate answers NOT MET and reports it to the owner).
 *   editedOnly suites an R0 packet edited but neither created nor declared.
 *              Each is a Release 0 suite (R0-35 review SEC-R035-3), bound by
 *              release0-edited-suites.json, unless authoredNoCase says the
 *              edit authored no case.
 *
 * It fails when a Release 0 suite is not bound, when a manifest names a suite
 * that does not exist, when a Release 0 suite has a skip or todo the index does
 * not explain, and when the index names a packet BUILD-MAP does not list (or
 * misses one it lists). An explained entry that is no longer in its suite is
 * REPORTED, not failed, so a later packet can close a todo without touching
 * this index first. A source scan cannot see every runtime skip, so
 * proof:release0 (scripts/proof-admission/release0.mjs) also reads the run's
 * report and fails on a case it did not run that no explanation covers
 * (R0-35 review SEC-R035-1); [R035-14] and [R035-15] test that gate.
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
const GATE_SCRIPT = join(PROOF_DIR, 'release0.mjs');
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

/**
 * A test API call and its chain of modifiers, in any order vitest accepts:
 * it.concurrent.skip, describe.sequential.todo, it.skip.each(...)(...),
 * test.concurrent.skipIf(...)(...) (review R035-CR-2, SEC-R035-1: a skip
 * after a modifier was missed).
 */
const API_CHAIN =
  /(?<![\w$.])(it|test|describe|suite)(?![\w$])((?:\s*\.\s*(?:concurrent|sequential|shuffle|skip|todo|only|fails|skipIf|runIf|each|for)(?![\w$]))*)/g;
const X_FORM = /(?<![\w$.])(xit|xdescribe|xtest)(?![\w$])/g;
/** ctx.skip() / context.skip() / a destructured skip(): the test context skipping its own test at runtime. */
const CONTEXT_SKIP = /(?<![\w$.])(?:([A-Za-z_$][\w$]*)\s*\.\s*)?skip\s*\(/g;
/** A modifier that does not skip anything. */
const NEUTRAL_MODIFIERS = new Set(['concurrent', 'sequential', 'shuffle', 'each', 'for']);
/** A modifier whose own argument list (a condition or a table) comes before the title call. */
const CALL_THEN_TITLE = new Set(['skipIf', 'runIf', 'each', 'for']);
const TEST_API = new Set(['it', 'test', 'describe', 'suite']);
/** The options form it(title, { skip: true }, fn): a skip, todo, only or fails key whose value is not the literal false. */
const OPTION_SKIP = /(?<![\w$.])(skip|todo|only|fails)\s*(?::\s*([^,}]*))?(?=[,}])/;

/** The index of the first comma at depth 0 between `from` and `end` (in blanked code), or -1. */
function topLevelComma(code: string, from: number, end: number): number {
  let depth = 0;
  for (let k = from; k < end; k += 1) {
    const c = code[k];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) return k;
  }
  return -1;
}

/** The index just past the brace that closes the one at `open` (in blanked code). */
function closeBrace(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k += 1) {
    if (code[k] === '{') depth += 1;
    else if (code[k] === '}') {
      depth -= 1;
      if (depth === 0) return k + 1;
    }
  }
  return code.length;
}

type ApiCall = {
  at: number;
  base: string;
  words: string[];
  title: string | null;
  /** The title call's parentheses (open .. end), when there is one. */
  open: number;
  end: number;
  /** The options-form skip key (it(title, { skip: true }, fn)), if any. */
  optionSkip: string | null;
};

/** Every it/test/describe/suite call (or bare reference) in a test file, with its modifier chain and title. */
function findApiCalls(source: string, code: string): ApiCall[] {
  const calls: ApiCall[] = [];
  for (const m of code.matchAll(API_CHAIN)) {
    const words = m[2].split('.').map((w) => w.trim()).filter(Boolean);
    let i = (m.index ?? 0) + m[0].length;
    const skipWs = () => {
      while (i < code.length && /\s/.test(code[i])) i += 1;
    };
    skipWs();
    const call: ApiCall = { at: m.index ?? 0, base: m[1], words, title: null, open: -1, end: -1, optionSkip: null };
    if (code[i] === '(' && words.length > 0 && CALL_THEN_TITLE.has(words[words.length - 1])) {
      i = closeParen(code, i);
      skipWs();
    }
    if (code[i] === '(') {
      call.open = i;
      call.end = closeParen(code, i);
      call.title = readTitle(source, i + 1);
      const comma = topLevelComma(code, i + 1, call.end - 1);
      if (comma >= 0) {
        let j = comma + 1;
        while (j < call.end && /\s/.test(code[j])) j += 1;
        if (code[j] === '{') {
          const option = OPTION_SKIP.exec(code.slice(j, closeBrace(code, j)));
          if (option && (option[2] === undefined || option[2].trim() !== 'false')) call.optionSkip = option[1];
        }
      }
    }
    calls.push(call);
  }
  return calls;
}

/**
 * Every skip-like call in a test file: it/test/describe/suite with .skip .todo
 * .skipIf .runIf .only .fails anywhere in its modifier chain, the options form
 * (`it(title, { skip: true }, fn)`, also todo/only/fails), a test context's
 * skip() (ctx.skip(), a destructured skip(); titled by the test around it),
 * and xit/xdescribe/xtest. A static scan cannot see everything a test does at
 * runtime; proof:release0 (scripts/proof-admission/release0.mjs) also reads
 * the run's report and fails on any case it did not run that no explanation
 * covers (SEC-R035-1).
 */
export function findSkipCalls(source: string): SkipCall[] {
  const code = blankNonCode(source);
  const found: Array<{ at: number; kind: string; title: string | null }> = [];
  const calls = findApiCalls(source, code);
  for (const call of calls) {
    const chain = call.words.length > 0 ? `.${call.words.join('.')}` : '';
    if (call.words.some((w) => !NEUTRAL_MODIFIERS.has(w))) {
      found.push({ at: call.at, kind: `${call.base}${chain}`, title: call.title });
    } else if (call.optionSkip) {
      found.push({ at: call.at, kind: `${call.base}${chain}(options.${call.optionSkip})`, title: call.title });
    }
  }
  for (const m of code.matchAll(X_FORM)) {
    let i = (m.index ?? 0) + m[0].length;
    while (i < code.length && /\s/.test(code[i])) i += 1;
    found.push({ at: m.index ?? 0, kind: m[1], title: code[i] === '(' ? readTitle(source, i + 1) : null });
  }
  const tests = calls.filter((c) => (c.base === 'it' || c.base === 'test') && c.open >= 0);
  for (const m of code.matchAll(CONTEXT_SKIP)) {
    if (m[1] !== undefined && TEST_API.has(m[1])) continue; // it.skip(...): the chain above
    const at = m.index ?? 0;
    const around = tests.filter((t) => t.open < at && at < t.end).sort((a, b) => b.open - a.open)[0];
    found.push({ at, kind: 'context.skip', title: around?.title ?? null });
  }
  return found
    .sort((a, b) => a.at - b.at)
    .map(({ at, kind, title }) => ({
      kind,
      title: title === null ? null : normalize(title),
      line: source.slice(0, at).split('\n').length,
    }));
}

/** The titles of the it/test cases of a test file that run (no skip, todo, only or fails in their chain or options). */
export function findRunningTestTitles(source: string): string[] {
  const code = blankNonCode(source);
  return findApiCalls(source, code)
    .filter(
      (c) =>
        (c.base === 'it' || c.base === 'test') &&
        c.title !== null &&
        !c.optionSkip &&
        c.words.every((w) => NEUTRAL_MODIFIERS.has(w)),
    )
    .map((c) => normalize(c.title as string));
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
/** What closes a CLOSED explanation: a case a Release 0 manifest requires, a line a repo file holds, or a running web unit case. */
type ClosedBy =
  | { manifest: string; case: string }
  | { file: string; contains: string }
  | { webSuite: string; case: string };
/**
 * CLOSED   fixed outside the suite; closedBy names the proof proof:release0 runs (SEC-R035-2)
 * RULED    an owner ruling closed it without a code change (ruling)
 * DEFERRED an owner ruling moved it out of Release 0 (ruling)
 * V1-SCOPE a V1 packet's residual in a suite an R0 packet only edited (followUp: its queued V1 id)
 * OPEN     a Release 0 gap still open: the gate answers NOT MET and reports it to the owner (SEC-R035-4)
 */
type ExplainedStatus = 'CLOSED' | 'RULED' | 'DEFERRED' | 'V1-SCOPE' | 'OPEN';
type Explained = {
  suite: string;
  kind: string;
  titleStartsWith: string;
  reason: string;
  owner: string;
  status: ExplainedStatus;
  closedBy?: ClosedBy[];
  ruling?: string;
  followUp?: string;
};
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
  editedOnly: Array<{ suite: string; editedBy: string[]; createdBy: string; authoredNoCase?: string }>;
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

/** The owner rulings of BUILD-MAP section (g): D-<n> rows. */
function buildMapRulings(): Set<string> {
  const text = readFileSync(BUILD_MAP, 'utf8');
  const start = text.indexOf('## (g) Open decisions');
  const end = text.indexOf('## (h)', start);
  expect(start, 'BUILD-MAP section (g) not found').toBeGreaterThan(-1);
  const rulings = new Set<string>();
  for (const line of text.slice(start, end).split('\n')) {
    const row = /^\|\s*(D-\d+)\s*\|/.exec(line);
    if (row) rulings.add(row[1]);
  }
  return rulings;
}

/** Every packet id BUILD-QUEUE-001.json queues. */
function queuedIds(): Set<string> {
  return new Set((JSON.parse(readFileSync(BUILD_QUEUE, 'utf8')) as Array<{ id: string }>).map((e) => e.id));
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

type ReportAssertion = { title: string; ancestorTitles?: string[]; fullName: string; status: string };
type GateReport = { testResults: Array<{ name: string; assertionResults: ReportAssertion[] }> };
type RuntimeSkip = { suite: string; status: string; fullName: string };
type Release0Gate = {
  EXIT: { MET: number; REJECTED: number; NOT_MET: number };
  runtimeSkips: (
    report: GateReport,
    index: Pick<Release0Index, 'suites' | 'explained'>,
  ) => { unexplained: RuntimeSkip[]; explained: RuntimeSkip[]; missingSuites: string[] };
  openEntries: (index: Pick<Release0Index, 'explained'>) => Explained[];
  gateVerdict: (input: {
    runManifestsExit: number | null;
    specExit: number | null;
    runtime: { unexplained: RuntimeSkip[]; missingSuites: string[] } | null;
    open: Explained[];
  }) => { code: number; verdict: string };
};
let gate: Release0Gate;

beforeAll(async () => {
  ({ manifestSuites } = (await import(pathToFileURL(join(PROOF_DIR, 'evaluate.mjs')).href)) as {
    manifestSuites: typeof manifestSuites;
  });
  ({ classify } = (await import(pathToFileURL(join(PROOF_DIR, 'run-manifests.mjs')).href)) as {
    classify: typeof classify;
  });
  gate = (await import(pathToFileURL(GATE_SCRIPT).href)) as Release0Gate;
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

/** A kind findSkipCalls reports that an explanation may name (.only is never explained). */
const SKIP_KIND =
  /^(?:(?:it|test|describe|suite)(?:\.(?:concurrent|sequential|shuffle|skip|todo|fails|skipIf|runIf|each|for))+|(?:it|test|describe|suite)(?:\.(?:concurrent|sequential|shuffle|each|for))*\(options\.(?:skip|todo|fails)\)|x(?:it|describe|test)|context\.skip)$/;

/**
 * Why a CLOSED explanation's proof does not hold (SEC-R035-2): a case must be
 * required by a manifest proof:release0 runs (so skipping, renaming or
 * deleting it rejects the gate); a repo file must hold the line; a web unit
 * case (the web suite runs in CI's web job, not here) must exist and run.
 */
function closingProofProblems(at: string, proof: ClosedBy, index: Release0Index, manifests: Map<string, LoadedManifest>): string[] {
  if ('manifest' in proof) {
    if (!index.manifests.includes(proof.manifest)) return [`${at}: closedBy ${proof.manifest} is not a Release 0 manifest proof:release0 runs`];
    const required = (manifests.get(proof.manifest)?.manifest.requiredCases ?? []).map(normalize);
    return required.includes(normalize(proof.case ?? ''))
      ? []
      : [`${at}: closedBy case ${JSON.stringify(proof.case)} is not required by ${proof.manifest}`];
  }
  if ('file' in proof) {
    const path = join(REPO, proof.file);
    if (proof.file.split('/').includes('..') || !existsSync(path)) return [`${at}: closedBy file ${proof.file} does not exist`];
    return typeof proof.contains === 'string' && proof.contains.length > 0 && readFileSync(path, 'utf8').includes(proof.contains)
      ? []
      : [`${at}: closedBy file ${proof.file} does not hold ${JSON.stringify(proof.contains)}`];
  }
  if ('webSuite' in proof) {
    const path = join(REPO, proof.webSuite);
    if (!proof.webSuite.startsWith('apps/web/') || proof.webSuite.split('/').includes('..') || !existsSync(path)) {
      return [`${at}: closedBy webSuite ${proof.webSuite} is not an apps/web test file`];
    }
    const wanted = normalize(proof.case ?? '');
    return wanted.length >= 12 && findRunningTestTitles(readFileSync(path, 'utf8')).some((t) => t.startsWith(wanted))
      ? []
      : [`${at}: closedBy web case ${JSON.stringify(proof.case)} is not a running case of ${proof.webSuite}`];
  }
  return [`${at}: closedBy ${JSON.stringify(proof)} names no manifest case, file or web case`];
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
      calls.filter((c) => c.kind.split(/[.()]/).includes('only')).map((c) => `${suite}:${c.line} ${c.kind}`),
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

  it('[R035-09] every explanation names a Release 0 suite, its kind, a title prefix, its reason, the packet or ruling that owns it and its status; a CLOSED one names a proof proof:release0 runs, a RULED or DEFERRED one a BUILD-MAP ruling, a V1-SCOPE one a queued V1 packet (SEC-R035-2, SEC-R035-4)', () => {
    const index = loadIndex();
    const suites = release0SuiteSet(index);
    const rulings = buildMapRulings();
    const queued = queuedIds();
    const manifests = new Map(loadManifests().map((m) => [m.file, m]));
    const problems: string[] = [];
    const ruled = (at: string, ruling: unknown) => {
      if (typeof ruling !== 'string' || !rulings.has(ruling)) {
        problems.push(`${at}: ruling ${JSON.stringify(ruling)} is not a ruling of BUILD-MAP section (g)`);
      }
    };
    index.explained.forEach((e, k) => {
      const at = `explained[${k}] (${e.suite})`;
      if (!suites.has(e.suite)) problems.push(`${at}: not a Release 0 suite of the index`);
      if (!SKIP_KIND.test(e.kind ?? '')) problems.push(`${at}: kind ${JSON.stringify(e.kind)}`);
      if (typeof e.titleStartsWith !== 'string' || normalize(e.titleStartsWith).length < 12) {
        problems.push(`${at}: titleStartsWith must be at least 12 characters of the title`);
      }
      if (typeof e.reason !== 'string' || e.reason.trim().length < 20) problems.push(`${at}: reason`);
      if (typeof e.owner !== 'string' || !/\b(?:R0|V1|W\d|D)-[A-Za-z0-9]/.test(e.owner)) {
        problems.push(`${at}: owner must name a packet (R0-*, V1-*, W<n>-*) or a ruling (D-<n>)`);
      }
      switch (e.status) {
        case 'CLOSED': {
          if (!Array.isArray(e.closedBy) || e.closedBy.length === 0) {
            problems.push(`${at}: CLOSED names no proof in closedBy`);
            break;
          }
          if (e.ruling !== undefined) ruled(at, e.ruling);
          for (const proof of e.closedBy) problems.push(...closingProofProblems(at, proof, index, manifests));
          break;
        }
        case 'RULED':
        case 'DEFERRED':
          ruled(at, e.ruling);
          break;
        case 'V1-SCOPE':
          if (typeof e.followUp !== 'string' || !e.followUp.startsWith('V1-') || !queued.has(e.followUp)) {
            problems.push(`${at}: V1-SCOPE needs followUp, the queued V1 packet (BUILD-QUEUE-001.json) whose scope it is`);
          }
          break;
        case 'OPEN':
          if (e.followUp !== undefined && !queued.has(e.followUp) && !rulings.has(e.followUp)) {
            problems.push(`${at}: followUp ${JSON.stringify(e.followUp)} is neither a queued packet nor a ruling`);
          }
          break;
        default:
          problems.push(`${at}: status ${JSON.stringify(e.status)} is not CLOSED, RULED, DEFERRED, V1-SCOPE or OPEN`);
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

  it('[R035-12] a suite an R0 packet only edited is a Release 0 suite, bound and scanned like the others, unless the index records that the edit authored no case (SEC-R035-3, R035-CR-3)', () => {
    const index = loadIndex();
    const suites = release0SuiteSet(index);
    const problems: string[] = [];
    for (const e of index.editedOnly) {
      if (!Array.isArray(e.editedBy) || e.editedBy.length === 0 || !e.createdBy) problems.push(`${e.suite}: editedBy and createdBy`);
      const noCase = typeof e.authoredNoCase === 'string' ? e.authoredNoCase.trim() : '';
      if (noCase.length === 0 && !suites.has(e.suite)) {
        problems.push(`${e.suite}: edited by ${e.editedBy.join(', ')} but not a Release 0 suite, so no manifest of proof:release0 binds its cases`);
      }
      if (noCase.length > 0 && (suites.has(e.suite) || noCase.length < 20)) {
        problems.push(`${e.suite}: authoredNoCase is for a suite left out of Release 0, with the reason (at least 20 characters)`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[R035-13] proof:release0 runs release0.mjs: run-manifests.mjs over exactly the index manifests keeping its report, then this spec, then the runtime skip check on that report; CI runs it right after the manifest step and fails on everything but NOT MET', () => {
    const index = loadIndex();
    expect(index.packetId).toBe('R0-35-EXIT-PROOF');
    expect(release0SuiteSet(index).has(THIS_SPEC)).toBe(true);
    const scripts = (JSON.parse(readFileSync(SERVER_PACKAGE, 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['proof:release0'], 'apps/server package.json runs the gate script').toBe(
      'node ../../scripts/proof-admission/release0.mjs',
    );
    const source = readFileSync(GATE_SCRIPT, 'utf8');
    expect(source).toContain("const RUNNER = join(SCRIPT_DIR, 'run-manifests.mjs');");
    expect(source, 'the --only list is read from the index, so it cannot drift').toContain(
      "const INDEX_PATH = join(SCRIPT_DIR, 'release0-index.json');",
    );
    expect(source).toContain(`const THIS_SPEC = '${THIS_SPEC}';`);
    const main = source.indexOf('function main()');
    const runner = source.indexOf("[RUNNER, '--only', index.manifests.join(','), '--keep-report', reportPath, ...args]", main);
    const spec = source.indexOf("['run', THIS_SPEC]", main);
    const runtime = source.indexOf('runtimeSkips(JSON.parse(readFileSync(reportPath', main);
    expect(main).toBeGreaterThan(-1);
    expect(runner, 'run-manifests over the index manifests, keeping the report it produced').toBeGreaterThan(main);
    expect(spec, 'the coverage spec runs after run-manifests').toBeGreaterThan(runner);
    expect(runtime, 'the runtime skip check reads that report after the spec').toBeGreaterThan(spec);
    const ci = readFileSync(CI_WORKFLOW, 'utf8');
    const manifestStep = ci.indexOf('node scripts/proof-admission/run-manifests.mjs --skip-build');
    const release0Step = ci.indexOf('pnpm --filter server proof:release0 --skip-build');
    expect(manifestStep).toBeGreaterThan(-1);
    expect(release0Step, 'ci-cd.yml runs proof:release0').toBeGreaterThan(-1);
    const between = ci.slice(manifestStep, release0Step);
    expect((between.match(/\n\s+- name:/g) ?? []).length, 'the step right after the manifest step').toBe(1);
    const step = ci.slice(release0Step, ci.indexOf('\n      - name:', release0Step));
    expect(step, 'NOT MET (exit 3) is annotated for the owner; every other exit fails the job').toMatch(
      /if \[ "\$code" -eq 3 \]; then[\s\S]*::warning[\s\S]*exit 0[\s\S]*fi\s+exit "\$code"/,
    );
  });

  it('[R035-14] the gate fails on a case of a Release 0 suite the run skipped, left todo or pending (it.concurrent.skip, { skip: true }, ctx.skip()) unless the index explains it, and on a Release 0 suite missing from the run (SEC-R035-1)', () => {
    const index = {
      suites: { 'test/a.test.ts': { manifests: ['a.json'] }, 'test/b.test.ts': { manifests: ['a.json'] } },
      explained: [
        { suite: 'test/a.test.ts', kind: 'it.todo', titleStartsWith: 'an explained todo', reason: 'r', owner: 'R0-00', status: 'OPEN' },
        { suite: 'test/a.test.ts', kind: 'describe.skip', titleStartsWith: 'an explained block', reason: 'r', owner: 'R0-00', status: 'OPEN' },
      ] as Explained[],
    };
    const at = (title: string, status: string, ancestorTitles: string[] = ['blk']): ReportAssertion => ({
      title,
      ancestorTitles,
      fullName: [...ancestorTitles, title].join(' '),
      status,
    });
    const report: GateReport = {
      testResults: [
        {
          name: '/repo/apps/server/test/a.test.ts',
          assertionResults: [
            at('a cross-tenant negative control', 'skipped'),
            at('an options-form skip', 'skipped'),
            at('an explained todo of the index', 'todo'),
            at('inside it', 'skipped', ['an explained block of cases']),
            at('a pending case', 'pending'),
            at('a passing case', 'passed'),
            at('a failing case', 'failed'),
          ],
        },
        { name: '/repo/apps/server/test/c.test.ts', assertionResults: [at('not a Release 0 suite', 'skipped')] },
      ],
    };
    const result = gate.runtimeSkips(report, index);
    expect(result.unexplained.map((u) => `${u.suite} ${u.status} ${u.fullName}`)).toEqual([
      'test/a.test.ts skipped blk a cross-tenant negative control',
      'test/a.test.ts skipped blk an options-form skip',
      'test/a.test.ts pending blk a pending case',
    ]);
    expect(result.explained.map((u) => u.fullName)).toEqual(['blk an explained todo of the index', 'an explained block of cases inside it']);
    expect(result.missingSuites, 'a Release 0 suite the run did not report').toEqual(['test/b.test.ts']);
    const verdict = gate.gateVerdict({ runManifestsExit: 0, specExit: 0, runtime: result, open: [] });
    expect(verdict.code).toBe(gate.EXIT.REJECTED);
    const clean = gate.runtimeSkips({ testResults: [report.testResults[0], { name: '/repo/apps/server/test/b.test.ts', assertionResults: [] }] }, {
      ...index,
      explained: [
        ...index.explained,
        { suite: 'test/a.test.ts', kind: 'context.skip', titleStartsWith: 'a cross-tenant negative', reason: 'r', owner: 'R0-00', status: 'CLOSED' },
        { suite: 'test/a.test.ts', kind: 'it(options.skip)', titleStartsWith: 'an options-form skip', reason: 'r', owner: 'R0-00', status: 'CLOSED' },
        { suite: 'test/a.test.ts', kind: 'it.skipIf', titleStartsWith: 'a pending case', reason: 'r', owner: 'R0-00', status: 'CLOSED' },
      ] as Explained[],
    });
    expect(clean.unexplained).toEqual([]);
    expect(clean.missingSuites).toEqual([]);
  });

  it('[R035-15] an OPEN explanation is reported to the owner and the gate answers NOT MET (exit 3), never MET; a failure anywhere else is REJECTED (exit 2) (SEC-R035-4)', () => {
    const index = loadIndex();
    const open = gate.openEntries(index);
    expect(open).toEqual(index.explained.filter((e) => e.status === 'OPEN'));
    if (open.length > 0) {
      console.warn(
        `release0-index.json: ${open.length} OPEN Release 0 item(s); proof:release0 answers NOT MET until each is closed or ruled:\n` +
          open.map((e) => `  ${e.suite} ${JSON.stringify(e.titleStartsWith)} owner: ${e.owner}`).join('\n'),
      );
    }
    const clean = { runManifestsExit: 0, specExit: 0, runtime: { unexplained: [], missingSuites: [] } };
    expect(gate.gateVerdict({ ...clean, open: [] }).code).toBe(gate.EXIT.MET);
    const one = [{ suite: 'test/a.test.ts', titleStartsWith: 'an open gap', owner: 'R0-00', status: 'OPEN' } as Explained];
    expect(gate.gateVerdict({ ...clean, open: one })).toMatchObject({ code: gate.EXIT.NOT_MET, verdict: 'NOT MET' });
    expect(gate.EXIT.NOT_MET).toBe(3);
    for (const failed of [
      { ...clean, runManifestsExit: 2 },
      { ...clean, runManifestsExit: 3 },
      { ...clean, runManifestsExit: null },
      { ...clean, specExit: 1 },
      { ...clean, runtime: null },
      { ...clean, runtime: { unexplained: [{ suite: 's', status: 'skipped', fullName: 'x' }], missingSuites: [] } },
      { ...clean, runtime: { unexplained: [], missingSuites: ['s'] } },
    ]) {
      expect(gate.gateVerdict({ ...failed, open: one }), JSON.stringify(failed)).toMatchObject({ code: gate.EXIT.REJECTED });
    }
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

  it('[R035-S3] finds a skip after a modifier (it.concurrent.skip, describe.concurrent.skip, test.sequential.todo, it.skip.each), the options form ({ skip: true }) and a test context skip (ctx.skip(), a destructured skip()) with their titles (R035-CR-2, SEC-R035-1)', () => {
    const source = [
      "it.concurrent.skip('concurrent skip', () => {});",
      'describe.concurrent.skip("concurrent block", () => {});',
      "test.sequential.todo('sequential todo');",
      "it.skip.each([[1], [2]])('each skip %s', () => {});",
      "it('options skip', { skip: true }, () => {});",
      "describe('options todo block', { todo: true }, () => {});",
      "it('runs with a timeout', { timeout: 5000 }, () => {});",
      "it('skip false is not a skip', { skip: false }, () => {});",
      "it('skips at runtime', (ctx) => {",
      '  if (process.env.X) ctx.skip();',
      '});',
      "it.each([[1]])('plain each %s', () => {});",
      "it.concurrent('plain concurrent', () => {});",
      "test('destructured', ({ skip }) => {",
      '  skip();',
      '});',
      "it.concurrent.only('focused', () => {});",
    ].join('\n');
    expect(findSkipCalls(source)).toEqual([
      { kind: 'it.concurrent.skip', title: 'concurrent skip', line: 1 },
      { kind: 'describe.concurrent.skip', title: 'concurrent block', line: 2 },
      { kind: 'test.sequential.todo', title: 'sequential todo', line: 3 },
      { kind: 'it.skip.each', title: 'each skip %s', line: 4 },
      { kind: 'it(options.skip)', title: 'options skip', line: 5 },
      { kind: 'describe(options.todo)', title: 'options todo block', line: 6 },
      { kind: 'context.skip', title: 'skips at runtime', line: 10 },
      { kind: 'context.skip', title: 'destructured', line: 15 },
      { kind: 'it.concurrent.only', title: 'focused', line: 17 },
    ]);
  });

  it('[R035-S4] findRunningTestTitles lists the cases that run and none that a chain or an options object skips (a web closing proof must be one of them)', () => {
    const source = [
      "it('runs', () => {});",
      "test.concurrent('runs concurrently', () => {});",
      "it.skip('skipped', () => {});",
      "it('options skip', { skip: true }, () => {});",
      "it.todo('a todo');",
      "describe('a block', () => {});",
    ].join('\n');
    expect(findRunningTestTitles(source)).toEqual(['runs', 'runs concurrently']);
  });
});
