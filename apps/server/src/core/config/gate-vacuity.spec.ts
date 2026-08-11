/**
 * A gate that finds nothing must prove it looked.
 *
 * THE FAILURE THIS EXISTS FOR, five instances of it in one week:
 *
 *   flow-tool-honesty.spec.ts   could not see a handler written without braces
 *   tenant-model-list.spec.ts   could not see a model that was never listed
 *   event-wiring.spec.ts        could not see @OnEvent(CONSTANT), so a dead
 *                               listener passed by not being counted at all
 *   llm-cost.service.ts         had no gate, and reported $0 for 80% of calls
 *   check-tool-routes           proved parity with the wrong evidence
 *
 * Every one was green. None was measuring what its name claimed, and in each
 * case the defect was not in the assertion — it was in the READER feeding it.
 * A scan that matches nothing produces an empty list, and `expect(findings)
 * .toEqual([])` is perfectly happy with an empty list. The gate reports "all
 * clear" and means "I could not see".
 *
 * So: any spec that (a) builds a list by reading source and (b) asserts that
 * list is empty must also assert its INPUT was non-empty. One line —
 * `expect(files.length).toBeGreaterThan(50)` — converts "no findings" from an
 * ambiguous result into a real one.
 *
 * WHAT THIS CANNOT DO, stated plainly because the file's whole subject is
 * checks that overstate themselves. It reads test source with regular
 * expressions, so it recognises the SHAPES below and not the intent. A reader
 * that returns a non-empty list of the wrong things still passes here. This
 * catches the empty-input class only, which is the one that actually happened,
 * repeatedly.
 *
 * Opt out with the marker `@vacuity-ok` and a reason, on a spec where emptiness
 * genuinely cannot be an artefact of the reader.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SERVER_ROOT = join(__dirname, '..', '..', '..');
const SEARCH_ROOTS = [join(SERVER_ROOT, 'src'), join(SERVER_ROOT, 'test')];

function specFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'coverage'].includes(e.name)) continue;
      out = out.concat(specFiles(p));
    } else if (/\.(spec|test)\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * WALKS THE TREE to build its own input — the shape that can silently produce
 * nothing.
 *
 * `readdirSync` on a directory that has moved, been renamed, or been filtered
 * to nothing returns `[]` and throws nothing. That empty array flows into the
 * findings list and the gate reports all-clear.
 *
 * A bare `readFileSync(knownPath)` is deliberately NOT counted. If the file is
 * missing it throws, so the spec fails loudly rather than measuring nothing —
 * and treating it as a risk produced two false positives on the first run
 * (key-cortex-circadian, parasympathetic-consolidation), where the
 * `toEqual([])` asserts a SERVICE returned nothing and the file read is
 * incidental. Forcing a meaningless assertion onto those would be this gate
 * committing the error it was written to catch: matching a shape instead of
 * the thing.
 *
 * RESIDUAL RISK, stated rather than papered over: a single-file read whose
 * REGEX extraction stops matching is vacuous too, and this does not catch it.
 * That is exactly what happened to tenant-model-list.spec.ts, which is why that
 * file now opens with `it('finds both sides')`. There is no static way to tell
 * "this empty array came from a broken parser" from "this empty array is the
 * answer" — so this gate covers the mechanical case and the convention covers
 * the rest.
 */
const READS_SOURCE = /readdirSync\(|analyseEventWiring\(|getOpenAiToolDefinitions\(|\bFLOW_TOOLS\b/;

/** Asserts "there are no findings". */
const ASSERTS_EMPTY = /toEqual\(\[\]\)|toHaveLength\(0\)|\.length\)\.toBe\(0\)/;

/**
 * Proves the reader saw something. Deliberately generous — any lower bound on
 * any quantity counts, because the point is that SOMEONE THOUGHT ABOUT IT, not
 * that they expressed it a particular way.
 */
const PROVES_INPUT =
  /toBeGreaterThan\(|toBeGreaterThanOrEqual\(|\.length\)\.toBe\([1-9]|\.size\)\.toBe\([1-9]|toHaveLength\([1-9]|toBeDefined\(\)|toContain\(/;

const OPT_OUT = /@vacuity-ok/;

interface Vacuous {
  file: string;
  why: string;
}

function findVacuousGates(): { scanned: number; scanners: number; vacuous: Vacuous[] } {
  const files = SEARCH_ROOTS.flatMap((r) => specFiles(r));
  let scanners = 0;
  const vacuous: Vacuous[] = [];

  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (!READS_SOURCE.test(src)) continue;
    scanners++;
    if (OPT_OUT.test(src)) continue;
    if (!ASSERTS_EMPTY.test(src)) continue;
    if (PROVES_INPUT.test(src)) continue;

    vacuous.push({
      file: relative(SERVER_ROOT, f).split(sep).join('/'),
      why: 'reads source, asserts a list is empty, never asserts the list could have been non-empty',
    });
  }

  return { scanned: files.length, scanners, vacuous };
}

describe('a gate that finds nothing proves it looked', () => {
  const result = findVacuousGates();

  it('this meta-gate is not itself vacuous', () => {
    // The joke that would write itself. A vacuity checker whose file walker is
    // broken finds no vacuous gates and passes, which is precisely the defect
    // it exists to catch, one level up.
    expect(result.scanned, 'no spec files found — the walker is broken').toBeGreaterThan(200);
    // 32 at the time of writing. The bound said 40 while READS_SOURCE still
    // counted single-file reads, and narrowing the rule made it wrong — this
    // assertion caught that, which is the entire argument for having it.
    expect(
      result.scanners,
      'no tree-walking specs found — READS_SOURCE matches nothing, so this ' +
        'gate is inspecting an empty set and would pass forever',
    ).toBeGreaterThan(20);
  });

  it('every source-scanning gate proves its input was non-empty', () => {
    const lines = result.vacuous.map((v) => `    ${v.file}`);

    expect(
      result.vacuous.map((v) => v.file),
      'These specs read source, build a list, and assert it is empty — but never ' +
        'assert the list COULD have been non-empty. If the reader stops matching ' +
        '(a rename, a reformat, a syntax it was never taught), the list is empty ' +
        'for the wrong reason and the gate reports all-clear while measuring ' +
        'nothing. That has happened five times here in a week.\n\n' +
        lines.join('\n') +
        '\n\n  Add one assertion that the input was real — ' +
        'expect(files.length).toBeGreaterThan(N) — or mark the spec @vacuity-ok ' +
        'with a reason.',
    ).toEqual([]);
  });
});
