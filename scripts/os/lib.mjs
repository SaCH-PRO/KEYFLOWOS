// Shared parsing utilities for the operating-layer scripts (scripts/os/*).
//
// These deliberately implement a tiny state-machine lexer instead of regex
// scans: the gate files these scripts read are full of comments containing
// apostrophes, quotes and brackets ("a provider's own redelivery key"), and a
// grep-count over that text is exactly the measurement bug VERIFIED_STATE
// rule 1 warns about. Known limit: template literals containing nested
// backticks inside ${} interpolation are not handled; none of the scanned
// files use them.

const REGEX_PRECEDING_CHARS = new Set([
  '', '(', '[', '{', ',', ';', ':', '=', '!', '?', '&', '|', '^', '~', '+', '-', '*', '%', '<', '>', '\n',
]);
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'throw', 'case', 'in', 'of', 'typeof', 'void', 'delete', 'yield', 'await', 'else', 'do',
]);

function isRegexStart(src, idx, prevSigChar, prevWord) {
  if (REGEX_PRECEDING_CHARS.has(prevSigChar)) return true;
  if (REGEX_PRECEDING_KEYWORDS.has(prevWord)) return true;
  // Also allow after a line start where prevSigChar wasn't updated yet
  if (idx === 0) return true;
  return false;
}

/** Replace // and /* *​/ comments with spaces, preserving strings and regex literals. */
export function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let state = 'code'; // code | line | block | sq | dq | tpl | regex
  let regexInClass = false;
  let prevSigChar = '';
  let prevWord = '';
  let wordBoundary = true;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; wordBoundary = true; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && next === '*') { state = 'block'; wordBoundary = true; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && isRegexStart(src, i, prevSigChar, prevWord)) {
        state = 'regex';
        regexInClass = false;
        prevSigChar = '/';
        prevWord = '';
        wordBoundary = true;
        i++;
        continue;
      }
      if (c === "'") { state = 'sq'; prevSigChar = "'"; prevWord = ''; wordBoundary = true; }
      else if (c === '"') { state = 'dq'; prevSigChar = '"'; prevWord = ''; wordBoundary = true; }
      else if (c === '`') { state = 'tpl'; prevSigChar = '`'; prevWord = ''; wordBoundary = true; }
      else if (/[A-Za-z0-9_$]/.test(c)) {
        prevWord = wordBoundary ? c : prevWord + c;
        wordBoundary = false;
        prevSigChar = c;
      } else if (!/\s/.test(c)) {
        prevSigChar = c;
        prevWord = '';
        wordBoundary = true;
      } else {
        wordBoundary = true;
      }
      i++;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') state = 'code';
      else out[i] = ' ';
      i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c !== '\n') out[i] = ' ';
      i++;
      continue;
    }
    if (state === 'regex') {
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') { state = 'code'; regexInClass = false; prevSigChar = '\n'; prevWord = ''; wordBoundary = true; i++; continue; }
      if (c === '[') { regexInClass = true; i++; continue; }
      if (c === ']' && regexInClass) { regexInClass = false; i++; continue; }
      if (c === '/' && !regexInClass) { state = 'code'; prevSigChar = '/'; prevWord = ''; wordBoundary = true; i++; continue; }
      i++;
      continue;
    }
    // inside a string
    if (c === '\\') { i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code';
    }
    i++;
  }
  return out.join('');
}

/**
 * Return the initializer text of `const <name> = ...` (export optional).
 * Bracket-delimited initializers are captured to their matching close;
 * scalar initializers are captured to the terminating semicolon.
 * Throws if the constant is not found or has an empty/unterminated initializer —
 * "not found" must never read as 0.
 */
