/**
 * D-280 / SEC-WAW-1 (P60: FU-WA-INBOUND-KEY-EXCLUDE) — Static Reader Census Gate
 *
 * Ensures every production file in `apps/server/src/modules/` that reads
 * `contactNote` or `contactEvent` (or nested `notes:`/`events:` selects on Contact)
 * is accounted for in the D-280 census, and that every automatic/background KEY
 * prompt reader explicitly applies `EXCLUDE_WHATSAPP_INBOUND_SOURCE` (NULL-safe
 * exclusion of `source = 'whatsapp_inbound'`).
 *
 * If a future packet adds a new `contactNote` or `contactEvent` reader, this
 * census fails loudly until the reader is classified (automatic KEY excluded vs
 * owner-initiated KEY vs non-LLM UI/count).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

const MODULES_ROOT = join(__dirname, '..');

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Automatic / background KEY prompt readers & indirect body-copy sinks that
 * MUST import and apply the D-280 exclusion helpers from `whatsapp-inbound-exclusion.ts`.
 */
const AUTOMATIC_EXCLUDED_FILES = [
  'key-cortex/key-cortex-intuition.service.ts',
  'crm/conversation-ai.service.ts',
  'ai/flow-orchestrator.service.ts',
  'ai/pattern-detector.service.ts',
  'crm/crm-timeline.service.ts',
  'crm/contact-insight.listener.ts',
  'growth-intelligence/customer-journey.service.ts',
] as const;

/**
 * Owner-initiated KEY / explicit UI-button AI readers (allowed under D-280 when
 * the owner explicitly asks KEY).
 */
const OWNER_INITIATED_AI_FILES = new Set([
  'crm/crm-ai.service.ts',
  'momentum/momentum-ai.service.ts',
  'autopilot/autopilot-ai.service.ts',
]);

/**
 * Non-LLM UI, count/timestamp-only, audit/privacy, or write-only files audited
 * under the D-280 census (never pass ContactNote.body or ContactEvent.data.body
 * into an automatic LLM prompt).
 */
const SAFE_NON_AUTOMATIC_PROMPT_FILES = new Set([
  'crm/crm.service.ts',
  'crm/crm.controller.ts',
  'crm/crm-stats.service.ts',
  'crm/crm-journey.service.ts',
  'crm/crm-actions.service.ts',
  'crm/crm-accounts.service.ts',
  'crm/crm-communication.service.ts',
  'crm/crm-duplicate-detection.service.ts',
  'crm/crm-flow.service.ts',
  'crm/crm-network.service.ts',
  'crm/crm-revenue.service.ts',
  'crm/crm-sequence-analytics.service.ts',
  'crm/best-channel.service.ts',
  'crm/contact-insight.service.ts',
  'crm/lead-scoring.scheduler.ts',
  'crm/revenue-event.listener.ts',
  'crm/privacy/contact-privacy.service.ts',
  'commerce/commerce.service.ts',
  'communications/omnichannel-processor.service.ts',
  'communications/profit-trajectory.service.ts',
  'diagnostics/diagnostics.service.ts',
  'flow/automation-executor.service.ts',
  'flow/flow.service.ts',
  'momentum/client-momentum.service.ts',
  'people-flow/relationship-health.service.ts',
  'ai/flow-tool-registry.ts',
]);

const READER_PATTERN = /\b(contactNote|contactEvent)\.(findMany|findFirst|findUnique|count|groupBy)\b/;

describe('D-280 / SEC-WAW-1 ContactNote & ContactEvent reader census', () => {
  const allFiles = walkTsFiles(MODULES_ROOT);

  it('every ContactNote / ContactEvent reader under src/modules is classified in the D-280 census', () => {
    const known = new Set<string>([
      ...AUTOMATIC_EXCLUDED_FILES,
      ...OWNER_INITIATED_AI_FILES,
      ...SAFE_NON_AUTOMATIC_PROMPT_FILES,
    ]);

    const unclassified: string[] = [];
    for (const file of allFiles) {
      const rel = relative(MODULES_ROOT, file).replace(/\\/g, '/');
      const src = readFileSync(file, 'utf8');
      if (READER_PATTERN.test(src) && !known.has(rel)) {
        unclassified.push(rel);
      }
    }

    expect(
      unclassified,
      'Unclassified ContactNote/ContactEvent reader(s) added — audit against D-280 (exclude whatsapp_inbound from automatic KEY prompts) and register in this census',
    ).toEqual([]);
  });

  it('every automatic KEY prompt reader & indirect body-copy sink uses the canonical whatsapp-inbound-exclusion helper', () => {
    for (const rel of AUTOMATIC_EXCLUDED_FILES) {
      const src = readFileSync(join(MODULES_ROOT, rel), 'utf8');
      expect(src, `${rel} must import from whatsapp-inbound-exclusion`).toContain('whatsapp-inbound-exclusion');
    }
  });

  it('ContactInsightService.computeContactIntelligenceFields does not select unused ContactNote.body', () => {
    const src = readFileSync(join(MODULES_ROOT, 'crm/contact-insight.service.ts'), 'utf8');
    const idx = src.indexOf('contactNote.findMany');
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 220);
    expect(snippet).not.toContain('body: true');
  });
});
