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
 *     baseline that may shrink but never grow, and no new file joins it;
 *   - V1-38b (review CR-1): the readers that counted 'CUSTOMER' (lead scoring,
 *     the people health score, people-flow relationship health, the maturity
 *     assessment) count a CLIENT, and a legacy 'CUSTOMER' row the same;
 *   - V1-38b review repairs: the dialects are still WRITTEN. The CSV/link
 *     import copies a file's status column into Contact.status verbatim
 *     (crm-import.service.ts -> CrmService.createContact), so a 'CUSTOMER' or
 *     'DORMANT' row can appear today, not only from before V1-38. The readers
 *     keep their legacy spellings while any writer can produce them, and
 *     people-flow keeps a contact imported as 'DORMANT' in Dormant and out of
 *     At Risk, as it did before V1-38b (CR-1 of the V1-38b review). Real-DB
 *     proof of the writer and the readers:
 *     test/contact-status-readers-import.integration.test.ts.
 *   - W3-V1-38c-IMPORT-STATUS (V1-38b residuals): the import stores the status
 *     column as a ContactStatus (importedContactStatus: the vocabulary in any
 *     case, the legacy CUSTOMER as CLIENT), so the import writes no CUSTOMER.
 *     A DORMANT cell keeps the legacy DORMANT the people-flow segments read
 *     (review CR-V38c-1: the LEAD default would move a contact imported as
 *     dormant between segments, and no owner ruling covers that); anything
 *     else takes the LEAD default. The import is not the only writer outside
 *     the DTOs: CrmService.createContact and updateContact store a status
 *     verbatim, and a playbook's update_status action hands updateContact
 *     'ACTIVE' or whatever status the action names (review ST-38c-1, a
 *     follow-up packet), so a dialect can still be written. The readers keep
 *     reading the legacy spellings, through one legacy CLIENT spelling, one
 *     legacy dormant spelling and one predicate (LEGACY_CLIENT_STATUS,
 *     LEGACY_DORMANT_STATUS, isClientStatus) in crm.constants.ts.
 *   - W4-D92-DORMANT-AS-CLIENT (owner ruling D-92): an imported (or legacy)
 *     DORMANT contact status is stored as CLIENT, so every stored status is one
 *     of CONTACT_STATUSES, and "dormant" is always worked out from inactivity
 *     (the Dormant segment shows clients with no recent activity). The import
 *     and a playbook's update_status action store a status only through
 *     canonicalContactStatus, which reads DORMANT, like CUSTOMER, as CLIENT,
 *     and update_status writes nothing for ACTIVE or any word with no
 *     ContactStatus. Rows are not migrated: a row still holding DORMANT reads
 *     as CLIENT (isClientStatus), and no reader puts it in Dormant by its
 *     spelling. The cases below that pinned the pre-D-92 behaviour say so.
 *     Review CR-D92-1: two more writers outside the DTOs stored a status
 *     verbatim, lowercase included ('dormant', 'customer', 'lead'), which no
 *     reader counts: KEY Cortex's CRM adapter (create_contact, update_contact,
 *     update_status; crm-adapter.service.spec.ts) and KEY's
 *     update_status_with_confirmation (CrmService.bulkUpdateContacts). Both
 *     store through canonicalContactStatus now and refuse a status with none.
 *   - W5-D92-RESIDUALS (D-92 residuals): the KEY Cortex capability registry
 *     offers exactly CONTACT_STATUSES (it offered churned and partner, which
 *     the CRM adapter refuses), and the Google/Outlook contact-sync rules and
 *     the connector form mapping store and apply an operator's defaultStatus
 *     only through canonicalContactStatus (last describe block below).
 *
 * Pure: reads source files, imports constants and drives the readers over
 * in-memory stand-ins for Prisma; no database, no network.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTACT_STATUSES,
  LEGACY_CLIENT_STATUS,
  LEGACY_DORMANT_STATUS,
  canonicalContactStatus,
  contactStatusForExternalCustomer,
  isClientStatus,
  isContactStatus,
} from './crm.constants';
import { FLOW_TOOLS, getToolByName } from '../ai/flow-tool-registry';
import { LeadScoringScheduler } from './lead-scoring.scheduler';
import { HealthScoreService } from '../intelligence/health-score.service';
import { RelationshipHealthService } from '../people-flow/relationship-health.service';
import { MaturityAssessmentService } from '../analytics/maturity-assessment.service';

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
 * V1-38b fixed those four readers (STATUS_READERS below) and dropped them from
 * this baseline.
 */
const LEGACY_DIALECT_READERS: Record<string, { hits: number; why: string }> = {
  'modules/ai/key-tool-registry.service.ts': {
    hits: 1,
    why: "status: { not: 'DORMANT' } filter: excludes a row the CSV/link import or a playbook's update_status action wrote as DORMANT before D-92 (neither writes it since); D-92 reads such a row as CLIENT, so this KEY tool filter is a residual outside W4-D92-DORMANT-AS-CLIENT",
  },
  'modules/ai/flow-orchestrator.service.ts': { hits: 1, why: "an Automation's ACTIVE/INACTIVE, not Contact.status (scanner false positive)" },
};

