/**
 * RR-TOOL-EFFECT-METADATA (D-261, D-262, D-17, D-119; slice 2 of 2, after
 * RR-TOOL-EFFECT-CLASS): every FLOW_TOOLS entry refines slice-1 'WRITE' into
 * one of the four write effect classes ('INTERNAL_WRITE' | 'EXTERNAL_EFFECT' |
 * 'MONEY' | 'DESTRUCTIVE') and declares required `idempotency`,
 * `reversibility`, and `contractVersion` (>= 1) metadata.
 *
 * Consistency rules enforced over FLOW_TOOLS (and independently exercised via
 * negative controls over synthetic fixtures):
 *   Rule 1: A tool with non-empty `changedEntities` is NEVER `READ`.
 *   Rule 2: A tool whose handler sends mail/messages/notifications or calls an
 *           external provider is `EXTERNAL_EFFECT` or higher (never `READ` or
 *           `INTERNAL_WRITE`).
 *   Rule 3: A `MONEY` tool NEVER has `idempotency === 'NATURAL'` without a
 *           verified entry in `REVIEWED_NATURAL_MONEY_GUARDS` citing a real
 *           file:line idempotency guard.
 *   Rule 4: A non-`read`-family tool marked `READ` MUST be listed in
 *           `REVIEWED_NON_READ_FAMILY_READ_TOOLS` with a real existing
 *           file:line citation whose handler performs no write/send/provider
 *           call, AND must have empty `changedEntities`.
 *   Rule 5: External send tools (email/message/SMS/WhatsApp/social publish)
 *           have `reversibility` of `IRREVERSIBLE` (or `UNKNOWN`, never
 *           `REVERSIBLE` or `COMPENSABLE`).
 *
 * Exports added by slice 2 are accessed through a namespace import so this
 * spec loads cleanly on base and fails listing every tool missing metadata or
 * still carrying slice-1 'WRITE'.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as registry from './flow-tool-registry';
import type { FlowTool } from './flow-tool-registry';

const REPO_ROOT = resolve(__dirname, '../../../../..');

const { FLOW_TOOLS } = registry;
const isReadOnlyTool: (name: string) => boolean =
  (registry as unknown as { isReadOnlyTool?: (name: string) => boolean }).isReadOnlyTool ??
  (() => {
    throw new Error('isReadOnlyTool is not exported from flow-tool-registry');
  });

export const VALID_EFFECT_CLASSES = [
  'READ',
  'INTERNAL_WRITE',
  'EXTERNAL_EFFECT',
  'MONEY',
  'DESTRUCTIVE',
] as const;

export const VALID_IDEMPOTENCY = ['NATURAL', 'KEYED', 'NONE'] as const;

export const VALID_REVERSIBILITY = [
  'REVERSIBLE',
  'COMPENSABLE',
  'IRREVERSIBLE',
  'UNKNOWN',
] as const;

export type ValidEffectClass = (typeof VALID_EFFECT_CLASSES)[number];

const EFFECT_CLASS_RANK: Record<ValidEffectClass, number> = {
  READ: 0,
  INTERNAL_WRITE: 1,
  EXTERNAL_EFFECT: 2,
  MONEY: 3,
  DESTRUCTIVE: 4,
};

export interface ToolWithMetadata extends Omit<FlowTool, 'effectClass'> {
  effectClass?: unknown;
  idempotency?: unknown;
  reversibility?: unknown;
  contractVersion?: unknown;
}

export interface ReviewedReadCitation {
  tool: string;
  handlerFile: string;
  handlerLine: number;
  reason: string;
}

export interface ReviewedMoneyGuardCitation {
  tool: string;
  guardFile: string;
  guardLine: number;
  reason: string;
}

export type SourceLookup =
  | ReadonlyMap<string, readonly string[]>
  | ((relPath: string) => readonly string[] | null);

/**
 * Audited outbound send/publish tools whose execution dispatches email,
 * WhatsApp, SMS, customer-visible ticket replies, or social posts (Rule 5).
 */
export const KNOWN_SEND_TOOLS: readonly string[] = [
  'send_message_with_approval',
  'commerce_send_invoice',
  'marketing_send_campaign',
  'social_publish_post',
  'comms_send_broadcast',
  'inbox_reply_thread',
  'helpdesk_reply_to_ticket',
  'delegation_payment_recovery',
];

