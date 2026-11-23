#!/usr/bin/env tsx
/**
 * Encrypt BankConnection.accessToken values stored before the token-encryption
 * extension covered the column (packet RR-BANK-TOKEN-ENCRYPT, V1-72; rulings
 * D-261, D-262).
 *
 * Dry run by default: counts bank connections, classifies each row's stored
 * access_token as plaintext (non-empty and not in the extension's ciphertext
 * form), already encrypted, or no token (null or empty), prints the counts and
 * one `<connection_id>  plaintext` line per plaintext row, and writes nothing.
 * It never prints a token, a ciphertext, a business id or the database URL.
 *
 * --apply rewrites each plaintext row through the @keyflow/db client, whose
 * token-encryption extension encrypts the value on write, one row per update.
 * Each update is conditional on the row still holding the value that was read,
 * so a token changed after the scan is skipped (changed_since_read), never
 * overwritten. Rows already encrypted are never touched, so a second run finds
 * nothing to do. Reads stay correct before, during and after the run: the
 * extension passes an unencrypted value through unchanged.
 *
 * Run --apply only on owner authority recorded on issue #80. The key is the
 * extension's (CONNECTOR_CREDENTIALS_KEY, then CREDENTIALS_ENCRYPTION_KEY, then
 * JWT_SECRET): run it with the same key the API runs with, or the API cannot
 * read the rewritten tokens.
 *
 * Usage (from apps/server; reads DATABASE_URL from the repo-root .env):
 *   pnpm encrypt:bank-tokens                       # dry run, every business
 *   pnpm encrypt:bank-tokens --business=<id>       # dry run, scoped to business(es)
 *   pnpm encrypt:bank-tokens --apply               # encrypt the plaintext rows
 *
 * Exit status: 0 done, 1 database read/update failure, 2 bad arguments.
 */
import { db, tokenEncryptionKeySource } from '@keyflow/db';

/** The extension's ciphertext form (packages/db/src/middleware/token-encryption.ts PREFIX). */
const CIPHER_PREFIX = 'enc:v1:';

interface BankConnectionDelegate {
  update(args: { where: { id: string; accessToken: string }; data: { accessToken: string }; select: { id: true } }): Promise<unknown>;
}
type Db = Pick<typeof db, '$queryRawUnsafe'> & { bankConnection: BankConnectionDelegate };
type Log = (...args: unknown[]) => void;

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
    return { error: `unknown argument ${JSON.stringify(arg.slice(0, 40))}` };
  }
  return { apply, businessIds };
}

export type TokenState = 'plaintext' | 'encrypted' | 'none';

export function tokenState(stored: string | null): TokenState {
  if (stored === null || stored === '') return 'none';
  return stored.startsWith(CIPHER_PREFIX) ? 'encrypted' : 'plaintext';
}

/** A failure described without the values it carried (Prisma errors can quote the query's arguments). */
function describeFailure(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown };
  if (typeof e?.code === 'string') return `database error ${e.code}`;
  return typeof e?.name === 'string' ? e.name : 'unknown error';
}

const row = (label: string, n: number) => `  ${label.padEnd(24)} ${n}`;

export async function main(argv: string[], deps: { db?: Db; log?: Log; error?: Log } = {}): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;
  const args = parseArgs(argv);
  if ('error' in args) {
    error(`Bad arguments (${args.error}). Usage: encrypt-bank-connection-tokens [--apply] [--business=<id> ...]`);
    return 2;
  }

  const database: Db = deps.db ?? (db as unknown as Db);
  const scope = args.businessIds.length > 0 ? ` (limited to ${args.businessIds.length} business(es))` : ' (every business)';
  log(
    args.apply
      ? `Bank connection token encryption (RR-BANK-TOKEN-ENCRYPT, V1-72) - APPLY: encrypting plaintext tokens${scope}`
      : `Bank connection token encryption (RR-BANK-TOKEN-ENCRYPT, V1-72) - DRY RUN: nothing is written; re-run with --apply to encrypt${scope}`,
  );
  log(`  key source               ${tokenEncryptionKeySource() ?? 'none set (dev fallback key)'}`);

  const scopeSql = args.businessIds.length > 0 ? ' WHERE business_id = ANY($1::text[])' : '';
  const scopeParams = args.businessIds.length > 0 ? [args.businessIds] : [];

  let scanned: Array<{ id: string; access_token: string | null }>;
  try {
    scanned = (await database.$queryRawUnsafe(
      `SELECT id, access_token FROM bank_connections${scopeSql} ORDER BY id`,
      ...scopeParams,
    )) as Array<{ id: string; access_token: string | null }>;
  } catch (err: unknown) {
    error(`Bank connections could not be read: ${describeFailure(err)}. Nothing was written.`);
    return 1;
  }

  const plaintext = scanned.filter((r) => tokenState(r.access_token) === 'plaintext');
  const encrypted = scanned.filter((r) => tokenState(r.access_token) === 'encrypted');
  const none = scanned.filter((r) => tokenState(r.access_token) === 'none');

  log(row('connections_scanned', scanned.length));
  log(row('plaintext_tokens', plaintext.length));
  log(row('already_encrypted', encrypted.length));
  log(row('no_token', none.length));

  if (!args.apply) {
    log(row('would_encrypt', plaintext.length));
    for (const item of plaintext) log(`  ${item.id}  plaintext`);
    return 0;
  }

  let done = 0;
  let changedSinceRead = 0;
  let failed = 0;
  for (const item of plaintext) {
    const value = item.access_token as string;
    try {
      // Through the extension: it encrypts data.accessToken. The where clause makes the write conditional on
      // the row still holding the plaintext that was read.
      await database.bankConnection.update({
        where: { id: item.id, accessToken: value },
        data: { accessToken: value },
        select: { id: true },
      });
      done += 1;
    } catch (err: unknown) {
      if ((err as { code?: unknown })?.code === 'P2025') {
        changedSinceRead += 1;
        continue;
      }
      failed += 1;
      error(`Failed encrypting bank connection ${item.id}: ${describeFailure(err)}`);
    }
  }

  log(row('encrypted', done));
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
      console.error(`Bank connection token encryption failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
