import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseYaml, stringifyYaml } from '../lib/yaml.mjs';
import { artifactBindingProblems, BINDING_PROBLEMS } from '../lib/admission.mjs';
import { branchPr } from './helpers/branch-pr.mjs';

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

test('NC mapping keys round-trip as the same keys, in mappings, nested mappings and sequence items (C10-F1)', () => {
  // Copilot r4171689174: a key holding a colon was written plain, so the line
  // either failed to parse or parsed to a different key.
  const keys = [':', 'a:b', 'a: b', '- z', '1.50', 'say "hi": now', "it's", 'tab\there', 'bell\bfeed\f', ''];
  for (const key of keys) {
    const source = { top: { [key]: 1 }, list: [{ [key]: 'v', after: true }], [key]: { inner: 'x' } };
    const text = stringifyYaml(source);
    assert.deepEqual(parseYaml(text), source, `${JSON.stringify(key)} must read back as itself`);
    assert.equal(stringifyYaml(parseYaml(text)), text, `${JSON.stringify(key)}: a second write is identical`);
  }
  // The same text as a value: a hold stores its packet id, and lists hold packet ids.
  for (const value of [...keys.filter((k) => k !== ''), 'a:', 'trailing ', '-']) {
    const source = { packet_id: value, list: [value, 'plain'] };
    assert.deepEqual(parseYaml(stringifyYaml(source)), source, `${JSON.stringify(value)} must read back as the same value`);
  }
  // Referent: an ordinary key is still written plain, so existing artifacts do not change.
  assert.equal(stringifyYaml({ 'KF-META-P': 1, 'impl/x': 2, a_b: { 'x.y': 3 } }), 'KF-META-P: 1\nimpl/x: 2\na_b:\n  x.y: 3\n');
  // Referent: a quoted key in hand-written YAML reads as its text.
  assert.deepEqual(parseYaml('"a: b": 1\n\'c: d\': 2\n"e\\"f": 3\n'), { 'a: b': 1, 'c: d': 2, 'e"f': 3 });
});

test('unsupported constructs throw instead of parsing to something wrong', () => {
  assert.throws(() => parseYaml('a: &anchor x\n'), /anchors/);
  assert.throws(() => parseYaml('a: {b: 1}\n'), /flow mappings/);
  assert.throws(() => parseYaml('a:\n\tb: 1\n'), /tabs/);
});

// Packet-agnostic since KF-META-STATE-REDUCER-LIVE-001, so the pin no longer
// has to be retargeted on every packet. Agreement between the two files is not
// enough (Copilot r4171689206): a pair copied from another packet agrees too.
// They are bound to the PR by the same rule admission applies (C10-F2).
test('the real control artifacts on this branch parse and are bound to one packet, branch and PR', () => {
  const docs = [];
  for (const file of ['.agent-control/active-packet.yaml', '.agent-control/claude-return.yaml']) {
    const doc = parseYaml(fs.readFileSync(file, 'utf8'));
    assert.equal(typeof doc.packet_id, 'string', `${file} must expose packet_id as text`);
    assert.match(doc.packet_id, /^KF-[A-Z0-9-]+$/, `${file} packet_id must be a packet id`);
    assert.equal(typeof doc.production_touched, 'boolean', `${file} production_touched must be boolean`);
    assert.match(String(doc.implementation_branch), /^impl\/\S+$/, `${file} must declare its implementation branch`);
    docs.push(doc);
  }
  const [active, ret] = docs;
  assert.deepEqual(artifactBindingProblems({ pr: branchPr(active), active, ret }), []);
  // Referent: the same real pair is rejected for any other PR, so the check above is not vacuous.
  const other = artifactBindingProblems({ pr: { head_ref: `${active.implementation_branch}-other`, number: 0 }, active, ret });
  assert.ok(other.some((p) => p.code === BINDING_PROBLEMS.BRANCH_NOT_PR_HEAD));
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

test('NC escaped comment: an escaped quote does not end the scalar, so a later " #" is value', () => {
  // The exact Copilot input: `packet_id: "KF\" # 1"` was cut at "#".
  assert.equal(parseYaml('packet_id: "KF\\" # 1"\n').packet_id, 'KF" # 1');
  assert.equal(parseYaml("packet_id: 'it''s # 1'\n").packet_id, "it's # 1");
  assert.equal(parseYaml('packet_id: "KF\\\\" # note\n').packet_id, 'KF\\', 'referent: an escaped backslash still closes');
  assert.equal(parseYaml('packet_id: "KF\\" # 1" # note\n').packet_id, 'KF" # 1', 'referent: the comment after the close is stripped');
});

test('REGRESSION: a block scalar as a sequence item is read', () => {
  // The real claude-return.yaml uses `- >` for long prose entries. The parser
  // rejected it, which meant a control artifact this codec must read was
  // unparseable by it. Caught in CI, not locally, because the artifact was
  // rewritten after the last local run.
  const doc = parseYaml(`
known_gaps:
  - >
    The reviewer adapters are configuration hooks: they report WAITING
    until credentials are supplied.
  - >
    A hosted runner cannot impersonate the interactive session.
  - a plain short entry
after: tail
`);
  assert.equal(doc.known_gaps.length, 3);
  assert.equal(doc.known_gaps[0], 'The reviewer adapters are configuration hooks: they report WAITING until credentials are supplied.');
  assert.equal(doc.known_gaps[1], 'A hosted runner cannot impersonate the interactive session.');
  assert.equal(doc.known_gaps[2], 'a plain short entry');
  assert.equal(doc.after, 'tail');
});

test('a literal block scalar as a sequence item keeps its newlines', () => {
  const doc = parseYaml('steps:\n  - |\n    one\n    two\n  - three\n');
  assert.equal(doc.steps[0], 'one\ntwo');
  assert.equal(doc.steps[1], 'three');
});