/**
 * V1-38b (CR-1): the readers that counted only 'CUSTOMER' as a customer. Each
 * now reads CLIENT, the canonical status, and counts a legacy 'CUSTOMER' row
 * the same. The Shopify adapter wrote such a row before V1-38, and the CSV/link
 * import copied a file's status column verbatim until V1-38c. The import
 * stores CLIENT for it now (V1-38c), but a playbook's update_status action can
 * still write it (review ST-38c-1, follow-up packet), and rows hold it: the
 * legacy spelling may go only once no writer can produce it and no row holds
 * it. V1-38c: the readers take it, and the predicate, from crm.constants.ts.
 */
const STATUS_READERS = [
  'modules/crm/lead-scoring.scheduler.ts',
  'modules/intelligence/health-score.service.ts',
  'modules/people-flow/relationship-health.service.ts',
  'modules/analytics/maturity-assessment.service.ts',
];

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

  it.each(STATUS_READERS)(
    "CR-1 (V1-38b): %s reads CLIENT - no status dialect, out of the baseline, and its only 'CUSTOMER' is the one documented legacy constant",
    (file) => {
      const src = read(file);
      expect(dialectHits(src), `${file}: CUSTOMER/DORMANT/INACTIVE in a status position`).toEqual([]);
      expect(LEGACY_DIALECT_READERS[file], `${file} may not be baselined`).toBeUndefined();
      // Hoisting the dialect out of the status position would pass the scan
      // above, so every 'CUSTOMER' literal in a reader must be the declaration
      // that names it as the legacy spelling of CLIENT.
      const customerLiterals = src.match(/['"`]CUSTOMER['"`]/g) ?? [];
      const legacyDeclarations = src.match(/\bconst LEGACY_CLIENT_STATUS = 'CUSTOMER';/g) ?? [];
      expect(customerLiterals.length, `${file}: a 'CUSTOMER' literal other than const LEGACY_CLIENT_STATUS`).toBe(legacyDeclarations.length);
      expect(legacyDeclarations.length, `${file}: one legacy declaration at most`).toBeLessThanOrEqual(1);
      expect(src, `${file} takes CLIENT from the vocabulary (crm.constants.ts)`).toMatch(/from '\.{1,2}\/(?:crm\/)?crm\.constants'/);
      // V1-38b review CR-2: the legacy spelling is not only historical, and
      // the reader says so (the CSV/link import still writes it).
      if (legacyDeclarations.length) {
        expect(src, `${file}: the legacy note names the import that still writes CUSTOMER`).toMatch(/crm-import\.service\.ts/);
      }
    },
  );

  it('V1-38c: the legacy CLIENT spelling and isClientStatus are declared once, in crm.constants.ts, and the four status readers import them and declare neither', () => {
    const constants = read('modules/crm/crm.constants.ts');
    expect(constants.match(/\bexport const LEGACY_CLIENT_STATUS = 'CUSTOMER';/g) ?? [], 'one LEGACY_CLIENT_STATUS in crm.constants.ts').toHaveLength(1);
    expect(constants, 'crm.constants.ts exports isClientStatus').toMatch(/\bexport function isClientStatus\(/);
    for (const file of STATUS_READERS) {
      const src = read(file);
      expect(src, `${file}: a local LEGACY_CLIENT_STATUS`).not.toMatch(/\bconst LEGACY_CLIENT_STATUS\b/);
      expect(src, `${file}: a local isClientStatus`).not.toMatch(/\b(?:const|function) isClientStatus\b/);
      expect(src, `${file}: a 'CUSTOMER' literal`).not.toMatch(/['"`]CUSTOMER['"`]/);
      expect(src, `${file}: takes the legacy helper from crm.constants.ts`).toMatch(
        /import \{[^}]*\b(?:isClientStatus|LEGACY_CLIENT_STATUS)\b[^}]*\} from '\.{1,2}\/(?:crm\/)?crm\.constants'/,
      );
    }
    // No other file declares its own copy.
    const copies = sourceFiles(SRC)
      .filter((f) => /\bconst LEGACY_CLIENT_STATUS\b/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(copies).toEqual(['modules/crm/crm.constants.ts']);
    expect(LEGACY_CLIENT_STATUS).toBe('CUSTOMER');
    expect(isClientStatus('CLIENT')).toBe(true);
    expect(isClientStatus(LEGACY_CLIENT_STATUS)).toBe(true);
    // D-92: a row still holding the legacy DORMANT (written before D-92; rows
    // are not migrated) reads as CLIENT. Before D-92 this case pinned
    // isClientStatus('DORMANT') false.
    expect(isClientStatus(LEGACY_DORMANT_STATUS)).toBe(true);
    for (const s of ['LEAD', 'PROSPECT', 'LOST', 'client', 'customer', 'dormant', '', null, undefined]) {
      expect(isClientStatus(s), String(s)).toBe(false);
    }
  });

  // D-92: before D-92 this case read DORMANT as none (a status with no
  // ContactStatus, which the import then kept as the legacy DORMANT).
  it('V1-38c, D-92: canonicalContactStatus reads a written value as a ContactStatus: the vocabulary in any case or padding as itself, the legacy CUSTOMER and DORMANT as CLIENT, and INACTIVE, ACTIVE, an unknown or a blank value as none', () => {
    for (const s of CONTACT_STATUSES) {
      expect(canonicalContactStatus(s)).toBe(s);
      expect(canonicalContactStatus(s.toLowerCase())).toBe(s);
      expect(canonicalContactStatus(` ${s[0]}${s.slice(1).toLowerCase()} `)).toBe(s);
    }
    for (const v of ['CUSTOMER', 'customer', ' Customer ', 'DORMANT', 'dormant', ' Dormant ']) {
      expect(canonicalContactStatus(v), v).toBe('CLIENT');
      // The mapping the readers use: what they count as CLIENT, the import stores as CLIENT.
      expect(isClientStatus(canonicalContactStatus(v))).toBe(true);
    }
    for (const v of ['INACTIVE', 'inactive', 'ACTIVE', 'Active', 'VIP', 'Negotiation', 'CLIENTS', 'C L I E N T', 'DORMANTS', 'D O R M A N T', '', '   ', null, undefined]) {
      expect(canonicalContactStatus(v), String(v)).toBeNull();
    }
  });

  // D-92: before D-92 this case required relationship-health to import
  // LEGACY_DORMANT_STATUS and keep a contact imported as DORMANT in Dormant
  // whatever its silence (V1-38b review CR-1, V1-38c review CR-V38c-1).
  it("D-92 (was CR-1, V1-38b review): people-flow relationship health spells no Contact.status 'DORMANT' and reads no LEGACY_DORMANT_STATUS of its own: a stored legacy DORMANT is a CLIENT through isClientStatus", () => {
    const src = read('modules/people-flow/relationship-health.service.ts');
    // relationship-health has no relationshipHealth 'DORMANT' literal, so every
    // 'DORMANT' literal in it would be a Contact.status spelling.
    expect(src.match(/['"`]DORMANT['"`]/g) ?? [], "relationship-health: a 'DORMANT' literal of its own").toEqual([]);
    expect(src, 'relationship-health singles out the legacy DORMANT spelling (D-92: it is a CLIENT)').not.toMatch(/\bLEGACY_DORMANT_STATUS\b/);
    expect(src, 'relationship-health reads a client through isClientStatus from crm.constants.ts').toMatch(
      /import \{[^}]*\bisClientStatus\b[^}]*\} from '\.\.\/crm\/crm\.constants'/,
    );
    const constants = read('modules/crm/crm.constants.ts');
    expect(constants.match(/\bexport const LEGACY_DORMANT_STATUS = 'DORMANT';/g) ?? [], 'one documented LEGACY_DORMANT_STATUS').toHaveLength(1);
    expect(constants.match(/['"`]DORMANT['"`]/g) ?? [], "crm.constants.ts: a 'DORMANT' literal other than LEGACY_DORMANT_STATUS").toHaveLength(1);
    const copies = sourceFiles(SRC)
      .filter((f) => /\bconst LEGACY_DORMANT_STATUS\b/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(copies).toEqual(['modules/crm/crm.constants.ts']);
    expect(LEGACY_DORMANT_STATUS).toBe('DORMANT');
    expect(isClientStatus(LEGACY_DORMANT_STATUS)).toBe(true);
  });

  // D-92: replaces the V1-38c (review CR-V38c-1) case that pinned
  // importedContactStatus keeping the legacy DORMANT for a DORMANT cell.
  it('D-92 (was V1-38c review CR-V38c-1): what the CSV/link import stores for a DORMANT cell in any case or padding is CLIENT, a ContactStatus, and crm.constants.ts keeps no separate import mapping (importedContactStatus) that could store DORMANT', () => {
    for (const v of ['DORMANT', 'dormant', ' Dormant ']) {
      expect(canonicalContactStatus(v), v).toBe('CLIENT');
      expect(isContactStatus(canonicalContactStatus(v)), v).toBe(true);
    }
    const constants = read('modules/crm/crm.constants.ts');
    expect(constants, 'crm.constants.ts: importedContactStatus').not.toMatch(/\bimportedContactStatus\b/);
    for (const file of sourceFiles(SRC)) {
      expect(readFileSync(file, 'utf8'), `${rel(file)}: importedContactStatus`).not.toMatch(/\bimportedContactStatus\b/);
    }
  });

  it('V1-38c, D-92: the CSV/link import stores its status cell through canonicalContactStatus, the helper a playbook update_status uses, and copies no status cell verbatim', () => {
    const src = read('modules/crm/crm-import.service.ts');
    expect(src).toMatch(/canonicalContactStatus\(row\[mapping\.status\]\)/);
    const stringFields = src.match(/const stringFields[^=]*= \[([^\]]*)\]/);
    expect(stringFields, 'buildContactInput lists the cells it copies verbatim').not.toBeNull();
    expect(stringFields![1]).not.toMatch(/'status'/);
  });

  // D-92: replaces the ST-38c-1 characterization (V1-38c review), which pinned
  // update_status handing updateContact 'ACTIVE' by default, or the CUSTOMER or
  // DORMANT the action named.
  it("D-92 (ST-38c-1, V1-38c review): a playbook's update_status action hands CrmService.updateContact only a ContactStatus: DORMANT and CUSTOMER in any case as CLIENT, a canonical status as itself, and nothing at all for ACTIVE (the old default), no status, INACTIVE or an unknown word", async () => {
    const { AutomationExecutorService } = await import('../flow/automation-executor.service');
    const written: Array<{ contactId: string; status: string | undefined }> = [];
    const warned: string[] = [];
    const self = {
      crm: {
        updateContact: async (input: { contactId: string; status?: string }) => {
          written.push({ contactId: input.contactId, status: input.status });
          return {};
        },
      },
      logger: { warn: (m: string) => { warned.push(m); }, log: () => undefined, error: () => undefined },
    };
    const executeAction = (AutomationExecutorService.prototype as any).executeAction as (...args: unknown[]) => Promise<unknown>;
    await executeAction.call(self, 'biz', 'playbook', { type: 'update_status' }, { contactId: 'none' });
    await executeAction.call(self, 'biz', 'playbook', { type: 'update_status', status: 'ACTIVE' }, { contactId: 'active' });
    await executeAction.call(self, 'biz', 'playbook', { type: 'update_status', status: 'INACTIVE' }, { contactId: 'inactive' });
    await executeAction.call(self, 'biz', 'playbook', { type: 'UPDATE_STATUS', value: 'VIP' }, { contactId: 'vip' });
    await executeAction.call(self, 'biz', 'playbook', { type: 'update_status', status: 'CUSTOMER' }, { contactId: 'customer' });
    await executeAction.call(self, 'biz', 'playbook', { type: 'UPDATE_STATUS', value: 'DORMANT' }, { contactId: 'dormant' });
    await executeAction.call(self, 'biz', 'playbook', { type: 'update_status', status: ' dormant ' }, { contactId: 'dormant-padded' });
    await executeAction.call(self, 'biz', 'playbook', { type: 'update_status', status: 'lost' }, { contactId: 'lost' });
    await executeAction.call(self, 'biz', 'playbook', { type: 'update_status', value: 'PROSPECT' }, { contactId: 'prospect' });
    expect(written).toEqual([
      { contactId: 'customer', status: 'CLIENT' },
      { contactId: 'dormant', status: 'CLIENT' },
      { contactId: 'dormant-padded', status: 'CLIENT' },
      { contactId: 'lost', status: 'LOST' },
      { contactId: 'prospect', status: 'PROSPECT' },
    ]);
    for (const w of written) expect(isContactStatus(w.status), w.contactId).toBe(true);
    // A skipped action says so, as a playbook action with an invalid config does.
    expect(warned, 'one warning per update_status that names no ContactStatus').toHaveLength(4);
  });

  // D-92 review CR-D92-1: before this repair the tool handed bulkUpdateContacts
  // its newStatus verbatim ('DORMANT', 'dormant', 'customer', 'ACTIVE').
  it("D-92 (review CR-D92-1): KEY's update_status_with_confirmation hands CrmService.bulkUpdateContacts only a ContactStatus: DORMANT and CUSTOMER in any case as CLIENT, a canonical status in any case as itself, and refuses ACTIVE, INACTIVE, an unknown or a blank status writing nothing", { timeout: 60_000 }, async () => {
    const { FlowOrchestratorService } = await import('../ai/flow-orchestrator.service');
    const written: Array<{ contactIds: string[]; status?: string }> = [];
    const self = {
      getCrm: () => ({
        bulkUpdateContacts: async (input: { contactIds: string[]; status?: string }) => {
          written.push({ contactIds: input.contactIds, status: input.status });
          return { updated: input.contactIds.length };
        },
      }),
    };
    const executeToolAction = (FlowOrchestratorService.prototype as any).executeToolAction as (...args: unknown[]) => Promise<any>;
    const run = (newStatus: unknown) =>
      executeToolAction.call(self, 'biz', 'update_status_with_confirmation', { entityType: 'contact', ids: ['c1', 'c2'], newStatus });
    const CANONICAL: Array<[string, string]> = [
      ['DORMANT', 'CLIENT'], ['dormant', 'CLIENT'], [' Dormant ', 'CLIENT'], ['CUSTOMER', 'CLIENT'], ['customer', 'CLIENT'],
      ['lead', 'LEAD'], ['Prospect', 'PROSPECT'], ['CLIENT', 'CLIENT'], ['LOST', 'LOST'],
    ];
    for (const [newStatus, stored] of CANONICAL) {
      const result = await run(newStatus);
      // The tool answers with the status it wrote.
      expect(result, newStatus).toEqual({ entityType: 'contact', updatedCount: 2, newStatus: stored });
    }
    expect(written.map((w) => w.status)).toEqual(CANONICAL.map(([, stored]) => stored));
    for (const w of written) expect(isContactStatus(w.status), String(w.status)).toBe(true);
    const before = written.length;
    for (const newStatus of ['ACTIVE', 'INACTIVE', 'churned', 'VIP', '', '   ', undefined, 7]) {
      await expect(run(newStatus), String(newStatus)).rejects.toThrow(/Unsupported contact status/);
    }
    expect(written, 'a refused status writes nothing').toHaveLength(before);
  });

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

/**
 * A Prisma `where` evaluated in memory: only the operators the readers below
 * use. An operator it does not know throws, so a reader that changes its query
 * shape fails here instead of matching by accident.
 */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Array<Record<string, unknown>>).some((w) => matchesWhere(row, w));
    const value = row[key] as any;
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return value === cond;
    return Object.entries(cond as Record<string, any>).every(([op, x]) => {
      switch (op) {
        case 'in': return (x as unknown[]).includes(value);
        case 'not': return value !== x;
        case 'lt': return value != null && value < x;
        default: throw new Error(`in-memory where: unsupported operator ${key}.${op}`);
      }
    });
  });
}

describe("V1-38b (CR-1): the status readers count a CLIENT as a customer, and a legacy 'CUSTOMER' row (written by the CSV/link import until V1-38c) the same", () => {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(Date.now() - days * DAY);

  it('lead scoring: a CLIENT earns the +5 customer bonus over a PROSPECT; a legacy CUSTOMER scores as a CLIENT; LOST keeps its -10', async () => {
    const statuses = ['PROSPECT', 'CLIENT', 'CUSTOMER', 'LOST'];
    const scores = new Map<string, number>();
    const db = {
      business: { findMany: async () => [{ id: 'biz' }] },
      contact: {
        // Identical inputs but the status, so the status term is the only difference.
        findMany: async () =>
          statuses.map((status) => ({ id: status, relationshipHealth: null, lastInteractionAt: null, lastContactedAt: null, status })),
        update: async ({ where, data }: { where: { id: string }; data: { leadScore: number } }) => {
          scores.set(where.id, data.leadScore);
        },
      },
      deal: { groupBy: async () => [] },
      invoice: { groupBy: async () => [] },
      contactEvent: { groupBy: async () => [] },
    };
    const scheduler = new LeadScoringScheduler({ client: db } as any);
    expect(await scheduler.tick(new Date('2026-11-09T23:00:00Z'))).toEqual({ ran: true, updated: 4 });
    expect(scores.get('CLIENT'), 'CLIENT vs PROSPECT').toBe(scores.get('PROSPECT')! + 5);
    expect(scores.get('CUSTOMER'), 'legacy CUSTOMER vs CLIENT').toBe(scores.get('CLIENT'));
    expect(scores.get('LOST'), 'LOST vs PROSPECT').toBe(scores.get('PROSPECT')! - 10);
  });

  it('people health score: a CLIENT untouched for 60+ days is a dormant customer; a legacy CUSTOMER row counts the same; fresh, other-status, deleted and other-tenant rows do not', async () => {
    const row = (id: string, status: string, updatedDaysAgo: number, extra: Record<string, unknown> = {}) => ({
      id, businessId: 'biz', deletedAt: null, status, updatedAt: ago(updatedDaysAgo), email: `${id}@example.test`, phone: '+18685550100', ...extra,
    });
    const contacts = [
      row('client-stale', 'CLIENT', 90),
      row('legacy-stale', 'CUSTOMER', 90),
      row('client-fresh', 'CLIENT', 5),
      row('prospect-stale', 'PROSPECT', 90),
      row('client-deleted', 'CLIENT', 90, { deletedAt: ago(1) }),
      row('client-other-tenant', 'CLIENT', 90, { businessId: 'other' }),
    ];
    const count = async ({ where }: { where: Record<string, unknown> }) => contacts.filter((c) => matchesWhere(c, where)).length;
    const health: any = new HealthScoreService({ client: { contact: { count } } } as any);
    const people = await health.calculatePeopleHealth('biz');
    expect(people.metrics.dormantCustomers).toBe(2);
    expect(people.reasons).toContain('2 dormant customers');
    expect(people.metrics.totalContacts).toBe(4);
  });

  it('people-flow segments: a recently active CLIENT is a High-Value Customer and a legacy CUSTOMER the same; a PROSPECT is not', async () => {
    const contact = (id: string, status: string, daysSilent: number) => ({
      id, firstName: id, lastName: null, email: null, status, lastInteractionAt: ago(daysSilent), leadScore: 60,
    });
    const contacts = [contact('client', 'CLIENT', 3), contact('legacy', 'CUSTOMER', 3), contact('prospect', 'PROSPECT', 3)];
    const svc = new RelationshipHealthService({ client: { contact: { findMany: async () => contacts } } } as any);
    const highValue = (await svc.listSegments('biz')).find((s) => s.id === 'high-value');
    expect(highValue?.contacts.map((c) => c.id).sort()).toEqual(['client', 'legacy']);
    expect(highValue?.criteria).toContain('CLIENT');
    expect(highValue?.criteria).not.toContain('CUSTOMER');
  });

  it('people-flow segments: dormancy is not a Contact.status (CF-49), so silence alone places a canonical contact in At Risk and Dormant, as before', async () => {
    const contact = (id: string, status: string, daysSilent: number) => ({
      id, firstName: id, lastName: null, email: null, status, lastInteractionAt: ago(daysSilent), leadScore: 40,
    });
    const contacts = [contact('client-silent', 'CLIENT', 100), contact('lead-quiet', 'LEAD', 20)];
    const svc = new RelationshipHealthService({ client: { contact: { findMany: async () => contacts } } } as any);
    const segments = await svc.listSegments('biz');
    const ids = (id: string) => segments.find((s) => s.id === id)?.contacts.map((c) => c.id) ?? [];
    expect(ids('stale-leads')).toEqual(['lead-quiet']);
    expect(ids('at-risk')).toEqual(['client-silent']);
    expect(ids('dormant')).toEqual(['client-silent']);
    expect(segments.find((s) => s.id === 'dormant')?.criteria, 'the criteria names no status the CRM cannot hold').not.toMatch(/DORMANT/);
    // Every segment's criteria names only statuses the CRM can hold (one
    // contact per segment, so listSegments returns all five).
    const everyone = [
      { ...contact('hot', 'LEAD', 1), leadScore: 80 },
      contact('stale', 'LEAD', 20),
      contact('client', 'CLIENT', 1),
      contact('silent', 'CLIENT', 100),
    ];
    const all = await new RelationshipHealthService({ client: { contact: { findMany: async () => everyone } } } as any).listSegments('biz');
    expect(all.map((s) => s.id).sort()).toEqual(['at-risk', 'dormant', 'high-value', 'hot-leads', 'stale-leads']);
    for (const s of all) {
      for (const [, named] of s.criteria.matchAll(/\bstatus ([A-Z_]+)/gi)) {
        expect(CONTACT_STATUSES as readonly string[], `${s.id}: "${s.criteria}"`).toContain(named);
      }
    }
  });

  // D-92: replaces the V1-38b review CR-1 case, which pinned a contact stored
  // as DORMANT in Dormant whatever its silence (the one active 5 days ago
  // included) and out of At Risk.
  it("D-92 (was V1-38b review CR-1): people-flow segments read a stored legacy 'DORMANT' as CLIENT, and Dormant is the clients silent 90+ days whatever the stored spelling (CLIENT, CUSTOMER, DORMANT), never a contact by its status alone", async () => {
    const contact = (id: string, status: string, daysSilent: number) => ({
      id, firstName: id, lastName: null, email: null, status, lastInteractionAt: ago(daysSilent), leadScore: 40,
    });
    const contacts = [
      contact('dormant-recent', 'DORMANT', 5),
      contact('dormant-quiet', 'DORMANT', 40),
      contact('dormant-silent', 'DORMANT', 100),
      contact('customer-silent', 'CUSTOMER', 100),
      contact('client-quiet', 'CLIENT', 40),
      contact('client-silent', 'CLIENT', 100),
      contact('client-active', 'CLIENT', 3),
      contact('lead-silent', 'LEAD', 100),
      contact('lost-silent', 'LOST', 100),
    ];
    const segments = await new RelationshipHealthService({ client: { contact: { findMany: async () => contacts } } } as any).listSegments('biz');
    const ids = (id: string) => (segments.find((s) => s.id === id)?.contacts.map((c) => c.id) ?? []).sort();
    // Dormant: clients with no interaction in 90+ days, whatever the spelling.
    // The legacy DORMANT active 5 days ago is no longer in Dormant, and a lead
    // or a lost contact silent as long is not a client.
    expect(ids('dormant')).toEqual(['client-silent', 'customer-silent', 'dormant-silent']);
    // At Risk: silence alone, a legacy DORMANT row no longer left out.
    expect(ids('at-risk')).toEqual(['client-quiet', 'client-silent', 'customer-silent', 'dormant-quiet', 'dormant-silent', 'lead-silent', 'lost-silent']);
    // A legacy DORMANT active in the last 30 days is a High-Value Customer as a CLIENT is.
    expect(ids('high-value')).toEqual(['client-active', 'dormant-recent']);
    // A legacy DORMANT is a client, never a lead.
    expect(ids('stale-leads')).toEqual(['lead-silent']);
    for (const s of segments) {
      for (const [, named] of s.criteria.matchAll(/\bstatus ([A-Z_]+)/gi)) {
        expect(CONTACT_STATUSES as readonly string[], `${s.id}: "${s.criteria}"`).toContain(named);
      }
      expect(s.criteria, `${s.id}: the criteria names an "imported as dormant" rule D-92 removed`).not.toMatch(/imported as dormant/i);
    }
    expect(segments.find((s) => s.id === 'dormant')?.criteria, 'Dormant says it is clients').toMatch(/\bCLIENT\b/);
  });

  it('relationship health signals: a CLIENT with no bookings in 90 days is flagged, a legacy CUSTOMER the same, a PROSPECT is not', async () => {
    // The stand-in row carries businessId. The real findUnique selects none, so
    // computeHealth answers null for every contact today (characterized in
    // test/contact-reads-noncrm-visibility.integration.test.ts; not this packet).
    const signalsFor = async (status: string) => {
      const prisma = {
        client: {
          contact: {
            findUnique: async () => ({
              id: 'c1', businessId: 'biz', firstName: 'Ada', lastName: null, email: null, status, lastInteractionAt: ago(3), createdAt: ago(400),
            }),
          },
          invoice: { findMany: async () => [] },
          booking: { findMany: async () => [] },
          contactTask: { findMany: async () => [] },
          contactNote: { findMany: async () => [] },
          deal: { findMany: async () => [] },
        },
      };
      const health = await new RelationshipHealthService(prisma as any).computeHealth('biz', 'c1');
      expect(health, `computeHealth(${status})`).not.toBeNull();
      return health!.signals;
    };
    expect(await signalsFor('CLIENT')).toContain('No bookings in 90 days');
    expect(await signalsFor('CUSTOMER')).toContain('No bookings in 90 days');
    expect(await signalsFor('PROSPECT')).not.toContain('No bookings in 90 days');
  });

  it('maturity assessment: CLIENT contacts are the customers of the Customer dimension; legacy CUSTOMER rows count the same', async () => {
    const customerMaturity = async (statuses: string[]) => {
      const business = {
        invoices: [], bookings: [], products: [], services: [],
        members: [{ id: 'm1', role: 'OWNER' }],
        channelConnections: [],
        contacts: statuses.map((status) => ({ status, createdAt: ago(10) })),
        _count: { invoices: 0, contacts: statuses.length, bookings: 0, products: 0, services: 0 },
      };
      const prisma = {
        client: {
          business: { findUnique: async () => business },
          maturityScore: { findMany: async () => [], create: async ({ data }: { data: Record<string, unknown> }) => data },
        },
      };
      const { assessment } = await new MaturityAssessmentService(prisma as any).assessBusiness('biz');
      return (assessment as any).customerMaturity as number;
    };
    const eleven = (status: string) => Array.from({ length: 11 }, () => status);
    // 11 contacts score 10 on their own; more than 10 customers add 10.
    expect(await customerMaturity(eleven('PROSPECT'))).toBe(10);
    expect(await customerMaturity(eleven('CLIENT'))).toBe(20);
    expect(await customerMaturity([...Array.from({ length: 6 }, () => 'CLIENT'), ...Array.from({ length: 5 }, () => 'CUSTOMER')])).toBe(20);
  });
});

/**
 * W4-D92-DORMANT-AS-CLIENT (owner ruling D-92): an imported (or legacy) DORMANT
 * status is stored as CLIENT, and rows are not migrated, so a row still holding
 * the legacy DORMANT (written by the CSV/link import or a playbook's
 * update_status before D-92) reads as CLIENT in every status reader; dormancy
 * comes from inactivity only. Real-DB proof on rows the import wrote:
 * test/contact-status-readers-import.integration.test.ts.
 */
describe("D-92: a stored legacy 'DORMANT' reads as CLIENT in every status reader; dormancy comes from inactivity only", () => {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(Date.now() - days * DAY);

  it('D-92: lead scoring scores a legacy DORMANT row as a CLIENT (the +5 customer bonus), not as a status of its own', async () => {
    const statuses = ['PROSPECT', 'CLIENT', 'DORMANT'];
    const scores = new Map<string, number>();
    const db = {
      business: { findMany: async () => [{ id: 'biz' }] },
      contact: {
        findMany: async () =>
          statuses.map((status) => ({ id: status, relationshipHealth: null, lastInteractionAt: null, lastContactedAt: null, status })),
        update: async ({ where, data }: { where: { id: string }; data: { leadScore: number } }) => {
          scores.set(where.id, data.leadScore);
        },
      },
      deal: { groupBy: async () => [] },
      invoice: { groupBy: async () => [] },
      contactEvent: { groupBy: async () => [] },
    };
    const scheduler = new LeadScoringScheduler({ client: db } as any);
    expect(await scheduler.tick(new Date('2026-11-09T23:00:00Z'))).toEqual({ ran: true, updated: 3 });
    expect(scores.get('DORMANT'), 'legacy DORMANT vs CLIENT').toBe(scores.get('CLIENT'));
    expect(scores.get('CLIENT'), 'CLIENT vs PROSPECT').toBe(scores.get('PROSPECT')! + 5);
  });

  it('D-92: the people health score counts a legacy DORMANT row untouched for 60+ days as a dormant customer, as a CLIENT, and a fresh one not', async () => {
    const row = (id: string, status: string, updatedDaysAgo: number) => ({
      id, businessId: 'biz', deletedAt: null, status, updatedAt: ago(updatedDaysAgo), email: `${id}@example.test`, phone: '+18685550100',
    });
    const contacts = [
      row('client-stale', 'CLIENT', 90),
      row('dormant-stale', 'DORMANT', 90),
      row('dormant-fresh', 'DORMANT', 5),
      row('lead-stale', 'LEAD', 90),
    ];
    const count = async ({ where }: { where: Record<string, unknown> }) => contacts.filter((c) => matchesWhere(c, where)).length;
    const health: any = new HealthScoreService({ client: { contact: { count } } } as any);
    const people = await health.calculatePeopleHealth('biz');
    expect(people.metrics.dormantCustomers).toBe(2);
    expect(people.reasons).toContain('2 dormant customers');
  });

  it('D-92: relationship health signals flag a legacy DORMANT row with no bookings in 90 days as they flag a CLIENT', async () => {
    const prisma = {
      client: {
        contact: {
          findUnique: async () => ({
            id: 'c1', businessId: 'biz', firstName: 'Ada', lastName: null, email: null, status: 'DORMANT', lastInteractionAt: ago(3), createdAt: ago(400),
          }),
        },
        invoice: { findMany: async () => [] },
        booking: { findMany: async () => [] },
        contactTask: { findMany: async () => [] },
        contactNote: { findMany: async () => [] },
        deal: { findMany: async () => [] },
      },
    };
    const health = await new RelationshipHealthService(prisma as any).computeHealth('biz', 'c1');
    expect(health, 'computeHealth(DORMANT)').not.toBeNull();
    expect(health!.signals).toContain('No bookings in 90 days');
  });

  it('D-92: the maturity assessment counts legacy DORMANT rows as customers, as CLIENT rows', async () => {
    const statuses = [...Array.from({ length: 6 }, () => 'CLIENT'), ...Array.from({ length: 5 }, () => 'DORMANT')];
    const business = {
      invoices: [], bookings: [], products: [], services: [],
      members: [{ id: 'm1', role: 'OWNER' }],
      channelConnections: [],
      contacts: statuses.map((status) => ({ status, createdAt: ago(10) })),
      _count: { invoices: 0, contacts: statuses.length, bookings: 0, products: 0, services: 0 },
    };
    const prisma = {
      client: {
        business: { findUnique: async () => business },
        maturityScore: { findMany: async () => [], create: async ({ data }: { data: Record<string, unknown> }) => data },
      },
    };
    const { assessment } = await new MaturityAssessmentService(prisma as any).assessBusiness('biz');
    // 11 contacts score 10 on their own; more than 10 customers add 10.
    expect((assessment as any).customerMaturity).toBe(20);
  });
});

/**
 * W5-D92-RESIDUALS (owner ruling D-92, the residuals W4-D92-DORMANT-AS-CLIENT
 * recorded in crm.constants.ts): two more places offered or stored a status
 * outside CONTACT_STATUSES.
 *   - The KEY Cortex capability registry (key-cortex-capability-registry.service.ts)
 *     offered the model 'lead', 'prospect', 'customer', 'churned' and 'partner'
 *     for create_contact, update_contact, update_status and the list_contacts
 *     and count_contacts filters, while the CRM adapter refuses churned and
 *     partner (review CR-D92-1) and a filter matches a stored status exactly.
 *     It now offers exactly CONTACT_STATUSES, and create_contact defaults to LEAD.
 *   - The Google and Outlook contact-sync rules and the connector form mapping
 *     (connect/*.service.ts) stored an operator's configured defaultStatus as
 *     given and wrote it to every contact a sync or a form submission created.
 *     They now store and apply it only through canonicalContactStatus, and the
 *     setting answers 400 for a value with none. Behavioural proof over the
 *     real controller: test/connect-default-status.e2e.test.ts. The Google
 *     Forms mapping is not one of them: its defaultStatus is the quote status.
 */
describe('W5-D92-RESIDUALS (D-92): the KEY Cortex capability registry and the connector contact rules speak only CONTACT_STATUSES', () => {
  type Param = { name: string; description: string; enumValues?: string[]; default?: unknown };
  type Entry = { name: string; parameters: Param[] };
  const CRM_STATUS_PARAMS: Array<['actions' | 'queries', string]> = [
    ['actions', 'create_contact'],
    ['actions', 'update_contact'],
    ['actions', 'list_contacts'],
    ['actions', 'update_status'],
    ['queries', 'count_contacts'],
  ];

  it('D-92: every contact-status parameter the KEY Cortex capability registry offers is exactly CONTACT_STATUSES (no churned, partner or customer), and create_contact defaults to LEAD', async () => {
    const { KeyCortexCapabilityRegistryService } = await import('../key-cortex/key-cortex-capability-registry.service');
    const crm = new KeyCortexCapabilityRegistryService().getAllCapabilities().find((c) => c.module === 'crm');
    expect(crm, 'the registry lists the crm module').toBeTruthy();
    for (const [kind, name] of CRM_STATUS_PARAMS) {
      const entry = (crm![kind] as Entry[]).find((x) => x.name === name);
      expect(entry, `crm.${name} is registered`).toBeTruthy();
      const status = entry!.parameters.find((p) => p.name === 'status');
      expect(status?.enumValues, `crm.${name}.status`).toEqual([...CONTACT_STATUSES]);
      if (name === 'create_contact') expect(status?.default, 'create_contact.status default').toBe('LEAD');
    }
    // Every other crm status parameter is a task's, not a contact's.
    const others = ([...crm!.actions, ...crm!.queries] as Entry[])
      .filter((x) => !CRM_STATUS_PARAMS.some(([, name]) => name === x.name))
      .flatMap((x) => x.parameters.filter((p) => p.name === 'status').map((p) => `${x.name}: ${p.description}`));
    expect(others).toEqual(['get_tasks: Task status']);
    // Each value offered is one the CRM adapter stores as itself.
    for (const [kind, name] of CRM_STATUS_PARAMS) {
      const status = (crm![kind] as Entry[]).find((x) => x.name === name)!.parameters.find((p) => p.name === 'status')!;
      for (const v of status.enumValues ?? []) expect(canonicalContactStatus(v), `crm.${name} offers ${v}`).toBe(v);
    }
  });

  it('D-92: the connector contact-sync rules and the connector form mapping store and apply an operator default status only through canonicalContactStatus, and write no defaultStatus verbatim', () => {
    for (const file of [
      'modules/connect/google-contacts-sync.service.ts',
      'modules/connect/outlook-contacts-sync.service.ts',
      'modules/connect/connector-form-mapping.service.ts',
    ]) {
      const src = read(file);
      expect(src, `${file}: takes canonicalContactStatus from crm.constants.ts`).toMatch(
        /import \{[^}]*\bcanonicalContactStatus\b[^}]*\} from '\.\.\/crm\/crm\.constants'/,
      );
      expect(src, `${file}: a defaultStatus written to Contact.status verbatim`).not.toMatch(
        /\bstatus\s*(?::|=)\s*(?:rules|mapping|input|prev)\.defaultStatus\b/,
      );
      expect(src, `${file}: a defaultStatus read back verbatim`).not.toMatch(
        /defaultStatus:\s*typeof obj\.defaultStatus === 'string' \? obj\.defaultStatus/,
      );
    }
    // The Google Forms mapping writes no Contact.status: its defaultStatus is the quote's
    // (review SEC-D92R-1: a quote status, held to DRAFT in test/connect-default-status.e2e.test.ts).
    const forms = read('modules/connect/google-forms-mapping.service.ts');
    const createContact = forms.match(/this\.crm\.createContact\(\{([\s\S]*?)\}\);/);
    expect(createContact, 'google-forms-mapping creates its contact through CrmService.createContact').not.toBeNull();
    expect(createContact![1], 'google-forms-mapping names a contact status').not.toMatch(/\bstatus\b/);
  });
});
