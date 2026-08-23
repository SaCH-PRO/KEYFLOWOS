// Shared parsing utilities for the operating-layer scripts (scripts/os/*).
//
// These deliberately implement a tiny state-machine lexer instead of regex
// scans: the gate files these scripts read are full of comments containing
// apostrophes, quotes and brackets ("a provider's own redelivery key"), and a
// grep-count over that text is exactly the measurement bug VERIFIED_STATE
// rule 1 warns about. Known limit: template literals containing nested
// backticks inside ${} interpolation are not handled; none of the scanned
// files use them.

/** Replace // and /* *​/ comments with spaces, preserving string contents. */
export function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let state = 'code'; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && next === '*') { state = 'block'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
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
 * Throws if the constant is not found — "not found" must never read as 0.
 */
export function extractInitializer(src, name) {
  const clean = stripComments(src);
  const decl = new RegExp(`(?:export\\s+)?const\\s+${name}\\b[^=;]*=`, 'm');
  const m = decl.exec(clean);
  if (!m) throw new Error(`constant ${name} not found`);
  let i = m.index + m[0].length;
  const n = clean.length;
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
      if (sawBracket && depth === 0) return clean.slice(start, i + 1);
      continue;
    }
    if (!sawBracket && c === ';') return clean.slice(start, i);
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