export function extractInitializer(src, name) {
  const clean = stripComments(src);
  const decl = new RegExp(`(?:export\\s+)?const\\s+${name}\\b`, 'm');
  const m = decl.exec(clean);
  if (!m) throw new Error(`constant ${name} not found`);
  let i = m.index + m[0].length;
  const n = clean.length;
  // Advance past optional TypeScript type annotation (handles generics, `{ a: number; b: string }`,
  // arrow types `=>`, and string literal types `'a;b=c'`).
  let typeDepth = 0;
  let typeState = 'code';
  let foundEq = false;
  for (; i < n; i++) {
    const c = clean[i];
    if (typeState !== 'code') {
      if (c === '\\') { i++; continue; }
      if ((typeState === 'sq' && c === "'") || (typeState === 'dq' && c === '"') || (typeState === 'tpl' && c === '`')) {
        typeState = 'code';
      }
      continue;
    }
    if (c === "'") { typeState = 'sq'; continue; }
    if (c === '"') { typeState = 'dq'; continue; }
    if (c === '`') { typeState = 'tpl'; continue; }
    // Skip `=>` arrow-function type operator before checking `<`/`>` or `=`
    if (c === '=' && clean[i + 1] === '>') { i++; continue; }
    if (c === '<' || c === '(' || c === '[' || c === '{') { typeDepth++; continue; }
    if (c === '>' || c === ')' || c === ']' || c === '}') { if (typeDepth > 0) typeDepth--; continue; }
    if (typeDepth === 0 && c === '=' && clean[i + 1] !== '=') {
      i++;
      foundEq = true;
      break;
    }
    if (typeDepth === 0 && c === ';') break;
  }
  if (!foundEq) throw new Error(`constant ${name} initializer not found`);
  while (i < n && /\s/.test(clean[i])) i++;
  const start = i;
  let depth = 0;
  let sawBracket = false;
  let state = 'code';
  for (; i < n; i++) {
    const c = clean[i];
    if (state !== 'code') {
      if (c === '\\') { i++; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
      continue;
    }
    if (c === "'") { state = 'sq'; continue; }
    if (c === '"') { state = 'dq'; continue; }
    if (c === '`') { state = 'tpl'; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; sawBracket = true; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth < 0) throw new Error(`unbalanced initializer for ${name}`);
      if (sawBracket && depth === 0) return clean.slice(start, i + 1);
      continue;
    }
    if (!sawBracket && c === ';') {
      const scalar = clean.slice(start, i);
      if (!scalar.trim()) throw new Error(`empty initializer for ${name}`);
      return scalar;
    }
  }
  throw new Error(`unterminated initializer for ${name}`);
}

/** All string-literal values inside an (already comment-stripped) segment. */
export function stringLiterals(segment) {
  const out = [];
  let i = 0;
  const n = segment.length;
  let state = 'code';
  let buf = '';
  while (i < n) {
    const c = segment[i];
    if (state === 'code') {
      if (c === "'") { state = 'sq'; buf = ''; }
      else if (c === '"') { state = 'dq'; buf = ''; }
      i++;
      continue;
    }
    if (c === '\\') { buf += segment[i + 1]; i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"')) {
      out.push(buf);
      state = 'code';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  return out;
}

/**
 * Count keys of a record initializer: string literals immediately followed by
 * a colon. Correct for Record<string, string> too, where values are also
 * string literals and a plain literal count would double.
 */
export function recordKeyCount(segment) {
  let count = 0;
  let i = 0;
  const n = segment.length;
  let state = 'code';
  while (i < n) {
    const c = segment[i];
    if (state === 'code') {
      if (c === "'" || c === '"') { state = c === "'" ? 'sq' : 'dq'; }
      i++;
      continue;
    }
    if (c === '\\') { i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"')) {
      state = 'code';
      let j = i + 1;
      while (j < n && /\s/.test(segment[j])) j++;
      if (segment[j] === ':') count++;
    }
    i++;
  }
  return count;
}

/** Numeric values appearing as `key: <number>` pairs in a record initializer. */
export function recordNumericValues(segment) {
  const out = [];
  const re = /:\s*(-?\d+(?:\.\d+)?)\s*[,}]/g;
  let m;
  while ((m = re.exec(segment)) !== null) out.push(Number(m[1]));
  return out;
}

function countTopLevelItems(segment, openChar, closeChar, label) {
  const s = segment.trim();
  if (!s.startsWith(openChar) || !s.endsWith(closeChar)) {
    throw new Error(`expected ${label} initializer ${openChar}...${closeChar}`);
  }
  const inner = s.slice(1, -1);
  let count = 0;
  let hasToken = false;
  let depth = 0;
  let state = 'code';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (state !== 'code') {
      if (c === '\\') { i++; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
        state = 'code';
      }
      continue;
    }
    if (c === "'") { state = 'sq'; hasToken = true; continue; }
    if (c === '"') { state = 'dq'; hasToken = true; continue; }
    if (c === '`') { state = 'tpl'; hasToken = true; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; hasToken = true; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth < 0) throw new Error(`unbalanced ${label} initializer (unexpected ${c})`);
      continue;
    }
    if (depth === 0 && c === ',') {
      if (hasToken) { count++; hasToken = false; }
      continue;
    }
    if (!/\s/.test(c)) hasToken = true;
  }
  if (state !== 'code') throw new Error(`unterminated string in ${label} initializer`);
  if (depth !== 0) throw new Error(`unbalanced ${label} initializer (depth=${depth})`);
  if (hasToken) count++;
  return count;
}

/**
 * Count top-level elements of an array initializer `[...]` (already comment-stripped).
 * Fails closed on unbalanced brackets, multi-literal inputs, or unterminated strings.
 */
export function arrayElementCount(segment) {
  return countTopLevelItems(segment, '[', ']', 'array');
}

