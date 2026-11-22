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
 * naming another business is not taken, and every entry belongs to the member that read it (the subject of the
 * session token; review SEC-1): after a sign-out and another member's sign-in, with or without a reload, the next
 * reader starts from nothing.
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
  /** Who read it (actingMember): an entry is only ever given back to the member that read it. */
  member: string;
  /** When it was read (ms), for "ready" entries. */
  readAt: number;
}

const IDLE: Entry = Object.freeze({ status: "idle", settings: DEFAULT_BUSINESS_SETTINGS, error: null, member: "", readAt: 0 });
const LOADING: Entry = Object.freeze({ status: "loading", settings: DEFAULT_BUSINESS_SETTINGS, error: null, member: "", readAt: 0 });

/**
 * How long settings just read are taken as current: a reader mounted, or the tab looked at again, within it asks
 * nothing (review COR-3: the nav and every hub read this). After it, the next mount or look reads again, so a change
 * made on another device or by another member shows without a reload (review COR-4).
 */
export const BUSINESS_SETTINGS_FRESH_MS = 30_000;

/**
 * Who is acting in this browser now, for telling one member's reads from the next's (review SEC-1): the subject of
 * the session token the api client sends (the admin token first, as lib/api.ts picks it), which stays the same
 * across a token refresh. A token with no readable subject stands for itself; no token is "none". This is read, not
 * verified: it keys an in-memory cache and grants nothing.
 */
function actingMember(): string {
  if (typeof window === "undefined") return "none";
  let token: string | null = null;
  try {
    token = window.localStorage.getItem("kf_admin_token") ?? window.localStorage.getItem("kf_token");
  } catch {
    return "none";
  }
  if (!token) return "none";
  try {
    const payload = token.split(".")[1] ?? "";
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (isPlainObject(claims) && typeof claims.sub === "string" && claims.sub) return `sub:${claims.sub}`;
  } catch {
    // Not a token with claims: it stands for itself below.
  }
  return `token:${token}`;
}

/** Per business id; a Map, so no id (however it is spelled) reads another's entry or an inherited one. */
const entries = new Map<string, Entry>();
/** Per business id: the reads started, and the answers recorded, so a late read never undoes a newer answer. */
const readsStarted = new Map<string, number>();
const answersRecorded = new Map<string, number>();
/** Reads in flight, per member and business id: readers that ask together share one. */
const inFlight = new Map<string, Promise<void>>();
/** Per business id: how many mounted hooks read it (they are read again when the cache is dropped or goes stale). */
const watched = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function setEntry(businessId: string, entry: Entry): void {
  entries.set(businessId, entry);
  emit();
}

/** The entry `member` read for the business, or none: another member's entry is as good as absent. */
function entryFor(businessId: string, member: string): Entry | undefined {
  const entry = entries.get(businessId);
  return entry && entry.member === member ? entry : undefined;
}

function entryOf(businessId: string | null): Entry {
  if (!businessId) return IDLE;
  return entryFor(businessId, actingMember()) ?? LOADING;
}

const bump = (counter: Map<string, number>, id: string) => counter.set(id, (counter.get(id) ?? 0) + 1);

/** Drops everything read so far and reads again for the hooks still mounted. */
function dropCache(): void {
  for (const id of new Set([...entries.keys(), ...readsStarted.keys(), ...watched.keys()])) bump(readsStarted, id);
  entries.clear();
  inFlight.clear();
  emit();
  for (const id of [...watched.keys()]) void loadBusinessSettings(id, { force: true });
}

/** The tab is looked at again: the businesses being read are read again if what is held has gone stale. */
function revalidateWatched(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  for (const id of [...watched.keys()]) void loadBusinessSettings(id);
}

if (typeof window !== "undefined") {
  // A business was selected in this tab (workspace.ts selectBusiness): start again from nothing.
  window.addEventListener(BUSINESS_CHANGED_EVENT, dropCache);
  window.addEventListener("focus", revalidateWatched);
  document.addEventListener("visibilitychange", revalidateWatched);
}

