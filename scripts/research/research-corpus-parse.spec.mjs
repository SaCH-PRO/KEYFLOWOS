// FU-RESEARCH-CORPUS-YAML (D-261): the research ledger
// docs/intelligence/research/RESEARCH-CORPUS.yaml parses, and this check keeps
// it parsing.
//
// The owner's 2026-11-22 scan found the ledger unreadable: an unquoted title
// containing ': ' (the Peopleware entry, line 84) and, once that is quoted, a
// `sources`-shaped entry placed under the `expansion_protocol` mapping (the
// fictional-intelligence programme). Tools that want the full source ledger
// (the research context compiler, the parallels index) could not read it.
//
// Two checks, both dependency-free so they run in the Type Check job before
// install, next to the other script specs:
//   1. a lint of every YAML file under docs/intelligence/research/ for the two
//      shapes that broke the ledger: a plain (unquoted) mapping value that
//      itself contains ': ' or ends in ':', and a sequence item that does not
//      belong to the mapping around it (at the indentation of `key: value`
//      entries, deeper than a `key: value` entry, or after a bare key whose
//      value was already given deeper). Each finding names file:line.
//   2. a full parse with the one YAML parser this repository has at hand
//      without a dependency ruling: PyYAML through python3. When python3 or
//      PyYAML is absent the full parse is reported as NOT RUN with the reason:
//      under CI (`CI` set, as GitHub Actions sets it) that is a FAILURE, so a
//      runner without the parser cannot pass the ledger silently; locally it is
//      a loud `todo` with a diagnostic line, never a pass. The lint still runs.
//      Locally: `node --test scripts/research/research-corpus-parse.spec.mjs`.
//
// What the lint cannot see is left to the full parse: it is a line-based guard
// for the known failure classes, not a YAML validator. Known misses, by design:
// a continuation line of a multi-line plain scalar that looks like `key: value`;
// text after a quoted scalar (`"a" b`); flow collections (`{a: b}`, `[a, b]`);
// anchors, aliases and tags; a `key: value` written with a tab. PyYAML catches
// those when it runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RESEARCH_DIR = path.join('docs', 'intelligence', 'research');
export const LEDGER = path.join(RESEARCH_DIR, 'RESEARCH-CORPUS.yaml');

/**
 * How the full-parse test reports a parseResearchYaml result: a parser that did
 * not run FAILS under CI (`CI` set and not 'false'/'0') and is a `todo` only on a
 * developer machine; a parse that ran fails on its problems and passes otherwise.
 */
export function parseOutcome(result, env = process.env) {
  if (!result.ran) {
    const ci = env.CI !== undefined && env.CI !== '' && env.CI !== 'false' && env.CI !== '0';
    return ci
      ? { kind: 'fail', message: `full YAML parse NOT RUN in CI: ${result.reason}` }
      : { kind: 'todo', message: `full YAML parse not run here: ${result.reason}` };
  }
  if (result.problems.length > 0) return { kind: 'fail', message: `\n${result.problems.join('\n')}\n` };
  return { kind: 'pass', message: '' };
}

/** Every .yaml/.yml file under docs/intelligence/research/, repo-relative, sorted. */
export function researchYamlFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ya?ml$/i.test(entry.name)) out.push(path.relative(root, full));
    }
  };
  walk(path.join(root, RESEARCH_DIR));
  return out.sort();
}

