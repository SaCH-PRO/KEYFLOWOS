/**
 * FU-PROPOSAL-MONEY-TAG (V1-88 / P131; owner rulings D-238, D-227):
 * 1. Static writer census across `apps/server/src` guaranteeing EVERY
 *    `keyActionProposal.create` / `createMany` / `upsert` call goes through the
 *    canonical structural money tagger (`computeProposalCarriesMoney`) and stamps
 *    `carriesMoney`.
 * 2. Anti-spoofing check guaranteeing `CreateKeyActionProposalDto` never accepts
 *    client-supplied `carriesMoney`.
 * 3. Unit coverage for structural classification, deep payload walking,
 *    obfuscation normalization, over-hiding avoidance, monotonicity, and
 *    read-time anti-downgrade backstop.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  isFinancialProposal,
  PROPOSAL_CLASSIFY_SELECT,
} from '../business-genome/key-genome/genome-finance-scope';
import {
  computeProposalCarriesMoney,
  isStructurallyFinancialProposal,
  isStructurallyFinancialTool,
  monotonicCarriesMoney,
  structuredPayloadCarriesMoney,
  structuralTextCarriesMoney,
  toolSchemaCarriesMoney,
} from './proposal-money-tag';

const SRC_ROOT = path.resolve(__dirname, '../..');

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('FU-PROPOSAL-MONEY-TAG static writer census (V1-88)', () => {
  const ALLOWED_CREATE_WRITERS = new Set([
    'modules/key-autonomy/key-action-proposal.service.ts',
    'modules/key-autonomy/action-boundary/key-action-boundary.service.ts',
  ]);

  it('every keyActionProposal.create/createMany/createManyAndReturn/upsert or raw SQL INSERT in apps/server/src lives in an allowed canonical writer and stamps carriesMoney', () => {
    const files = walkTsFiles(SRC_ROOT);
    const createSites: Array<{ rel: string; line: number; match: string }> = [];
    const rawInsertSites: Array<{ rel: string; line: number; match: string }> = [];

    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf8');

      const createRe = /keyActionProposal\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = createRe.exec(content)) !== null) {
        const line = content.slice(0, m.index).split('\n').length;
        createSites.push({ rel, line, match: m[0].replace(/\s+/g, ' ') });
      }

      const sqlRe = /INSERT\s+INTO\s+["']?key_action_proposals["']?/gi;
      while ((m = sqlRe.exec(content)) !== null) {
        const line = content.slice(0, m.index).split('\n').length;
        rawInsertSites.push({ rel, line, match: m[0].replace(/\s+/g, ' ') });
      }
    }

    // Zero raw SQL inserts bypassing canonical writers
    expect(rawInsertSites, `Raw SQL key_action_proposals inserts found: ${JSON.stringify(rawInsertSites)}`).toEqual([]);

    // Exact create-site count (1 per allowed canonical writer) so an untagged second site in an allowed file cannot slip in
    expect(createSites.length, `Expected exactly 2 create sites (1 per canonical writer), found: ${JSON.stringify(createSites)}`).toBe(2);

    // Zero unregistered writers
    const unregistered = createSites.filter((s) => !ALLOWED_CREATE_WRITERS.has(s.rel));
    expect(unregistered, `Unregistered KeyActionProposal create writers: ${JSON.stringify(unregistered)}`).toEqual([]);

    // Every allowed writer calls computeProposalCarriesMoney and writes carriesMoney
    for (const rel of ALLOWED_CREATE_WRITERS) {
      const sitesForFile = createSites.filter((s) => s.rel === rel);
      expect(sitesForFile.length, `${rel} must contain exactly 1 create site`).toBe(1);
      const content = fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
      expect(content, `${rel} must call computeProposalCarriesMoney`).toContain('computeProposalCarriesMoney(');
      expect(content, `${rel} must persist carriesMoney`).toMatch(/\bcarriesMoney\b/);
    }
  });

  it('CreateKeyActionProposalDto does not accept client-supplied carriesMoney (anti-spoofing)', () => {
    const dtoPath = path.join(SRC_ROOT, 'modules/key-autonomy/dto/create-key-action-proposal.dto.ts');
    const content = fs.readFileSync(dtoPath, 'utf8');
    expect(content).not.toMatch(/\bcarriesMoney\b/);
  });

  it('PROPOSAL_CLASSIFY_SELECT includes carriesMoney: true', () => {
    expect(PROPOSAL_CLASSIFY_SELECT).toHaveProperty('carriesMoney', true);
  });
});

describe('FU-PROPOSAL-MONEY-TAG structural classifier & read-time backstop', () => {
  it('monotonicCarriesMoney never downgrades true to false', () => {
    expect(monotonicCarriesMoney(true, false)).toBe(true);
    expect(monotonicCarriesMoney(true, true)).toBe(true);
    expect(monotonicCarriesMoney(false, true)).toBe(true);
    expect(monotonicCarriesMoney(false, false)).toBe(false);
    expect(monotonicCarriesMoney(null, false)).toBe(false);
    expect(monotonicCarriesMoney(null, true)).toBe(true);
  });

  it.each([
    'commerce_create_invoice',
    'payments_create_link',
    'expenses_create',
    'deals_create',
    'payroll_set_rate',
    'procurement_issue_po',
    'inventory_create_purchase_order',
    'bookings.add_service',
    'temporal_flow.list_events',
    'storelink.create_promo_code',
    'storelink.get_product_health',
    'fetch_revenue_risk',
    'monitoring_overdue_invoices',
    'monitoring_client_risk',
    'mystery_unmapped_tool',
  ])('tool %s is structurally financial', (toolName) => {
    expect(isStructurallyFinancialTool(toolName)).toBe(true);
  });

  it.each([
    'crm_add_task',
    'crm_create_contact',
    'calendar_create_event',
    'helpdesk_create_ticket',
    'temporal_flow.create_event',
    'cortex.create_task',
    'monitoring_stale_leads',
    'monitoring_delayed_projects',
    'monitoring_booking_gaps',
  ])('tool %s is structurally non-financial', (toolName) => {
    expect(isStructurallyFinancialTool(toolName)).toBe(false);
  });

  it('toolSchemaCarriesMoney detects financial properties including nested array item schemas', () => {
    expect(
      toolSchemaCarriesMoney({
        type: 'object',
        properties: { name: { type: 'string', description: 'Service' }, price: { type: 'number', description: 'Price' } },
        required: ['name'],
      }),
    ).toBe(true);
    expect(
      toolSchemaCarriesMoney({
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task' },
          dueDate: { type: 'string', description: 'Date' },
        },
        required: ['title'],
      }),
    ).toBe(false);
  });

  it('detects deeply nested money, separate currency, balance_900, and 9+ word spaced keys', () => {
    expect(structuredPayloadCarriesMoney({ total: { note: 'ok', nested: { val: 900 } } })).toBe(true);
    expect(structuredPayloadCarriesMoney({ currency: 'TTD', value: 500 })).toBe(true);
    expect(structuredPayloadCarriesMoney({ refId: 'balance_900' })).toBe(true);
    expect(structuredPayloadCarriesMoney({ 'total due for the main client for the spring event': 900 })).toBe(true);
  });

  it('exempts count keys ending in a digit and nested count objects', () => {
    expect(structuredPayloadCarriesMoney({ totalCount2: 5, total_items_2: 12, totalTasks1: 3 })).toBe(false);
    expect(structuredPayloadCarriesMoney({ stats: { total: { count: 12, items: 5 } } })).toBe(false);
  });

  it('normalizes Cyrillic homoglyphs, NFD combining marks, HTML entities, worded amounts, and wide windows without over-hiding', () => {
    expect(structuralTextCarriesMoney('Follow up on \u0456nv\u043e\u0456ce 900')).toBe(true);
    expect(structuralTextCarriesMoney('Check i\u0301nvoice 900 status')).toBe(true);
    expect(structuralTextCarriesMoney('Collect &#36;500 from client')).toBe(true);
    expect(structuralTextCarriesMoney('Total due is five hundred')).toBe(true);
    expect(structuralTextCarriesMoney('The total for the spring event next Friday is 900')).toBe(true);

    expect(structuralTextCarriesMoney('Spent 3 hours on outreach')).toBe(false);
    expect(structuralTextCarriesMoney('Meeting with Bill at 10am')).toBe(false);
    expect(structuralTextCarriesMoney('See C:\\trent\\notes.txt for the schedule')).toBe(false);
    expect(structuralTextCarriesMoney('Follow up with design team. '.repeat(2500))).toBe(false);
  });

  it('isFinancialProposal respects carriesMoney=true, trusts carriesMoney=false for non-financial tools, blocks downgrade on financial tools, and fails closed when null', () => {
    // carriesMoney === true always financial even with neutral fields
    expect(isFinancialProposal({ carriesMoney: true, actionType: 'CREATE_TASK', module: 'crm', title: 'Plain task' })).toBe(true);

    // carriesMoney === false avoids over-hiding on non-financial tools
    expect(
      isFinancialProposal({
        carriesMoney: false,
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Spent 3 hours on outreach',
        summary: 'See C:\\trent\\notes.txt',
      }),
    ).toBe(false);

    // Anti-downgrade backstop: financial tool or unmapped tool with carriesMoney=false STILL returns true
    expect(
      isFinancialProposal({
        carriesMoney: false,
        actionType: 'EXECUTE_TOOL',
        module: 'commerce',
        toolName: 'commerce_create_invoice',
        title: 'Plain',
      }),
    ).toBe(true);
    expect(
      isFinancialProposal({
        carriesMoney: false,
        actionType: 'EXECUTE_TOOL',
        module: 'mystery',
        toolName: 'mystery.run',
        title: 'Plain',
      }),
    ).toBe(true);
    expect(
      isFinancialProposal({
        carriesMoney: false,
        actionType: 'REQUEST_APPROVAL',
        sourceType: 'HUMAN_WORKFLOW',
        title: 'Office chairs',
        affectedEntities: { requestType: 'po' },
      }),
    ).toBe(true);
    // Post-creation money executionResult / rejectionReason overrides carriesMoney=false
    expect(
      isFinancialProposal({
        carriesMoney: false,
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Call back',
        executionResult: { amount: 12345 },
      }),
    ).toBe(true);

    // Untagged legacy row (null) fails closed via text heuristic
    expect(
      isFinancialProposal({
        carriesMoney: null,
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Spent 3 hours on outreach',
      }),
    ).toBe(true);
    expect(
      isFinancialProposal({
        carriesMoney: null,
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Call Kerry back',
      }),
    ).toBe(false);

    // computeProposalCarriesMoney never downgrades caller's carriesMoney: true
    expect(
      computeProposalCarriesMoney({
        carriesMoney: true,
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Call Kerry back',
      }),
    ).toBe(true);

    // Structural check alone catches financial tools without text
    expect(
      isStructurallyFinancialProposal({
        actionType: 'EXECUTE_TOOL',
        module: 'crm',
        toolName: 'deals_create',
        title: 'Decommission old tablet',
      }),
    ).toBe(true);
  });
});
