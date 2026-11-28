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
import {
  extractInitializer,
  stringLiterals,
  recordNumericValues,
  recordKeyCount,
  arrayElementCount,
  objectKeyCount,
} from './lib.mjs';

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
  // Markdown-table ledgers (kind 'md-rows'): the row count of the one table in
  // the file. STATE.md's ledger table claims every row derives from THIS
  // command, so the two newest ledgers must be measured here or the
  // monotonicity check is blind to exactly the ledgers most likely to churn.
  { name: 'docs.debt', file: 'architecture/os/state/DOC_DEBT.md', header: '| doc | false claim | disproving command | disposition |', kind: 'md-rows', direction: 'shrink' },
  { name: 'routes.parity_absent', file: 'architecture/os/state/ROUTE_PARITY.md', header: '| path | client source | recorded |', kind: 'md-rows', direction: 'shrink' },

  // RR-GATE-LEDGER-CENSUS (D-261, D-262, D-22): every remaining shrink-only
  // ledger and ratchet across apps/, packages/, scripts/, and .github/.
  { name: 'cast.known_broken', file: 'apps/server/src/core/config/cast-call-integrity.spec.ts', constant: 'KNOWN_BROKEN', kind: 'strings', direction: 'shrink' },
  { name: 'lint.server_max_warnings', file: '.github/workflows/ci-cd.yml', workspace: 'server', kind: 'workflow-max-warnings', direction: 'shrink' },
  { name: 'lint.web_max_warnings', file: '.github/workflows/ci-cd.yml', workspace: 'web', kind: 'workflow-max-warnings', direction: 'shrink' },
  { name: 'fixtures.legacy_prefixes', file: 'apps/server/src/core/config/fixture-prefix-registry.spec.ts', constant: 'LEGACY', kind: 'strings', direction: 'shrink' },
  { name: 'routes.shadowing_allow_listed', file: 'apps/server/src/core/config/route-shadowing.spec.ts', constant: 'ALLOW_LISTED', kind: 'array-elements', direction: 'shrink' },
  { name: 'prisma.unused_models', file: 'apps/server/src/core/config/unused-model-census.spec.ts', constant: 'COMMITTED_UNUSED_MODELS', kind: 'array-elements', direction: 'shrink' },
  { name: 'crypto.no_production_guard', file: 'apps/server/src/core/crypto/token-crypto.spec.ts', constant: 'NO_PRODUCTION_GUARD', kind: 'strings', direction: 'shrink' },
  { name: 'prisma.business_meta_allowlist', file: 'apps/server/src/core/prisma/business-meta-writers.spec.ts', constant: 'D13_ALLOWLIST', kind: 'object-keys', direction: 'shrink' },
  { name: 'prisma.business_meta_ceiling', file: 'apps/server/src/core/prisma/business-meta-writers.spec.ts', constant: 'ALLOWLIST_CEILING', kind: 'number', direction: 'shrink' },
  { name: 'prisma.paged_order_allow_listed', file: 'apps/server/src/core/prisma/paged-order-census.spec.ts', constant: 'ALLOW_LISTED', kind: 'object-keys', direction: 'shrink' },
  { name: 'tenant.acknowledged_unindexed', file: 'apps/server/src/core/prisma/tenant-index-coverage.spec.ts', constant: 'ACKNOWLEDGED_UNINDEXED', kind: 'object-keys', direction: 'shrink' },
  { name: 'ai.direct_provider_census', file: 'apps/server/src/modules/ai/direct-provider-census.ts', constant: 'DIRECT_PROVIDER_CENSUS', kind: 'array-elements', direction: 'shrink' },
  { name: 'ai.dispatcher_id_allowlist', file: 'apps/server/src/modules/ai/flow-dispatcher-tenant.spec.ts', constant: 'ID_ALLOWLIST', kind: 'object-keys', direction: 'shrink' },
  { name: 'ai.dispatcher_service_binds_allowlist', file: 'apps/server/src/modules/ai/flow-dispatcher-tenant.spec.ts', constant: 'SERVICE_BINDS_ALLOWLIST', kind: 'object-keys', direction: 'shrink' },
  { name: 'ai.dispatcher_relation_allowlist', file: 'apps/server/src/modules/ai/flow-dispatcher-tenant.spec.ts', constant: 'RELATION_ALLOWLIST', kind: 'object-keys', direction: 'shrink' },
  { name: 'ai.dispatcher_raw_row_allowlist', file: 'apps/server/src/modules/ai/flow-dispatcher-tenant.spec.ts', constant: 'RAW_ROW_ALLOWLIST', kind: 'object-keys', direction: 'shrink' },
  { name: 'ai.non_strict_openai_tools', file: 'apps/server/src/modules/ai/flow-tool-registry.ts', constant: 'NON_STRICT_OPENAI_TOOLS', kind: 'strings', direction: 'shrink' },
  { name: 'ai.pro_auto_monitor_exempt_read_tools', file: 'apps/server/src/modules/ai/flow-tool-registry.ts', constant: 'PRO_AUTO_MONITOR_EXEMPT_READ_TOOLS', kind: 'strings', direction: 'shrink' },
  { name: 'commerce.balance_known_outside', file: 'apps/server/src/modules/commerce/balance-arithmetic.spec.ts', constant: 'KNOWN_OUTSIDE_WRITE_SET', kind: 'object-keys', direction: 'shrink' },
  { name: 'commerce.balance_unreachable_web', file: 'apps/server/src/modules/commerce/balance-arithmetic.spec.ts', constant: 'UNREACHABLE_WRITE_SET_WEB', kind: 'object-keys', direction: 'shrink' },
  { name: 'commerce.invoice_status_bypass_allowlist', file: 'apps/server/src/modules/commerce/invoice-status-writers.spec.ts', constant: 'BYPASS_ALLOWLIST', kind: 'object-keys', direction: 'shrink' },
  { name: 'commerce.invoice_status_allowlist_ceiling', file: 'apps/server/src/modules/commerce/invoice-status-writers.spec.ts', constant: 'ALLOWLIST_CEILING', kind: 'number', direction: 'shrink' },
  { name: 'web.link_targets_acknowledged', file: 'apps/web/src/lib/__tests__/link-targets.spec.ts', constant: 'ACKNOWLEDGED', kind: 'object-keys', direction: 'shrink' },
  { name: 'web.invoice_link_outside', file: 'apps/web/src/lib/__tests__/link-targets.spec.ts', constant: 'INVOICE_LINK_OUTSIDE_WRITE_SET', kind: 'object-keys', direction: 'shrink' },
  { name: 'web.unencoded_invoice_detail_outside', file: 'apps/web/src/lib/__tests__/link-targets.spec.ts', constant: 'UNENCODED_INVOICE_DETAIL_OUTSIDE_WRITE_SET', kind: 'object-keys', direction: 'shrink' },
  { name: 'web.nav_page_title_outside', file: 'apps/web/src/lib/__tests__/nav-labels-agree.spec.ts', constant: 'PAGE_TITLE_OUTSIDE_WRITE_SET', kind: 'object-keys', direction: 'shrink' },
  { name: 'web.nav_cockpit_label_outside', file: 'apps/web/src/lib/__tests__/nav-labels-agree.spec.ts', constant: 'COCKPIT_LABEL_OUTSIDE_WRITE_SET', kind: 'object-keys', direction: 'shrink' },
  { name: 'web.redirect_shadowed_acknowledged', file: 'apps/web/src/lib/__tests__/redirect-shadowing.spec.ts', constant: 'ACKNOWLEDGED_SHADOWED', kind: 'strings', direction: 'shrink' },
  { name: 'api.raw_record_debt', file: 'packages/api/src/no-raw-records.spec.ts', constant: 'RAW_RECORD_DEBT', kind: 'strings', direction: 'shrink' },
];

