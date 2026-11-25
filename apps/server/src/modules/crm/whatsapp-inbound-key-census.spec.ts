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
  'communications/profit-trajectory.service.ts',
  'diagnostics/diagnostics.service.ts',
  'flow/automation-executor.service.ts',
  'flow/flow.service.ts',
  'momentum/client-momentum.service.ts',
  'people-flow/relationship-health.service.ts',
]);

/**
 * Event-driven write-side sinks that do not query ContactNote/ContactEvent
 * directly from Prisma but receive ContactEvent payloads via EventEmitter2.
 */
const EVENT_LISTENER_SINKS = new Set<string>([
  'crm/contact-insight.listener.ts',
]);

const DIRECT_READER_PATTERN =
  /\b(contactNote|contactEvent)\s*\.\s*(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|groupBy|aggregate)\b/;

const RAW_SQL_READER_PATTERN =
  /\b(FROM|JOIN)\s+["'`]?(contact_notes|contact_events)["'`]?\b/i;

const CANONICAL_HELPER_SYMBOLS = [
  'EXCLUDE_WHATSAPP_INBOUND_SOURCE',
  'EXCLUDE_WHATSAPP_INBOUND_CONTACT_EVENTS',
  'isInboundWhatsAppEvent',
  'stripInboundWhatsAppBody',
] as const;

function hasNestedContactNotesOrEvents(src: string): boolean {
  const re = /\bcontact\s*\.\s*(?:findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const callBody = src.slice(m.index + m[0].length, i - 1);
    if (/\b(?:include|select)\s*:/.test(callBody) && /\b(?:notes|events)\s*:\s*(?:\{|true\b)/.test(callBody)) {
      return true;
    }
  }
  return false;
}

function readsContactNotesOrEvents(src: string): boolean {
  return (
    DIRECT_READER_PATTERN.test(src) ||
    RAW_SQL_READER_PATTERN.test(src) ||
    hasNestedContactNotesOrEvents(src)
  );
}

describe('D-280 / SEC-WAW-1 ContactNote & ContactEvent reader census', () => {
  const allFiles = walkTsFiles(MODULES_ROOT);

  it('every ContactNote / ContactEvent reader under src/modules (direct, multiline, nested Contact select, raw SQL) is classified in the D-280 census', () => {
    const known = new Set<string>([
      ...AUTOMATIC_EXCLUDED_FILES,
      ...OWNER_INITIATED_AI_FILES,
      ...SAFE_NON_AUTOMATIC_PROMPT_FILES,
    ]);

    const matched = new Set<string>();
    const unclassified: string[] = [];
    for (const file of allFiles) {
      const rel = relative(MODULES_ROOT, file).replace(/\\/g, '/');
      const src = readFileSync(file, 'utf8');
      if (readsContactNotesOrEvents(src)) {
        matched.add(rel);
        if (!known.has(rel)) {
          unclassified.push(rel);
        }
      }
    }

    expect(
      unclassified,
      'Unclassified ContactNote/ContactEvent reader(s) added — audit against D-280 (exclude whatsapp_inbound from automatic KEY prompts) and register in this census',
    ).toEqual([]);

    // Bidirectional self-check: every DB-reading census entry must actually match
    // the scanner so multiline/nested drift cannot hide unmatched files.
    const staleEntries = [...known].filter((rel) => !EVENT_LISTENER_SINKS.has(rel) && !matched.has(rel));
    expect(
      staleEntries,
      'Census contains entries that do not match the reader scanner — update scanner or remove dead entry',
    ).toEqual([]);
  });

  it('every automatic KEY prompt reader & indirect body-copy sink imports and invokes a canonical whatsapp-inbound-exclusion helper', () => {
    for (const rel of AUTOMATIC_EXCLUDED_FILES) {
      const src = readFileSync(join(MODULES_ROOT, rel), 'utf8');
      expect(src, `${rel} must import from whatsapp-inbound-exclusion`).toContain('whatsapp-inbound-exclusion');

      // Strip import statements to verify a canonical helper symbol is actually used in code (not just imported).
      const withoutImports = src.replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
      const usesHelper = CANONICAL_HELPER_SYMBOLS.some((sym) => new RegExp(`\\b${sym}\\b`).test(withoutImports));
      expect(
        usesHelper,
        `${rel} must actually apply one of ${CANONICAL_HELPER_SYMBOLS.join(', ')} beyond its import statement`,
      ).toBe(true);
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
