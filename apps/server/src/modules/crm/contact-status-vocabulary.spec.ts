/**
 * V1-38-CT-PRIVACY-PURGE-STATUS (CF-49): Contact.status has one vocabulary.
 *
 * The CRM DTOs admit LEAD | PROSPECT | CLIENT | LOST (CONTACT_STATUSES in
 * crm.constants.ts). Writers outside the DTO spoke other dialects: the Shopify
 * adapter wrote 'CUSTOMER' (and overwrote an existing contact's status on every
 * sync), KEY's daily brief read 'CUSTOMER' and 'DORMANT', and the KEY tool
 * registry offered the model 'INACTIVE' for create, update and segment. A
 * status no DTO admits is invisible to every reader that segments on the
 * canonical values, and a status the model is offered but the API refuses is a
 * tool that fails at run time.
 *
 * This spec is the ratchet:
 *   - the packet's writers (Shopify, KEY command, KEY tool registry, the privacy
 *     service) carry no dialect literal in a status position;
 *   - every contact-status parameter the KEY tool registry offers is exactly
 *     CONTACT_STATUSES;
 *   - across apps/server/src, the files that still read a dialect are a fixed
 *     baseline that may shrink but never grow, and no new file joins it.
 *
 * Pure: reads source files and imports constants; no database, no network.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTACT_STATUSES, contactStatusForExternalCustomer, isContactStatus } from './crm.constants';
import { FLOW_TOOLS, getToolByName } from '../ai/flow-tool-registry';

const SRC = join(__dirname, '..', '..'); // apps/server/src
const rel = (file: string) => relative(SRC, file).split(sep).join('/');
const read = (relPath: string) => readFileSync(join(SRC, relPath), 'utf8');

/** Status values seen in this codebase that no CRM DTO admits (CF-49). */
const DIALECTS = ['CUSTOMER', 'DORMANT', 'INACTIVE'] as const;

/**
 * A dialect literal in a status position: `status: 'X'`, `status === 'X'`,
 * `status !== 'X'`, `status: { not: 'X' }`, `status: cond ? 'X' : 'Y'`. The key
 * must be exactly `status` (relationshipHealth: 'DORMANT' is a different,
 * legitimate field), and the literal must sit on the same statement.
 */
const DIALECT_IN_STATUS = new RegExp(
  String.raw`\bstatus\b\s*(?::|===|!==|==|!=)[^;\n]*?['"\x60](${DIALECTS.join('|')})['"\x60]`,
  'g',
);

function dialectHits(source: string): string[] {
  return [...source.matchAll(DIALECT_IN_STATUS)].map((m) => m[1]);
}

/** The writers this packet owns. They must be clean. */
const PACKET_WRITERS = [
  'modules/shopify/shopify.service.ts',
  'modules/ai/key-command.service.ts',
  'modules/ai/flow-tool-registry.ts',
  'modules/crm/privacy/contact-privacy.service.ts',
];

/**
 * Files outside this packet's write set that still compare against a dialect,
 * at the V1-38 head. The count per file may only go down; a file not listed
 * here may not acquire one.
 *
 * These are READS of a value no canonical writer produces any more. That is a
 * regression this packet caused, not dead code (review CR-1): before V1-38 the
 * Shopify adapter wrote 'CUSTOMER', so the lead-scoring +5, the health-score
 * dormant-customer count, the relationship-health CUSTOMER signals and the
 * maturity customer count fired for every Shopify buyer. Shopify now writes
 * CLIENT (and maps an existing 'CUSTOMER' to CLIENT on its next sync), so those
 * branches no longer fire for Shopify buyers until the readers accept CLIENT.
 * The readers are outside the V1-38 write set: see the it.todo below.
 */
const LEGACY_DIALECT_READERS: Record<string, { hits: number; why: string }> = {
  'modules/ai/key-tool-registry.service.ts': { hits: 1, why: "status: { not: 'DORMANT' } filter (no-op: no contact holds DORMANT)" },
  'modules/ai/flow-orchestrator.service.ts': { hits: 1, why: "an Automation's ACTIVE/INACTIVE, not Contact.status (scanner false positive)" },
  'modules/crm/lead-scoring.scheduler.ts': { hits: 1, why: "+5 for status === 'CUSTOMER'" },
  'modules/intelligence/health-score.service.ts': { hits: 1, why: "count of status 'CUSTOMER'" },
  'modules/people-flow/relationship-health.service.ts': { hits: 5, why: "CUSTOMER/DORMANT signal branches" },
  'modules/analytics/maturity-assessment.service.ts': { hits: 1, why: "filter c.status === 'CUSTOMER'" },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(full);
    if (!e.name.endsWith('.ts') || e.name.endsWith('.spec.ts') || e.name.endsWith('.d.ts')) return [];
    return [full];
  });
}

