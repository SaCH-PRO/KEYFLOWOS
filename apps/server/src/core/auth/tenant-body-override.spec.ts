/**
 * One character of ordering was a cross-tenant write on nine domains.
 *
 *   @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
 *   @Post('businesses/:businessId/expenses')
 *   createExpense(
 *     @Param('businessId') businessId: string,
 *     @Body() body: { description: string; amount: number; ... },
 *   ) {
 *     return this.expenses.createExpense({ businessId, ...body });
 *                                          ^^^^^^^^^^^^^^^^^^
 *   }
 *
 * The spread comes last, so a `businessId` in the request body OVERWRITES the
 * path parameter the guard just validated. BusinessGuard confirms the caller
 * belongs to the business in the URL; the row is then written to whichever
 * business the body names.
 *
 * PROVEN, not inferred. Against a running server on 2026-08-07:
 *
 *   POST /expenses/businesses/<mine>/expenses
 *   { "businessId": "<not mine>", "description": "...", "amount": 1337 }
 *   -> HTTP 201, row landed in <not mine>
 *
 * After the fix, byte-identical request: HTTP 201, row landed in <mine>.
 *
 * This class is worse than the two IDOR bugs fixed the same day
 * (goals/:goalId/plans, drafts/:id/approve). Those needed a record id from the
 * target tenant. This needs only a businessId, which is not secret — it appears
 * in URLs, in API responses, and in any shared link. And `create` is not among
 * the operations the Prisma tenant extension hooks, so BUSINESS_ID_MODELS could
 * never have caught it.
 *
 * 25 sites across 12 files: invoices, quotes, recurring invoices, products,
 * services, expenses, expense categories, budgets, campaigns, contacts, contact
 * lists, accounts, deals, deal stages, lead forms, won/lost reasons.
 *
 * THE RULE: tenant-authoritative values go AFTER the spread. Always.
 *
 *   { ...body, businessId }        the guard-validated value wins
 *   { businessId, ...body }        the client wins
 *
 * A decorated DTO with `whitelist: true` would also strip the field, and that is
 * worth doing — but it is a second control that has to be remembered per-DTO.
 * Ordering is a property of the code that cannot be forgotten once it is right,
 * and this spec keeps it right.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MODULES = path.resolve(__dirname, '..', '..', 'modules');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(controller|service)\.ts$/.test(entry) && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * `businessId` appearing before a spread of request-shaped data.
 *
 * Deliberately tolerant of other keys on either side, because the first sweep
 * used `\{\s*businessId,\s*\.\.\.body\s*\}` and missed two real instances:
 *
 *   { businessId, ...body, actorId: req?.user?.id }   crm-deals.controller
 *   { quoteId, businessId, ...body }                  commerce.controller
 *
 * Both were live. A pattern that only matches the tidy case is how a sweep
 * reports "clean" while the class survives.
 */
const OVERRIDE = /\{[^{}]*\bbusinessId\s*,[^{}]*\.\.\.\s*(body|dto|input|payload|data)\b/g;

/**
 * Spreads that cannot carry a tenant override.
 *
 * `where: { businessId, ...(x ? { y } : {}) }` is a query filter composing
 * conditions, not a request body — the spread is a literal built in the same
 * expression and has no businessId in it.
 */
const SAFE_SPREAD = /\.\.\.\s*\(/;

describe('a request body cannot choose its own tenant', () => {
  const files = sourceFiles(MODULES);

  it('finds the source to scan', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('no object puts businessId before a spread of request data', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(OVERRIDE)) {
        if (SAFE_SPREAD.test(m[0])) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${path.relative(MODULES, file).split(path.sep).join('/')}:${line}  ${m[0].trim().slice(0, 72)}`);
      }
    }

    expect(
      offenders,
      'these let a request body overwrite the guard-validated businessId. Put the ' +
        'tenant AFTER the spread: { ...body, businessId }. Verified exploitable on ' +
        '2026-08-07 — a 201 that wrote a row into a business the caller had no ' +
        'membership in',
    ).toEqual([]);
  });

  it('the create path this was found on is ordered correctly', () => {
    // Named, because it is the one that was actually exploited end to end.
    const src = fs.readFileSync(path.join(MODULES, 'expenses', 'expenses.controller.ts'), 'utf8');

    expect(src).toMatch(/createExpense\(\{\s*\.\.\.body,\s*businessId\s*\}\)/);
  });

  it('the rule holds for update paths too, not just create', () => {
    // updateInvoice/updateQuote/convertQuoteToInvoice were the same shape with
    // a record id in front: { quoteId, businessId, ...body }.
    const src = fs.readFileSync(path.join(MODULES, 'commerce', 'commerce.controller.ts'), 'utf8');

    for (const call of ['updateInvoice', 'updateQuote', 'convertQuoteToInvoice']) {
      const at = src.indexOf(`this.commerce.${call}(`);
      if (at === -1) continue;
      const expr = src.slice(at, src.indexOf(')', at));
      expect(expr, `${call} still lets the body pick the tenant`).not.toMatch(/businessId\s*,[^)]*\.\.\.body/);
    }
  });
});