/**
 * Audited tools whose execution sends outbound mail/messages/notifications or
 * calls an external provider (AI LLM, Stripe, Google Drive/Gmail, Social APIs,
 * WhatsApp notification listener) — must be `EXTERNAL_EFFECT` or higher
 * (Rule 2).
 */
export const KNOWN_EXTERNAL_EFFECT_TOOLS: readonly string[] = [
  ...KNOWN_SEND_TOOLS,
  'reports_generate',
  'inbox_brief',
  'payments_list_transactions',
  'payments_search_transactions',
  'payments_list_links',
  'payments_create_link',
  'payments_revoke_link',
  'payments_refund_charge',
  'social_get_analytics',
  'contract_extract_terms',
  'contract_extract_clauses',
  'draft_followup_message',
  'draft_campaign_bundle',
  'draft_payment_reminder',
  'draft_storefront_copy',
  'draft_project_update',
  'generate_content_brief',
  'call_generate_script',
  'helpdesk_draft_reply',
  'drive_create_folder',
  'drive_create_document',
  'reconcile_sweep_statements',
  'seo_apply_remediation',
  'bookings_create_booking',
  'queue_campaign',
  'sequence_enroll',
  'sequence_enroll_overdue',
];

/**
 * The 14 read-family tools that slice 1 classified as WRITE (so isReadOnlyTool
 * returned false for them in slice 1 and must continue to return false in
 * slice 2).
 */
const SLICE_1_READ_FAMILY_WRITES: ReadonlySet<string> = new Set([
  'deals_list_stages',
  'finance_list_bank_accounts',
  'finance_list_coa',
  'present_onboarding_card',
  'inbox_list_threads',
  'inbox_read_thread',
  'reports_generate',
  'inbox_brief',
  'payments_list_transactions',
  'payments_search_transactions',
  'payments_list_links',
  'social_get_analytics',
  'contract_extract_terms',
  'contract_extract_clauses',
]);

