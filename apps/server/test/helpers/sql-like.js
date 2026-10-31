/**
 * Escaped LIKE prefixes for fixture cleanup (R0-00-WT-ISOLATION).
 *
 * In SQL LIKE, '_' matches any one character and '%' any run. A cleanup written
 * as `WHERE id LIKE 'r0_%'` therefore also deletes the rows of a suite whose
 * prefix is 'r0q_'. Every new real-DB suite cleans up through sqlLikePrefix():
 *
 *   await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
 *
 * which expands to `id LIKE 'r0\_%' ESCAPE '\'`: the prefix matched literally,
 * then anything. apps/server/src/core/config/fixture-prefix-registry.spec.ts
 * rejects a new suite that writes LIKE any other way.
 *
 * This file is JavaScript on purpose, like key-action-boundary.fixture.js:
 * apps/server/tsconfig.json pins rootDir to ./src and includes test/**, relying
 * on every TypeScript file under test/ being excluded as *.test.ts or *.spec.ts.
 * A TypeScript helper here fails the server typecheck and build with TS6059.
 */

const ESCAPE = '\\';

/**
 * Escape LIKE wildcards ('%', '_') and the escape character itself, so the
 * value matches only itself.
 * @param {string} value
 * @returns {string}
 */
export function escapeLikePattern(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('escapeLikePattern: expected a non-empty string');
  }
  return value.replace(/[\\%_]/g, (c) => `${ESCAPE}${c}`);
}

/**
 * A complete SQL fragment, `'<escaped prefix>%' ESCAPE '\'`, for interpolation
 * after LIKE in a raw cleanup statement. Refuses a prefix containing a quote,
 * since it is spliced into SQL text.
 * @param {string} prefix
 * @returns {string}
 */
export function sqlLikePrefix(prefix) {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new TypeError('sqlLikePrefix: expected a non-empty prefix');
  }
  if (prefix.includes("'")) {
    throw new TypeError('sqlLikePrefix: a fixture prefix may not contain a quote');
  }
  return `'${escapeLikePattern(prefix)}%' ESCAPE '${ESCAPE}'`;
}
