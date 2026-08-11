/**
 * A service Nest builds on every boot that nothing can ever call.
 *
 * FOUND BY WALKING INTO ONE. `ChaserService`'s own docstring says "Runs daily
 * (8am business timezone) or on demand". It has no @Cron, no @Interval, no
 * @OnEvent, and `chaseBusiness` has zero callers anywhere in the tree. It is
 * imported, provided, exported and constructed, and it has never run once.
 *
 * That is a specific and expensive shape of dead code, because every signal
 * says it is alive: it appears in a module, it is exported, the docstring
 * describes a schedule, and a reader has to check three separate reachability
 * mechanisms to discover otherwise. The capability map found the same thing
 * independently about KeyCortexSagaExecutorService — "has no non-spec caller" —
 * which is how a compensating-transaction engine came to be written, correct,
 * and never executed.
 *
 * REACHABILITY, the three ways a Nest provider is legitimately used:
 *   1. injected into another class's constructor, or fetched via moduleRef
 *   2. driven by the framework — @Cron, @Interval, @Timeout, @OnEvent, or a
 *      lifecycle hook like OnModuleInit
 *   3. attached by decorator — @UseGuards(X), @UseInterceptors(X). Guards and
 *      interceptors are NEVER injected, so a check that ignores this reports
 *      every guard in the codebase as dead. Measured: AuthGuard has 1,026
 *      decorator uses and zero injections.
 *
 * Anything reachable by none of the three is constructed for nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..');

/**
 * Services that are unreachable today and acknowledged.
 *
 * A DEBT LEDGER that may only SHRINK, in the same shape as
 * ACKNOWLEDGED_UNSCOPED, UNPRICED_ACKNOWLEDGED and UNENFORCED_ACKNOWLEDGED. Its
 * value is not that these are fine — several are things the product is
 * advertised as doing — but that a SEVENTH cannot appear without someone
 * noticing.
 *
 * Deleting or wiring them is a product decision and deliberately not made here:
 * KeyCortexSagaExecutorService in particular is the compensation engine the
 * cross-department work will need, and wiring ChaserService would start sending
 * nudges to real users who have never received one.
 */
const UNREACHABLE_ACKNOWLEDGED = new Set<string>([
  // Docstring claims "Runs daily (8am business timezone)". It does not run.
  'ChaserService',
  // The compensation engine: written, correct, reverse-order, and never
  // executed. Named in docs/CAPABILITY_MAP_2026-08-09.md.
  'KeyCortexSagaExecutorService',
  'KeyAuditorService',
  'KeyPlannerService',
  'KnowledgeIngestionService',
  // Slack integration that nothing calls.
  'SlackService',

  // ── Two protective interceptors that never run ────────────────────────────
  //
  // Found by this gate rather than by hand, and they are the sharper half of
  // the finding: both are SAFETY middleware, and neither is referenced anywhere
  // outside its own file. Not injected, not attached with @UseInterceptors, and
  // not registered as APP_INTERCEPTOR in app.module.ts — which does register
  // four others, so the pattern was known and these were simply left out.
  //
  //   RequestTimeoutInterceptor — no request timeout is enforced anywhere.
  //   IdempotencyInterceptor    — HTTP-level replay protection is absent. The
  //                               tool layer has its own idempotency keys, so
  //                               this is not the only defence, but it is not
  //                               a defence at all today.
  //
  // Deliberately NOT wired here. Turning on a request timeout starts killing
  // long requests that currently succeed, and turning on idempotency changes
  // write semantics for every POST — both are product decisions with live
  // blast radius, and this session has already spent its time undoing one of
  // those made carelessly.
  'RequestTimeoutInterceptor',
  'IdempotencyInterceptor',
]);

