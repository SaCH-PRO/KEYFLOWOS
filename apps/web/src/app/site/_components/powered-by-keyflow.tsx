/**
 * S5 — Powered-by KeyFlow badge.
 *
 * Renders only on free-tier storefronts. Once the business upgrades to
 * FLOW or KEYFLOW, the parent passes a non-FREE plan and we render
 * nothing — the upgrade silently buys removal of the badge.
 *
 * Server-rendered (no client JS) so it appears in the initial HTML
 * for crawlers and instant page loads.
 */
export function PoweredByKeyFlow({ plan }: { plan?: string | null }) {
  if (plan && plan !== "FREE") return null;
  return (
    <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 text-center">
      <a
        href="https://keyflow.app/?utm_source=storefront&utm_medium=powered_by&utm_campaign=growth_loop"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
      >
        <span className="opacity-70">Powered by</span>
        <span className="font-semibold tracking-tight">KeyFlow</span>
        <span className="opacity-60">— the AI operating system for small businesses</span>
      </a>
    </div>
  );
}
