/**
 * RR-ACTION-INTENT-ONE-CLASSIFIER (D-261, D-262): the one place where KEY
 * decides whether a message asks it to DO something.
 *
 * Before this packet six hand-written regexes carried six vocabularies that
 * disagreed (Flow's deliberation guard knew cancel / refund / pay / remove /
 * mark; the Cortex router, reasoning and structured-output classifiers and the
 * session intent extractor did not), so the same request opened the actions
 * layer on one path and not on another. This module is their union, word
 * bounded and case insensitive. Every site calls classifyActionIntent and
 * keeps its own decision around the answer.
 *
 * Authority: this only decides whether the actions layer / tool-calling
 * category is OFFERED. Every action still passes the same path as before
 * (autonomy orchestrator and approval on the Cortex, inline confirmation
 * through the action boundary on Flow, the tool allowlist, KEY_DISABLED);
 * enableActions false never yields actions. No Nest import: a pure function.
 */

/** The one vocabulary: the union of the six former regexes. */
export const ACTION_VERBS: readonly string[] = [
  'create', 'make', 'add', 'send', 'schedule', 'book', 'update', 'change', 'delete', 'remove', 'cancel',
  'invoice', 'draft', 'generate', 'assign', 'move', 'set', 'mark', 'pay', 'refund', 'publish', 'post',
  'run', 'execute', 'build', 'task', 'email', 'reminder', 'workflow',
];

const ACTION_VERB_PATTERN = new RegExp(`\\b(${ACTION_VERBS.join('|')})\\b`, 'gi');

export interface ActionIntent {
  /** True when at least one action verb appears as a whole word. */
  isAction: boolean;
  /** The verbs found, lower-cased, in order of first appearance, each once. */
  verbs: string[];
}

/** Pure: does `text` ask KEY to do something, and with which verbs. */
export function classifyActionIntent(text: string): ActionIntent {
  const verbs: string[] = [];
  for (const match of (text ?? '').matchAll(ACTION_VERB_PATTERN)) {
    const verb = match[1].toLowerCase();
    if (!verbs.includes(verb)) verbs.push(verb);
  }
  return { isAction: verbs.length > 0, verbs };
}
