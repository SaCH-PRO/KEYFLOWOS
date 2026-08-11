/**
 * Which advertised events can actually fire.
 *
 * A listener with no emitter is a feature that silently never happens: the
 * automation is offered in the UI, the handler is written and tested, and the
 * event never arrives. Nothing fails. It is the same silent-zero shape as the
 * two statement-sweep defects, one layer up.
 *
 * Counting them is harder than it looks, and every quick attempt gets it wrong
 * in the SAME direction — over-reporting deaths, which is worse than useless
 * because it sends someone to "fix" working code:
 *
 *   grep "emit('x.y')"        misses this.emitEvent(businessId, 'x.y', row)
 *                             — a wrapper, used for all 11 content_request.*
 *   grep "emit(" only         misses emit(`content_request.${status}`)
 *                             — a template, which covers several listeners at
 *                             once and cannot be resolved statically at all
 *
 *   callee must say "emit"    misses the local wrapper
 *                               const queue = (name, p) => ...emit(name, p)
 *                             which is how EVERY invoice is sent
 *
 * A false death is worse than a missed one: it sends someone to "fix" working
 * code, and the fix is a duplicate emit. So this resolves FOUR ways and keeps
 * the uncertain ones out of the accusation:
 *
 *   LIVE       a literal inside an emit call — including calls to local
 *              wrappers that forward their first argument to .emit().
 *   DYNAMIC    no literal, but a template emit builds names with this prefix.
 *              Unknowable without running it; never counted as dead.
 *   UNVERIFIED the name is written down somewhere, but not anywhere this
 *              recognises as an emit. Could be an unmodelled wrapper. A human
 *              has to look; the script will not guess.
 *   DEAD       the name appears NOWHERE except the @OnEvent waiting for it.
 *              Absence of the string really does imply absence of the emit,
 *              which is the one claim this can make safely.
 *
 * Only DEAD is a finding. Run: npx tsx scripts/event-wiring.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(e.name) ? [p] : [];
  });
}

export interface EventWiring {
  /** A literal in an emit position, or a template that builds this name. */
  live: string[];
  dynamic: Array<{ event: string; prefix: string }>;
  /**
   * Mentioned somewhere, but never in anything this script recognises as an
   * emit. Could be a wrapper shape not modelled here, or could be genuinely
   * dead — a human has to look. NOT gated, precisely because it is a maybe.
   */
  unverified: string[];
  /**
   * `@OnEvent(SOMETHING)` where SOMETHING is a name this script cannot resolve
   * to a string. Not a death and not a life — a BLIND SPOT, surfaced so it
   * cannot be one silently. This bucket exists because @OnEvent(CONSTANT) was
   * invisible to the listener scan, so a dead listener passed the gate by not
   * being counted at all.
   */
  unresolvedListeners: string[];
  /** Appears nowhere but the @OnEvent waiting for it. Cannot fire. */
  dead: string[];
  emittedLiterals: number;
  listeners: number;
}

/** Looks like an event name: two or more dot-separated lower_snake segments. */
const EVENT_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_*]*)+$/i;

/**
 * The argument text of every call whose callee mentions "emit".
 *
 * The first version of this script counted ANY event-shaped literal anywhere
 * as proof the event was emitted, and was wrong in the dangerous direction —
 * it reported working listeners as live for reasons that were not emits:
 *
 *   events.types.ts        'invoice.sent': InvoiceStatusPayload   a TYPE MAP key
 *   ai.listener.ts         this.processEvent('invoice.sent', p)   the LISTENER
 *                                                                 forwarding to
 *                                                                 its own handler
 *   event-stream.service   this.broadcast(id, 'x.y', ...)         a WebSocket send
 *   cross-module-agent     triggerEvent: 'purchaseOrder.received' config
 *
 * None of those puts anything on the bus. Requiring an emit-shaped callee is
 * the difference between "this string exists" and "something emits it".
 */
