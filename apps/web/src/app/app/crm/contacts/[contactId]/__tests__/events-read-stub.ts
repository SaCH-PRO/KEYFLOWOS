/**
 * The events read, answered as the server answers it since FU-TIMELINE-EVENTS-PAGING (D-284; crm.controller.ts
 * contactEvents, crm-timeline.service.ts listContactEvents / listContactEventsPage), for the Timeline's jsdom tests:
 *
 *   - newest first, by createdAt and then id (both descending);
 *   - with no limit, cursor or paged: the newest 20, as a plain array (the default call, unchanged);
 *   - with any of them: { events, nextCursor, hasMore }, a page of `limit` (1..200, default 20) strictly older than the
 *     opaque cursor; nextCursor names the page's last event and is null on the last page; an invalid limit, paged or
 *     cursor answers 400, as the server does.
 *
 * `list` is what the read may serve the reading member: the server withholds money events per page (D-100), so a
 * test of a member passes the list without them, as the server would serve it.
 */
export interface StubEvent {
  id: string;
  createdAt: string;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** An opaque cursor, as the client must treat it (the server's is base64url JSON; this one only has to round-trip). */
export function cursorFor(id: string): string {
  return `c.${btoa(id)}`;
}

function idOf(cursor: string): string | null {
  if (!cursor.startsWith("c.")) return null;
  try {
    return atob(cursor.slice(2));
  } catch {
    return null;
  }
}

/** Newest first: createdAt descending, then id descending (the server's keyset order). */
export function newestFirst<T extends StubEvent>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const t = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (t !== 0) return t;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** The answer to one GET .../contacts/:c/events at `url`, from the events the member may be served. */
export function serveEventsRead(url: string, list: readonly StubEvent[]): Response {
  const q = new URL(url, "http://localhost").searchParams;
  const sorted = newestFirst(list);
  if (!q.has("limit") && !q.has("cursor") && !q.has("paged")) return json(200, sorted.slice(0, DEFAULT_LIMIT));
  const paged = q.get("paged");
  if (paged !== null && paged !== "true" && paged !== "1") return json(400, { message: "paged must be true or 1" });
  const rawLimit = q.get("limit");
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) return json(400, { message: "limit must be an integer between 1 and 200" });
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (limit < 1 || limit > MAX_LIMIT) return json(400, { message: "limit must be an integer between 1 and 200" });
  let start = 0;
  const cursor = q.get("cursor");
  if (cursor !== null) {
    const id = idOf(cursor);
    const at = id === null ? -1 : sorted.findIndex((e) => e.id === id);
    if (at < 0) return json(400, { message: "Invalid cursor" });
    start = at + 1;
  }
  const window = sorted.slice(start, start + limit + 1);
  const hasMore = window.length > limit;
  const events = window.slice(0, limit);
  const last = events[events.length - 1];
  return json(200, { events, nextCursor: hasMore && last ? cursorFor(last.id) : null, hasMore });
}