function subscribe(listener: () => void): () => void {
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
 * Reads the business's settings, as the member acting now, and records them for every reader. Readers that ask
 * together share one read, and settings read within BUSINESS_SETTINGS_FRESH_MS are not asked for again unless
 * `force` is set. What is already shown (settings, or a failure) stays while it is read again; settings are kept through a failure that says
 * nothing about access (a network failure, a 5xx) and dropped on a refusal (401, 403, 404). A read records nothing
 * when a newer read or a write's answer has overtaken it, or when the member acting has changed since it was asked.
 */
export function loadBusinessSettings(businessId: string, options: { force?: boolean } = {}): Promise<void> {
  if (!businessId) return Promise.resolve();
  const member = actingMember();
  const held = entryFor(businessId, member);
  const flightKey = `${member}\n${businessId}`;
  if (!options.force) {
    if (held?.status === "ready" && Date.now() - held.readAt < BUSINESS_SETTINGS_FRESH_MS) return Promise.resolve();
    const flying = inFlight.get(flightKey);
    if (flying) return flying;
  }

  bump(readsStarted, businessId);
  const read = readsStarted.get(businessId);
  const answersAtStart = answersRecorded.get(businessId) ?? 0;
  // Whatever this member is shown stays while it is read again: settings that are ready, and a failure too (review
  // COR2-1: a failed view is not swapped away, and its "Try again" keeps the keyboard, on every re-read).
  if (!held) setEntry(businessId, { ...LOADING, member });

  const flight = (async () => {
    const res = await apiGet<Record<string, unknown>>(`/identity/businesses/${encodeURIComponent(businessId)}`);

    if (readsStarted.get(businessId) !== read) return;
    if ((answersRecorded.get(businessId) ?? 0) !== answersAtStart) return;
    // Asked as one member, answered after another took the browser: not theirs to be shown.
    if (actingMember() !== member) return;
    const failed = (error: string) => setEntry(businessId, { status: "failed", settings: DEFAULT_BUSINESS_SETTINGS, error, member, readAt: 0 });
    if (res.error !== null && res.error !== undefined) {
      if (entryFor(businessId, member)?.status === "ready" && !isRefusedRead(res.status)) return;
      failed(res.error.trim() || COULD_NOT_LOAD);
      return;
    }
    if (!isPlainObject(res.data) || res.data.id !== businessId) {
      // Not this business's answer: nothing in it is taken.
      failed(COULD_NOT_LOAD);
      return;
    }
    setEntry(businessId, { status: "ready", settings: businessSettingsOf(res.data), error: null, member, readAt: Date.now() });
  })().finally(() => {
    if (inFlight.get(flightKey) === flight) inFlight.delete(flightKey);
  });
  inFlight.set(flightKey, flight);
  return flight;
}

/**
 * The settings an answer confirms for `businessId`: it is this business's and carries them. Null for anything else
 * (no body, a list, another business's id, an answer without the settings): such an answer confirms nothing.
 */
export function confirmedBusinessSettings(businessId: string, answer: unknown): BusinessSettings | null {
  if (!businessId || !isPlainObject(answer) || answer.id !== businessId) return null;
  const carries = hasOwn(answer, "sells") && isBusinessSells(answer.sells) && hasOwn(answer, "advancedCrm") && typeof answer.advancedCrm === "boolean";
  return carries ? businessSettingsOf(answer) : null;
}

/** Who is acting now, for a caller that sends a write itself and records its answer with noteBusinessSettings. */
export function actingMemberNow(): string {
  return actingMember();
}

/**
 * Records what a write for `businessId` answered (the profile PATCH and the door both answer what GET answers), for
 * every reader, and overtakes any read still in flight. Returns whether the answer was this business's.
 *
 * An answer that is not (no body, a list, another business's id; review SEC-2) records nothing of itself and
 * returns false: what the business now holds is unknown, so it is read again, and the caller must not report the
 * write as saved. One that is this business's but does not carry the settings is not guessed at either: the
 * business is read again. `sentAs` is who sent the write (actingMemberNow() taken before it was sent): an answer that
 * lands after the member changed is recorded for nobody.
 */
export function noteBusinessSettings(businessId: string, answer: unknown, sentAs: string = actingMember()): boolean {
  if (!businessId) return false;
  bump(answersRecorded, businessId);
  const own = isPlainObject(answer) && answer.id === businessId;
  if (sentAs !== actingMember()) {
    // Sent as one member, answered after another took the browser (review SEC2-2): the answer is not theirs to be
    // shown, and whatever the first member was shown is gone with them.
    if (entries.get(businessId)?.member === sentAs && entries.delete(businessId)) emit();
    // The counter above overtook any read the member now acting has in flight (review SEC3-1): read again for them.
    if (watched.has(businessId)) void loadBusinessSettings(businessId, { force: true });
    return own;
  }
  const settings = confirmedBusinessSettings(businessId, answer);
  if (settings) {
    setEntry(businessId, { status: "ready", settings, error: null, member: sentAs, readAt: Date.now() });
    return true;
  }
  if (watched.has(businessId)) {
    void loadBusinessSettings(businessId, { force: true });
  } else if (entries.delete(businessId)) {
    emit();
  }
  return own;
}

/** Forgets everything read (tests; nothing in the app needs it). */
export function resetBusinessSettings(): void {
  entries.clear();
  readsStarted.clear();
  answersRecorded.clear();
  inFlight.clear();
  watched.clear();
  emit();
}

/* ─────────────────────────────── the two doors ─────────────────────────────── */

type WriteAnswer = Awaited<ReturnType<typeof apiPatch<Record<string, unknown>>>>;

const notSent = (error: string): WriteAnswer => ({ data: null, error });

/** A 2xx whose answer is not this business's: not a success anyone can vouch for (review SEC-2). */
const UNREADABLE_ANSWER = "The change was sent, but the answer could not be read. Check what is shown here before trying again.";
/** A 2xx that landed after the member who sent the write was no longer the one acting (review SEC3-2). */
const MEMBER_CHANGED = "The change was sent by someone who is no longer signed in here. Check what is shown before changing it again.";
/** A 2xx for this business that does not hold what was sent (review SEC2-1). */
const UNCONFIRMED_ANSWER = "The change was sent, but the business does not show it. Check what is shown here before trying again.";

/**
 * The answer of a write as the caller gets it. A 2xx is a success only when it answered for this business and holds
 * what was sent (`holds`); anything less is an error in plain words, and what the business holds is read again.
 * The answer is recorded for the member who sent the write (`sentAs`), never for one who took the browser since.
 */
function recorded(businessId: string, sentAs: string, res: WriteAnswer, holds: (settings: BusinessSettings) => boolean): WriteAnswer {
  if (res.error !== null) return res;
  if (sentAs !== actingMember()) {
    // Answered after another member took the browser (review SEC3-2): nothing is recorded for them, and the
    // outcome of a change they did not make is not announced on their screen as theirs.
    noteBusinessSettings(businessId, res.data, sentAs);
    return { data: null, error: MEMBER_CHANGED, status: res.status };
  }
  if (!noteBusinessSettings(businessId, res.data, sentAs)) return { data: null, error: UNREADABLE_ANSWER, status: res.status };
  const confirmed = confirmedBusinessSettings(businessId, res.data);
  if (confirmed && holds(confirmed)) return res;
  // Recorded above when it carried the settings; when it did not, a watched business is already being read again.
  return { data: null, error: UNCONFIRMED_ANSWER, status: res.status };
}

/**
 * What the business sells, through the owner-only profile PATCH (D-11): sells and nothing else. The server refuses
 * anyone but the owner; the answer then carries its words and nothing a reader shows changes.
 */
export async function saveBusinessSells(businessId: string, sells: BusinessSells): Promise<WriteAnswer> {
  if (!isBusinessSells(sells)) return notSent("Choose services, products or both.");
  const sentAs = actingMember();
  const res = await apiPatch<Record<string, unknown>>(`/identity/businesses/${encodeURIComponent(businessId)}`, { sells });
  return recorded(businessId, sentAs, res, (held) => held.sells === sells);
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
  const sentAs = actingMember();
  const res = await apiPatch<Record<string, unknown>>(`/identity/businesses/${encodeURIComponent(businessId)}/advanced-settings`, body);
  return recorded(
    businessId,
    sentAs,
    res,
    (held) =>
      (body.advancedCrm === undefined || held.advancedCrm === body.advancedCrm) &&
      // A depth sent is confirmed only by a depth answered (review SEC3-3), never by the default of a missing one.
      (body.depth === undefined || (isPlainObject(res.data) && isPlainObject(res.data.depth))) &&
      Object.entries(body.depth ?? {}).every(([hub, depth]) => held.depth[hub as BusinessHub] === depth),
  );
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
  // Who is acting, as of this render: when it changes under a mounted reader, the business is read again as them.
  const member = actingMember();

  useEffect(() => {
    if (!businessId) return;
    watched.set(businessId, (watched.get(businessId) ?? 0) + 1);
    void loadBusinessSettings(businessId);
    return () => {
      const left = (watched.get(businessId) ?? 1) - 1;
      if (left > 0) watched.set(businessId, left);
      else watched.delete(businessId);
    };
  }, [businessId, member]);

  const reload = useCallback(() => (businessId ? loadBusinessSettings(businessId, { force: true }) : Promise.resolve()), [businessId]);

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
