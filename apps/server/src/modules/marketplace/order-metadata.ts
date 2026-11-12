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
