/**
 * Quoted-scalar escape decoding.
 *
 * Kept in its own file because these cases are dense in backslashes and are
 * easiest to read without the surrounding suite.
 *
 * Why this exists: the codec used to strip the quotes from a double-quoted
 * scalar without decoding its escapes, so a value written as
 *   find: "} elseif ($x -notlike \"*$y*\") {"
 * parsed with literal backslashes still in it. A negative-control manifest
 * using that form never matched the real file, and the control reported
 * VACUOUS -- which reads exactly like a genuine finding. A codec that parses
 * admission evidence must not quietly hand back a value the author did not
 * write.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, stringifyYaml } from '../lib/yaml.mjs';

test('REGRESSION: a double-quoted scalar decodes escaped quotes', () => {
  const doc = parseYaml('a: "say \\"hi\\""\n');
  assert.equal(doc.a, 'say "hi"');
});

test('REGRESSION: a doubled backslash decodes to one', () => {
  const doc = parseYaml('b: "c:\\\\tmp\\\\run"\n');
  assert.equal(doc.b, 'c:\\tmp\\run');
});

test('escaped n, t and r decode to their control characters', () => {
  assert.equal(parseYaml('c: "line\\nbreak"\n').c, 'line\nbreak');
  assert.equal(parseYaml('d: "tab\\there"\n').d, 'tab\there');
  assert.equal(parseYaml('e: "cr\\rhere"\n').e, 'cr\rhere');
});

test("a single-quoted scalar is literal except for a doubled ''", () => {
  assert.equal(parseYaml("a: 'it''s'\n").a, "it's");
  // A backslash inside single quotes is NOT an escape.
  assert.equal(parseYaml("b: 'c:\\tmp'\n").b, 'c:\\tmp');
});

test('the exact manifest form used by NC-WORKER-COMPLETION-MARKER round-trips', () => {
  // This is the shape that silently failed to match before the fix.
  const doc = parseYaml('find: "} elseif ($text -notlike \\"*$doneMarker*\\") {"\n');
  assert.equal(doc.find, '} elseif ($text -notlike "*$doneMarker*") {');
});

test('a value containing quotes survives a write/read round trip', () => {
  const source = {
    find: '} elseif ($text -notlike "*$doneMarker*") {',
    path: 'c:\\tmp\\run',
    note: 'he said "no"',
  };
  assert.deepEqual(parseYaml(stringifyYaml(source)), source);
});
