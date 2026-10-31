#!/usr/bin/env node
/**
 * K12 resource admission.
 *
 *   --manifest <file>               CI mode (ci-resources.json): judge process.env
 *                                   only. --env-file is refused here: a file cannot
 *                                   vouch for CI=true.
 *   --packet <id> [--env-file <f>]  Per-packet mode (R0-00-WT-ISOLATION): judge the
 *         [--state-file <f>]        values a suite in this worktree will see, against
 *                                   manifests/local-worktree-resources.json (or
 *                                   --manifest). Admits only kf_wt_<packet> and the
 *                                   Redis index scripts/worktree-resources.sh
 *                                   allocated to that packet.
 *
 * In per-packet mode the env file defaults to the repo-root .env beside this
 * script, the file every integration suite loads (../../../.env from
 * apps/server/test). A value the shell exports wins over the file, exactly as
 * dotenv does, so a shell that still exports the main-tree DATABASE_URL is
 * judged as what it is.
 *
 * Per-packet mode is also bound to the provisioner's allocation table (the
 * state file: --state-file, else KF_WT_STATE_FILE, else
 * <git common dir>/kf-worktree-resources.tsv, as in worktree-resources.sh). The
 * packet must have exactly one row; REDIS_URL must name the index in that row
 * and no other row may hold it; the worktree that owns the judged .env must be
 * the one in that row; and KF_WT_PACKET (the provisioner writes it into .env)
 * must name the packet. So a worktree cannot be admitted under another packet's
 * id, and two packets cannot both be admitted on one Redis index.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXIT = Object.freeze({ ADMITTED: 0, REJECTED: 2 });

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const LOCAL_WORKTREE_MANIFEST = join(SCRIPT_DIR, 'manifests', 'local-worktree-resources.json');

function verdict(status, reasons, details = {}) {
  return { status, reasons, ...details };
}

/**
 * `R0-00-WT-ISOLATION`, `R0-00` and `r0_00` all name packet `r0_00`, whose
 * database is `kf_wt_r0_00`. scripts/worktree-resources.sh derives the same slug.
 */
export function packetSlug(id) {
  const m = /^([A-Za-z])(\d+)[-_](\d{2,3})(?:[-_][A-Za-z0-9-]*)?$/.exec(String(id ?? ''));
  return m ? `${m[1].toLowerCase()}${m[2]}_${m[3]}` : null;
}

/** KEY=VALUE lines, `export ` prefix and surrounding quotes allowed, as dotenv reads them. */
export function parseEnvFile(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '');
    vars[m[1]] = value;
  }
  return vars;
}

/**
 * The provisioner's allocation table: one `<slug>\t<redis index>\t<worktree>`
 * line per live packet (scripts/worktree-resources.sh state_put).
 */
export function parseStateFile(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const [slug = '', index = '', worktree = ''] = line.split('\t');
    rows.push({ slug, index: /^\d+$/.test(index) ? Number(index) : NaN, worktree });
  }
  return rows;
}

function redisDbIndex(url) {
  const path = url.pathname.replace(/^\//, '');
  if (path === '') return 0;
  return /^\d+$/.test(path) ? Number(path) : NaN;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['KF_PROOF_RESOURCE_POLICY_INVALID'];
  }
  if (manifest.manifestVersion !== 1 || !Array.isArray(manifest.resources) || manifest.resources.length === 0) {
    return ['KF_PROOF_RESOURCE_POLICY_INVALID'];
  }
  if (!manifest.requiredEnv || typeof manifest.requiredEnv !== 'object') {
    return ['KF_PROOF_RESOURCE_POLICY_INVALID'];
  }
  return [];
}

function effectivePort(url) {
  if (url.port) return Number(url.port);
  if (['postgres:', 'postgresql:'].includes(url.protocol)) return 5432;
  if (url.protocol === 'redis:') return 6379;
  return null;
}

function resourceIdentity(rule, url) {
  const identity = {
    env: rule.env,
    kind: rule.kind,
    protocol: url.protocol,
    host: url.hostname,
    port: effectivePort(url),
  };
  if (rule.kind === 'postgres') {
    identity.database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  }
  return identity;
}

/**
 * @param manifest  a resource manifest
 * @param env       the exported environment (process.env)
 * @param options   per-packet mode: { packet, fileEnv, state, worktree }. fileEnv
 *                  holds the worktree .env values (an exported value wins, as
 *                  with dotenv); state the provisioner's rows (parseStateFile);
 *                  worktree the real path of the worktree whose .env is judged.
 *                  Outside per-packet mode only `env` is judged and fileEnv is
 *                  ignored.
 */
