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
//      itself contains ': ' or ends in ':', and a sequence item placed at the
//      same indentation as the mapping entries around it. Each finding names
//      file:line.
//   2. a full parse with the one YAML parser this repository has at hand
//      without a dependency ruling: PyYAML through python3. When python3 or
//      PyYAML is absent the full parse is reported as NOT RUN with the reason,
//      loudly (a diagnostic line and a `todo`), never as a pass; the lint
//      still runs. Locally: `node --test scripts/research/research-corpus-parse.spec.mjs`.
//
// What the lint cannot see is left to the full parse: it is a guard for the
// two known failure classes, not a YAML validator.

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
const MAPPING_ENTRY = /^(\s*)(?:- )?([A-Za-z_][\w./-]*):(?:\s+(.*))?$/;
const SEQUENCE_ITEM = /^(\s*)- /;

/**
 * The two failure classes, as `{ line, message }` findings over a file's text.
 * Comments (`#` after whitespace) are dropped from a plain value before the
 * test, so `title: Foo # a: b` is not a finding.
 */
export function lintYamlText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  let previous = null; // the previous significant line: { indent, kind: 'entry' | 'key' | 'item' | 'other' }
  let blockScalarIndent = null; // inside a `|`/`>` block: content lines are skipped
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
    if (entry && entry[3] !== undefined && entry[3].trim() !== '') {
      const value = entry[3].replace(/\s+#.*$/, '').trim();
      if (/^[|>]/.test(value)) {
        blockScalarIndent = indent;
      } else if (PLAIN_START.test(value) && (/:\s/.test(value) || /:$/.test(value))) {
        findings.push({
          line: i + 1,
          message: `plain (unquoted) value of '${entry[2]}' contains ': ' or ends in ':'; quote it ("...") so the colon is text, not a nested key`,
        });
      }
    }
    if (item) {
      // A `- ` item is a sibling of the entries around it only when the previous
      // significant line is a `key: value` entry at the same indentation: a
      // sequence cannot sit inside a mapping at the mapping's own level.
      if (previous && previous.kind === 'entry' && previous.indent === indent && !previous.item) {
        findings.push({
          line: i + 1,
          message: 'sequence item at the indentation of the mapping entries above it; move it into the list it belongs to (or indent it under a key)',
        });
      }
    }
    const kind = item ? 'item' : entry ? (entry[3] !== undefined && entry[3].trim() !== '' ? 'entry' : 'key') : 'other';
    previous = { indent, kind, item: Boolean(item) };
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
    if (!result.ran) {
      t.diagnostic(`full YAML parse NOT RUN: ${result.reason}. Run this spec locally where python3 and PyYAML are installed.`);
      t.todo(`full YAML parse not run here: ${result.reason}`);
      return;
    }
    assert.deepEqual(result.problems, [], `\n${result.problems.join('\n')}\n`);
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
