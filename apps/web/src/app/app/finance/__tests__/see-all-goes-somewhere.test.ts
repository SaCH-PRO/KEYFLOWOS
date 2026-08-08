/**
 * "See all" must lead somewhere that actually shows all of it.
 *
 * The finance action panel truncates to five items and offers a "See all"
 * link. That link pointed at /app/money, which is a one-line re-export of
 * /app/finance/page, which renders THIS PANEL in compact mode. Five items, a
 * button promising more, and the same five items. A business with six finance
 * actions could not reach the sixth, and nothing anywhere reported a problem.
 *
 * The shape is worth naming because it is not a broken link and no gate looks
 * for it. Every check passes: the route resolves, the page renders, the panel
 * works. The defect only exists in the relationship between a truncation and
 * the destination that was supposed to undo it — and that relationship is
 * invisible to a route checker, which is why the money-hub consolidation could
 * quietly sever it.
 *
 * The full view was never deleted. It sat at /app/finance/actions the whole
 * time, redirected away by next.config, rendering compact={false}.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WEB = join(__dirname, '..', '..', '..', '..', '..');
const APP = join(WEB, 'src', 'app', 'app');
const read = (...p: string[]) => readFileSync(join(...p), 'utf8');

/** Follow a one-line `export { default } from "@/app/..."` re-export. */
function resolveReExport(routeFile: string): string {
  const src = readFileSync(routeFile, 'utf8');
  const m = src.match(/export\s*\{\s*default\s*\}\s*from\s*["']@\/app\/(.+?)["']/);
  if (!m) return routeFile;
  return join(WEB, 'src', 'app', `${m[1]}.tsx`);
}

describe('a truncated list offers a way to see the rest', () => {
  const panel = read(APP, 'finance', '_intel-panel.tsx');

  it('the finance panel truncates, so its "See all" carries weight', () => {
    // If this stops being true the test below is measuring nothing.
    expect(panel).toMatch(/compact\s*\?\s*items\.slice\(/);
  });

  it('"See all" does not lead back to the same compact panel', () => {
    const href = panel.match(/<Link href="([^"]+)"[^>]*>\s*\n?\s*See all/)?.[1];
    expect(href, '"See all" link not found — did the panel change shape?').toBeTruthy();

    const routeFile = join(APP, href!.replace('/app/', ''), 'page.tsx');
    expect(existsSync(routeFile), `${href} has no page`).toBe(true);

    // Follow the re-export to whatever actually renders.
    const rendered = readFileSync(resolveReExport(routeFile), 'utf8');

    // The destination must not be a page whose panel is compact. That is the
    // exact loop: "see all" landing on the same five items.
    const rendersCompactPanel = /<FinanceIntelPanel[^/>]*\scompact(\s|\/|>)/.test(rendered);
    expect(
      rendersCompactPanel,
      `"See all" points at ${href}, which renders FinanceIntelPanel in COMPACT mode — ` +
        'the same truncated list it was offering to expand.',
    ).toBe(false);
  });

  it('the destination renders the full list', () => {
    const href = panel.match(/<Link href="([^"]+)"[^>]*>\s*\n?\s*See all/)?.[1];
    const routeFile = join(APP, href!.replace('/app/', ''), 'page.tsx');
    const rendered = readFileSync(resolveReExport(routeFile), 'utf8');

    // Either it renders the panel uncompacted itself, or it delegates to a
    // client child that does.
    const here = /compact=\{false\}/.test(rendered);
    const child = rendered.match(/from\s+["']\.\/(_[\w-]+)["']/)?.[1];
    const inChild =
      child && existsSync(join(APP, 'finance', 'actions', `${child}.tsx`))
        ? /compact=\{false\}/.test(read(APP, 'finance', 'actions', `${child}.tsx`))
        : false;

    expect(here || inChild, 'the "See all" destination never renders the full list').toBe(true);
  });
});