function emitArgumentText(src: string): string {
  // Local wrappers count as emitters. invoice-workflow.service.ts:317 defines
  //
  //   const queue = (name, payload) => { ...; else this.events.emit(name, payload); }
  //   queue(`invoice.${lower}`, {...})
  //
  // and a version of this that required the callee itself to say "emit"
  // reported invoice.sent, invoice.void and invoice.payment_failed as DEAD.
  // They are not — that is the send path for every invoice in the product.
  // A false DEAD is worse than a missed one: it sends someone to "fix" code
  // that works, and the fix is a duplicate emit.
  const wrappers = new Set<string>();
  for (const m of src.matchAll(
    /(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=]*)?=>\s*\{([\s\S]{0,600}?)\n\s{0,6}\}/g,
  )) {
    const [, fnName, params, body] = m;
    const first = params.split(',')[0]?.trim().split(':')[0]?.trim();
    // Identifier only. A destructured first parameter — `({ businessId })` —
    // yields `{`, which is not a name to look for and is not a valid regex.
    if (!first || !/^[A-Za-z_$][\w$]*$/.test(first)) continue;
    if (new RegExp(`\\.emit\\(\\s*${first}\\b`).test(body)) wrappers.add(fnName);
  }

  const out: string[] = [];
  const calleePattern = wrappers.size
    ? new RegExp(`\\b(\\w*[eE]mit\\w*|${[...wrappers].join('|')})\\s*\\(`, 'g')
    : /\b(\w*[eE]mit\w*)\s*\(/g;
  const callee = calleePattern;
  for (let m = callee.exec(src); m; m = callee.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    // Balance to the matching close paren so the slice cannot bleed into the
    // next statement and manufacture evidence out of unrelated code.
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      i += 1;
    }
    out.push(src.slice(start, i));
  }
  return out.join('\n');
}

/**
 * `EXPORTED_CONST -> 'its.string.value'`, for resolving @OnEvent(CONSTANT) and
 * emit(CONSTANT).
 *
 * Built from @keyflow/shared and from the server tree, because an event name
 * declared once and referenced by symbol is the pattern that should be
 * ENCOURAGED — it is how `work.obligation.raised` avoids the rename drift this
 * whole file exists to catch — and it was the one shape the analyser could not
 * see.
 */
function buildEventConstants(files: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const sources = [...files];
  const shared = path.join(SRC, '..', '..', '..', 'packages', 'shared', 'src');
  if (existsSync(shared)) sources.push(...walk(shared));

  for (const file of sources) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(
      /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*['"`]([a-zA-Z][a-zA-Z0-9_.]*)['"`]/g,
    )) {
      if (EVENT_NAME.test(m[2])) out.set(m[1], m[2]);
    }
  }
  return out;
}

