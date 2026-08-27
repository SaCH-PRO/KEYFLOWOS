/**
 * A redirect that shadows a page nobody deleted.
 *
 * The information architecture was consolidated — CRM into people-flow, finance
 * into financial-flow, and so on — with permanent redirects in next.config.ts.
 * The redirects work. What was left behind is the page each one shadows:
 * `app/crm/page.tsx` still exists, still compiles, still type-checks, and can
 * never render, because a 308 fires before Next ever reaches it.
 *
 * Twelve of them, confirmed against a running dev server rather than inferred:
 * every one returns 308 and the file underneath is unreachable. Editing any of
 * those files produces no observable effect, which is a specific and expensive
 * kind of confusion — the same shape as `inventory-reachability.spec.ts`, where
 * a 2,032-line command centre was mounted behind a redirect that bounced past
 * it.
 *
 * WHAT THIS DOES NOT CLAIM. The existing entries are not wrong; the redirects
 * are deliberate and the destinations are right. The dead files are debt, not a
 * defect. This gate exists so a THIRTEENTH is not added silently, and so that
 * deleting one of the twelve is a one-line ledger edit rather than an
 * archaeology exercise.
 *
 * The subroutes are NOT affected and must not be confused with the index:
 * `/app/crm` is shadowed, but the 24 pages under `/app/crm/...` are reachable,
 * because only the exact path is redirected.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.join(__dirname, '..', '..', '..');
const APP = path.join(WEB, 'src', 'app');
const CONFIG = path.join(WEB, 'next.config.ts');

interface Rule {
  source: string;
  destination: string;
}

/** Redirect rules as written in next.config.ts. */
function rules(): Rule[] {
  const cfg = fs.readFileSync(CONFIG, 'utf8');
  const re = /source:\s*["'`]([^"'`]+)["'`][\s\S]{0,120}?destination:\s*["'`]([^"'`]+)["'`]/g;
  const out: Rule[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cfg))) out.push({ source: m[1], destination: m[2] });
  return out;
}

/** The route a rule guards, with any `:path*` suffix removed. */
const baseOf = (source: string) => source.replace(/\/:path\*?$/, '');

/** Routes whose page.tsx exists but is shadowed by a redirect. */
function shadowed(): string[] {
  const seen = new Set<string>();
  for (const r of rules()) {
    const base = baseOf(r.source);
    if (fs.existsSync(path.join(APP, base, 'page.tsx'))) seen.add(base);
  }
  return [...seen].sort();
}

/**
 * Pages already known to be shadowed. Shrink-only.
 *
 * An entry is NOT approval — it records a file that can never render. Removing
 * one means deleting the page (verify it is unreachable first: the exact path
 * must 308, and its subroutes must not).
 */
const ACKNOWLEDGED_SHADOWED = [
  '/app/accounting',
  '/app/calendar',
  '/app/control-tower',
  '/app/crm',
  '/app/expenses',
  '/app/finance',
  '/app/finance/actions',
  '/app/finance/expenses',
  '/app/finance/reports',
  '/app/finance/revenue',
  '/app/marketing',
  '/app/projects',
];

describe('redirects and the pages beneath them', () => {
  it('parses the redirect table — this gate is not vacuous', () => {
    // If the regex stops matching, every assertion below passes on anything.
    expect(rules().length, 'no redirect rules parsed from next.config.ts').toBeGreaterThan(15);
  });

  it('no new page is hidden behind a redirect', () => {
    const added = shadowed().filter((p) => !ACKNOWLEDGED_SHADOWED.includes(p));

    expect(
      added,
      'this route has a page.tsx AND a redirect in next.config.ts, so the file ' +
        'can never render — editing it will appear to do nothing. Either delete ' +
        'the page or drop the redirect. If it is deliberate, record it here.',
    ).toEqual([]);
  });

  it('the ledger shrinks and does not go stale', () => {
    const live = new Set(shadowed());
    const gone = ACKNOWLEDGED_SHADOWED.filter((p) => !live.has(p));

    expect(
      gone,
      'this page is no longer shadowed — the file or the redirect was removed. ' +
        'Drop the entry so the list keeps meaning what it says.',
    ).toEqual([]);
  });

  it('no redirect points at another redirect', () => {
    // /app/finance/expenses -> /app/expenses -> /app/money/expenses works today,
    // at three hops. It is fragile rather than broken: delete the middle rule as
    // "obsolete" and the first silently lands on the dead page it was meant to
    // bypass, resurrecting a screen someone decided to retire.
    const sources = new Set(rules().map((r) => baseOf(r.source)));
    const chains = [...new Set(
      rules().filter((r) => sources.has(r.destination)).map((r) => `${baseOf(r.source)} -> ${r.destination}`),
    )].sort();

    expect(
      chains,
      'this redirect points at a path that is itself redirected. Point it at the ' +
        'final destination so removing the intermediate rule cannot silently ' +
        'change where the first one lands.',
    ).toEqual(['/app/finance/expenses -> /app/expenses']);
  });
});
