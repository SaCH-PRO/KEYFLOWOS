/**
 * Minimal YAML subset codec for KEYFLOWOS agent-control artifacts.
 *
 * Deliberately dependency-free: the control-plane scripts must run on a bare
 * `node` in any GitHub runner or developer shell without a pnpm install, and
 * the repository declares no YAML dependency at the root.
 *
 * Supported subset (this is the whole contract — anything else throws):
 *   - block mappings with 2-space nesting
 *   - block sequences of scalars and of mappings
 *   - inline flow sequences: [a, b, c]
 *   - folded (>) and literal (|) block scalars
 *   - scalars: null/~/empty, true/false, integers, floats, quoted and plain strings
 *   - '#' comments on their own line or after a value
 *
 * Not supported, by design: anchors, aliases, tags, multi-document streams,
 * complex keys, flow mappings. These throw rather than parse to something
 * plausible-but-wrong, because this codec parses admission evidence.
 */

const INDENT = '  ';

// ---------------------------------------------------------------- parsing

function stripComment(text) {
  // Only strip a '#' that starts a token, so URLs and SHAs survive.
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

function parseScalar(raw) {
  const text = stripComment(raw).trim();
  if (text === '' || text === '~' || text === 'null') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
  ) {
    return text.slice(1, -1);
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new Error(`yaml: unterminated flow sequence: ${text}`);
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((part) => parseScalar(part));
  }
  // Only the empty flow mapping is supported, because the serializer emits it
  // to distinguish "an empty map" from "null". A populated one still throws.
  if (text === '{}') return {};
  if (text.startsWith('{')) throw new Error(`yaml: non-empty flow mappings are not supported: ${text}`);
  if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) {
    throw new Error(`yaml: anchors/aliases/tags are not supported: ${text}`);
  }
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  return text;
}

function indentOf(line) {
  return line.length - line.replace(/^ +/, '').length;
}

function isBlank(line) {
  const t = line.trim();
  return t === '' || t.startsWith('#');
}

/** Consume a `>`/`|` block scalar starting after the marker line at `start`. */
function readBlockScalar(lines, start, parentIndent, style) {
  const collected = [];
  let i = start;
  let bodyIndent = null;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      collected.push('');
      i += 1;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (bodyIndent === null) bodyIndent = ind;
    collected.push(line.slice(bodyIndent));
    i += 1;
  }
  while (collected.length && collected[collected.length - 1] === '') collected.pop();

  if (style === '|') return [collected.join('\n'), i];

  // Folded: blank lines become newlines, consecutive non-blank lines join with a space.
  const parts = [];
  let buffer = [];
  for (const line of collected) {
    if (line === '') {
      if (buffer.length) parts.push(buffer.join(' '));
      buffer = [];
      parts.push('');
    } else {
      buffer.push(line.trim());
    }
  }
  if (buffer.length) parts.push(buffer.join(' '));
  return [parts.join('\n').replace(/\n{2,}/g, '\n'), i];
}

/**
 * Absorb continuation lines of a multi-line plain scalar.
 *
 * YAML folds a plain scalar that continues on more-indented lines:
 *   - whether the gate applies to chore/*,
 *     which today keys on impl/*
 * The real control artifacts use this, so it is part of the supported subset.
 * A continuation is any deeper line that is not a new list item and not a key.
 */
function absorbContinuation(lines, start, indent, initial) {
  const parts = [initial];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') break;
    if (line.trim().startsWith('#')) break;
    const ind = indentOf(line);
    if (ind <= indent) break;
    const body = line.slice(ind);
    if (body.startsWith('- ')) break;
    if (matchKey(body)) break;
    parts.push(stripComment(body).trim());
    i += 1;
  }
  return [parts.join(' '), i];
}

function parseNode(lines, start, indent) {
  let i = start;
  while (i < lines.length && isBlank(lines[i])) i += 1;
  if (i >= lines.length) return [null, i];

  const ind = indentOf(lines[i]);
  if (ind < indent) return [null, i];

  const isSequence = lines[i].slice(ind).startsWith('- ') || lines[i].slice(ind).trim() === '-';
  return isSequence ? parseSequence(lines, i, ind) : parseMapping(lines, i, ind);
}

