import { Prisma } from '@prisma/client';
import type { BusinessMetaTx } from '../../core/prisma/business-meta';

/**
 * W10-SOP-FIX (SOP-V4; owner ruling D-112): one-statement writes to a
 * marketplace order's metadata (jsonb).
 *
 * The order's metadata holds its fulfilment timeline (statusTimeline) and the
 * links the paid listener writes (links.contactId). Every writer used to read
 * the whole metadata, change its copy and write the copy back: the paid
 * marking's step (writeMarking), mark_paid's un-awaited autoRouteOrder,
 * FulfillmentRoutingService.routeOrder (run by mark_paid and, on the same
 * store_order.paid, by StoreOrderRoutingListener) and
 * CommerceIntegrationService's contact link all run together after a marking,
 * so a writer that had read before another committed wrote its stale copy
 * over it. The review lost steps in 4 of 5 single mark_paid calls with
 * production wiring; at 6470942a every one of 5 lost a routing step or the
 * contact link (V18-T2m).
 *
 * Each function below is one UPDATE whose new metadata is an expression over
 * the row's own metadata, changing only its part (an appended step, a removed
 * step, one key of an object). The UPDATE takes the row lock itself and, under
 * READ COMMITTED, computes its value from the newest committed row after any
 * wait, so nothing that commits meanwhile is undone, and no lock or pooled
 * connection is held across round trips (the shape SiteService.trackEvent uses
 * for Business.metaData, FOLLOW3-D12). The row is matched in its business, the
 * tenant: an order of another business, or no order, matches nothing and
 * nothing is written (the count returned is 0). updated_at is set, as Prisma's
 * @updatedAt would.
 */

/** The client a write runs on: the shared client (PrismaService.client) or an interactive transaction's. */
export type OrderMetadataClient = Pick<BusinessMetaTx, '$executeRaw'>;

/** A timeline step as the routes write it (a JSON object): status, timestamp, note and the action's own fields. */
export type OrderTimelineStep = object;

/** The stored metadata as an object ('{}' for NULL or any other JSON value). */
const METADATA = Prisma.sql`(CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END)`;

/** The stored statusTimeline as an array ('[]' when absent or not an array). */
const TIMELINE = Prisma.sql`(CASE WHEN jsonb_typeof(metadata -> 'statusTimeline') = 'array' THEN metadata -> 'statusTimeline' ELSE '[]'::jsonb END)`;

/**
 * Appends `steps` (in order) to the order's statusTimeline, and, with
 * `status`, writes the order's status in the same statement.
 *
 * `stampRowStatus`: each step's `status` is the order's status as stored when
 * the statement runs (before any `status` it writes), read in the statement
 * rather than before it (autoRouteOrder's routing step notes the status the
 * order is in).
 */
export function appendOrderTimeline(
  client: OrderMetadataClient,
  businessId: string,
  orderId: string,
  steps: readonly OrderTimelineStep[],
  options: { status?: string; stampRowStatus?: boolean } = {},
): Promise<number> {
  const json = JSON.stringify(steps);
  const appended = options.stampRowStatus
    ? Prisma.sql`(SELECT COALESCE(jsonb_agg(s.value || jsonb_build_object('status', marketplace_orders.status) ORDER BY s.n), '[]'::jsonb)
                    FROM jsonb_array_elements(${json}::jsonb) WITH ORDINALITY AS s(value, n))`
    : Prisma.sql`${json}::jsonb`;
  const status = options.status !== undefined ? Prisma.sql`status = ${options.status},` : Prisma.empty;
  return client.$executeRaw`
    UPDATE marketplace_orders
       SET ${status}
           metadata = ${METADATA} || jsonb_build_object('statusTimeline', ${TIMELINE} || ${appended}),
           updated_at = NOW()
     WHERE id = ${orderId} AND business_id = ${businessId}`;
}

