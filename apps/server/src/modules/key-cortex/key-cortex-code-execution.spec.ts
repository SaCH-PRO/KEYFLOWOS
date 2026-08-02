/**
 * Two arbitrary-code-execution surfaces existed in the cortex. These tests pin
 * them closed at the source level, because a reviewer re-adding either would
 * otherwise reintroduce remote code execution silently.
 *
 *  1. key-cortex-sandbox.service.ts — $queryRawUnsafe(code) behind a regex
 *     "allowlist" that statement chaining defeats:
 *         /^(\s*SELECT\s+.*\s+FROM\s*"?(\w+)"?.*)$/i
 *     `.*$` matches greedily on one line, so
 *         SELECT * FROM Invoice; DROP TABLE x
 *     satisfies it — the captured table is the allowlisted `Invoice` and the
 *     trailing statement rides along.
 *
 *  2. key-cortex-flow-studio.service.ts — new Function() over flow-authored
 *     strings, both as a transform script and as `with(context) { ... }` for
 *     condition evaluation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

/**
 * Reduce a source file to executable code.
 *
 * Strips block comments, line comments, and regex literals. The last matters:
 * the sandbox defines a BLOCKLIST of patterns it rejects in user-submitted code,
 * e.g. `{ pattern: /eval\s*\(/, message: 'eval() is not allowed' }`. Scanning
 * raw text flags that defence as if it were the vulnerability.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*')) return false;
      // Blocklist entries name the very constructs we forbid, in order to reject
      // them in user-submitted code, e.g.
      //   { pattern: /eval\s*\(/, message: 'eval() is not allowed' }
      // Scanning those flags the defence as if it were the vulnerability.
      if (/^\{?\s*pattern:\s*\//.test(t)) return false;
      return true;
    })
    .join('\n');
}

describe('SQL execution surface', () => {
  const src = code(read('key-cortex-sandbox.service.ts'));

  it('never calls $queryRawUnsafe', () => {
    expect(src).not.toContain('$queryRawUnsafe');
  });

  it('does not reintroduce a regex-based SQL allowlist', () => {
    // A regex is not a SQL parser. If SQL execution returns it must be via
    // named parameterised queries, not pattern matching.
    expect(src).not.toMatch(/SELECT\\s\+\.\*\\s\+FROM/);
  });

  it('the documented bypass would defeat the old allowlist', () => {
    // Demonstrates why the old control could not hold, so nobody restores it.
    const oldAllowlist = /^(\s*SELECT\s+.*\s+FROM\s*"?(\w+)"?.*)$/i;
    const chained = 'SELECT * FROM Invoice; DROP TABLE x';
    expect(oldAllowlist.test(chained)).toBe(true);
    expect(chained.match(/FROM\s*"?(\w+)"?/i)?.[1]).toBe('Invoice');
  });
});

describe('flow-studio code execution surface', () => {
  const src = code(read('key-cortex-flow-studio.service.ts'));

  it('never constructs functions from flow data', () => {
    expect(src).not.toContain('new Function');
  });

  it('never uses a with(context) scope', () => {
    expect(src).not.toMatch(/with\s*\(\s*context\s*\)/);
  });

  it('does not eval', () => {
    expect(src).not.toMatch(/\beval\s*\(/);
  });
});

describe('repository-wide', () => {
  it('no cortex service INVOKES a function built from a string', async () => {
    // Constructing a Function compiles but does not run the body — verified:
    //   new Function('sideEffect()')    -> body NOT executed
    //   new Function('sideEffect()')()  -> body executed
    //
    // So `new Function(code);` with the result discarded is a syntax check, not
    // code execution. What must never come back is CALLING one: capturing it
    // (and therefore being able to call it) or invoking it inline.
    const { readdirSync } = await import('node:fs');
    const offenders: string[] = [];
    for (const f of readdirSync(__dirname)) {
      if (!f.endsWith('.service.ts')) continue;
      const src = code(read(f));
      const invocable =
        /=\s*new Function\s*\(/.test(src) || // captured, therefore callable
        /new Function\s*\([^)]*\)\s*\(/.test(src) || // invoked inline
        /\beval\s*\(/.test(src);
      if (invocable) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('the sandbox syntax check compiles without invoking', () => {
    const src = code(read('key-cortex-sandbox.service.ts'));
    expect(src).toMatch(/new Function\(code\);/); // present
    expect(src).not.toMatch(/=\s*new Function\(code\)/); // but never captured
  });
});