/**
 * Count top-level properties (depth 1) of an object literal `{...}` (already
 * comment-stripped). Supports quoted and bare identifier keys, ignores nested
 * object keys, and fails closed on malformed inputs.
 */
export function objectKeyCount(segment) {
  return countTopLevelItems(segment, '{', '}', 'object');
}

/**
 * Sum `count: <non-negative integer>` fields inside a Record<string, { count: number, ... }>
 * initializer. Verifies every top-level entry contributes a `count:` field so a missing
 * count can never read silently as 0.
 */
export function recordCountFieldSum(segment) {
  const entries = objectKeyCount(segment);
  if (entries === 0) return 0;
  const counts = [];
  const re = /\bcount\s*:\s*(\d+)\s*[,}]/g;
  let m;
  while ((m = re.exec(segment)) !== null) counts.push(Number(m[1]));
  if (counts.length !== entries) {
    throw new Error(`expected ${entries} nested count fields, found ${counts.length}`);
  }
  return counts.reduce((a, b) => a + b, 0);
}

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * Extract active (non-comment) `run:` commands from a GitHub Actions workflow YAML.
 * Supports inline `run:`, flow mapping `{ ..., run: ... }`, and block scalars `run: |` / `run: >`.
 */
export function extractWorkflowRunCommands(source) {
  const lines = source.split(/\r?\n/).map((line) => (/^\s*#/.test(line) ? '' : line));
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*(?:- )?)run:[ \t]*(.*)$/.exec(lines[i]) || /[{,]\s*run:[ \t]*()(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] && !/^[|>][+-]?\s*$/.test(m[2])) {
      out.push({ line: i + 1, text: m[2].replace(/\s*[},]\s*$/, '') });
      continue;
    }
    const keyIndent = m[1].length;
    const block = [];
    let j = i + 1;
    for (; j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > keyIndent); j += 1) {
      block.push(lines[j]);
    }
    out.push({ line: i + 1, text: block.join('\n') });
    i = j - 1;
  }
  return out;
}

const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Parse `--max-warnings <N>` from an active `pnpm --filter <workspace> lint --max-warnings <N>`
 * command in a GitHub Actions workflow YAML. Strips YAML and inline shell `#` comments, requires
 * `pnpm` as the actual command word (rejecting `echo` and commented spoofs), and fails closed if
 * zero or more than one active run matches.
 */
export function parseWorkflowMaxWarnings(source, workspace) {
  const matches = [];
  for (const run of extractWorkflowRunCommands(source)) {
    const joined = run.text.replace(/\\\r?\n\s*/g, ' ');
    const uncommented = joined
      .split(/\r?\n/)
      .map((line) => line.replace(/(^|[\s;&|()])#.*$/, '$1'))
      .join('\n');
    const commands = uncommented
      .split(/\r?\n|;|&&|\|\|/)
      .flatMap((pipeline) => pipeline.split('|').map((command, k) => ({ command, head: k === 0 })));
    for (const { command, head: atHead } of commands) {
      let tokens = command.trim().split(/\s+/).filter(Boolean);
      let head = atHead;
      const stripEnv = () => {
        while (tokens.length && ENV_ASSIGNMENT_RE.test(tokens[0])) {
          tokens.shift();
          head = false;
        }
      };
      stripEnv();
      for (let stripped = true; stripped; ) {
        stripped = false;
        if (head && tokens[0] === 'time') {
          tokens.shift();
          stripped = true;
          stripEnv();
        } else if (tokens[0] === 'timeout' && tokens.length >= 2) {
          tokens = tokens.slice(2);
          stripped = true;
          head = false;
        }
      }
      if (tokens[0] !== 'pnpm') continue;
      let sawFilter = false;
      let sawLint = false;
      let maxWarnings = null;
      for (let t = 1; t < tokens.length; t += 1) {
        const tok = tokens[t];
        if (tok === '--filter' && tokens[t + 1] === workspace) {
          sawFilter = true;
          t += 1;
        } else if (tok === `--filter=${workspace}`) {
          sawFilter = true;
        } else if (tok === 'lint') {
          sawLint = true;
        } else if (tok === '--max-warnings' && /^\d+$/.test(tokens[t + 1] ?? '')) {
          maxWarnings = Number(tokens[t + 1]);
          t += 1;
        } else if (tok.startsWith('--max-warnings=')) {
          const val = tok.slice('--max-warnings='.length);
          if (/^\d+$/.test(val)) maxWarnings = Number(val);
        }
      }
      if (sawFilter && sawLint && maxWarnings !== null) {
        matches.push(maxWarnings);
      }
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly 1 active pnpm lint --max-warnings command for workspace "${workspace}", found ${matches.length}`,
    );
  }
  return matches[0];
}