const HANDLER_MUTATION_OR_EXTERNAL_RE =
  /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(|\b(emailService|transactionalEmail|messageSender|aiUsage)\b|sendCampaign|publishPost|sendBroadcast|refundCharge/;

const GUARD_LINE_RE =
  /status\s*===|FOR UPDATE|idempoten|dedupe|already|existing/i;

function createRepoSourceLookup(): (relPath: string) => readonly string[] | null {
  const cache = new Map<string, readonly string[] | null>();
  return (relPath: string): readonly string[] | null => {
    if (cache.has(relPath)) return cache.get(relPath) ?? null;
    const abs = resolve(REPO_ROOT, relPath);
    if (!abs.startsWith(REPO_ROOT) || !existsSync(abs)) {
      cache.set(relPath, null);
      return null;
    }
    const lines = readFileSync(abs, 'utf8').split('\n');
    cache.set(relPath, lines);
    return lines;
  };
}

function getSourceLines(
  lookup: SourceLookup,
  relPath: string,
): readonly string[] | null {
  if (typeof lookup === 'function') return lookup(relPath);
  return lookup.get(relPath) ?? null;
}

function extractSwitchCaseBody(
  lines: readonly string[],
  startLine1Indexed: number,
): string {
  const startIdx = startLine1Indexed - 1;
  let endIdx = startIdx + 1;
  while (endIdx < lines.length && !/^\s*case '/.test(lines[endIdx])) {
    endIdx += 1;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

export interface ValidateMetadataOptions {
  knownExternalEffectTools?: readonly string[];
  knownSendTools?: readonly string[];
}

/**
 * Validates every tool's effect metadata and all five consistency rules,
 * returning `tool: problem` strings (empty array = census passes).
 */
export function validateToolEffectMetadata(
  tools: readonly ToolWithMetadata[],
  reviewedReadList: readonly ReviewedReadCitation[],
  reviewedMoneyGuards: readonly ReviewedMoneyGuardCitation[],
  handlerSources: SourceLookup,
  options: ValidateMetadataOptions = {},
): string[] {
  const problems: string[] = [];
  const knownExternal = new Set(
    options.knownExternalEffectTools ?? KNOWN_EXTERNAL_EFFECT_TOOLS,
  );
  const knownSends = new Set(options.knownSendTools ?? KNOWN_SEND_TOOLS);

  const toolNames = new Set(tools.map((t) => t.name));
  const reviewedReadByTool = new Map<string, ReviewedReadCitation>();
  for (const entry of reviewedReadList) {
    if (!entry.tool || !toolNames.has(entry.tool)) {
      problems.push(
        `REVIEWED_NON_READ_FAMILY_READ_TOOLS: unknown tool ${JSON.stringify(entry.tool)}`,
      );
      continue;
    }
    if (reviewedReadByTool.has(entry.tool)) {
      problems.push(
        `${entry.tool}: duplicate entry in REVIEWED_NON_READ_FAMILY_READ_TOOLS`,
      );
    }
    reviewedReadByTool.set(entry.tool, entry);
  }

  const moneyGuardByTool = new Map<string, ReviewedMoneyGuardCitation>();
  for (const guard of reviewedMoneyGuards) {
    if (!guard.tool || !toolNames.has(guard.tool)) {
      problems.push(
        `REVIEWED_NATURAL_MONEY_GUARDS: unknown tool ${JSON.stringify(guard.tool)}`,
      );
      continue;
    }
    if (moneyGuardByTool.has(guard.tool)) {
      problems.push(
        `${guard.tool}: duplicate entry in REVIEWED_NATURAL_MONEY_GUARDS`,
      );
    }
    moneyGuardByTool.set(guard.tool, guard);
  }

  const validEffects = new Set<string>(VALID_EFFECT_CLASSES);
  const validIdempotency = new Set<string>(VALID_IDEMPOTENCY);
  const validReversibility = new Set<string>(VALID_REVERSIBILITY);

  for (const tool of tools) {
    const ec = tool.effectClass;
    const hasValidEffect = typeof ec === 'string' && validEffects.has(ec);
    if (!hasValidEffect) {
      problems.push(
        `${tool.name}: effectClass must be one of ${VALID_EFFECT_CLASSES.join(' | ')} (got ${JSON.stringify(ec)})`,
      );
    }

    const idem = tool.idempotency;
    const hasValidIdem = typeof idem === 'string' && validIdempotency.has(idem);
    if (!hasValidIdem) {
      problems.push(
        `${tool.name}: idempotency must be one of ${VALID_IDEMPOTENCY.join(' | ')} (got ${JSON.stringify(idem)})`,
      );
    }

    const rev = tool.reversibility;
    const hasValidRev = typeof rev === 'string' && validReversibility.has(rev);
    if (!hasValidRev) {
      problems.push(
        `${tool.name}: reversibility must be one of ${VALID_REVERSIBILITY.join(' | ')} (got ${JSON.stringify(rev)})`,
      );
    }

    const cv = tool.contractVersion;
    if (typeof cv !== 'number' || !Number.isInteger(cv) || cv < 1) {
      problems.push(
        `${tool.name}: contractVersion must be a positive integer >= 1 (got ${JSON.stringify(cv)})`,
      );
    }

    if (!hasValidEffect) continue;
    const effectClass = ec as ValidEffectClass;

    // Rule 1: non-empty changedEntities is never READ
    if (
      effectClass === 'READ' &&
      Array.isArray(tool.changedEntities) &&
      tool.changedEntities.length > 0
    ) {
      problems.push(
        `${tool.name}: Rule 1 violation — READ tool declares non-empty changedEntities ${JSON.stringify(tool.changedEntities)}`,
      );
    }

    // Rule 2: external sender / provider caller is EXTERNAL_EFFECT or higher
    if (
      knownExternal.has(tool.name) &&
      EFFECT_CLASS_RANK[effectClass] < EFFECT_CLASS_RANK.EXTERNAL_EFFECT
    ) {
      problems.push(
        `${tool.name}: Rule 2 violation — external sender/provider tool must be EXTERNAL_EFFECT or higher (got ${effectClass})`,
      );
    }

    // Rule 3: MONEY tool never has idempotency NATURAL without a verified guard citation
    if (effectClass === 'MONEY' && idem === 'NATURAL') {
      const guard = moneyGuardByTool.get(tool.name);
      if (!guard) {
        problems.push(
          `${tool.name}: Rule 3 violation — MONEY tool has idempotency 'NATURAL' without a REVIEWED_NATURAL_MONEY_GUARDS entry`,
        );
      } else {
        if (!guard.reason || guard.reason.trim().length === 0) {
          problems.push(
            `${tool.name}: Rule 3 violation — money guard citation is missing reason`,
          );
        }
        const lines = guard.guardFile
          ? getSourceLines(handlerSources, guard.guardFile)
          : null;
        if (!lines) {
          problems.push(
            `${tool.name}: Rule 3 violation — money guard file not found (${JSON.stringify(guard.guardFile)})`,
          );
        } else if (
          !Number.isInteger(guard.guardLine) ||
          guard.guardLine < 1 ||
          guard.guardLine > lines.length
        ) {
          problems.push(
            `${tool.name}: Rule 3 violation — money guard line ${guard.guardLine} out of range for ${guard.guardFile}`,
          );
        } else {
          const lineText = lines[guard.guardLine - 1].trim();
          if (
            lineText.length === 0 ||
            lineText.startsWith('//') ||
            !GUARD_LINE_RE.test(lineText)
          ) {
            problems.push(
              `${tool.name}: Rule 3 violation — cited line ${guard.guardFile}:${guard.guardLine} does not contain an idempotency guard (${JSON.stringify(lineText)})`,
            );
          }
        }
      }
    }

    // Rule 4: non-read-family tool marked READ must have a verified handler citation
    if (effectClass === 'READ' && tool.family !== 'read') {
      const citation = reviewedReadByTool.get(tool.name);
      if (!citation) {
        problems.push(
          `${tool.name}: Rule 4 violation — non-read-family ('${tool.family}') tool marked READ without a REVIEWED_NON_READ_FAMILY_READ_TOOLS entry`,
        );
      } else {
        if (!citation.reason || citation.reason.trim().length === 0) {
          problems.push(
            `${tool.name}: Rule 4 violation — reviewed-READ citation is missing reason`,
          );
        }
        const lines = citation.handlerFile
          ? getSourceLines(handlerSources, citation.handlerFile)
          : null;
        if (!lines) {
          problems.push(
            `${tool.name}: Rule 4 violation — reviewed-READ handler file not found (${JSON.stringify(citation.handlerFile)})`,
          );
        } else if (
          !Number.isInteger(citation.handlerLine) ||
          citation.handlerLine < 1 ||
          citation.handlerLine > lines.length
        ) {
          problems.push(
            `${tool.name}: Rule 4 violation — reviewed-READ handler line ${citation.handlerLine} out of range for ${citation.handlerFile}`,
          );
        } else {
          const citedLine = lines[citation.handlerLine - 1];
          if (!citedLine.includes(`case '${tool.name}':`)) {
            problems.push(
              `${tool.name}: Rule 4 violation — cited line ${citation.handlerFile}:${citation.handlerLine} does not open case '${tool.name}':`,
            );
          } else {
            const body = extractSwitchCaseBody(lines, citation.handlerLine);
            const match = body.match(HANDLER_MUTATION_OR_EXTERNAL_RE);
            if (match) {
              problems.push(
                `${tool.name}: Rule 4 violation — reviewed-READ handler contains write/send/provider call (${match[0]})`,
              );
            }
          }
        }
      }
    }

    // Rule 5: external send tools must be IRREVERSIBLE or UNKNOWN (never REVERSIBLE or COMPENSABLE)
    if (
      knownSends.has(tool.name) &&
      hasValidRev &&
      rev !== 'IRREVERSIBLE' &&
      rev !== 'UNKNOWN'
    ) {
      problems.push(
        `${tool.name}: Rule 5 violation — external send tool must have reversibility IRREVERSIBLE or UNKNOWN (got ${JSON.stringify(rev)})`,
      );
    }
  }

  return problems;
}

const makeFixture = (over: Partial<ToolWithMetadata> = {}): ToolWithMetadata => ({
  name: 'fixture_tool',
  description: 'fixture',
  family: 'read',
  effectClass: 'READ',
  idempotency: 'NATURAL',
  reversibility: 'REVERSIBLE',
  contractVersion: 1,
  riskLevel: 'low',
  riskTier: 1,
  parameters: { type: 'object', properties: {}, required: [] },
  outputSchema: { type: 'object', description: 'fixture', fields: {} },
  manualEquivalentRoute: '/app/keyflow-command',
  ...over,
});

function readRegistryTables(): {
  reviewedReads: readonly ReviewedReadCitation[] | undefined;
  reviewedMoneyGuards: readonly ReviewedMoneyGuardCitation[] | undefined;
} {
  const ns = registry as unknown as {
    REVIEWED_NON_READ_FAMILY_READ_TOOLS?: readonly ReviewedReadCitation[];
    REVIEWED_NATURAL_MONEY_GUARDS?: readonly ReviewedMoneyGuardCitation[];
  };
  return {
    reviewedReads: ns.REVIEWED_NON_READ_FAMILY_READ_TOOLS,
    reviewedMoneyGuards: ns.REVIEWED_NATURAL_MONEY_GUARDS,
  };
}

describe('RR-TOOL-EFFECT-METADATA: FLOW_TOOLS effect metadata census and consistency rules', () => {
  it('DoD RED: every FLOW_TOOLS entry declares valid widened effectClass (no slice-1 WRITE), idempotency, reversibility, and contractVersion >= 1, and satisfies all consistency rules', () => {
    expect(FLOW_TOOLS.length).toBeGreaterThanOrEqual(289);
    const { reviewedReads, reviewedMoneyGuards } = readRegistryTables();
    const problems = validateToolEffectMetadata(
      FLOW_TOOLS as readonly ToolWithMetadata[],
      reviewedReads ?? [],
      reviewedMoneyGuards ?? [],
      createRepoSourceLookup(),
    );
    expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
  });

  it('DoD RED: registry exports REVIEWED_NON_READ_FAMILY_READ_TOOLS and REVIEWED_NATURAL_MONEY_GUARDS tables', () => {
    const { reviewedReads, reviewedMoneyGuards } = readRegistryTables();
    expect(Array.isArray(reviewedReads)).toBe(true);
    expect(Array.isArray(reviewedMoneyGuards)).toBe(true);
    const lookup = createRepoSourceLookup();
    for (const entry of reviewedReads ?? []) {
      const lines = lookup(entry.handlerFile);
      expect(lines, `${entry.tool}: ${entry.handlerFile}`).not.toBeNull();
      expect(lines?.[entry.handlerLine - 1], entry.tool).toContain(
        `case '${entry.tool}':`,
      );
    }
    for (const guard of reviewedMoneyGuards ?? []) {
      const lines = lookup(guard.guardFile);
      expect(lines, `${guard.tool}: ${guard.guardFile}`).not.toBeNull();
      expect(
        lines?.[guard.guardLine - 1]?.trim().length ?? 0,
        guard.tool,
      ).toBeGreaterThan(0);
    }
  });

  it('isReadOnlyTool matches slice 1 for every tool not on REVIEWED_NON_READ_FAMILY_READ_TOOLS and fails closed on unknown/MCP/dotted names', () => {
    const { reviewedReads } = readRegistryTables();
    const reviewedSet = new Set((reviewedReads ?? []).map((r) => r.tool));

    expect(FLOW_TOOLS.length).toBeGreaterThanOrEqual(289);
    for (const tool of FLOW_TOOLS as readonly ToolWithMetadata[]) {
      expect(isReadOnlyTool(tool.name), tool.name).toBe(
        tool.effectClass === 'READ',
      );
      if (reviewedSet.has(tool.name)) {
        expect(isReadOnlyTool(tool.name), tool.name).toBe(true);
      } else {
        const expectedSlice1Read =
          tool.family === 'read' && !SLICE_1_READ_FAMILY_WRITES.has(tool.name);
        expect(isReadOnlyTool(tool.name), tool.name).toBe(expectedSlice1Read);
      }
    }

    expect(isReadOnlyTool('no_such_tool')).toBe(false);
    expect(isReadOnlyTool('mcp__stripe__refund')).toBe(false);
    expect(isReadOnlyTool('cortex.create_task')).toBe(false);
  });

  it('negative controls: rejects slice-1 WRITE and missing or invalid idempotency, reversibility, and contractVersion', () => {
    const emptySources = new Map<string, readonly string[]>();

    const slice1Write = validateToolEffectMetadata(
      [makeFixture({ name: 'legacy_write', family: 'crud', effectClass: 'WRITE' })],
      [],
      [],
      emptySources,
    );
    expect(slice1Write).toHaveLength(1);
    expect(slice1Write[0]).toContain('effectClass');

    const missingFields = validateToolEffectMetadata(
      [
        makeFixture({
          name: 'incomplete_tool',
          idempotency: undefined,
          reversibility: undefined,
          contractVersion: undefined,
        }),
      ],
      [],
      [],
      emptySources,
    );
    expect(missingFields).toHaveLength(3);

    const badContractVersions = validateToolEffectMetadata(
      [
        makeFixture({ name: 'cv_zero', contractVersion: 0 }),
        makeFixture({ name: 'cv_float', contractVersion: 1.5 }),
        makeFixture({ name: 'cv_neg', contractVersion: -1 }),
        makeFixture({ name: 'cv_str', contractVersion: '1' }),
      ],
      [],
      [],
      emptySources,
    );
    expect(badContractVersions).toHaveLength(4);
  });

  it('negative controls: Rule 1 rejects a READ tool with non-empty changedEntities', () => {
    const problems = validateToolEffectMetadata(
      [makeFixture({ name: 'bad_read_ce', changedEntities: ['invoice'] })],
      [],
      [],
      new Map(),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Rule 1');
  });

  it('negative controls: Rule 2 rejects a tool that sends email or calls an external provider if marked READ or INTERNAL_WRITE', () => {
    const readEmailSender = validateToolEffectMetadata(
      [makeFixture({ name: 'synthetic_email_sender', effectClass: 'READ' })],
      [],
      [],
      new Map(),
      {
        knownExternalEffectTools: ['synthetic_email_sender'],
        knownSendTools: [],
      },
    );
    expect(readEmailSender).toHaveLength(1);
    expect(readEmailSender[0]).toContain('Rule 2');

    const internalEmailSender = validateToolEffectMetadata(
      [
        makeFixture({
          name: 'synthetic_email_sender',
          family: 'execute',
          effectClass: 'INTERNAL_WRITE',
          idempotency: 'NONE',
          reversibility: 'IRREVERSIBLE',
        }),
      ],
      [],
      [],
      new Map(),
      {
        knownExternalEffectTools: ['synthetic_email_sender'],
        knownSendTools: ['synthetic_email_sender'],
      },
    );
    expect(internalEmailSender).toHaveLength(1);
    expect(internalEmailSender[0]).toContain('Rule 2');
  });

  it('negative controls: Rule 3 rejects a MONEY tool with idempotency NATURAL and no cited guard, or with a missing/invalid citation', () => {
    const moneyNatural = makeFixture({
      name: 'synthetic_money_tool',
      family: 'execute',
      effectClass: 'MONEY',
      idempotency: 'NATURAL',
      reversibility: 'COMPENSABLE',
      changedEntities: ['invoice'],
    });

    const unguarded = validateToolEffectMetadata(
      [moneyNatural],
      [],
      [],
      new Map(),
    );
    expect(unguarded).toHaveLength(1);
    expect(unguarded[0]).toContain('Rule 3');

    const missingFile = validateToolEffectMetadata(
      [moneyNatural],
      [],
      [
        {
          tool: 'synthetic_money_tool',
          guardFile: 'apps/server/src/nonexistent.ts',
          guardLine: 10,
          reason: 'missing file',
        },
      ],
      new Map(),
    );
    expect(missingFile).toHaveLength(1);
    expect(missingFile[0]).toContain('Rule 3');

    const commentLineOnly = validateToolEffectMetadata(
      [moneyNatural],
      [],
      [
        {
          tool: 'synthetic_money_tool',
          guardFile: 'fake/service.ts',
          guardLine: 2,
          reason: 'points at comment',
        },
      ],
      new Map([['fake/service.ts', ['async pay() {', '  // pretend guard', '}']]]),
    );
    expect(commentLineOnly).toHaveLength(1);
    expect(commentLineOnly[0]).toContain('Rule 3');
  });

  it('negative controls: Rule 4 rejects a non-read-family tool marked READ without a valid handler citation or whose handler writes/sends', () => {
    const crudRead = makeFixture({
      name: 'synthetic_lookup',
      family: 'crud',
      effectClass: 'READ',
    });

    const uncited = validateToolEffectMetadata([crudRead], [], [], new Map());
    expect(uncited).toHaveLength(1);
    expect(uncited[0]).toContain('Rule 4');

    const missingFile = validateToolEffectMetadata(
      [crudRead],
      [
        {
          tool: 'synthetic_lookup',
          handlerFile: 'apps/server/src/missing.ts',
          handlerLine: 5,
          reason: 'missing file',
        },
      ],
      [],
      new Map(),
    );
    expect(missingFile).toHaveLength(1);
    expect(missingFile[0]).toContain('Rule 4');

    const handlerActuallyWrites = validateToolEffectMetadata(
      [crudRead],
      [
        {
          tool: 'synthetic_lookup',
          handlerFile: 'fake/orchestrator.ts',
          handlerLine: 1,
          reason: 'falsely claims read-only',
        },
      ],
      [],
      new Map([
        [
          'fake/orchestrator.ts',
          [
            "      case 'synthetic_lookup': {",
            '        await this.prisma.client.contact.create({ data: {} });',
            '        return {};',
            '      }',
          ],
        ],
      ]),
    );
    expect(handlerActuallyWrites).toHaveLength(1);
    expect(handlerActuallyWrites[0]).toContain('Rule 4');
  });

  it('negative controls: Rule 5 rejects an external send tool marked REVERSIBLE or COMPENSABLE', () => {
    for (const badRev of ['REVERSIBLE', 'COMPENSABLE'] as const) {
      const problems = validateToolEffectMetadata(
        [
          makeFixture({
            name: 'synthetic_send_mail',
            family: 'execute',
            effectClass: 'EXTERNAL_EFFECT',
            idempotency: 'NONE',
            reversibility: badRev,
          }),
        ],
        [],
        [],
        new Map(),
        {
          knownExternalEffectTools: ['synthetic_send_mail'],
          knownSendTools: ['synthetic_send_mail'],
        },
      );
      expect(problems, badRev).toHaveLength(1);
      expect(problems[0], badRev).toContain('Rule 5');
    }
  });

  it('positive control: accepts valid fixtures across all five effect classes including guarded NATURAL MONEY and cited non-read-family READ', () => {
    const sources = new Map<string, readonly string[]>([
      [
        'fake/orchestrator.ts',
        [
          "      case 'synthetic_crud_lookup': {",
          '        const rows = await this.prisma.client.contact.findMany({ where: { businessId } });',
          '        return { rows };',
          '      }',
        ],
      ],
      [
        'fake/commerce.ts',
        [
          '  async markPaid() {',
          "    if (existingInvoice.status === 'PAID') return existingInvoice;",
          '  }',
        ],
      ],
    ]);

    const problems = validateToolEffectMetadata(
      [
        makeFixture({ name: 'r_read', family: 'read', effectClass: 'READ' }),
        makeFixture({
          name: 'synthetic_crud_lookup',
          family: 'crud',
          effectClass: 'READ',
        }),
        makeFixture({
          name: 'w_internal',
          family: 'crud',
          effectClass: 'INTERNAL_WRITE',
          idempotency: 'NONE',
          reversibility: 'COMPENSABLE',
          changedEntities: ['contact'],
        }),
        makeFixture({
          name: 'w_external_send',
          family: 'execute',
          effectClass: 'EXTERNAL_EFFECT',
          idempotency: 'NONE',
          reversibility: 'IRREVERSIBLE',
          changedEntities: ['message'],
        }),
        makeFixture({
          name: 'w_money_guarded',
          family: 'execute',
          effectClass: 'MONEY',
          idempotency: 'NATURAL',
          reversibility: 'COMPENSABLE',
          changedEntities: ['invoice'],
        }),
        makeFixture({
          name: 'w_destructive',
          family: 'crud',
          effectClass: 'DESTRUCTIVE',
          idempotency: 'NONE',
          reversibility: 'IRREVERSIBLE',
          changedEntities: ['contact'],
        }),
      ],
      [
        {
          tool: 'synthetic_crud_lookup',
          handlerFile: 'fake/orchestrator.ts',
          handlerLine: 1,
          reason: 'pure Prisma findMany lookup',
        },
      ],
      [
        {
          tool: 'w_money_guarded',
          guardFile: 'fake/commerce.ts',
          guardLine: 2,
          reason: 'early return when status is already PAID',
        },
      ],
      sources,
      {
        knownExternalEffectTools: ['w_external_send'],
        knownSendTools: ['w_external_send'],
      },
    );
    expect(problems).toEqual([]);
  });
});
