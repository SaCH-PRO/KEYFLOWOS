/**
 * Bounded, dependency-free evaluator for flow conditions and small
 * expressions. Replaces `new Function` (which executed tenant-supplied code
 * with full Node access — an RCE).
 *
 * Grammar (recursive descent, precedence low→high):
 *   expr      := orExpr
 *   orExpr    := andExpr ("||" andExpr)*
 *   andExpr   := notExpr ("&&" notExpr)*
 *   notExpr   := "!" notExpr | comparison
 *   comparison:= primary (("=="|"==="|"!="|"!=="|">="|"<="|">"|"<") primary)?
 *   primary   := literal | path | "(" expr ")"
 *   literal   := "string" | 'string' | number | true | false | null
 *   path      := ident ("." ident)*        (resolved against the context)
 *
 * Anything outside this grammar evaluates to false / undefined. There is no
 * function call, no property accessor beyond dotted paths, no assignment.
 */

type Token =
  | { kind: 'op'; value: string }
  | { kind: 'str'; value: string }
  | { kind: 'num'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'ident'; value: string };

const OPS = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '!', '(', ')', '>', '<'];

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"' || ch === "'") {
      const end = input.indexOf(ch, i + 1);
      if (end === -1) return null;
      tokens.push({ kind: 'str', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      const num = Number(input.slice(i, j));
      if (Number.isNaN(num)) return null;
      tokens.push({ kind: 'num', value: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_$.]/.test(input[j])) j++;
      const word = input.slice(i, j);
      if (word === 'true' || word === 'false') tokens.push({ kind: 'bool', value: word === 'true' });
      else if (word === 'null' || word === 'undefined') tokens.push({ kind: 'null' });
      else tokens.push({ kind: 'ident', value: word });
      i = j;
      continue;
    }
    const op = OPS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ kind: 'op', value: op });
      i += op.length;
      continue;
    }
    return null; // unsupported character
  }
  return tokens;
}

function getPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private context: Record<string, unknown>) {}

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token | undefined { return this.tokens[this.pos++]; }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.kind === 'op' && t.value === v;
  }

  parseExpr(): unknown { return this.parseOr(); }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.isOp('||')) {
      this.next();
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseNot();
    while (this.isOp('&&')) {
      this.next();
      const right = this.parseNot();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseNot(): unknown {
    if (this.isOp('!')) {
      this.next();
      return !this.parseNot();
    }
    return this.parseComparison();
  }

  private parseComparison(): unknown {
    const left = this.parsePrimary();
    const t = this.peek();
    if (t?.kind === 'op' && ['==', '===', '!=', '!==', '>', '>=', '<', '<='].includes(t.value)) {
      this.next();
      const right = this.parsePrimary();
      switch (t.value) {
        case '==': case '===': return left === right;
        case '!=': case '!==': return left !== right;
        case '>': return Number(left) > Number(right);
        case '>=': return Number(left) >= Number(right);
        case '<': return Number(left) < Number(right);
        case '<=': return Number(left) <= Number(right);
      }
    }
    return left;
  }

  private parsePrimary(): unknown {
    if (this.isOp('(')) {
      this.next();
      const value = this.parseExpr();
      if (!this.isOp(')')) throw new Error('unbalanced parentheses');
      this.next();
      return value;
    }
    const t = this.next();
    if (!t) throw new Error('unexpected end of expression');
    switch (t.kind) {
      case 'str': case 'num': case 'bool': return t.value;
      case 'null': return null;
      case 'ident': {
        const direct = this.context[t.value];
        if (direct !== undefined) return direct;
        const underscored = this.context[`_${t.value}`];
        if (underscored !== undefined) return underscored;
        return getPath(this.context, t.value);
      }
      default: throw new Error('unexpected token');
    }
  }
}

/** Safely evaluate a boolean condition against a context. False on any error. */
export function evaluateCondition(expression: string, context: Record<string, unknown>): boolean {
  try {
    const tokens = tokenize(expression);
    if (!tokens || tokens.length === 0) return false;
    const parser = new Parser(tokens, context);
    const value = parser.parseExpr();
    return Boolean(value);
  } catch {
    return false;
  }
}

/** Safely evaluate an expression to a value (used by small transform fields). */
export function evaluateValue(expression: string, context: Record<string, unknown>): unknown {
  try {
    const tokens = tokenize(expression);
    if (!tokens || tokens.length === 0) return undefined;
    return new Parser(tokens, context).parseExpr();
  } catch {
    return undefined;
  }
}