export function admitResources(manifest, env = process.env, options = {}) {
  const policyErrors = validateManifest(manifest);
  if (policyErrors.length > 0) return verdict('REJECTED', policyErrors);

  let packet = null;
  if (manifest.packetScoped === true) {
    if (!options.packet) return verdict('REJECTED', ['KF_PROOF_RESOURCE_PACKET_REQUIRED']);
    packet = packetSlug(options.packet);
    if (!packet) return verdict('REJECTED', ['KF_PROOF_RESOURCE_PACKET_INVALID']);
  } else if (options.packet) {
    return verdict('REJECTED', ['KF_PROOF_RESOURCE_POLICY_INVALID'], { message: 'manifest is not packet-scoped' });
  }

  // A file is consulted only in per-packet mode. In CI mode the trust anchor
  // is what the runner exported, and a file must not be able to supply it.
  const fileEnv = packet ? (options.fileEnv ?? {}) : {};
  const shellHas = (key) => Object.prototype.hasOwnProperty.call(env, key);
  const fileHas = (key) => Object.prototype.hasOwnProperty.call(fileEnv, key);
  const lookup = (key) => (shellHas(key) ? env[key] : fileEnv[key]);
  const sourceOf = (key) => (shellHas(key) ? 'shell' : 'env-file');

  // requiredEnv is never resolved from a file, in either mode.
  const envMismatches = Object.entries(manifest.requiredEnv)
    .filter(([key, expected]) => (shellHas(key) ? env[key] : undefined) !== expected)
    .map(([key]) => key);
  if (envMismatches.length > 0) {
    return verdict('REJECTED', ['KF_PROOF_RESOURCE_ENVIRONMENT_UNTRUSTED'], { envMismatches });
  }

  let allocation = null;
  if (packet) {
    // The .env must have been written for this packet: every source that sets
    // KF_WT_PACKET names it, and at least one sets it.
    const markers = [
      ...(shellHas('KF_WT_PACKET') ? [{ source: 'shell', value: env.KF_WT_PACKET }] : []),
      ...(fileHas('KF_WT_PACKET') ? [{ source: 'env-file', value: fileEnv.KF_WT_PACKET }] : []),
    ];
    if (markers.length === 0 || markers.some((m) => m.value !== packet)) {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_PACKET_MISMATCH'], {
        packet,
        markers,
        hint: 'KF_WT_PACKET must name this packet; the .env was written for another packet, or not by worktree-resources.sh provision',
      });
    }

    // The allocation table is the only record of which Redis index belongs to
    // which packet. Without it, two packets on one index look equally valid.
    if (!Array.isArray(options.state)) {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_STATE_UNAVAILABLE'], { packet });
    }
    const rows = options.state.filter((r) => r.slug === packet);
    if (rows.length !== 1) {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_NOT_PROVISIONED'], { packet, rows: rows.length });
    }
    allocation = rows[0];
    if (options.worktree !== undefined && options.worktree !== allocation.worktree) {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_WORKTREE_MISMATCH'], {
        packet,
        worktree: options.worktree,
        allocatedWorktree: allocation.worktree,
      });
    }
  }

  const sharedDatabaseNames = Array.isArray(manifest.sharedDatabaseNames) ? manifest.sharedDatabaseNames : [];
  const admitted = [];
  for (const rule of manifest.resources) {
    const raw = lookup(rule.env);
    if (!raw) {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_MISSING'], { env: rule.env });
    }

    let url;
    try {
      url = new URL(raw);
    } catch {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_URL_INVALID'], { env: rule.env });
    }

    const identity = resourceIdentity(rule, url);
    if (packet) {
      identity.source = sourceOf(rule.env);
      if (identity.source === 'shell') {
        identity.hint = `${rule.env} is exported by the shell, which overrides the worktree .env (dotenv never overrides an exported value); unset it in the worktree shell`;
      }
    }

    if (!rule.allowedProtocols?.includes(url.protocol)) {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_PROTOCOL_UNSAFE'], identity);
    }
    if (!rule.allowedHosts?.includes(url.hostname)) {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_HOST_UNSAFE'], identity);
    }
    if (!rule.allowedPorts?.includes(identity.port)) {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_PORT_UNSAFE'], identity);
    }
    if (rule.allowedUsernames && !rule.allowedUsernames.includes(decodeURIComponent(url.username))) {
      return verdict('REJECTED', ['KF_PROOF_RESOURCE_IDENTITY_UNSAFE'], identity);
    }
    if (rule.kind === 'postgres') {
      // The main-tree and template databases are named separately so the
      // negative control answers with its own reason, not a generic mismatch.
      if (identity.database && sharedDatabaseNames.includes(identity.database)) {
        return verdict('REJECTED', ['KF_PROOF_RESOURCE_DATABASE_SHARED'], identity);
      }
      const allowed = (rule.allowedDatabaseNames ?? []).map((name) =>
        packet ? String(name).replaceAll('{packet}', packet) : name,
      );
      if (!identity.database || !allowed.includes(identity.database)) {
        return verdict('REJECTED', ['KF_PROOF_RESOURCE_DATABASE_UNSAFE'], identity);
      }
    }
    if (rule.kind === 'redis' && Array.isArray(rule.allowedDbIndexes)) {
      identity.dbIndex = redisDbIndex(url);
      if (!rule.allowedDbIndexes.includes(identity.dbIndex)) {
        return verdict('REJECTED', ['KF_PROOF_RESOURCE_REDIS_INDEX_UNSAFE'], identity);
      }
    }
    if (rule.kind === 'redis' && allocation) {
      if (!('dbIndex' in identity)) identity.dbIndex = redisDbIndex(url);
      if (identity.dbIndex !== allocation.index) {
        return verdict('REJECTED', ['KF_PROOF_RESOURCE_REDIS_INDEX_FOREIGN'], { ...identity, allocatedDbIndex: allocation.index });
      }
      const sharedWith = options.state.filter((r) => r.slug !== packet && r.index === identity.dbIndex).map((r) => r.slug);
      if (sharedWith.length > 0) {
        return verdict('REJECTED', ['KF_PROOF_RESOURCE_REDIS_INDEX_SHARED'], { ...identity, sharedWith });
      }
    }

    admitted.push(identity);
  }

  return verdict('ADMITTED_NONPRODUCTION', [], packet ? { packet, resources: admitted } : { resources: admitted });
}