export function analyseEventWiring(): EventWiring {
  const files = walk(SRC);
  const EVENT_CONSTANTS = buildEventConstants(files);
  /** @OnEvent(SOMETHING) where SOMETHING is a name this cannot resolve. */
  const unresolvedListeners = new Set<string>();

  const listeners = new Set<string>();
  /** Event-shaped literals sitting inside an emit call — strong evidence. */
  const literals = new Set<string>();
  /**
   * Event-shaped literals ANYWHERE outside an @OnEvent — weak evidence.
   *
   * A name here might only be a type-map key or a config string, so it does not
   * prove the event fires. But its ABSENCE does prove the opposite: a name that
   * appears nowhere except the listener waiting for it cannot be emitted by
   * anything. That asymmetry is what makes the DEAD verdict safe to gate on.
   */
  const anyMention = new Set<string>();
  /** Prefixes built by template emits, e.g. `content_request.` */
  const dynamicPrefixes = new Set<string>();

  for (const file of files) {
    const src = readFileSync(file, 'utf8');

    // What is waited for.
    for (const m of src.matchAll(/@OnEvent\(\s*['"`]([^'"`]+)['"`]/g)) {
      listeners.add(m[1]);
    }

    // …and what is waited for by NAME rather than by literal.
    //
    // This pattern was invisible for as long as it existed. The scan above
    // matches @OnEvent( followed by a QUOTE, so `@OnEvent(WORK_OBLIGATION_RAISED)`
    // was not judged live — it was never seen as a listener at all, and the
    // gate passed by measuring nothing. That is the same shape as the honesty
    // sweep that could not see a braceless handler and the tenant gate that
    // could not see an unscoped model: the check was fine, its input was short.
    //
    // Constants are resolved against exported string literals (see
    // EVENT_CONSTANTS). One that cannot be resolved is NOT quietly dropped —
    // it goes to `unresolvedListeners`, which the spec asserts is empty, so the
    // failure mode is a loud "I cannot see this" rather than a silent pass.
    for (const m of src.matchAll(/@OnEvent\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*[,)]/g)) {
      const resolved = EVENT_CONSTANTS.get(m[1]);
      if (resolved) listeners.add(resolved);
      else unresolvedListeners.add(m[1]);
    }

    // Strip @OnEvent decorators before looking for emits. The trailing [^)]*
    // matters: `@OnEvent('crm.deal.won', { async: true })` survived an earlier
    // version that required the paren immediately after the string, so the
    // listener's own name counted as proof something emitted it. A listener
    // cannot be its own emitter.
    // Both decorator forms are stripped. The constant form has to be, for the
    // same reason the literal form does — a listener cannot be its own emitter —
    // and leaving it in was measurably wrong: with the emit deleted,
    // `@OnEvent(WORK_OBLIGATION_SETTLED)` resolved to a name in emit-scanned
    // text and kept a genuinely dead listener looking alive.
    const withoutListeners = src
      .replace(/@OnEvent\(\s*['"`][^'"`]+['"`][^)]*\)/g, '@OnEvent(_)')
      .replace(/@OnEvent\(\s*[A-Za-z_$][A-Za-z0-9_$]*[^)]*\)/g, '@OnEvent(_)');

    // Weak evidence: the name is written down somewhere that is not a listener.
    for (const m of withoutListeners.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9_.]*)['"`]/g)) {
      if (EVENT_NAME.test(m[1])) anyMention.add(m[1]);
    }

    // Strong evidence: the literal sits inside an emit call.
    const emitText = emitArgumentText(withoutListeners);

    for (const m of emitText.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9_.]*)['"`]/g)) {
      if (EVENT_NAME.test(m[1])) literals.add(m[1]);
    }

    // emit(CONSTANT, payload) is a real emit and must count as one.
    //
    // Resolving listeners without also resolving emitters would be worse than
    // resolving neither: `@OnEvent(WORK_OBLIGATION_RAISED)` would become
    // visible while `emit(WORK_OBLIGATION_RAISED, payload)` stayed invisible,
    // and the gate would report a FALSE DEATH on a live event. This file's own
    // header says why that is the dangerous direction — it sends someone to
    // "fix" working code, and the fix is a duplicate emit.
    for (const m of emitText.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
      const resolved = EVENT_CONSTANTS.get(m[1]);
      if (resolved) literals.add(resolved);
    }

    // NOT fed into `anyMention`, and that asymmetry is deliberate.
    //
    // The weak-evidence bucket asks "is this string written down anywhere",
    // which is meaningful for a LITERAL: someone typed 'invoice.sent' for a
    // reason. It is meaningless for a SYMBOL. `WORK_OBLIGATION_SETTLED` appears
    // in its own declaration, in every import statement, and in the @OnEvent
    // waiting for it — so resolving symbols into anyMention would mean a
    // constant-named event can NEVER be reported dead, which is the failure this
    // whole change set out to fix.
    //
    // Measured, not reasoned: with the emit deleted, the first version of this
    // still reported work.obligation.settled as alive. Symbols count only in an
    // emit position, above.

    // Template emits: emit(`content_request.${newStatus}`) and
    // emitEvent(id, `agent.message.${topic}`).
    for (const m of emitText.matchAll(/[`]([a-zA-Z][a-zA-Z0-9_.]*\.)\$\{/g)) {
      dynamicPrefixes.add(m[1]);
    }
  }

  const live: string[] = [];
  const dynamic: Array<{ event: string; prefix: string }> = [];
  const unverified: string[] = [];
  const dead: string[] = [];

  for (const event of [...listeners].sort()) {
    // A wildcard listener takes whatever arrives; it cannot be dead.
    if (event.includes('*')) { live.push(event); continue; }

    if (literals.has(event)) { live.push(event); continue; }

    const prefix = [...dynamicPrefixes].find((p) => event.startsWith(p));
    if (prefix) { dynamic.push({ event, prefix }); continue; }

    // The whole point of the split: only accuse when the name exists nowhere
    // else at all. Anything merely unrecognised is a question, not a finding.
    if (anyMention.has(event)) { unverified.push(event); continue; }

    dead.push(event);
  }

  return {
    live,
    dynamic,
    unverified,
    dead,
    unresolvedListeners: [...unresolvedListeners].sort(),
    emittedLiterals: literals.size,
    listeners: listeners.size,
  };
}

if (require.main === module) {
  const r = analyseEventWiring();
  console.log(`[event-wiring] ${r.listeners} listeners, ${r.emittedLiterals} event-shaped literals\n`);
  console.log(`  LIVE     ${r.live.length}`);
  console.log(`  DYNAMIC  ${r.dynamic.length}  (a template emit builds these — cannot be resolved statically)`);
  for (const d of r.dynamic) console.log(`             ${d.event}  <- \`${d.prefix}\${...}\``);
  console.log(`  UNVERIF  ${r.unverified.length}  (written down, but not in a recognised emit — needs a human)`);
  for (const d of r.unverified) console.log(`             ${d}`);
  console.log(`  DEAD     ${r.dead.length}`);
  for (const d of r.dead) console.log(`             ${d}`);
  if (r.dead.length) {
    console.log('\nA listener with no emitter is an automation the UI offers and');
    console.log('the product never performs. Emit it, or delete the listener.');
  }
}
