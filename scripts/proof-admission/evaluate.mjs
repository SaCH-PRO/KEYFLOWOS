#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXIT = Object.freeze({
  SATISFIED: 0,
  REJECTED: 2,
  INCOMPLETE: 3,
});

function normalizeCaseId(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function verdict(status, reasons, details = {}) {
  return {
    status,
    reasons,
    ...details,
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }
  if (manifest.manifestVersion !== 1) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }
  if (typeof manifest.packageId !== 'string' || manifest.packageId.length === 0) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }
  if (!Array.isArray(manifest.requiredCases) || manifest.requiredCases.length === 0) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }

  const ids = manifest.requiredCases.map(normalizeCaseId);
  if (ids.some((id) => id.length === 0)) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }
  if (new Set(ids).size !== ids.length) {
    return ['KF_PROOF_MANIFEST_DUPLICATE_CASE_ID'];
  }
  return [];
}

function collectAssertions(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.testResults)) {
    return { error: 'KF_PROOF_REPORT_MALFORMED' };
  }

  const assertions = [];
  for (const suite of report.testResults) {
    if (!suite || !Array.isArray(suite.assertionResults)) {
      return { error: 'KF_PROOF_REPORT_MALFORMED' };
    }
    for (const assertion of suite.assertionResults) {
      if (!assertion || typeof assertion !== 'object') {
        return { error: 'KF_PROOF_REPORT_MALFORMED' };
      }
      const caseId = normalizeCaseId(assertion.fullName);
      if (!caseId || typeof assertion.status !== 'string') {
        return { error: 'KF_PROOF_REPORT_MALFORMED' };
      }
      assertions.push({
        caseId,
        status: assertion.status,
        title: assertion.title ?? null,
        suite: suite.name ?? null,
      });
    }
  }
  return { assertions };
}

export function evaluateProof(manifest, report) {
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length > 0) {
    return verdict('REJECTED', manifestErrors);
  }

  const collected = collectAssertions(report);
  if (collected.error) {
    return verdict('REJECTED', [collected.error]);
  }

  const assertions = collected.assertions;
  const byId = new Map();
  for (const assertion of assertions) {
    const existing = byId.get(assertion.caseId) ?? [];
    existing.push(assertion);
    byId.set(assertion.caseId, existing);
  }

  const duplicated = [...byId.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([caseId]) => caseId);

  if (duplicated.length > 0) {
    return verdict('REJECTED', ['KF_PROOF_DUPLICATE_CASE_ID'], { duplicated });
  }

  const requiredCases = manifest.requiredCases.map(normalizeCaseId);
  const missing = requiredCases.filter((caseId) => !byId.has(caseId));
  if (missing.length > 0) {
    return verdict('REJECTED', ['KF_PROOF_REQUIRED_CASE_MISSING'], { missing });
  }

  const notPassed = requiredCases
    .map((caseId) => byId.get(caseId)[0])
    .filter((assertion) => assertion.status !== 'passed');

  if (notPassed.length > 0) {
    const statuses = [...new Set(notPassed.map((a) => a.status))];
    const reasons = statuses.some((s) => ['pending', 'skipped', 'todo'].includes(s))
      ? ['KF_PROOF_REQUIRED_CASE_SKIPPED']
      : ['KF_PROOF_REQUIRED_CASE_FAILED'];
    return verdict('REJECTED', reasons, {
      notPassed: notPassed.map(({ caseId, status }) => ({ caseId, status })),
    });
  }

  if (manifest.requireReportSuccess !== false && report.success !== true) {
    return verdict('REJECTED', ['KF_PROOF_REPORT_UNSUCCESSFUL']);
  }

  if (manifest.allowAdditionalCases === false) {
    const required = new Set(requiredCases);
    const unexpected = assertions.map((a) => a.caseId).filter((id) => !required.has(id));
    if (unexpected.length > 0) {
      return verdict('REJECTED', ['KF_PROOF_UNEXPECTED_CASE'], { unexpected });
    }
  }

  return verdict('SATISFIED_AT_DECLARED_SCOPE', [], {
    packageId: manifest.packageId,
    proofScope: manifest.proofScope ?? null,
    requiredCaseCount: requiredCases.length,
    discoveredCaseCount: assertions.length,
  });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'], { message: error.message })));
    process.exit(EXIT.REJECTED);
  }

  if (!args.manifest || !args.report) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'])));
    process.exit(EXIT.REJECTED);
  }

  let manifest;
  try {
    manifest = loadJson(args.manifest);
  } catch (error) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_MANIFEST_UNTRUSTED'], { message: error.message })));
    process.exit(EXIT.REJECTED);
  }

  let report;
  try {
    report = loadJson(args.report);
  } catch (error) {
    const missing = error && error.code === 'ENOENT';
    const result = verdict(
      missing ? 'INCOMPLETE' : 'REJECTED',
      [missing ? 'KF_PROOF_REPORT_MISSING' : 'KF_PROOF_REPORT_MALFORMED'],
      { message: error.message },
    );
    console.log(JSON.stringify(result));
    process.exit(missing ? EXIT.INCOMPLETE : EXIT.REJECTED);
  }

  const result = evaluateProof(manifest, report);
  console.log(JSON.stringify(result));
  process.exit(result.status === 'SATISFIED_AT_DECLARED_SCOPE' ? EXIT.SATISFIED : EXIT.REJECTED);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
