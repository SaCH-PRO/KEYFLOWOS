// Cardinality of every shrink-only ledger and floor ratchet in the repo,
// parsed from the gate files' own constants (parse, don't grep-count —
// VERIFIED_STATE rule 1). Deterministic JSON to stdout; no timestamps.
//
// The truth cycle runs this nightly and compares against the Prev column in
// architecture/os/state/STATE.md. A ledger that GREW (or a floor that FELL)
// is a gate-integrity incident, not a data update.
//
// Exit 1 on any parse failure — "constant not found" must never read as 0
// (gate-vacuity rule: a reader that finds nothing must prove it looked).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractInitializer, stringLiterals, recordNumericValues, recordKeyCount } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// direction: 'shrink' = count may only go down; 'grow' = floor may only go up.
const LEDGERS = [
  { name: 'tenant.acknowledged_unscoped', file: 'apps/server/src/core/prisma/tenant-model-list.spec.ts', constant: 'ACKNOWLEDGED_UNSCOPED', kind: 'strings', direction: 'shrink' },
  { name: 'tenant.never_scope', file: 'apps/server/src/core/prisma/tenant-model-list.spec.ts', constant: 'NEVER_SCOPE', kind: 'strings', direction: 'fixed' },
  { name: 'tenant.business_id_models', file: 'packages/db/src/client.ts', constant: 'BUSINESS_ID_MODELS', kind: 'strings', direction: 'grow' },
  { name: 'events.known_dead', file: 'apps/server/src/core/event-bus/event-wiring.spec.ts', constant: 'KNOWN_DEAD', kind: 'strings', direction: 'shrink' },
  { name: 'providers.unreachable', file: 'apps/server/src/core/config/unreachable-provider.spec.ts', constant: 'UNREACHABLE_ACKNOWLEDGED', kind: 'strings', direction: 'shrink' },
  { name: 'billing.unpriced', file: 'apps/server/src/modules/subscriptions/plans.ts', constant: 'UNPRICED_ACKNOWLEDGED', kind: 'strings', direction: 'shrink' },
  { name: 'billing.unenforced_limits', file: 'apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts', constant: 'UNENFORCED_ACKNOWLEDGED', kind: 'strings', direction: 'shrink' },
  { name: 'auth.public_handlers', file: 'apps/server/src/core/auth/public-surface.spec.ts', constant: 'ACKNOWLEDGED_PUBLIC', kind: 'record-sum', direction: 'shrink' },
  { name: 'auth.public_controllers', file: 'apps/server/src/core/auth/public-surface.spec.ts', constant: 'ACKNOWLEDGED_PUBLIC', kind: 'record-keys', direction: 'shrink' },
  { name: 'web.known_fabricated', file: 'apps/web/src/lib/__tests__/no-fabricated-screens.spec.ts', constant: 'KNOWN_FABRICATED', kind: 'strings', direction: 'shrink' },
  { name: 'trpc.unchecked', file: 'apps/server/src/trpc.module.spec.ts', constant: 'ACKNOWLEDGED_UNCHECKED', kind: 'record-keys', direction: 'shrink' },
  { name: 'ai.handler_coverage_floor_pct', file: 'apps/server/src/modules/ai/handler-coverage-ratchet.spec.ts', constant: 'FLOOR_PCT', kind: 'number', direction: 'grow' },
];

const results = [];
const errors = [];
for (const l of LEDGERS) {
  try {
    const src = readFileSync(resolve(ROOT, l.file), 'utf8');
    const init = extractInitializer(src, l.constant);
    let value;
    if (l.kind === 'strings') value = stringLiterals(init).length;
    else if (l.kind === 'record-sum') value = recordNumericValues(init).reduce((a, b) => a + b, 0);
    else if (l.kind === 'record-keys') value = recordKeyCount(init);
    else if (l.kind === 'number') value = Number(init.trim());
    if (!Number.isFinite(value)) throw new Error(`non-numeric result for ${l.constant}`);
    results.push({ name: l.name, file: l.file, constant: l.constant, direction: l.direction, value });
  } catch (e) {
    errors.push(`${l.name}: ${e.message}`);
  }
}

if (errors.length > 0) {
  console.error(`ledger-sizes: ${errors.length} parse failure(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
// Anti-vacuity: the two constants that must be non-empty today. trpc.unchecked
// is legitimately 0 (a closed ledger) and has no floor.
const bidm = results.find((r) => r.name === 'tenant.business_id_models');
if (!bidm || bidm.value < 300) {
  console.error(`ledger-sizes: BUSINESS_ID_MODELS parsed as ${bidm?.value} (< 300) — the reader is blind`);
  process.exit(1);
}
console.log(JSON.stringify(results, null, 2));
