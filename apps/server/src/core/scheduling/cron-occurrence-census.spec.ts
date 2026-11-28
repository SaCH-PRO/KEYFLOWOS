/**
 * RR-CRON-OCCURRENCE-LOCK (D-261, D-262, D-17, D-257):
 *
 * Static census of every `@Cron(...)` handler under `apps/server/src`:
 *   - Every `@Cron` handler must be registered in `CRON_OCCURRENCE_CENSUS` as either:
 *       - `CLAIMED` (calls `claimOccurrence(...)` after the D-17 kill-switch check, with a unique job key), or
 *       - `IDEMPOTENT` (with an explicit reason explaining why duplicate execution in one slot is safe,
 *         or referencing MEM-CONSOLIDATION-CHECKPOINT per D-257).
 *   - Zero stale/ghost entries in `CRON_OCCURRENCE_CENSUS`.
 *   - Negative control: an unregistered synthetic `@Cron` handler MUST be caught by the scanner.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CRON_OCCURRENCE_CENSUS } from './occurrence-claim';

const SERVER_ROOT = join(__dirname, '..', '..', '..');
const SRC = join(SERVER_ROOT, 'src');

const posix = (abs: string) => relative(SERVER_ROOT, abs).split(sep).join('/');

interface ScannedCron {
  id: string;
  file: string;
  method: string;
  body: string;
}

function sourceFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'coverage'].includes(e.name)) continue;
      out = out.concat(sourceFiles(p));
    } else if (/\.ts$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function closeParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

function braceBlock(src: string, from: number): string {
  const open = src.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return '';
}

function scanCronHandlersInSource(file: string, src: string): ScannedCron[] {
  const out: ScannedCron[] = [];
  const re = /^\s*@Cron\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = closeParen(src, src.indexOf('(', m.index));
    for (;;) {
      const rest = src.slice(i);
      const trivia = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest);
      if (trivia && trivia[0].length > 0) {
        i += trivia[0].length;
        continue;
      }
      const deco = /^@[A-Za-z0-9_.]+/.exec(rest);
      if (deco) {
        i += deco[0].length;
        if (src[i] === '(') i = closeParen(src, i);
        continue;
      }
      break;
    }
    const sig = /^(?:(?:public|private|protected)\s+)?(?:async\s+)?([A-Za-z0-9_]+)\s*\(/.exec(src.slice(i));
    if (!sig) continue;
    const paramsOpen = i + sig[0].length - 1;
    const paramsClose = closeParen(src, paramsOpen);
    out.push({
      id: `${file}#${sig[1]}`,
      file,
      method: sig[1],
      body: braceBlock(src, paramsClose),
    });
  }
  return out;
}

function discoverAllCronHandlers(): ScannedCron[] {
  const all: ScannedCron[] = [];
  for (const abs of sourceFiles(SRC)) {
    const src = readFileSync(abs, 'utf8');
    all.push(...scanCronHandlersInSource(posix(abs), src));
  }
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

function findUnregisteredCrons(handlers: ScannedCron[], census: Record<string, unknown>): string[] {
  return handlers.filter((h) => !Object.prototype.hasOwnProperty.call(census, h.id)).map((h) => h.id);
}

/** D-17: kill-switch check must stay the first executable statement of every @Cron handler. */
const KILL_SWITCH_FIRST =
  /^\{\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*if\s*\(\s*(?:schedulersDisabled|keyCronsDisabled)\(\)\s*\)\s*(?:\{\s*)?return\b/;

describe('RR-CRON-OCCURRENCE-LOCK: @Cron occurrence-claim census', () => {
  it('RED-BEFORE: every @Cron handler in apps/server/src is registered as CLAIMED or IDEMPOTENT with zero drift', () => {
    const handlers = discoverAllCronHandlers();
    expect(handlers.length).toBeGreaterThanOrEqual(20);

    const unregistered = findUnregisteredCrons(handlers, CRON_OCCURRENCE_CENSUS);
    expect(unregistered, 'unregistered @Cron handlers').toEqual([]);

    const discoveredIds = new Set(handlers.map((h) => h.id));
    const stale = Object.keys(CRON_OCCURRENCE_CENSUS)
      .filter((id) => !discoveredIds.has(id))
      .sort();
    expect(stale, 'stale entries in CRON_OCCURRENCE_CENSUS').toEqual([]);

    const claimedJobs = new Map<string, string>();
    const violations: string[] = [];

    for (const h of handlers) {
      const entry = CRON_OCCURRENCE_CENSUS[h.id];
      if (!entry) continue;

      if (!KILL_SWITCH_FIRST.test(h.body)) {
        violations.push(`${h.id}: D-17 kill switch must stay the first statement`);
      }

      if (entry.mode === 'CLAIMED') {
        if (!entry.job || entry.job.trim().length === 0) {
          violations.push(`${h.id}: CLAIMED entry must declare a non-empty job name`);
        } else {
          const prev = claimedJobs.get(entry.job);
          if (prev) {
            violations.push(`${h.id}: duplicate claimed job key "${entry.job}" (already used by ${prev})`);
          }
          claimedJobs.set(entry.job, h.id);
        }

        const expectedCall = `claimOccurrence(`;
        if (!h.body.includes(expectedCall) || !h.body.includes(`'${entry.job}'`)) {
          violations.push(`${h.id}: marked CLAIMED(job='${entry.job}') but handler body does not call claimOccurrence(..., '${entry.job}', ...)`);
        }
      } else if (entry.mode === 'IDEMPOTENT') {
        if (!entry.reason || entry.reason.trim().length < 10) {
          violations.push(`${h.id}: IDEMPOTENT entry must document why duplicate execution is safe`);
        }
      } else {
        violations.push(`${h.id}: invalid mode ${(entry as { mode?: unknown }).mode}`);
      }
    }

    expect(violations).toEqual([]);
    // First slice must actively claim ContractRenewalSweep.scheduledSweep and non-idempotent handlers
    expect(CRON_OCCURRENCE_CENSUS['src/modules/contracts/contract-renewal.sweep.ts#scheduledSweep']?.mode).toBe(
      'CLAIMED',
    );
    expect(claimedJobs.size).toBeGreaterThanOrEqual(1);
  });

  it('NEGATIVE CONTROL: an unregistered synthetic @Cron handler is caught by the census scanner', () => {
    const syntheticSrc = `
      @Injectable()
      export class RogueCronService {
        @Cron('0 1 * * *')
        async rogueUnregisteredJob(): Promise<void> {
          if (schedulersDisabled()) return;
        }
      }
    `;
    const scanned = scanCronHandlersInSource('src/modules/rogue/rogue-cron.service.ts', syntheticSrc);
    expect(scanned).toHaveLength(1);
    expect(scanned[0].id).toBe('src/modules/rogue/rogue-cron.service.ts#rogueUnregisteredJob');

    const missing = findUnregisteredCrons(scanned, CRON_OCCURRENCE_CENSUS);
    expect(missing).toEqual(['src/modules/rogue/rogue-cron.service.ts#rogueUnregisteredJob']);
  });
});
