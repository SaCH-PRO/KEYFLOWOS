import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FinanceController } from './finance.controller';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { MODULE_SCOPE_KEY, ModuleScopeGuard } from '../../core/auth/module-scope.guard';

/**
 * PR195-JOURNAL-SCOPE (review finding CR-P195-4): the port mounted the manual-journal composer at
 * /app/finance/journal, and POST finance/businesses/:b/journal-entries checked membership only
 * (ensureAccess), so a STAFF member holding revenue read, or no finance scope at all, posted any
 * balanced journal into the business's books.
 *
 * The module: revenue. The Books have no module key of their own (D-57: "No new module key"); their
 * reads, the manual journal list included, are gated by revenue read, the trial-balance gate, and the
 * one other manual Books write on this controller, the credit note, is revenue write. So a manual
 * journal write needs revenue write, through RequireModuleScope + ModuleScopeGuard as its siblings do,
 * which also keeps the derived KEY tool table (job-role-tool-families.spec.ts) honest: PostingService
 * .post is now governed by revenue write. ensureAccess stays: ModuleScopeGuard passes a platform
 * SUPER_ADMIN, and one who is not a member writes none of the business's books (D-46, FOLLOW3-A5).
 *
 * The recurring journal templates are manual journals too: POST .../recurring-journal-entries/:id/run
 * posts one ADJUSTMENT at once, and a template created or edited is posted by the scheduler later, so
 * every write of a template (create, edit, run, cancel, delete) needs the same revenue write; otherwise
 * the gate above is a door with a second, open door beside it.
 *
 *   JWS-U01  POST journal-entries: ModuleScopeGuard and revenue write (RED-BEFORE: no scope at all).
 *   JWS-U02  every recurring journal write: ModuleScopeGuard and revenue write (RED-BEFORE).
 *   JWS-U03  unchanged: the class guards, and GET journal-entries' revenue read (D-57).
 */

const scopeOf = (handler: unknown) => Reflect.getMetadata(MODULE_SCOPE_KEY, handler as object);
const guardsOf = (handler: unknown) => Reflect.getMetadata(GUARDS_METADATA, handler as object);
const proto = FinanceController.prototype as unknown as Record<string, unknown>;

describe('PR195-JOURNAL-SCOPE: a manual journal write needs revenue write (CR-P195-4)', () => {
  it('JWS-U01 RED-BEFORE: POST journal-entries runs ModuleScopeGuard with revenue write', () => {
    expect(scopeOf(proto.createJournalEntry)).toEqual({ module: 'revenue', minLevel: 'write' });
    expect(guardsOf(proto.createJournalEntry)).toEqual([ModuleScopeGuard]);
  });

  it.each([
    ['createRecurringJournal', 'POST recurring-journal-entries'],
    ['updateRecurringJournal', 'PATCH recurring-journal-entries/:id'],
    ['runRecurringJournal', 'POST recurring-journal-entries/:id/run'],
    ['cancelRecurringJournal', 'POST recurring-journal-entries/:id/cancel'],
    ['deleteRecurringJournal', 'DELETE recurring-journal-entries/:id'],
  ])('JWS-U02 RED-BEFORE: %s (%s) runs ModuleScopeGuard with revenue write', (method) => {
    expect(scopeOf(proto[method])).toEqual({ module: 'revenue', minLevel: 'write' });
    expect(guardsOf(proto[method])).toEqual([ModuleScopeGuard]);
  });

  it('JWS-U03 unchanged: the class guards, and the journal list keeps revenue read (D-57)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FinanceController)).toEqual([AuthGuard, BusinessGuard]);
    expect(scopeOf(proto.listJournalEntries)).toEqual({ module: 'revenue', minLevel: 'read' });
    expect(guardsOf(proto.listJournalEntries)).toEqual([ModuleScopeGuard]);
  });
});