describe('Contact.status vocabulary (CF-49)', () => {
  it('the scanner is not vacuous: it finds each dialect shape and ignores other fields', () => {
    expect(dialectHits("status: 'CUSTOMER',")).toEqual(['CUSTOMER']);
    expect(dialectHits("status: { not: 'DORMANT' },")).toEqual(['DORMANT']);
    expect(dialectHits("status: customer.orders_count > 0 ? 'CUSTOMER' : 'LEAD',")).toEqual(['CUSTOMER']);
    expect(dialectHits("if (contact.status === 'DORMANT') x();")).toEqual(['DORMANT']);
    expect(dialectHits("status: { type: 'string', enum: ['LEAD', 'PROSPECT', 'CLIENT', 'INACTIVE'] },")).toEqual(['INACTIVE']);
    expect(dialectHits("relationshipHealth: 'DORMANT',")).toEqual([]);
    expect(dialectHits("status: 'CLIENT',")).toEqual([]);
  });

  it('CONTACT_STATUSES is exactly what the CRM create and update DTOs admit', () => {
    for (const dto of ['modules/crm/dto/create-contact.dto.ts', 'modules/crm/dto/update-contact.dto.ts']) {
      const m = read(dto).match(/@IsIn\(\[([^\]]*)\]\)\s*(?:@\w+\([^)]*\)\s*)*status\??:/);
      expect(m, `${dto}: no @IsIn on status`).not.toBeNull();
      const admitted = [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
      expect(admitted, dto).toEqual([...CONTACT_STATUSES]);
    }
  });

  it.each(PACKET_WRITERS)('%s writes and reads no status dialect', (file) => {
    expect(dialectHits(read(file)), `${file}: CUSTOMER/DORMANT/INACTIVE in a status position`).toEqual([]);
  });

  it('every contact-status parameter KEY is offered is exactly CONTACT_STATUSES', () => {
    for (const name of ['crm_create_contact', 'crm_update_contact', 'segment_contacts']) {
      const tool = getToolByName(name);
      expect(tool, `${name} is registered`).toBeTruthy();
      expect(tool!.parameters.properties.status?.enum, `${name}.status.enum`).toEqual([...CONTACT_STATUSES]);
    }
    const list = getToolByName('crm_list_contacts');
    expect(list, 'crm_list_contacts is registered').toBeTruthy();
    const desc = list!.parameters.properties.status?.description ?? '';
    for (const d of DIALECTS) expect(desc, `crm_list_contacts.status describes ${d}`).not.toContain(d);
    for (const s of CONTACT_STATUSES) expect(desc, `crm_list_contacts.status omits ${s}`).toContain(s);
    // No other crm_* contact tool offers a status enum outside the vocabulary.
    for (const tool of FLOW_TOOLS.filter((t) => /contact/.test(t.name))) {
      const e = tool.parameters.properties.status?.enum;
      if (e && !/deal/.test(tool.name)) {
        for (const v of e) expect(CONTACT_STATUSES as readonly string[], `${tool.name}.status offers ${v}`).toContain(v);
      }
    }
  });

  it('the dialect readers outside the packet are a baseline that never grows', () => {
    const grown: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const r = rel(file);
      const hits = dialectHits(readFileSync(file, 'utf8')).length;
      if (hits === 0) continue;
      const allowed = LEGACY_DIALECT_READERS[r]?.hits ?? 0;
      if (hits > allowed) grown.push(`${r}: ${hits} dialect status literal(s), baseline ${allowed}`);
    }
    expect(grown, 'a new Contact.status dialect literal: use CONTACT_STATUSES (crm.constants.ts)').toEqual([]);
    for (const w of PACKET_WRITERS) expect(LEGACY_DIALECT_READERS[w], `${w} may not be baselined`).toBeUndefined();
  });

  it.todo(
    "CR-1 (companion packet, files outside the V1-38 write set): the legacy 'CUSTOMER' readers read CLIENT - lead-scoring.scheduler.ts (+5), health-score.service.ts (dormant customer count), relationship-health.service.ts (CUSTOMER signal branches), maturity-assessment.service.ts (customer count) - and LEGACY_DIALECT_READERS drops each file it fixes",
  );

  it('an external store buyer maps into the vocabulary: orders make a CLIENT, none a LEAD', () => {
    expect(contactStatusForExternalCustomer(3)).toBe('CLIENT');
    expect(contactStatusForExternalCustomer(1)).toBe('CLIENT');
    expect(contactStatusForExternalCustomer(0)).toBe('LEAD');
    expect(contactStatusForExternalCustomer(undefined)).toBe('LEAD');
    for (const n of [0, 1, 5, undefined, null]) expect(isContactStatus(contactStatusForExternalCustomer(n as number))).toBe(true);
    for (const d of DIALECTS) expect(isContactStatus(d)).toBe(false);
    for (const s of CONTACT_STATUSES) expect(isContactStatus(s)).toBe(true);
  });
});
