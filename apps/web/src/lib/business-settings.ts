"use client";

/**
 * BIZ-SETTINGS-WEB (re-cut v1 plan, step 3; owner rulings D-150 'hubs', D-218 'sellsowner', D-11): the web's one
 * reader, and two write doors, of the per-business v1 settings the server keeps on the business
 * (BIZ-SETTINGS-SERVER, apps/server core/prisma/business-meta.ts):
 *
 *   sells        what the business sells: services, products or both. It decides which hubs show and what the
 *                phone's bottom bar holds (NAV-A1).
 *   advancedCrm  the Advanced CRM switch (Deals and Companies).
 *   depth        per hub, standard or advanced: whether that hub's advanced tabs show.
 *
 * READ: GET /identity/businesses/:id answers the three top-level to every member, each absent or invalid stored key
 * at its default (both, off, every hub standard). businessSettingsOf reads an answer by the same rule, so a value
 * this file does not know is never passed on to the nav. useBusinessSettings() is the hook the nav and the hubs
 * read: it says whether the settings are loading, ready or failed, and holds the defaults until they are ready.
 * These settings choose what the app shows; they grant nothing (every route is still guarded on the server), so a
 * failed read falling back to "every hub" hides nothing and opens nothing.
 *
 * WRITE, two doors, as the server has them:
 *   - saveBusinessSells: what the business sells, through the owner-only profile PATCH
 *     (PATCH /identity/businesses/:id, D-11). Only the owner; the server refuses anyone else.
 *   - saveAdvancedSettings: the Advanced CRM switch and hub depth, through the owner-or-admin door
 *     (PATCH /identity/businesses/:id/advanced-settings, BIZ-SETTINGS-ADMIN-DOOR). It is sent advancedCrm and depth
 *     and nothing else: sells never leaves through it.
 * Both answer as lib/api.ts answers ({ data, error, status }): a refusal carries the server's words, and nothing a
 * reader shows changes. A write that goes through is recorded from the server's answer, for every reader at once.
 *
 * The settings are kept per business id, in memory only (never in browser storage: D-150, depth is stored on the
 * business, never in the browser). A reader is only ever given the entry of the business it asked for, an answer
 * naming another business is not taken, and the whole cache is dropped whenever a business is selected (sign-in,
 * signup, a switch), so nothing read as one member is shown to the next.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiGet, apiPatch } from "./api";
import { BUSINESS_CHANGED_EVENT, getStoredBusinessId } from "./workspace";

export const BUSINESS_SELLS = ["services", "products", "both"] as const;
export type BusinessSells = (typeof BUSINESS_SELLS)[number];

/** The seven v1 hubs (D-150, D-151): Today, Customers, Sales, Schedule, Money, Your page, Settings. */
export const BUSINESS_HUBS = ["today", "customers", "sales", "schedule", "money", "page", "settings"] as const;
export type BusinessHub = (typeof BUSINESS_HUBS)[number];

export const HUB_DEPTHS = ["standard", "advanced"] as const;
export type HubDepth = (typeof HUB_DEPTHS)[number];

export interface BusinessSettings {
  sells: BusinessSells;
  advancedCrm: boolean;
  depth: Record<BusinessHub, HubDepth>;
}

