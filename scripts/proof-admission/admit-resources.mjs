#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXIT = Object.freeze({ ADMITTED: 0, REJECTED: 2 });

function verdict(status, reasons, details = {}) {
  return { status, reasons, ...details };
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

export function admitResources(manifest, env = process.env) {
  const policyErrors = validateManifest(manifest);
  if (policyErrors.length > 0) return verdict('REJECTED', policyErrors);

  const envMismatches = Object.entries(manifest.requiredEnv)
    .filter(([key, expected]) => env[key] !== expected)
    .map(([key]) => key);
  if (envMismatches.length > 0) {
    return verdict('REJECTED', ['KF_PROOF_RESOURCE_ENVIRONMENT_UNTRUSTED'], { envMismatches });
  }

  const admitted = [];
  for (const rule of manifest.resources) {
    const raw = env[rule.env];
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
      if (!identity.database || !rule.allowedDatabaseNames?.includes(identity.database)) {
        return verdict('REJECTED', ['KF_PROOF_RESOURCE_DATABASE_UNSAFE'], identity);
      }
    }

    admitted.push(identity);
  }

  return verdict('ADMITTED_NONPRODUCTION', [], { resources: admitted });
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'], { message: error.message })));
    process.exit(EXIT.REJECTED);
  }

  if (!args.manifest) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'])));
    process.exit(EXIT.REJECTED);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(args.manifest, 'utf8'));
  } catch (error) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_RESOURCE_POLICY_INVALID'], { message: error.message })));
    process.exit(EXIT.REJECTED);
  }

  const result = admitResources(manifest);
  console.log(JSON.stringify(result));
  process.exit(result.status === 'ADMITTED_NONPRODUCTION' ? EXIT.ADMITTED : EXIT.REJECTED);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
