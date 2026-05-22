/**
 * Static feature-flag config that gates the dormant top-level modules
 * compressed out of the primary nav by Task #605 (Navigation de-scope).
 *
 * Defaults:
 *   - production: every dormant module is OFF (false)
 *   - development: every dormant module is ON (true) so existing dev
 *     workflows that depended on these surfaces don't suddenly break
 *
 * Override per-flag at build time with NEXT_PUBLIC_FF_<UPPERCASE_KEY>,
 * e.g. NEXT_PUBLIC_FF_COMMUNITY=true. Values "true" / "1" enable, any
 * other string disables.
 *
 * IMPORTANT: every NEXT_PUBLIC_FF_* env var MUST be referenced as a
 * static literal (process.env.NEXT_PUBLIC_FF_FOO, no computed access)
 * so Next.js can statically inline its value into client bundles. A
 * dynamic process.env[name] lookup would silently fall through to the
 * default in the browser.
 */

export type DormantFeatureFlagKey =
  | "community"
  | "learning"
  | "documents"
  | "supplier"
  | "contentScheduler"
  | "marketplaceBrowsing"
  | "agencyPack"
  | "compliancePack"
  | "webPresencePack"
  | "salesPack"
  | "blueprintPostOnboard";

export type FeatureFlagMap = Readonly<Record<DormantFeatureFlagKey, boolean>>;

function parseOverride(raw: string | undefined): boolean | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0" || v === "") return false;
  return null;
}

// Static per-flag env reads. Each NEXT_PUBLIC_* literal is replaced by
// Next.js at build time, so these overrides work in both server and
// client bundles. Do NOT refactor into a loop / computed key access.
const RAW_OVERRIDES: Readonly<Record<DormantFeatureFlagKey, string | undefined>> = {
  community: process.env.NEXT_PUBLIC_FF_COMMUNITY,
  learning: process.env.NEXT_PUBLIC_FF_LEARNING,
  documents: process.env.NEXT_PUBLIC_FF_DOCUMENTS,
  supplier: process.env.NEXT_PUBLIC_FF_SUPPLIER,
  contentScheduler: process.env.NEXT_PUBLIC_FF_CONTENT_SCHEDULER,
  marketplaceBrowsing: process.env.NEXT_PUBLIC_FF_MARKETPLACE_BROWSING,
  agencyPack: process.env.NEXT_PUBLIC_FF_AGENCY_PACK,
  compliancePack: process.env.NEXT_PUBLIC_FF_COMPLIANCE_PACK,
  webPresencePack: process.env.NEXT_PUBLIC_FF_WEB_PRESENCE_PACK,
  salesPack: process.env.NEXT_PUBLIC_FF_SALES_PACK,
  blueprintPostOnboard: process.env.NEXT_PUBLIC_FF_BLUEPRINT_POST_ONBOARD,
};

function defaultForEnvironment(): boolean {
  return process.env.NODE_ENV !== "production";
}

function buildFlags(): FeatureFlagMap {
  const fallback = defaultForEnvironment();
  const map = {} as Record<DormantFeatureFlagKey, boolean>;
  (Object.keys(RAW_OVERRIDES) as DormantFeatureFlagKey[]).forEach((k) => {
    const override = parseOverride(RAW_OVERRIDES[k]);
    map[k] = override == null ? fallback : override;
  });
  return Object.freeze(map);
}

export const featureFlags: FeatureFlagMap = buildFlags();

export function isFeatureEnabled(key: DormantFeatureFlagKey): boolean {
  return featureFlags[key];
}

export const DORMANT_FEATURE_FLAG_KEYS: ReadonlyArray<DormantFeatureFlagKey> = Object.freeze([
  "community",
  "learning",
  "documents",
  "supplier",
  "contentScheduler",
  "marketplaceBrowsing",
  "agencyPack",
  "compliancePack",
  "webPresencePack",
  "salesPack",
  "blueprintPostOnboard",
]);
