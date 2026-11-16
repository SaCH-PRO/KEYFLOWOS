import type { PrismaService } from './prisma.service';

/** The client an interactive `$transaction` hands its callback. */
export type BusinessMetaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

/**
 * FOLLOW3-D12-METADATA-LOCKED-WRITES: the first statement of every
 * Business.metaData read-modify-write.
 *
 * Business.metaData is one jsonb column that many writers read, change and
 * write back whole. A writer that reads it without a lock and writes its copy
 * back undoes every write that committed in between: the public storefront
 * event (SiteService.trackEvent) wrote an owner's cleared payment secret back
 * (R0-SEC2c review SEC2c-ST-1), and two events in flight together recorded
 * one. This takes the business row lock (SELECT ... FOR NO KEY UPDATE: the
 * lock IdentityService.updateBusiness and GmailService take on the same row,
 * and the one the UPDATE takes anyway; it does not block inserts that
 * reference the business) and then reads metaData, on the caller's
 * transaction client. A concurrent writer that also locks first waits for
 * this transaction to commit and then reads its result.
 *
 * The lock is held, with one pooled connection, from this read to the
 * caller's commit. A public or high-rate writer that only adds its own key
 * must not take it (review D12-ST-1 / CR-D12-1: a burst of anonymous
 * storefront events queued on the row lock while each held one of the pool's
 * connections, and other tenants' queries failed): write that key in one
 * atomic statement over the row's own meta_data instead, as
 * SiteService.trackEvent does (the census lists such writers in
 * ATOMIC_STATEMENT_OWNERS).
 *
 * Use it inside the transaction that writes, and spread the metaData it
 * returns (not an earlier read) into the write:
 *
 *   await this.prisma.client.$transaction(async (tx) => {
 *     const business = await lockBusinessMeta(tx, businessId);
 *     if (!business) throw new NotFoundException('Business not found');
 *     const meta = (business.metaData as Record<string, unknown> | null) ?? {};
 *     await tx.business.update({ where: { id: businessId }, data: { metaData: { ...meta, key: value } } });
 *   });
 *
 * The write stays at the caller, so the D-11 owner-writes guard
 * (core/config/d11-owner-writes.spec.ts) still reads each writer's metaData
 * keys there. core/prisma/business-meta-writers.spec.ts is the census of every
 * writer.
 *
 * Returns null when there is no such business (or, with `live`, when it is
 * soft-deleted); nothing is locked then.
 */