const indentOf = (line) => line.length - line.trimStart().length;
/** A plain scalar starts with none of the YAML indicators that make a value safe to hold ': '. */
const PLAIN_START = /^[^"'|>[{&*!%@`#-]/;
/** `key:` or `key: value`, optionally as a `- ` item; the key may be quoted or any plain text without ':' or '#'. */
const MAPPING_ENTRY = /^(\s*)(- +)?("[^"]*"|'[^']*'|[^\s"'#:[\]{}-][^:#]*?):(?:\s+(.*))?$/;
const SEQUENCE_ITEM = /^(\s*)- /;

/**
 * The two failure classes, as `{ line, message }` findings over a file's text.
 * Comments (`#` after whitespace) are dropped from a plain value before the
 * test, so `title: Foo # a: b` is not a finding.
 *
 * Structure is tracked as a stack of open frames { indent, kind, deeper }:
 * 'entry' is `key: value`, 'key' a bare `key:` whose value comes deeper, 'item'
 * a `- ` item, 'other' anything else. A `- key: ...` line opens an item frame
 * and, at the key's column, an entry/key frame, so the item's sibling keys and
 * a block scalar's extent are judged at that column.
 */
export function lintYamlText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  const stack = [];
  let blockScalarIndent = null; // inside a `|`/`>` block: content lines deeper than this are skipped
  const open = (indent, kind) => {
    while (stack.length > 0 && stack[stack.length - 1].indent > indent) stack.pop();
    const top = stack[stack.length - 1];
    if (top && top.indent === indent) stack.pop();
    else if (top) top.deeper = true;
    stack.push({ indent, kind, deeper: false });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = indentOf(line);
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    const entry = MAPPING_ENTRY.exec(line);
    const item = SEQUENCE_ITEM.exec(line);
    const keyColumn = entry ? indent + (entry[2] ? entry[2].length : 0) : indent;
    const hasValue = Boolean(entry) && entry[4] !== undefined && entry[4].trim() !== '';
    if (hasValue) {
      const value = entry[4].replace(/\s+#.*$/, '').trim();
      if (/^[|>]/.test(value)) {
        blockScalarIndent = keyColumn;
      } else if (PLAIN_START.test(value) && (/:\s/.test(value) || /:$/.test(value))) {
        findings.push({
          line: i + 1,
          message: `plain (unquoted) value of '${entry[3]}' contains ': ' or ends in ':'; quote it ("...") so the colon is text, not a nested key`,
        });
      }
    }
    if (item) {
      // Close the frames this item leaves, then judge it against the frame it
      // meets: at the same indentation it may follow another item, or a bare
      // key whose value has not been given yet (`list:` then `- x`), but not a
      // `key: value` entry nor a bare key whose value already came deeper
      // (`rules:` / `  - a` / `- id: Y`); deeper than the top frame it may
      // follow a bare key or an item, but not a `key: value` entry (`a: 1` /
      // `  - x`).
      while (stack.length > 0 && stack[stack.length - 1].indent > indent) stack.pop();
      const top = stack[stack.length - 1];
      let misplaced = false;
      if (top && top.indent === indent) misplaced = top.kind === 'entry' || (top.kind === 'key' && top.deeper);
      else if (top && top.indent < indent) misplaced = top.kind === 'entry';
      if (misplaced) {
        findings.push({
          line: i + 1,
          message: 'sequence item at the indentation of the mapping entries around it, deeper than a "key: value" entry, or after a key whose value was already given deeper; move it into the list it belongs to (or indent it under a key)',
        });
      }
    }
    if (item) {
      open(indent, 'item');
      if (entry) open(keyColumn, hasValue ? 'entry' : 'key');
    } else if (entry) {
      open(indent, hasValue ? 'entry' : 'key');
    } else {
      open(indent, 'other');
    }
  }
  return findings;
}

/** Findings for every research YAML file, as `file:line message` strings. */
export function lintResearchYaml(root = ROOT) {
  const out = [];
  for (const file of researchYamlFiles(root)) {
    for (const f of lintYamlText(fs.readFileSync(path.join(root, file), 'utf8'))) out.push(`${file}:${f.line} ${f.message}`);
  }
  return out;
}

/**
 * Full parse of every research YAML file through python3 + PyYAML.
 * Returns { ran: true, problems: string[] } or { ran: false, reason }.
 */
export function parseResearchYaml(root = ROOT) {
  const files = researchYamlFiles(root);
  const script = [
    'import sys, json',
    'try:',
    '    import yaml',
    'except Exception as e:',
    "    print(json.dumps({'ran': False, 'reason': 'PyYAML not importable: %s' % e})); sys.exit(0)",
    'problems = []',
    'for f in sys.argv[1:]:',
    '    try:',
    "        with open(f, encoding='utf-8') as fh: yaml.safe_load(fh)",
    '    except yaml.YAMLError as e:',
    "        mark = getattr(e, 'problem_mark', None)",
    "        where = ('%s:%d:%d' % (f, mark.line + 1, mark.column + 1)) if mark else f",
    "        problems.append('%s %s' % (where, getattr(e, 'problem', None) or str(e).splitlines()[0]))",
    "print(json.dumps({'ran': True, 'problems': problems}))",
  ].join('\n');
  const run = spawnSync('python3', ['-I', '-c', script, ...files], { cwd: root, encoding: 'utf8' });
  if (run.error || run.status !== 0) {
    return { ran: false, reason: run.error ? `python3 not available: ${run.error.message}` : `python3 exited ${run.status}: ${(run.stderr || '').trim()}` };
  }
  try {
    return JSON.parse(run.stdout.trim());
  } catch {
    return { ran: false, reason: `unreadable parser output: ${run.stdout.slice(0, 200)}` };
  }
}

describe('FU-RESEARCH-CORPUS-YAML: the research ledger parses and stays parseable', () => {
  it('the ledger and its neighbours exist', () => {
    const files = researchYamlFiles();
    assert.ok(files.includes(LEDGER), `${LEDGER} is under ${RESEARCH_DIR}`);
    assert.ok(files.length >= 2, 'more than the ledger lives there');
  });

  it('no research YAML file carries the two shapes that broke the ledger (unquoted "key: value" scalar, sequence item at mapping level)', () => {
    const findings = lintResearchYaml();
    assert.deepEqual(findings, [], `\n${findings.join('\n')}\n`);
  });

  it('every research YAML file parses (full parse through python3 + PyYAML; NOT RUN is reported, never passed)', (t) => {
    const result = parseResearchYaml();
    const outcome = parseOutcome(result);
    if (outcome.kind === 'todo') {
      t.diagnostic(`full YAML parse NOT RUN: ${result.reason}. Run this spec locally where python3 and PyYAML are installed; under CI this is a failure.`);
      t.todo(outcome.message);
      return;
    }
    if (outcome.kind === 'fail') assert.fail(outcome.message);
  });
});

describe('FU-RESEARCH-CORPUS-YAML: review round 1 controls', () => {
  it('a missing parser FAILS under CI and is a todo only locally; a parse that ran decides on its problems', () => {
    assert.deepEqual(parseOutcome({ ran: false, reason: 'no python3' }, { CI: 'true' }), { kind: 'fail', message: 'full YAML parse NOT RUN in CI: no python3' });
    assert.deepEqual(parseOutcome({ ran: false, reason: 'no python3' }, {}), { kind: 'todo', message: 'full YAML parse not run here: no python3' });
    assert.deepEqual(parseOutcome({ ran: true, problems: [] }, { CI: 'true' }), { kind: 'pass', message: '' });
    assert.equal(parseOutcome({ ran: true, problems: ['a.yaml:1:1 bad'] }, {}).kind, 'fail');
  });

  it('keys that are not identifiers (a space, a digit, quotes) are still mapping entries for the first rule', () => {
    assert.equal(lintYamlText('a:\n  my key: a: b\n').length, 1);
    assert.equal(lintYamlText('a:\n  2024: a: b\n').length, 1);
    assert.equal(lintYamlText('a:\n  "k": a: b\n').length, 1);
    assert.deepEqual(lintYamlText('a:\n  my key: plain\n  2024: 3\n  "k": v\n'), []);
  });

  it('a block scalar inside a list item hides only its own content lines, not the sibling keys of the item', () => {
    const broken = 's:\n  - note: |\n      text: with colon\n    title: Peopleware: Productive\n';
    const findings = lintYamlText(broken);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 4);
    assert.deepEqual(lintYamlText('s:\n  - note: |\n      text: with colon\n    title: "Peopleware: Productive"\n'), []);
  });

  it('a sequence item is judged against its enclosing mapping: after a bare key whose value was already given deeper, and deeper than a "key: value" entry', () => {
    assert.equal(lintYamlText('rules:\n  - a\n- id: Y\n').length, 1);
    assert.equal(lintYamlText('a: 1\n  - x\n').length, 1);
    // still valid: a list at the key's own indentation, items after items, a sibling key after that list
    assert.deepEqual(lintYamlText('a:\n  list:\n  - x\n  - y\n  c: 2\n'), []);
    assert.deepEqual(lintYamlText('rules:\n  - a\n  - b\nnext: 1\n'), []);
    // and the original fictional-intelligence shape is still a finding
    assert.equal(lintYamlText('e:\n  k: v\n\n  - id: X\n').length, 1);
  });
});

