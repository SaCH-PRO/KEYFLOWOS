#!/usr/bin/env tsx
/**
 * Encrypt BankConnection.accessToken values stored before the token-encryption
 * extension covered the column (packet RR-BANK-TOKEN-ENCRYPT, V1-72; rulings
 * D-261, D-262).
 *
 * Dry run by default: counts bank connections, classifies each row's stored
 * access_token as plaintext (non-empty and not in the extension's ciphertext
 * form), already encrypted (decrypts with the loaded key), undecryptable (in
 * the ciphertext form but does not decrypt; a database error on that read
 * exits 1), gone since the scan, or no token (null or empty),
 * prints the counts and one `<connection_id>  plaintext|undecryptable` line
 * per such row, and writes nothing.
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
 * Both modes refuse (exit 2) when the @keyflow/db build loaded does not
 * encrypt the column. --apply also refuses (exit 2, nothing written) when no
 * key variable is set, and when there are plaintext rows to encrypt while
 * stored ciphertext exists in scope and none of it decrypts with the loaded key.
 * Each rewritten row's updated_at moves to the time of the run (@updatedAt).
 *
 * Exit status: 0 done, 1 database read/update failure, 2 bad arguments or a refused --apply.
 */
import { db, tokenEncryptionKeySource, ENCRYPTED_FIELDS } from '@keyflow/db';

/** The extension's ciphertext form (packages/db/src/middleware/token-encryption.ts PREFIX). */
const CIPHER_PREFIX = 'enc:v1:';

interface BankConnectionDelegate {
  update(args: { where: { id: string; accessToken: string }; data: { accessToken: string }; select: { id: true } }): Promise<unknown>;
  findUnique(args: { where: { id: string }; select: { id: true; accessToken: true } }): Promise<unknown>;
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
    // Not echoed: a token or a database URL pasted by mistake would land in the terminal and its logs.
    return { error: `unknown argument (${arg.length} characters)` };
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

/**
 * The cipher's own failure, recognised by a positive signal (SEC-V72S-R4-1, COR-V72S-R4-1): Node's AES-GCM
 * authentication failure (a plain Error with that message), or an ERR_CRYPTO_* / ERR_OSSL_* code (a bad IV or tag
 * length). Anything else, a Prisma error or a raw driver or network error, is a failed read.
 */
function isDecryptFailure(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e?.code === 'string') return /^ERR_(CRYPTO|OSSL)_/.test(e.code);
  return typeof e?.message === 'string' && e.message === 'Unsupported state or unable to authenticate data';
}

const row = (label: string, n: number) => `  ${label.padEnd(24)} ${n}`;

export async function main(
  argv: string[],
  deps: { db?: Db; log?: Log; error?: Log; encryptedFields?: Record<string, readonly string[]> } = {},
): Promise<number> {
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
  const keySource = tokenEncryptionKeySource();
  log(`  key source               ${keySource ?? 'none set (dev fallback key)'}`);
  if (args.apply) {
    // SEC-V72S-1: without a key variable the extension falls back to the in-repo dev key, so the rewritten tokens
    // would be readable by anyone with the repo and unreadable by an API running on its real key.
    if (!keySource) {
      error('Refusing --apply: no encryption key variable is set (CONNECTOR_CREDENTIALS_KEY, CREDENTIALS_ENCRYPTION_KEY or JWT_SECRET). Set the key the API runs with. Nothing was written.');
      return 2;
    }
  }
  // COR-V72S-1, COR-V72S-R4-2: a @keyflow/db build from before RR-BANK-TOKEN-ENCRYPT has no bankConnection hook:
  // --apply would write each plaintext back unchanged, and the dry run's decrypt probe would decrypt nothing, so
  // every 'enc:v1:' row would count as already encrypted whatever key sealed it. Both modes refuse.
  const fields = deps.encryptedFields ?? (ENCRYPTED_FIELDS as unknown as Record<string, readonly string[]>);
  if (!(fields.BankConnection ?? []).includes('accessToken')) {
    error('Refusing to run: the @keyflow/db build loaded does not encrypt BankConnection.accessToken (rebuild it with `pnpm --filter @keyflow/db build`). Nothing was written.');
    return 2;
  }

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
  const prefixed = scanned.filter((r) => tokenState(r.access_token) === 'encrypted');
  const none = scanned.filter((r) => tokenState(r.access_token) === 'none');

  // A value in the ciphertext form is only encrypted if the loaded key decrypts it: read each through the
  // extension (which decrypts) and count a failure as undecryptable. Such a row is sealed under another key, or
  // is a plaintext that happens to start with the prefix; the API's reads of it fail the same way. It is never
  // rewritten here: it needs an operator's decision.
  const undecryptable: string[] = [];
  let decrypted = 0;
  let gone = 0;
  for (const item of prefixed) {
    let found: unknown;
    try {
      found = await database.bankConnection.findUnique({ where: { id: item.id }, select: { id: true, accessToken: true } });
    } catch (err: unknown) {
      // SEC-V72S-R3-1: only a decrypt failure means "sealed under another key"; a database error is a failed read.
      if (!isDecryptFailure(err)) {
        error(`Bank connection ${item.id} could not be read: ${describeFailure(err)}. Nothing was written.`);
        return 1;
      }
      undecryptable.push(item.id);
      continue;
    }
    // A row deleted after the scan was not decrypted: it proves nothing about the key.
    if (found) decrypted += 1;
    else gone += 1;
  }

  log(row('connections_scanned', scanned.length));
  log(row('plaintext_tokens', plaintext.length));
  log(row('already_encrypted', decrypted));
  log(row('undecryptable', undecryptable.length));
  log(row('gone_since_read', gone));
  log(row('no_token', none.length));

  if (!args.apply) {
    log(row('would_encrypt', plaintext.length));
    for (const item of plaintext) log(`  ${item.id}  plaintext`);
    for (const id of undecryptable) log(`  ${id}  undecryptable`);
    return 0;
  }

  // SEC-V72S-R2-1: a key variable being set does not prove it is the API's key. When stored ciphertext exists and
  // none of it decrypts, the loaded key is almost certainly not the one the API used: refuse rather than seal the
  // plaintext rows under it. (With no stored ciphertext in scope there is nothing to check against.)
  // With nothing to encrypt there is nothing to protect (COR-V72S-R3-2): report and exit 0.
  if (plaintext.length > 0 && undecryptable.length > 0 && decrypted === 0) {
    error(
      `Refusing --apply: ${undecryptable.length} stored ciphertext value(s) and none decrypts with the loaded key ` +
        `(${keySource}); it is likely not the key the API runs with. Nothing was written.`,
    );
    return 2;
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
