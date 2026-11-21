#!/usr/bin/env tsx
/**
 * Backfill Contact.phone_normalized keys stored before E.164 normalization
 * (packet FU-PHONE-COUNTRY-DUPLICATES, owner ruling D-211).
 *
 * Dry run by default: scans contacts, classifies every row as current,
 * unreadable (kept as typed), needs_merge (another live contact in the same
 * business holds or wants the same E.164 key), or rewrite, prints counts and
 * `<contact_id>  <action>` lines without printing any phone number, name, or
 * business id, and writes nothing unless `--apply` is passed.
 *
 * Usage (from apps/server; reads DATABASE_URL from the repo-root .env):
 *   pnpm backfill:phone-keys                     # dry run, every business
 *   pnpm backfill:phone-keys --business=<id>     # dry run, scoped to business(es)
 *   pnpm backfill:phone-keys --apply             # rewrite eligible keys
 *
 * Exit status: 0 done, 1 database read/update failure, 2 bad arguments.
 * Runbook: docs/development/operator-data-cleanup-scripts.md (section 5).
 */
import { db } from '@keyflow/db';
import { contactPhoneRead } from '../src/modules/crm/crm-duplicate.util';

type Db = Pick<typeof db, '$queryRawUnsafe' | '$executeRawUnsafe'>;
type Log = (...args: unknown[]) => void;

export type PhoneBackfillAction = 'current' | 'rewrite' | 'needs_merge' | 'unreadable';

export interface ScannedContactRow {
  id: string;
  business_id: string;
  phone: string | null;
  phone_normalized: string | null;
  deleted_at: Date | null;
  country: string | null;
}

export interface PlannedPhoneBackfillRow {
  id: string;
  businessId: string;
  phone: string | null;
  currentKey: string | null;
  targetKey: string | null;
  deletedAt: Date | null;
  action: PhoneBackfillAction;
}

export type Args = { apply: boolean; businessIds: string[] } | { error: string };

export function parseArgs(argv: string[]): Args {
  let apply = false;
  const businessIds: string[] = [];
  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--business=')) {
      const id = arg.slice('--business='.length).trim();
      if (!id) return { error: '--business= needs a business id' };
      if (!businessIds.includes(id)) businessIds.push(id);
      continue;
    }
    return { error: 'unknown argument' };
  }
  return { apply, businessIds };
}