function parseSequence(lines, start, indent) {
  const out = [];
  let i = start;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1;
      continue;
    }
    const ind = indentOf(lines[i]);
    if (ind < indent) break;
    const body = lines[i].slice(ind);
    if (!body.startsWith('- ') && body.trim() !== '-') break;
    if (ind > indent) throw new Error(`yaml: unexpected indent in sequence at line ${i + 1}`);

    const rest = body.trim() === '-' ? '' : body.slice(2).trim();
    i += 1;

    if (rest === '') {
      const [value, next] = parseNode(lines, i, indent + 1);
      out.push(value);
      i = next;
      continue;
    }

    // "- >" / "- |" open a block scalar as the sequence item itself.
    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      const [value, next] = readBlockScalar(lines, i, indent, rest[0]);
      out.push(value);
      i = next;
      continue;
    }

    // "- key: value" opens a mapping whose first key sits at indent + 2.
    const kv = matchKey(rest);
    if (kv) {
      const itemLines = [' '.repeat(indent + 2) + rest, ...lines.slice(i)];
      const [value, consumed] = parseMapping(itemLines, 0, indent + 2);
      out.push(value);
      i += consumed - 1;
      continue;
    }

    const [folded, next] = absorbContinuation(lines, i, indent, rest);
    i = next;
    out.push(parseScalar(folded));
  }
  return [out, i];
}

function matchKey(text) {
  const m = text.match(/^("[^"]*"|'[^']*'|[^:#]+?):(\s|$)/);
  if (!m) return null;
  const key = parseScalar(m[1]);
  return { key: String(key), rest: text.slice(m[0].length - (m[2] === '' ? 0 : m[2].length)).trim() };
}

function parseMapping(lines, start, indent) {
  const out = {};
  let i = start;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1;
      continue;
    }
    const ind = indentOf(lines[i]);
    if (ind < indent) break;
    if (ind > indent) throw new Error(`yaml: unexpected indent at line ${i + 1}: ${lines[i]}`);

    const body = lines[i].slice(ind);
    if (body.startsWith('- ')) break;

    const kv = matchKey(body);
    if (!kv) throw new Error(`yaml: cannot parse mapping entry at line ${i + 1}: ${lines[i]}`);

    const valueText = stripComment(kv.rest).trim();
    i += 1;

    if (valueText === '>' || valueText === '|' || valueText === '>-' || valueText === '|-') {
      const [value, next] = readBlockScalar(lines, i, ind, valueText[0]);
      out[kv.key] = value;
      i = next;
      continue;
    }

    if (valueText === '') {
      const [value, next] = parseNode(lines, i, ind + 1);
      out[kv.key] = value;
      i = next;
      continue;
    }

    const [folded, next] = absorbContinuation(lines, i, ind, valueText);
    i = next;
    out[kv.key] = parseScalar(folded);
  }
  return [out, i];
}

export function parseYaml(text) {
  if (typeof text !== 'string') throw new TypeError('parseYaml expects a string');
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => l.includes('\t'))) throw new Error('yaml: tabs are not permitted for indentation');
  const [value] = parseNode(lines, 0, 0);
  return value === null ? {} : value;
}

// ------------------------------------------------------------ serializing

const PLAIN_SAFE = /^[A-Za-z0-9_./:@+-][A-Za-z0-9 _./:@+-]*$/;

function formatScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('yaml: cannot serialize non-finite number');
    return String(value);
  }
  const text = String(value);
  if (text === '') return '""';
  if (text.includes('\n')) return null; // caller switches to a literal block
  const reserved = ['null', 'true', 'false', '~'];
  if (reserved.includes(text) || !PLAIN_SAFE.test(text) || /^-?\d+(\.\d+)?$/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function serialize(value, depth, lines) {
  const pad = INDENT.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines[lines.length - 1] += ' []';
      return;
    }
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        lines.push(`${pad}-`);
        const before = lines.length;
        serialize(item, depth + 1, lines);
        // Fold "-" and the first key onto one line for readability.
        if (lines.length > before) {
          lines[before - 1] = `${pad}- ${lines[before].trim()}`;
          lines.splice(before, 1);
        }
      } else {
        const scalar = formatScalar(item);
        lines.push(`${pad}- ${scalar === null ? JSON.stringify(String(item)) : scalar}`);
      }
    }
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    const safeKey = PLAIN_SAFE.test(key) && !/^\d+$/.test(key) ? key : JSON.stringify(key);
    if (item !== null && typeof item === 'object') {
      const empty = Array.isArray(item) ? item.length === 0 : Object.keys(item).length === 0;
      if (empty) {
        lines.push(`${safeKey ? pad + safeKey + ':' : pad}${Array.isArray(item) ? ' []' : ' {}'}`);
        continue;
      }
      lines.push(`${pad}${safeKey}:`);
      serialize(item, depth + 1, lines);
      continue;
    }
    const scalar = formatScalar(item);
    if (scalar === null) {
      lines.push(`${pad}${safeKey}: |`);
      for (const line of String(item).split('\n')) lines.push(`${pad}${INDENT}${line}`);
      continue;
    }
    lines.push(`${pad}${safeKey}: ${scalar}`);
  }
}

export function stringifyYaml(value) {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('stringifyYaml expects an object or array at the document root');
  }
  const lines = [];
  serialize(value, 0, lines);
  return lines.join('\n') + '\n';
}

export default { parseYaml, stringifyYaml };