const FRAMEWORK_DRIVEN =
  /@Cron\(|@Interval\(|@Timeout\(|@OnEvent\(|OnModuleInit|OnModuleDestroy|OnApplicationBootstrap|OnApplicationShutdown/;

function tsFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist'].includes(e.name)) continue;
      out = out.concat(tsFiles(p));
    } else if (/\.ts$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

interface Finding {
  name: string;
  file: string;
}

function analyse(): { scanned: number; services: number; unreachable: Finding[] } {
  const files = tsFiles(SRC);
  const sources = files.map((f) => ({ f, src: readFileSync(f, 'utf8') }));

  const services: Array<{ name: string; f: string; src: string }> = [];
  for (const { f, src } of sources) {
    for (const m of src.matchAll(/@Injectable\(\)[\s\S]{0,120}?export class (\w+)/g)) {
      services.push({ name: m[1], f, src });
    }
  }

  const unreachable: Finding[] = [];
  for (const { name, f, src } of services) {
    if (FRAMEWORK_DRIVEN.test(src)) continue;

    // Attached by decorator — the mechanism guards and interceptors use.
    const byDecorator = new RegExp(`@(UseGuards|UseInterceptors|UseFilters|UsePipes)\\([^)]*\\b${name}\\b`);
    if (sources.some((s) => byDecorator.test(s.src))) continue;

    // Injected, or pulled out of the container, or aliased to a token.
    const byInjection = new RegExp(
      `(private|public|protected|readonly)\\s+\\w+\\s*:\\s*${name}\\b` +
        `|Inject\\(\\s*${name}\\s*\\)` +
        `|get\\(\\s*${name}\\b` +
        `|use(Existing|Class):\\s*${name}\\b`,
    );
    if (sources.some((s) => s.f !== f && byInjection.test(s.src))) continue;

    // Or any of its methods called by name.
    const methods = [...src.matchAll(/^  (?:async )?([a-zA-Z][\w]*)\(/gm)]
      .map((m) => m[1])
      .filter((m) => m !== 'constructor');
    const called = methods.some((m) =>
      sources.some((s) => s.f !== f && new RegExp(`\\.${m}\\(`).test(s.src)),
    );
    if (called) continue;

    unreachable.push({ name, file: relative(SRC, f).split(sep).join('/') });
  }

  return { scanned: files.length, services: services.length, unreachable };
}

describe('every provider the server builds can be reached', () => {
  const result = analyse();

  it('finds both sides — this check is not vacuous', () => {
    expect(result.scanned, 'no source files walked').toBeGreaterThan(500);
    expect(result.services, 'no @Injectable classes found — the reader is broken').toBeGreaterThan(300);
  });

  it('recognises decorator-attached guards as reachable', () => {
    // The false-positive class, pinned. Guards are never injected; a check that
    // only looks for injection reports all 9 of them as dead, and whoever reads
    // that output stops trusting the gate.
    const names = result.unreachable.map((u) => u.name);
    expect(names).not.toContain('AuthGuard');
    expect(names).not.toContain('BusinessGuard');
    expect(names).not.toContain('PlanLimitGuard');
  });

  it('no NEW provider is constructed on every boot and never reached', () => {
    const fresh = result.unreachable
      .filter((u) => !UNREACHABLE_ACKNOWLEDGED.has(u.name))
      .map((u) => `${u.name} (${u.file})`);

    expect(
      fresh,
      'These are @Injectable, registered, constructed on every boot — and reachable ' +
        'by none of the three mechanisms: constructor injection, framework decorators ' +
        '(@Cron/@OnEvent/lifecycle), or @UseGuards-style attachment. Every signal says ' +
        'they are alive. Wire it, delete it, or add it to UNREACHABLE_ACKNOWLEDGED, ' +
        'which may only shrink.',
    ).toEqual([]);
  });

  it('the ledger names no ghosts and may only shrink', () => {
    const stillDead = new Set(result.unreachable.map((u) => u.name));
    const revived = [...UNREACHABLE_ACKNOWLEDGED].filter((n) => !stillDead.has(n));
    expect(
      revived,
      'these are reachable now — take them off the ledger so the remaining count ' +
        'means "still dead" and nothing else',
    ).toEqual([]);
  });
});