// Count data rows of the single markdown table whose header line matches.
// A table with N `|`-delimited cells produces rows with N+1 pieces after a
// bare split; we accept any line that starts with `|`, sits after the header,
// and is not the `---` separator.
function countMarkdownRows(src, header) {
  const lines = src.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trim() === header.trim());
  if (headerIdx === -1) throw new Error(`table header not found: ${header}`);
  let count = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('|')) break; // table ended
    if (/^\|[\s|:-]+\|$/.test(t)) continue; // separator row
    count++;
  }
  return count;
}

// Parse `--max-warnings <N>` from an active (non-comment) workflow `run:` line
// for the given pnpm workspace (e.g. `pnpm --filter server lint --max-warnings 3343`).
// Fails closed if absent or matched more than once.
function parseWorkflowMaxWarnings(src, workspace) {
  const escaped = workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `^\\s*(?:-\\s*)?run:\\s+.*\\bpnpm\\s+--filter\\s+${escaped}\\s+lint\\s+--max-warnings(?:=|\\s+)(\\d+)\\b`,
  );
  const matches = [];
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = re.exec(line);
    if (m) matches.push(Number(m[1]));
  }
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly 1 lint --max-warnings run line for workspace "${workspace}", found ${matches.length}`,
    );
  }
  return matches[0];
}

const results = [];
const errors = [];
for (const l of LEDGERS) {
  try {
    const src = readFileSync(resolve(ROOT, l.file), 'utf8');
    let value;
    if (l.kind === 'md-rows') {
      value = countMarkdownRows(src, l.header);
    } else if (l.kind === 'workflow-max-warnings') {
      value = parseWorkflowMaxWarnings(src, l.workspace);
    } else {
      const init = extractInitializer(src, l.constant);
      if (l.kind === 'strings') value = stringLiterals(init).length;
      else if (l.kind === 'record-sum') value = recordNumericValues(init).reduce((a, b) => a + b, 0);
      else if (l.kind === 'record-keys') value = recordKeyCount(init);
      else if (l.kind === 'array-elements') value = arrayElementCount(init);
      else if (l.kind === 'object-keys') value = objectKeyCount(init);
      else if (l.kind === 'number') value = Number(init.trim());
      else throw new Error(`unknown ledger kind: ${l.kind}`);
    }
    if (!Number.isFinite(value)) throw new Error(`non-numeric result for ${l.name}`);
    const constantLabel =
      l.constant ?? l.header ?? (l.workspace ? `lint:${l.workspace}:--max-warnings` : undefined);
    results.push({ name: l.name, file: l.file, constant: constantLabel, direction: l.direction, value });
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