describe('FU-RESEARCH-CORPUS-YAML: confirmation round 2 controls', () => {
  it('pins the frames the mutants left loose: an item under a "- key: value" item, a block scalar whose content would otherwise be findings, a second document', () => {
    assert.deepEqual(lintYamlText('- a: 1\n  - x\n').map((f) => f.line), [2]);
    assert.deepEqual(lintYamlText('k: |\n  a: b: c\n  - x\nj: 1\n'), []);
    assert.deepEqual(lintYamlText('a:\n  - x\n---\n- y\n'), []);
    assert.equal(parseOutcome({ ran: false, reason: 'r' }, { CI: 'false' }).kind, 'todo');
    assert.equal(parseOutcome({ ran: false, reason: 'r' }, { CI: '0' }).kind, 'todo');
  });

  it('a bare block-scalar item ("- |") hides its content lines like a keyed one', () => {
    assert.deepEqual(lintYamlText('l:\n  - |\n    text: with: colon\n  - z\n'), []);
    assert.deepEqual(lintYamlText('l:\n  - >-\n    a: b\n  - z\nnext: 1\n'), []);
  });

  it('a key whose "value" is only a comment, an anchor or a tag is a bare key, so a deeper list under it is not a finding', () => {
    assert.deepEqual(lintYamlText('a: # c\n  - x\n'), []);
    assert.deepEqual(lintYamlText('a: &x\n  - y\n'), []);
    assert.deepEqual(lintYamlText('a: !!seq\n  - y\n'), []);
    // an anchored or tagged value that IS given stays a value
    assert.equal(lintYamlText('a: &x 1\n  - y\n').length, 1);
  });

  it('a plain value that starts with "-" followed by text is still a plain scalar for the first rule', () => {
    assert.equal(lintYamlText('a:\n  title: -a: b\n').length, 1);
    assert.deepEqual(lintYamlText('a:\n  title: -a b\n  n: -3\n'), []);
  });
});