/** The error's class and its code: never its message (which may carry a value or URL). */
export function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (code ${code})` : name;
}

export function planPhoneKeyBackfill(rows: readonly ScannedContactRow[]): PlannedPhoneBackfillRow[] {
  const preliminary: PlannedPhoneBackfillRow[] = rows.map((r) => {
    const hasDigit = typeof r.phone === 'string' && /\d/.test(r.phone);
    if (!hasDigit) {
      // No phone digits (empty or non-numeric note such as "front desk"): identity key must be NULL.
      const action: PhoneBackfillAction = r.phone_normalized === null ? 'current' : 'rewrite';
      return {
        id: r.id,
        businessId: r.business_id,
        phone: r.phone,
        currentKey: r.phone_normalized,
        targetKey: null,
        deletedAt: r.deleted_at,
        action,
      };
    }

    const read = contactPhoneRead(r.phone, r.country);
    if (read.unreadable) {
      return {
        id: r.id,
        businessId: r.business_id,
        phone: r.phone,
        currentKey: r.phone_normalized,
        targetKey: r.phone_normalized,
        deletedAt: r.deleted_at,
        action: 'unreadable',
      };
    }

    const targetKey = read.phoneNormalized;
    const action: PhoneBackfillAction = r.phone_normalized === targetKey ? 'current' : 'rewrite';
    return {
      id: r.id,
      businessId: r.business_id,
      phone: r.phone,
      currentKey: r.phone_normalized,
      targetKey,
      deletedAt: r.deleted_at,
      action,
    };
  });

  // Track keys already held by live contacts that are NOT being rewritten (current / unreadable).
  const heldByBusiness = new Map<string, Set<string>>();
  for (const item of preliminary) {
    if (item.deletedAt !== null) continue;
    if ((item.action === 'current' || item.action === 'unreadable') && item.currentKey) {
      let set = heldByBusiness.get(item.businessId);
      if (!set) {
        set = new Set<string>();
        heldByBusiness.set(item.businessId, set);
      }
      set.add(item.currentKey);
    }
  }

  // Group live candidate rewrites by (businessId, targetKey) to spot pairs colliding on the same E.164 key.
  const candidateCounts = new Map<string, number>();
  for (const item of preliminary) {
    if (item.deletedAt !== null || item.action !== 'rewrite' || !item.targetKey) continue;
    const composite = `${item.businessId}\0${item.targetKey}`;
    candidateCounts.set(composite, (candidateCounts.get(composite) ?? 0) + 1);
  }

  for (const item of preliminary) {
    if (item.deletedAt !== null || item.action !== 'rewrite' || !item.targetKey) continue;
    const held = heldByBusiness.get(item.businessId)?.has(item.targetKey) ?? false;
    const count = candidateCounts.get(`${item.businessId}\0${item.targetKey}`) ?? 0;
    if (held || count > 1) {
      item.action = 'needs_merge';
    }
  }

  return preliminary;
}

const row = (label: string, n: number) => `  ${label.padEnd(24)} ${n}`;

export async function main(argv: string[], deps: { db?: Db; log?: Log; error?: Log } = {}): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;
  const args = parseArgs(argv);
  if ('error' in args) {
    error(`Bad arguments (${args.error}). Usage: backfill-phone-keys [--apply] [--business=<id> ...]`);
    return 2;
  }

  const database = deps.db ?? db;
  const scope = args.businessIds.length > 0 ? ` (limited to ${args.businessIds.length} business(es))` : ' (every business)';
  log(
    args.apply
      ? `Contact phone key backfill (FU-PHONE-COUNTRY-DUPLICATES, D-211) - APPLY: rewriting${scope}`
      : `Contact phone key backfill (FU-PHONE-COUNTRY-DUPLICATES, D-211) - DRY RUN: nothing is written; re-run with --apply to rewrite${scope}`,
  );

  const scopeSql = args.businessIds.length > 0 ? ' AND c.business_id = ANY($1::text[])' : '';
  const scopeParams = args.businessIds.length > 0 ? [args.businessIds] : [];

  let scanned: ScannedContactRow[];
  try {
    scanned = (await database.$queryRawUnsafe(
      `SELECT c.id, c.business_id, c.phone, c.phone_normalized, c.deleted_at, b.country
       FROM contacts c
       JOIN businesses b ON b.id = c.business_id
       WHERE (c.phone IS NOT NULL OR c.phone_normalized IS NOT NULL)${scopeSql}
       ORDER BY c.id`,
      ...scopeParams,
    )) as ScannedContactRow[];
  } catch (err: unknown) {
    error(`Contacts could not be read: ${describeFailure(err)}. Nothing was written.`);
    return 1;
  }

  const plan = planPhoneKeyBackfill(scanned);
  const current = plan.filter((p) => p.action === 'current');
  const unreadable = plan.filter((p) => p.action === 'unreadable');
  const needsMerge = plan.filter((p) => p.action === 'needs_merge');
  const toRewrite = plan.filter((p) => p.action === 'rewrite');

  log(row('contacts_scanned', plan.length));
  log(row('key_current', current.length));
  log(row('unreadable_kept', unreadable.length));
  log(row('needs_merge', needsMerge.length));

  if (!args.apply) {
    log(row('would_rewrite', toRewrite.length));
    for (const item of plan) {
      if (item.action === 'current') continue;
      log(`  ${item.id}  ${item.action}`);
    }
    return 0;
  }

  let rewritten = 0;
  let changedSinceRead = 0;
  let failed = 0;

  for (const item of toRewrite) {
    try {
      const updated = await database.$executeRawUnsafe(
        `UPDATE contacts
         SET phone_normalized = $1
         WHERE id = $2
           AND business_id = $3
           AND phone IS NOT DISTINCT FROM $4
           AND phone_normalized IS NOT DISTINCT FROM $5
           AND deleted_at IS NOT DISTINCT FROM $6`,
        item.targetKey,
        item.id,
        item.businessId,
        item.phone,
        item.currentKey,
        item.deletedAt,
      );
      if (updated === 1) rewritten += 1;
      else changedSinceRead += 1;
    } catch (err: unknown) {
      failed += 1;
      error(`Failed updating contact ${item.id}: ${describeFailure(err)}`);
    }
  }

  log(row('rewritten', rewritten));
  log(row('changed_since_read', changedSinceRead));
  log(row('failed', failed));

  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`Contact phone key backfill failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