/** What the owner-or-admin door takes: the switch, hub depths (only the hubs named change), or both. */
export interface BusinessAdvancedSettingsWrite {
  advancedCrm?: boolean;
  depth?: Partial<Record<BusinessHub, HubDepth>>;
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function isBusinessSells(value: unknown): value is BusinessSells {
  return isOneOf(BUSINESS_SELLS, value);
}

function defaultDepth(): Record<BusinessHub, HubDepth> {
  const depth = {} as Record<BusinessHub, HubDepth>;
  for (const hub of BUSINESS_HUBS) depth[hub] = "standard";
  return depth;
}

/** The server's defaults (BUSINESS_SETTINGS_DEFAULTS): a business that never answered keeps every v1 hub. */
export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = Object.freeze({
  sells: "both",
  advancedCrm: false,
  depth: Object.freeze(defaultDepth()),
}) as BusinessSettings;

/**
 * The settings a business answer (GET or either PATCH) carries, each absent or invalid key at its default, as the
 * server reads a stored value (readBusinessSettings). A depth names hubs only and each hub a depth only.
 */
export function businessSettingsOf(business: unknown): BusinessSettings {
  const source = isPlainObject(business) ? business : {};
  const depth = defaultDepth();
  if (isPlainObject(source.depth)) {
    for (const hub of BUSINESS_HUBS) {
      if (hasOwn(source.depth, hub) && isOneOf(HUB_DEPTHS, source.depth[hub])) depth[hub] = source.depth[hub] as HubDepth;
    }
  }
  return {
    sells: hasOwn(source, "sells") && isBusinessSells(source.sells) ? source.sells : DEFAULT_BUSINESS_SETTINGS.sells,
    advancedCrm: hasOwn(source, "advancedCrm") && typeof source.advancedCrm === "boolean" ? source.advancedCrm : DEFAULT_BUSINESS_SETTINGS.advancedCrm,
    depth,
  };
}

/* ─────────────────────────────── the store ─────────────────────────────── */

export type BusinessSettingsStatus = "idle" | "loading" | "ready" | "failed";

interface Entry {
  status: BusinessSettingsStatus;
  settings: BusinessSettings;
  error: string | null;
}

const IDLE: Entry = Object.freeze({ status: "idle", settings: DEFAULT_BUSINESS_SETTINGS, error: null });
const LOADING: Entry = Object.freeze({ status: "loading", settings: DEFAULT_BUSINESS_SETTINGS, error: null });

/** Per business id; a Map, so no id (however it is spelled) reads another's entry or an inherited one. */
const entries = new Map<string, Entry>();
/** Per business id: the reads started, and the answers recorded, so a late read never undoes a newer answer. */
const readsStarted = new Map<string, number>();
const answersRecorded = new Map<string, number>();
/** Per business id: how many mounted hooks read it (they are reloaded when the cache is dropped). */
const watched = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function setEntry(businessId: string, entry: Entry): void {
  entries.set(businessId, entry);
  emit();
}

function entryOf(businessId: string | null): Entry {
  if (!businessId) return IDLE;
  return entries.get(businessId) ?? LOADING;
}

/** Drops everything read so far and reads again for the hooks still mounted. */
function dropCache(): void {
  entries.clear();
  for (const id of [...readsStarted.keys()]) readsStarted.set(id, (readsStarted.get(id) ?? 0) + 1);
  for (const id of [...answersRecorded.keys()]) answersRecorded.set(id, (answersRecorded.get(id) ?? 0) + 1);
  emit();
  for (const id of [...watched.keys()]) void loadBusinessSettings(id);
}

let listeningForSelection = false;
function listenForSelection(): void {
  if (listeningForSelection || typeof window === "undefined") return;
  listeningForSelection = true;
  // A business was selected in this tab (sign-in, signup, a switch): whoever reads next may be someone else.
  window.addEventListener(BUSINESS_CHANGED_EVENT, dropCache);
}

function subscribe(listener: () => void): () => void {
  listenForSelection();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A read the server refused this member or this business outright: nothing held from before is kept. */
function isRefusedRead(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 404;
}

const COULD_NOT_LOAD = "Couldn't load this business's settings.";

/**
 * Reads the business's settings and records them for every reader. Settings already shown stay while they are
 * read again; they are kept through a failure that says nothing about access (a network failure, a 5xx) and
 * dropped on a refusal (401, 403, 404). A read that a newer read, or a write's answer, has overtaken records
 * nothing.
 */
export async function loadBusinessSettings(businessId: string): Promise<void> {
  if (!businessId) return;
  const read = (readsStarted.get(businessId) ?? 0) + 1;
  readsStarted.set(businessId, read);
  const answersAtStart = answersRecorded.get(businessId) ?? 0;
  if (entries.get(businessId)?.status !== "ready") setEntry(businessId, LOADING);

  const res = await apiGet<Record<string, unknown>>(`/identity/businesses/${encodeURIComponent(businessId)}`);

  if (readsStarted.get(businessId) !== read) return;
  if ((answersRecorded.get(businessId) ?? 0) !== answersAtStart) return;
  if (res.error !== null && res.error !== undefined) {
    if (entries.get(businessId)?.status === "ready" && !isRefusedRead(res.status)) return;
    setEntry(businessId, { status: "failed", settings: DEFAULT_BUSINESS_SETTINGS, error: res.error.trim() || COULD_NOT_LOAD });
    return;
  }
  if (!isPlainObject(res.data) || res.data.id !== businessId) {
    // Not this business's answer: nothing in it is taken.
    setEntry(businessId, { status: "failed", settings: DEFAULT_BUSINESS_SETTINGS, error: COULD_NOT_LOAD });
    return;
  }
  setEntry(businessId, { status: "ready", settings: businessSettingsOf(res.data), error: null });
}

/**
 * Records what a write for `businessId` answered (the profile PATCH and the door both answer what GET answers), for
 * every reader, and overtakes any read still in flight. An answer naming another business records nothing; one that
 * does not carry the settings is not guessed at: the business is read again.
 */
export function noteBusinessSettings(businessId: string, answer: unknown): void {
  if (!businessId || !isPlainObject(answer) || answer.id !== businessId) return;
  answersRecorded.set(businessId, (answersRecorded.get(businessId) ?? 0) + 1);
  const carriesSettings = hasOwn(answer, "sells") && isBusinessSells(answer.sells) && hasOwn(answer, "advancedCrm") && typeof answer.advancedCrm === "boolean";
  if (!carriesSettings) {
    void loadBusinessSettings(businessId);
    return;
  }
  setEntry(businessId, { status: "ready", settings: businessSettingsOf(answer), error: null });
}

/** Forgets everything read (tests; nothing in the app needs it: a selected business already drops the cache). */
export function resetBusinessSettings(): void {
  entries.clear();
  readsStarted.clear();
  answersRecorded.clear();
  watched.clear();
  emit();
}

/* ─────────────────────────────── the two doors ─────────────────────────────── */

type WriteAnswer = Awaited<ReturnType<typeof apiPatch<Record<string, unknown>>>>;

const notSent = (error: string): WriteAnswer => ({ data: null, error });

/**
 * What the business sells, through the owner-only profile PATCH (D-11): sells and nothing else. The server refuses
 * anyone but the owner; the answer then carries its words and nothing a reader shows changes.
 */
export async function saveBusinessSells(businessId: string, sells: BusinessSells): Promise<WriteAnswer> {
  if (!isBusinessSells(sells)) return notSent("Choose services, products or both.");
  const res = await apiPatch<Record<string, unknown>>(`/identity/businesses/${encodeURIComponent(businessId)}`, { sells });
  if (res.error === null) noteBusinessSettings(businessId, res.data);
  return res;
}

/** The body the door is sent: advancedCrm and depth as named, nothing else; null when that is not a write. */
function advancedSettingsBody(write: unknown): BusinessAdvancedSettingsWrite | null {
  if (!isPlainObject(write)) return null;
  const body: BusinessAdvancedSettingsWrite = {};
  if (hasOwn(write, "advancedCrm") && write.advancedCrm !== undefined) {
    if (typeof write.advancedCrm !== "boolean") return null;
    body.advancedCrm = write.advancedCrm;
  }
  if (hasOwn(write, "depth") && write.depth !== undefined) {
    if (!isPlainObject(write.depth)) return null;
    const depth: Partial<Record<BusinessHub, HubDepth>> = {};
    for (const [hub, value] of Object.entries(write.depth)) {
      if (!isOneOf(BUSINESS_HUBS, hub) || !isOneOf(HUB_DEPTHS, value)) return null;
      depth[hub] = value;
    }
    if (Object.keys(depth).length > 0) body.depth = depth;
  }
  return Object.keys(body).length > 0 ? body : null;
}

/**
 * The Advanced CRM switch and hub depth, through the owner-or-admin door (BIZ-SETTINGS-ADMIN-DOOR; the owner, or an
 * admin with settings admin). The door is sent advancedCrm and depth only; the server refuses anyone else, and the
 * answer then carries its words and nothing a reader shows changes.
 */
export async function saveAdvancedSettings(businessId: string, write: BusinessAdvancedSettingsWrite): Promise<WriteAnswer> {
  const body = advancedSettingsBody(write);
  if (!body) return notSent("Choose the Advanced CRM switch or a hub's depth to change.");
  const res = await apiPatch<Record<string, unknown>>(`/identity/businesses/${encodeURIComponent(businessId)}/advanced-settings`, body);
  if (res.error === null) noteBusinessSettings(businessId, res.data);
  return res;
}

/* ─────────────────────────────── the hook ─────────────────────────────── */

export interface BusinessSettingsState extends BusinessSettings {
  /** The business these settings are of; null when none is selected. */
  businessId: string | null;
  /** "ready" only when the three values are the business's own; until then they are the defaults. */
  status: BusinessSettingsStatus;
  /** Why the read failed, in the server's words when it had any. */
  error: string | null;
  /** Reads the settings again. */
  reload: () => Promise<void>;
}

/** The business this browser is using, followed across a switch in this tab or another. */
function useStoredBusinessId(enabled: boolean): string | null {
  // Null on the server and on the first client render alike; the stored id is read once mounted.
  const [businessId, setBusinessId] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const read = () => setBusinessId(getStoredBusinessId());
    read();
    window.addEventListener(BUSINESS_CHANGED_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(BUSINESS_CHANGED_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, [enabled]);
  return enabled ? businessId : null;
}

/**
 * sells, advancedCrm and depth of a business, for the nav (NAV-A1) and the hubs. With no argument, the business
 * this browser is using; with an id (or null for none), that business. Until `status` is "ready" the values are the
 * defaults (both, off, every hub standard), and they are never another business's.
 */
export function useBusinessSettings(forBusinessId?: string | null): BusinessSettingsState {
  const stored = useStoredBusinessId(forBusinessId === undefined);
  const businessId = (forBusinessId === undefined ? stored : forBusinessId) || null;

  const entry = useSyncExternalStore(
    subscribe,
    () => entryOf(businessId),
    () => (businessId ? LOADING : IDLE),
  );

  useEffect(() => {
    if (!businessId) return;
    watched.set(businessId, (watched.get(businessId) ?? 0) + 1);
    void loadBusinessSettings(businessId);
    return () => {
      const left = (watched.get(businessId) ?? 1) - 1;
      if (left > 0) watched.set(businessId, left);
      else watched.delete(businessId);
    };
  }, [businessId]);

  const reload = useCallback(() => (businessId ? loadBusinessSettings(businessId) : Promise.resolve()), [businessId]);

  return useMemo(
    () => ({
      businessId,
      status: entry.status,
      error: entry.error,
      sells: entry.settings.sells,
      advancedCrm: entry.settings.advancedCrm,
      depth: entry.settings.depth,
      reload,
    }),
    [businessId, entry, reload],
  );
}