export async function lockBusinessMeta(
  tx: BusinessMetaTx,
  businessId: string,
  options: { live?: boolean } = {},
): Promise<{ metaData: unknown } | null> {
  await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR NO KEY UPDATE`;
  return tx.business.findFirst({
    where: options.live ? { id: businessId, deletedAt: null } : { id: businessId },
    select: { metaData: true },
  });
}

/**
 * V1-63 BIZ-SETTINGS-SERVER (owner ruling D-150 'hubs': seven hubs that fit
 * what you sell; depth lives inside hubs and is stored on the business, never
 * in the browser): the per-business v1 settings, three Business.metaData keys.
 *
 *   sells        what the business sells: 'services' | 'products' | 'both'.
 *                It decides which hubs show and what the phone's bottom bar
 *                holds (NAV-A1).
 *   advancedCrm  the Advanced CRM switch (Deals and Companies), a boolean.
 *   depth        per hub, 'standard' | 'advanced': whether that hub's advanced
 *                tabs show. Stored as a partial map (only the hubs written);
 *                a read answers every hub.
 *
 * A key that is absent, or holds a value that is not a setting, reads as its
 * default (BUSINESS_SETTINGS_DEFAULTS: 'both', false, every hub 'standard'),
 * so a business that existed before these settings keeps every v1 hub.
 *
 * WRITER: the owner-only profile PATCH (PATCH /identity/businesses/:businessId,
 * owner ruling D-11) is the one writer. IdentityService.updateBusiness checks
 * every value first (businessSettingsWriteOf: the field and the metaData bag
 * alike, an unknown value refused 400 BUSINESS_SETTING_INVALID before
 * anything is read or written) and applies them with
 * applyBusinessSettingsWrites inside its transaction, after the business row
 * lock and before its write. core/prisma/business-meta-writers.spec.ts
 * (MW-V63a/b) is the census: a second writer of one of these keys fails it.
 */
export const BUSINESS_SELLS = ['services', 'products', 'both'] as const;
export type BusinessSells = (typeof BUSINESS_SELLS)[number];

/** The seven v1 hubs (D-150, D-151): Today, Customers, Sales, Schedule, Money, Your page, Settings. */
export const BUSINESS_HUBS = ['today', 'customers', 'sales', 'schedule', 'money', 'page', 'settings'] as const;
export type BusinessHub = (typeof BUSINESS_HUBS)[number];

export const HUB_DEPTHS = ['standard', 'advanced'] as const;
export type HubDepth = (typeof HUB_DEPTHS)[number];

/** The Business.metaData keys the settings are stored under. */
export const BUSINESS_SETTINGS_META_KEYS = ['sells', 'advancedCrm', 'depth'] as const;

/** The 400 code a settings value that is not one (field or metaData bag) is refused with. */
export const BUSINESS_SETTING_INVALID = 'BUSINESS_SETTING_INVALID';

export interface BusinessSettings {
  sells: BusinessSells;
  advancedCrm: boolean;
  depth: Record<BusinessHub, HubDepth>;
}

/** A checked settings write: only the keys the caller named. */
export interface BusinessSettingsWrite {
  sells?: BusinessSells;
  advancedCrm?: boolean;
  depth?: Partial<Record<BusinessHub, HubDepth>>;
}

export const BUSINESS_SETTINGS_DEFAULTS: Readonly<{ sells: BusinessSells; advancedCrm: boolean; depth: HubDepth }> = Object.freeze({
  sells: 'both',
  advancedCrm: false,
  depth: 'standard',
});

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The hub entries of a stored depth that are settings (any other entry is ignored). */
function storedDepth(value: unknown): Partial<Record<BusinessHub, HubDepth>> {
  const out: Partial<Record<BusinessHub, HubDepth>> = {};
  if (!isPlainObject(value)) return out;
  for (const hub of BUSINESS_HUBS) {
    if (hasOwn(value, hub) && isOneOf(HUB_DEPTHS, value[hub])) out[hub] = value[hub] as HubDepth;
  }
  return out;
}

/** The settings a Business.metaData value holds, each absent or invalid key at its default. */
export function readBusinessSettings(metaData: unknown): BusinessSettings {
  const meta = isPlainObject(metaData) ? metaData : {};
  const stored = storedDepth(meta.depth);
  const depth = {} as Record<BusinessHub, HubDepth>;
  for (const hub of BUSINESS_HUBS) depth[hub] = stored[hub] ?? BUSINESS_SETTINGS_DEFAULTS.depth;
  return {
    sells: isOneOf(BUSINESS_SELLS, meta.sells) ? meta.sells : BUSINESS_SETTINGS_DEFAULTS.sells,
    advancedCrm: typeof meta.advancedCrm === 'boolean' ? meta.advancedCrm : BUSINESS_SETTINGS_DEFAULTS.advancedCrm,
    depth,
  };
}

/** The most characters of a refused depth entry's name a refusal repeats (review SEC-V63-1). */
const REFUSED_DEPTH_KEY_SHOWN = 32;

/** A refused depth entry's name as a refusal shows it: cut to REFUSED_DEPTH_KEY_SHOWN characters. */
const shownDepthKey = (key: string) =>
  key.length > REFUSED_DEPTH_KEY_SHOWN ? `${key.slice(0, REFUSED_DEPTH_KEY_SHOWN)}...` : key;

/**
 * Why a depth value is not a settings write (empty when it is one): a map
 * whose every key is a hub and every value a depth. `{}` changes no hub.
 *
 * Review SEC-V63-1: the problems are bounded whatever the value holds. A depth
 * names each hub at most once, so a map with more entries than there are hubs
 * is refused with one problem naming the count (never one per entry), and a
 * refused entry's name is cut short. The body pipe runs this before the
 * controller's D-11 check, so any member can send it.
 */
export function hubDepthProblems(value: unknown, field = 'depth'): string[] {
  if (!isPlainObject(value)) return [`${field} must be an object of hub to depth (hubs: ${BUSINESS_HUBS.join(', ')}; depths: ${HUB_DEPTHS.join(', ')})`];
  const entries = Object.keys(value).length;
  if (entries > BUSINESS_HUBS.length) {
    return [`${field} names ${entries} entries; a depth names at most ${BUSINESS_HUBS.length}, one per hub (hubs: ${BUSINESS_HUBS.join(', ')})`];
  }
  const problems: string[] = [];
  for (const [hub, depth] of Object.entries(value)) {
    if (!isOneOf(BUSINESS_HUBS, hub)) problems.push(`${field}.${shownDepthKey(hub)} is not a hub (hubs: ${BUSINESS_HUBS.join(', ')})`);
    else if (!isOneOf(HUB_DEPTHS, depth)) problems.push(`${field}.${hub} must be one of: ${HUB_DEPTHS.join(', ')}`);
  }
  return problems;
}

/**
 * The settings `source` names (a key present with a value other than
 * undefined), checked: `problems` lists every value that is not a setting
 * (null included: a setting is never cleared, only set), each prefixed with
 * `where` (the field path the caller used, '' or 'metaData.').
 */
export function businessSettingsWriteOf(source: unknown, where = ''): { write: BusinessSettingsWrite; problems: string[] } {
  const write: BusinessSettingsWrite = {};
  const problems: string[] = [];
  if (!isPlainObject(source)) return { write, problems };
  const named = (key: string) => hasOwn(source, key) && source[key] !== undefined;
  if (named('sells')) {
    if (isOneOf(BUSINESS_SELLS, source.sells)) write.sells = source.sells;
    else problems.push(`${where}sells must be one of: ${BUSINESS_SELLS.join(', ')}`);
  }
  if (named('advancedCrm')) {
    if (typeof source.advancedCrm === 'boolean') write.advancedCrm = source.advancedCrm;
    else problems.push(`${where}advancedCrm must be true or false`);
  }
  if (named('depth')) {
    const found = hubDepthProblems(source.depth, `${where}depth`);
    if (found.length === 0) write.depth = { ...(source.depth as Partial<Record<BusinessHub, HubDepth>>) };
    else problems.push(...found);
  }
  return { write, problems };
}

/** `over`'s keys win; depth merges per hub. */
export function mergeBusinessSettingsWrites(under: BusinessSettingsWrite, over: BusinessSettingsWrite): BusinessSettingsWrite {
  const out: BusinessSettingsWrite = { ...under, ...over };
  if (under.depth || over.depth) out.depth = { ...(under.depth ?? {}), ...(over.depth ?? {}) };
  else delete out.depth;
  return out;
}

/**
 * Apply a checked settings write to `merged`, the metaData copy about to be
 * written (the copy read under the business row lock, with the caller's bag
 * spread over it). A key the write names is set: sells and advancedCrm to the
 * written value, depth to the stored hubs (`stored`, read under the same
 * lock) with the written hubs over them, so a hub the write does not name
 * keeps its depth, whatever a bag spread put there. A key the write does not
 * name is left as `merged` holds it.
 */
export function applyBusinessSettingsWrites(merged: Record<string, unknown>, stored: Record<string, unknown>, write: BusinessSettingsWrite): void {
  if (write.sells !== undefined) merged.sells = write.sells;
  if (write.advancedCrm !== undefined) merged.advancedCrm = write.advancedCrm;
  if (write.depth !== undefined) merged.depth = { ...storedDepth(stored.depth), ...write.depth };
}

/**
 * `source` without the settings keys: they are Business.metaData keys, never
 * Business columns, so the profile PATCH keeps them out of its column copy
 * and its changed-field list.
 */
export function omitBusinessSettingsKeys<T extends object>(source: T): Omit<T, (typeof BUSINESS_SETTINGS_META_KEYS)[number]> {
  const copy: Record<string, unknown> = { ...(source as Record<string, unknown>) };
  for (const key of BUSINESS_SETTINGS_META_KEYS) delete copy[key];
  return copy as Omit<T, (typeof BUSINESS_SETTINGS_META_KEYS)[number]>;
}
