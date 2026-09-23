import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseYaml, stringifyYaml } from '../lib/yaml.mjs';

test('scalars parse to the right JavaScript types', () => {
  const doc = parseYaml(`
a_string: hello world
a_sha: 83b5f98d886e7831bbd2a1aac24f5cbb68701f51
an_int: 80
a_float: 1.5
yes_flag: true
no_flag: false
nothing: null
tilde: ~
empty:
quoted: "true"
`);
  assert.equal(doc.a_string, 'hello world');
  assert.equal(doc.a_sha, '83b5f98d886e7831bbd2a1aac24f5cbb68701f51', 'a hex sha must stay a string');
  assert.equal(doc.an_int, 80);
  assert.equal(doc.a_float, 1.5);
  assert.equal(doc.yes_flag, true);
  assert.equal(doc.no_flag, false);
  assert.equal(doc.nothing, null);
  assert.equal(doc.tilde, null);
  assert.equal(doc.empty, null);
  assert.equal(doc.quoted, 'true', 'a quoted boolean stays a string');
});

test('nested maps, sequences and sequences of maps round-trip', () => {
  const source = {
    version: 1,
    programme: { active: 'KF-META-AUTO-001', health: 'GREEN', touched: false },
    list: ['a', 'b', 'c'],
    entries: [
      { id: 'one', ok: true },
      { id: 'two', ok: false },
    ],
  };
  const parsed = parseYaml(stringifyYaml(source));
  assert.deepEqual(parsed, source);
});

test('REGRESSION: an empty map survives a write/read round trip', () => {
  // The serializer emits `{}`; the parser must accept it. A codec whose writer
  // produces something its reader rejects corrupts state on the first save.
  const source = { agents: {}, items: [], nested: { inner: {} } };
  const text = stringifyYaml(source);
  assert.match(text, /agents: \{\}/);
  assert.deepEqual(parseYaml(text), source);
});

test('an empty map and null stay distinguishable', () => {
  const parsed = parseYaml('a: {}\nb: null\n');
  assert.deepEqual(parsed.a, {});
  assert.equal(parsed.b, null);
});

test('folded and literal block scalars are read', () => {
  const doc = parseYaml(`
folded: >
  line one
  line two
literal: |
  step 1
  step 2
after: tail
`);
  assert.equal(doc.folded, 'line one line two');
  assert.equal(doc.literal, 'step 1\nstep 2');
  assert.equal(doc.after, 'tail', 'the block must not swallow the next key');
});

test('multi-line strings survive a round trip as literal blocks', () => {
  const source = { note: 'first line\nsecond line' };
  assert.deepEqual(parseYaml(stringifyYaml(source)), source);
});

test('inline flow sequences are read', () => {
  const doc = parseYaml('deps: [A, B, C]\nempty: []\n');
  assert.deepEqual(doc.deps, ['A', 'B', 'C']);
  assert.deepEqual(doc.empty, []);
});

test('comments are stripped but "#" inside a value is kept', () => {
  const doc = parseYaml('key: value # trailing comment\n# whole line\nurl: https://x/y#frag\nphase: KF-EXEC-GROWTH-001#closed_loop\n');
  assert.equal(doc.key, 'value');
  assert.equal(doc.url, 'https://x/y#frag');
  assert.equal(doc.phase, 'KF-EXEC-GROWTH-001#closed_loop', 'a phase reference must not be truncated');
});

test('values that look like YAML keywords are quoted on write', () => {
  const round = parseYaml(stringifyYaml({ a: 'true', b: 'null', c: '80', d: 'plain' }));
  assert.equal(round.a, 'true');
  assert.equal(round.b, 'null');
  assert.equal(round.c, '80');
  assert.equal(round.d, 'plain');
});

test('unsupported constructs throw instead of parsing to something wrong', () => {
  assert.throws(() => parseYaml('a: &anchor x\n'), /anchors/);
  assert.throws(() => parseYaml('a: {b: 1}\n'), /flow mappings/);
  assert.throws(() => parseYaml('a:\n\tb: 1\n'), /tabs/);
});

test('the real control artifacts on this branch parse', () => {
  for (const file of ['.agent-control/active-packet.yaml', '.agent-control/claude-return.yaml']) {
    const doc = parseYaml(fs.readFileSync(file, 'utf8'));
    assert.equal(doc.packet_id, 'KF-META-AUTO-001', `${file} must expose packet_id`);
    assert.equal(typeof doc.production_touched, 'boolean', `${file} production_touched must be boolean`);
  }
});

test('the programme DAG parses and keeps its quoted wave key as a string', () => {
  const dag = parseYaml(fs.readFileSync('docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml', 'utf8'));
  assert.ok(dag.packets.length === 35);
  assert.equal(dag.selection_policy.wave_order[0], '0');
  assert.equal(typeof dag.selection_policy.wave_order[0], 'string');
});

test('multi-line plain scalars fold, in sequences and in mappings', () => {
  const doc = parseYaml(`
open_questions:
  - whether the autopilot package should be subject to the gate,
    which today keys on impl/* and so does not apply to it
  - a short one
summary: a value that runs on
  to a second line
after: tail
`);
  assert.equal(
    doc.open_questions[0],
    'whether the autopilot package should be subject to the gate, which today keys on impl/* and so does not apply to it',
  );
  assert.equal(doc.open_questions[1], 'a short one');
  assert.equal(doc.summary, 'a value that runs on to a second line');
  assert.equal(doc.after, 'tail', 'folding must stop at the next key');
});

test('a "#" after whitespace in a plain scalar is a comment, per YAML', () => {
  // Documented deliberately: prose like "applies to PR #86" in an UNQUOTED
  // control field truncates at the "#", exactly as a conforming YAML parser
  // would. Quote the value when the "#" is meant to survive.
  assert.equal(parseYaml('a: applies to PR #86\n').a, 'applies to PR');
  assert.equal(parseYaml('a: "applies to PR #86"\n').a, 'applies to PR #86');
  assert.equal(parseYaml('a: refs/heads#86\n').a, 'refs/heads#86');
});