/**
 * W10-Z4-ROUTE-FIX (seam review SEAMZ4-CR-2; D-112): appends `steps` to the
 * order's statusTimeline and, only where the order's status is still
 * `advance.from` when the statement runs, writes `advance.to` and appends
 * `advance.steps` after them, in one UPDATE. Every SET expression reads the
 * row as it is before this UPDATE (after any wait for a concurrent writer of
 * the row, the newest committed version), so a status committed since the
 * caller read `from` (the paid door's paid, a cancel) is kept with no step
 * claiming otherwise.
 *
 * Fulfilment routing wrote the status it computed from the status it read when
 * its claim began; the paid door and the cancel action do not take the claim,
 * so a placed order marked paid while it was routed got 'placed' back, and a
 * cancelled one 'routed'.
 */
export function appendOrderTimelineAdvancingStatus(
  client: OrderMetadataClient,
  businessId: string,
  orderId: string,
  steps: readonly OrderTimelineStep[],
  advance: { from: string; to: string; steps: readonly OrderTimelineStep[] } | null,
): Promise<number> {
  if (!advance) return appendOrderTimeline(client, businessId, orderId, steps);
  const stillFrom = Prisma.sql`marketplace_orders.status = ${advance.from}`;
  return client.$executeRaw`
    UPDATE marketplace_orders
       SET status = CASE WHEN ${stillFrom} THEN ${advance.to} ELSE status END,
           metadata = ${METADATA} || jsonb_build_object('statusTimeline', ${TIMELINE} || ${JSON.stringify(steps)}::jsonb
             || CASE WHEN ${stillFrom} THEN ${JSON.stringify(advance.steps)}::jsonb ELSE '[]'::jsonb END),
           updated_at = NOW()
     WHERE id = ${orderId} AND business_id = ${businessId}`;
}

/**
 * W10-Z4-ROUTE-FIX (seam review SEAMZ4-CR-4): the order's public tracking
 * token, written in one statement only where none is stored (absent, null or
 * empty), the rest of the metadata as stored. Returns the token stored once it
 * has run: `token` where this call wrote it, the one another call stored first
 * otherwise, or null when there is no such order in the business.
 *
 * GET .../orders/:id/token read the whole metadata and wrote its copy back
 * with the token: a routing step or link committed in between was undone, and
 * a token another call had just stored (and handed out) was replaced.
 */
export async function setOrderPublicTokenOnce(
  client: Pick<BusinessMetaTx, '$queryRaw'>,
  businessId: string,
  orderId: string,
  token: string,
): Promise<string | null> {
  const written = await client.$queryRaw<Array<{ token: string | null }>>`
    UPDATE marketplace_orders
       SET metadata = ${METADATA} || jsonb_build_object('publicToken', ${token}::text),
           updated_at = NOW()
     WHERE id = ${orderId} AND business_id = ${businessId}
       AND COALESCE(${METADATA} ->> 'publicToken', '') = ''
    RETURNING metadata ->> 'publicToken' AS token`;
  if (written.length > 0) return written[0].token;
  // Not written: stored already (read in a new statement, so a token committed while the UPDATE waited is seen), or no
  // such order.
  const stored = await client.$queryRaw<Array<{ token: string | null }>>`
    SELECT ${METADATA} ->> 'publicToken' AS token FROM marketplace_orders WHERE id = ${orderId} AND business_id = ${businessId}`;
  return stored.length > 0 ? stored[0].token : null;
}

/**
 * W11-SHIPPING-EXPENSE-ONCE (owner ruling D-126; F-24): writes `value` under
 * metadata[key] in one statement, only where the key is absent, null or empty
 * (a JSON null, '{}', '[]' or ''), the rest of the metadata as stored. Returns
 * whether this call wrote it: false where another call stored a value first
 * (read under the row lock, after any wait for its writer, so two calls at once
 * cannot both write) or where there is no such order in the business. The
 * shape of setOrderPublicTokenOnce, for a claim made once per order.
 */