describe('FU-RESEARCH-CORPUS-YAML: negative controls over fixture text', () => {
  it('the Peopleware shape is a finding at its line, and quoting it clears it', () => {
    const broken = ['sources:', '  - id: BOOK-PEOPLEWARE', '    title: Peopleware: Productive Projects and Teams', '    authors:', '      - Tom DeMarco', ''].join('\n');
    const findings = lintYamlText(broken);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 3);
    assert.match(findings[0].message, /unquoted/);
    assert.deepEqual(lintYamlText(broken.replace('title: Peopleware: Productive Projects and Teams', 'title: "Peopleware: Productive Projects and Teams"')), []);
    assert.deepEqual(lintYamlText(broken.replace('title: Peopleware: Productive Projects and Teams', "title: 'Peopleware: Productive Projects and Teams'")), []);
  });

  it('a key ending in ":" with a value ending in ":" is a finding; a block scalar, a flow value, a comment and a URL are not', () => {
    assert.equal(lintYamlText('a:\n  b: value ends with colon:\n').length, 1);
    assert.deepEqual(lintYamlText('a:\n  b: |\n    text: with colon\n    more: text\n  c: plain\n'), []);
    assert.deepEqual(lintYamlText('a:\n  b: >\n    folded: text\n'), []);
    assert.deepEqual(lintYamlText('a:\n  b: { k: v }\n  c: [x, y]\n'), []);
    assert.deepEqual(lintYamlText('a:\n  b: plain # a: comment\n'), []);
    assert.deepEqual(lintYamlText('a:\n  file: docs/x/y.md\n  url: https://example.com/a\n'), []);
  });

  it('the fictional-intelligence shape is a finding: a "- id:" item right after "key: value" entries at the same indentation', () => {
    const broken = [
      'expansion_protocol:',
      '  default_status: QUEUED',
      '  duplicate_rule: Search first.',
      '',
      '  - id: RND-FICTIONAL-INTELLIGENCE-GENOME',
      '    title: KEY Fictional Intelligence Genome Programme',
      '',
    ].join('\n');
    const findings = lintYamlText(broken);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 5);
    assert.match(findings[0].message, /sequence item at the indentation of the mapping entries/);
  });

  it('well-formed lists are not findings: items under a bare key, items after items, nested lists, a list after a sibling key', () => {
    assert.deepEqual(lintYamlText('sources:\n  - id: A\n    title: "A: a"\n  - id: B\n    primary_questions:\n      - one?\n      - two?\n    caution: text\n\n  - id: C\n    title: C\n'), []);
    assert.deepEqual(lintYamlText('a:\n  b: 1\n  list:\n    - x\n    - y\n  c: 2\n'), []);
    assert.deepEqual(lintYamlText('a:\n  b: 1\n  list:\n  - x\n  - y\n  c: 2\n'), []);
  });

  it('CRLF text lints the same, and a file with no findings yields an empty list', () => {
    assert.equal(lintYamlText('a:\r\n  title: Peopleware: Productive\r\n').length, 1);
    assert.deepEqual(lintYamlText(''), []);
  });

  it('the full parse reports a problem with file:line:column for a scratch file that does not parse, when a parser is available', () => {
    // the OS temp dir: node_modules does not exist in CI before install, nor in a fresh worktree
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-yaml-'));
    try {
      fs.mkdirSync(path.join(dir, RESEARCH_DIR), { recursive: true });
      fs.writeFileSync(path.join(dir, LEDGER), 'sources:\n  - id: X\n    title: Peopleware: Productive\n');
      const result = parseResearchYaml(dir);
      if (!result.ran) return; // reported by the repository test as NOT RUN
      assert.equal(result.problems.length, 1);
      assert.match(result.problems[0], new RegExp(`^${LEDGER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:3:\\d+ `));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
