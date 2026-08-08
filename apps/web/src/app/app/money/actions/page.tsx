/**
 * The full finance action list, at its home in the money hub.
 *
 * The compact panel on /app/money shows the first five items and a "See all"
 * link. That link pointed at /app/money — which re-exports /app/finance/page,
 * which renders the SAME panel in compact mode. It was a loop: five items, a
 * button promising more, and the same five items again. A business with six
 * finance actions could not reach the sixth.
 *
 * The full list already existed at /app/finance/actions, rendering the panel
 * with compact={false}. The money-hub consolidation redirected that route to
 * /app/money without carrying the full view across, so the screen survived and
 * became unreachable.
 *
 * Same one-line re-export as /app/money/books and /app/money/revenue: the
 * implementation stays where it is and the hub owns the URL.
 */
export { default } from "@/app/app/finance/actions/page";