export async function setOrderMetadataKeyOnce(
  client: OrderMetadataClient,
  businessId: string,
  orderId: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  const written = await client.$executeRaw`
    UPDATE marketplace_orders
       SET metadata = ${METADATA} || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb),
           updated_at = NOW()
     WHERE id = ${orderId} AND business_id = ${businessId}
       AND COALESCE(${METADATA} -> ${key}::text, 'null'::jsonb) IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb, '""'::jsonb)`;
  return written > 0;
}

/**
 * W11-SHIPPING-EXPENSE-ONCE (owner ruling D-126; review SEC-SEO-1): writes
 * `value` under metadata[key] in one statement, only while metadata[key] is
 * still `expected` (jsonb equality), the rest of the metadata as stored.
 * Returns whether this call wrote it: false where another call changed the key
 * since `expected` was read (the WHERE is read again under the row lock, after
 * any wait for that writer, so of two calls replacing the same value one
 * writes), or where there is no such order in the business.
 */
export async function replaceOrderMetadataKeyIf(
  client: OrderMetadataClient,
  businessId: string,
  orderId: string,
  key: string,
  expected: unknown,
  value: unknown,
): Promise<boolean> {
  const written = await client.$executeRaw`
    UPDATE marketplace_orders
       SET metadata = ${METADATA} || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb),
           updated_at = NOW()
     WHERE id = ${orderId} AND business_id = ${businessId}
       AND ${METADATA} -> ${key}::text = ${JSON.stringify(expected)}::jsonb`;
  return written > 0;
}

/**
 * W11-SHIPPING-EXPENSE-ONCE (D-126): removes metadata[key] in one statement,
 * only while it still holds the claim `claimToken` (metadata[key].claim), so a
 * claim taken back after its work failed never removes a value another call has
 * written since. Returns the count written (0 when the key holds anything
 * else, or there is no such order in the business).
 */
export function removeOrderMetadataKeyIf(
  client: OrderMetadataClient,
  businessId: string,
  orderId: string,
  key: string,
  claimToken: string,
): Promise<number> {
  return client.$executeRaw`
    UPDATE marketplace_orders
       SET metadata = ${METADATA} - ${key}::text,
           updated_at = NOW()
     WHERE id = ${orderId} AND business_id = ${businessId}
       AND ${METADATA} -> ${key}::text ->> 'claim' = ${claimToken}`;
}

/**
 * Takes the last statusTimeline step equal to `step` (jsonb equality: the same
 * keys and values, in any key order) off the order: a marking that recorded
 * nothing takes back its own step. Nothing is written when there is none.
 */
export function takeBackOrderTimelineStep(
  client: OrderMetadataClient,
  businessId: string,
  orderId: string,
  step: OrderTimelineStep,
): Promise<number> {
  const json = JSON.stringify(step);
  return client.$executeRaw`
    UPDATE marketplace_orders
       SET metadata = ${METADATA} || jsonb_build_object('statusTimeline', ${TIMELINE} - (
             SELECT (MAX(s.n) - 1)::int
               FROM jsonb_array_elements(${TIMELINE}) WITH ORDINALITY AS s(value, n)
              WHERE s.value = ${json}::jsonb)),
           updated_at = NOW()
     WHERE id = ${orderId} AND business_id = ${businessId}
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(${TIMELINE}) AS s(value) WHERE s.value = ${json}::jsonb)`;
}

/**
 * Merges `patch` into the object under metadata[key] (metadata.links), the
 * rest of the metadata as stored.
 */
export function mergeOrderMetadataObject(
  client: OrderMetadataClient,
  businessId: string,
  orderId: string,
  key: string,
  patch: Record<string, unknown>,
): Promise<number> {
  return client.$executeRaw`
    UPDATE marketplace_orders
       SET metadata = ${METADATA} || jsonb_build_object(${key}::text,
             (CASE WHEN jsonb_typeof(metadata -> ${key}::text) = 'object' THEN metadata -> ${key}::text ELSE '{}'::jsonb END)
             || ${JSON.stringify(patch)}::jsonb),
           updated_at = NOW()
     WHERE id = ${orderId} AND business_id = ${businessId}`;
}
