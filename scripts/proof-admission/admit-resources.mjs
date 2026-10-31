#!/usr/bin/env node
/**
 * K12 resource admission.
 *
 *   --manifest <file>               CI mode (ci-resources.json): judge process.env.
 *   --packet <id> [--env-file <f>]  Per-packet mode (R0-00-WT-ISOLATION): judge the
 *                                   values a suite in this worktree will see, against
 *                                   manifests/local-worktree-resources.json (or
 *                                   --manifest). Admits only kf_wt_<packet> and a
 *                                   non-zero Redis index.
 *
 * In per-packet mode the env file defaults to the repo-root .env beside this
 * script, the file every integration suite loads (../../../.env from
 * apps/server/test). A value the shell exports wins over the file, exactly as
 * dotenv does, so a shell that still exports the main-tree DATABASE_URL is
 * judged as what it is.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
 * @param options   per-packet mode: { packet, fileEnv } where fileEnv holds the
 *                  worktree .env values; an exported value wins, as with dotenv
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

  const fileEnv = options.fileEnv ?? {};
  const shellHas = (key) => Object.prototype.hasOwnProperty.call(env, key);
  const lookup = (key) => (shellHas(key) ? env[key] : fileEnv[key]);
  const sourceOf = (key) => (shellHas(key) ? 'shell' : 'env-file');

  const envMismatches = Object.entries(manifest.requiredEnv)
    .filter(([key, expected]) => lookup(key) !== expected)
    .map(([key]) => key);
  if (envMismatches.length > 0) {
    return verdict('REJECTED', ['KF_PROOF_RESOURCE_ENVIRONMENT_UNTRUSTED'], { envMismatches });
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

    admitted.push(identity);
  }

  return verdict('ADMITTED_NONPRODUCTION', [], packet ? { packet, resources: admitted } : { resources: admitted });
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

  // The worktree .env: explicit --env-file must exist; the default (the repo
  // root .env the suites load) may be absent, leaving only the shell.
  let fileEnv;
  const envFile = args['env-file'] ?? (manifest.packetScoped === true ? join(REPO_ROOT, '.env') : null);
  if (envFile) {
    if (existsSync(envFile)) {
      try {
        fileEnv = parseEnvFile(readFileSync(envFile, 'utf8'));
      } catch (error) {
        console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_RESOURCE_ENV_FILE_INVALID'], { message: error.message })));
        process.exit(EXIT.REJECTED);
      }
    } else if (args['env-file']) {
      console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_RESOURCE_ENV_FILE_MISSING'])));
      process.exit(EXIT.REJECTED);
    }
  }

  const result = admitResources(manifest, process.env, { packet: args.packet, fileEnv });
  console.log(JSON.stringify(result));
  process.exit(result.status === 'ADMITTED_NONPRODUCTION' ? EXIT.ADMITTED : EXIT.REJECTED);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