/** <git common dir>/kf-worktree-resources.tsv, derived as worktree-resources.sh init_paths does. */
function defaultStateFile() {
  const git = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  if (git.status !== 0) return null;
  const common = git.stdout.trim();
  return join(isAbsolute(common) ? common : resolve(REPO_ROOT, common), 'kf-worktree-resources.tsv');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'], { message: error.message })));
    process.exit(EXIT.REJECTED);
  }

  // --packet alone means the committed local worktree manifest.
  const manifestPath = args.manifest ?? (args.packet ? LOCAL_WORKTREE_MANIFEST : null);
  if (!manifestPath) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'])));
    process.exit(EXIT.REJECTED);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_RESOURCE_POLICY_INVALID'], { message: error.message })));
    process.exit(EXIT.REJECTED);
  }

  const packetScoped = manifest?.packetScoped === true;
  if (!packetScoped && (args['env-file'] || args['state-file'])) {
    // CI mode judges what the runner exported. Before R0-00 a file could not
    // supply CI=true or GITHUB_ACTIONS=true; it still cannot.
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'], {
      message: '--env-file and --state-file apply only to a packet-scoped manifest (--packet)',
    })));
    process.exit(EXIT.REJECTED);
  }

  // The worktree .env: explicit --env-file must exist; the default (the repo
  // root .env the suites load) may be absent, leaving only the shell.
  let fileEnv;
  let worktree;
  const envFile = args['env-file'] ?? (packetScoped ? join(REPO_ROOT, '.env') : null);
  if (envFile) {
    if (existsSync(envFile)) {
      try {
        fileEnv = parseEnvFile(readFileSync(envFile, 'utf8'));
        worktree = realpathSync(dirname(resolve(envFile)));
      } catch (error) {
        console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_RESOURCE_ENV_FILE_INVALID'], { message: error.message })));
        process.exit(EXIT.REJECTED);
      }
    } else if (args['env-file']) {
      console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_RESOURCE_ENV_FILE_MISSING'])));
      process.exit(EXIT.REJECTED);
    } else {
      // No .env: the shell supplies everything, for the worktree this script is in.
      worktree = realpathSync(REPO_ROOT);
    }
  }

  // The provisioner's allocation table. Absent or unreadable, per-packet mode
  // rejects with KF_PROOF_RESOURCE_STATE_UNAVAILABLE.
  let state;
  if (packetScoped) {
    const stateFile = args['state-file'] ?? process.env.KF_WT_STATE_FILE ?? defaultStateFile();
    if (stateFile && existsSync(stateFile)) {
      try {
        state = parseStateFile(readFileSync(stateFile, 'utf8'));
      } catch {
        state = undefined;
      }
    }
  }

  const result = admitResources(manifest, process.env, { packet: args.packet, fileEnv, state, worktree });
  console.log(JSON.stringify(result));
  process.exit(result.status === 'ADMITTED_NONPRODUCTION' ? EXIT.ADMITTED : EXIT.REJECTED);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
