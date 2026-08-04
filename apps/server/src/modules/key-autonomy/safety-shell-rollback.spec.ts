/**
 * A safety component must not report work it did not do.
 *
 * rollback() logged "Would execute compensating action" for each item and
 * returned { success: true } regardless. Nothing was reverted.
 *
 * It is harmless today only by accident: the sole caller of check()
 * (key-action-executor.service.ts:31) never passes rollbackActions, so the list
 * is always empty and the loop never runs. The danger is the next caller — one
 * that passes real compensations and is told they succeeded.
 *
 * These tests pin the tripwire: nothing to do still succeeds, something to do
 * fails loudly until someone implements it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SafetyShellService } from './safety-shell.service';

function makeService() {
  return new SafetyShellService();
}

describe('rollback tells the truth about what it did', () => {
  it('succeeds on an empty list, because there is genuinely nothing to do', async () => {
    const result = await makeService().rollback('CREATE_TASK', []);

    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
  });

  it('REFUSES to report success when given real work it cannot perform', async () => {
    const result = await makeService().rollback('CREATE_TASK', [
      { type: 'void_invoice', id: 'inv_1' },
    ]);

    expect(result.success).toBe(false);
  });

  it('says why, so the caller knows what to implement', async () => {
    const result = await makeService().rollback('CREATE_TASK', [{ type: 'void_invoice' }]);

    expect(result.reason).toMatch(/cannot compensate/i);
    expect(result.reason).toMatch(/KeyCortexCompensationService/);
  });

  it('marks every action as not executed, not as logged', async () => {
    // "logged" reads like a completed step in an audit trail. It was not one.
    const result = await makeService().rollback('X', [{ a: 1 }, { b: 2 }]);

    expect(result.results).toEqual([
      { action: { a: 1 }, status: 'not_executed' },
      { action: { b: 2 }, status: 'not_executed' },
    ]);
  });
});

describe('the false success cannot come back', () => {
  const src = readFileSync(join(__dirname, 'safety-shell.service.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async rollback('));
  const body = fn.slice(0, fn.indexOf('\n  private '));

  it('no longer claims a compensating action was handled by logging it', () => {
    expect(body).not.toMatch(/Would execute compensating action/);
    expect(body).not.toMatch(/status: 'logged'/);
  });

  it('never returns success:true on a non-empty list', () => {
    // The only success:true is guarded by an explicit length === 0 check.
    const successes = [...body.matchAll(/success:\s*true/g)];
    expect(successes).toHaveLength(1);
    expect(body).toMatch(/rollbackActions\.length === 0.*success: true/s);
  });
});

describe('the caller that exists today is unaffected', () => {
  it('still passes no rollback actions, so nothing changes for it', () => {
    // If this ever stops being true, the tripwire above fires and whoever
    // changed it has to implement real compensation.
    const executor = readFileSync(join(__dirname, 'key-action-executor.service.ts'), 'utf8');
    const check = executor.slice(executor.indexOf('this.safetyShell.check('));
    const args = check.slice(0, check.indexOf('    );'));

    expect(args).not.toMatch(/rollbackActions/);
  });
});
