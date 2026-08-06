/**
 * The default nav showed three items, and nothing said so.
 *
 * use-app-layout.ts filters nav items with a strict label allowlist:
 *
 *   return MODE_OPERATE_ITEMS[disclosureMode].includes(i.label)
 *
 * A label that does not match is HIDDEN — silently, with no warning — and
 * `.filter((s) => s.items.length > 0)` then drops the emptied section entirely.
 * So a typo or a rename does not break a test or log an error. It removes a
 * feature from the product.
 *
 * The two files drifted. Measured at HEAD before this spec existed:
 *
 *   startup  allowed 6 labels, 3 existed. "Overview", "Directory" and
 *            "Pipeline" matched nothing — the real labels are "Command Center",
 *            "Contacts" and "Deals".
 *   growth   allowed 13, 8 existed.
 *   build    "Blueprint" was in all three lists; the label is "Business Genome",
 *            so the one thing a new business most needs to fill in was hidden.
 *
 * startup is the DEFAULT mode. Every new user opened KEYFLOWOS and saw Revenue,
 * Calendar and Bookings. No contacts, no inbox, no projects, no invoices. Only
 * `enterprise` looked right, because use-app-layout short-circuits it — which is
 * why this survived development.
 *
 * disclosure-mode.ts:69 already said "These labels must match the label field in
 * operateNav exactly". A constraint written in a comment and enforced by
 * nothing. This is that comment, made real.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MODE_OPERATE_ITEMS,
  MODE_BUILD_ITEMS,
  type DisclosureMode,
} from '../disclosure-mode';

const MODES: DisclosureMode[] = ['startup', 'growth', 'enterprise'];

/**
 * Labels declared in nav-config, split by the section array they belong to.
 *
 * Read from source rather than imported: nav-config is a "use client" module
 * carrying lucide icon components, and importing it into a node test drags in
 * React. The labels are plain string literals, so reading them is exact.
 */
function navLabels(): { operate: Set<string>; build: Set<string> } {
  const src = readFileSync(join(__dirname, '..', 'nav-config.ts'), 'utf8');
  const operateAt = src.indexOf('operateSections');
  const buildAt = src.indexOf('buildSections');

  expect(operateAt, 'operateSections not found — nav-config was restructured').toBeGreaterThan(-1);
  expect(buildAt, 'buildSections not found — nav-config was restructured').toBeGreaterThan(operateAt);

  // ITEM labels only. A NavSection also has a `label` — "Operating System",
  // "Sales", "Governance" — and the filter never sees those: it runs over
  // section.items. Matching every `label:` made this test demand that section
  // headings appear in the allowlists, which is meaningless. Items are the ones
  // that carry an href.
  const grab = (from: number, to: number) =>
    new Set([...src.slice(from, to).matchAll(/label: "([^"]+)",\s*href:/g)].map((m) => m[1]));

  return { operate: grab(operateAt, buildAt), build: grab(buildAt, src.length) };
}

describe('every mode allowlist names labels that actually exist', () => {
  const { operate, build } = navLabels();

  for (const mode of MODES) {
    it(`${mode}: every Operate entry resolves to a real nav item`, () => {
      const unknown = MODE_OPERATE_ITEMS[mode].filter((label) => !operate.has(label));

      expect(
        unknown,
        `these labels hide nothing and show nothing — they simply do not exist: ${unknown.join(', ')}`,
      ).toEqual([]);
    });

    it(`${mode}: every Build entry resolves to a real nav item`, () => {
      const unknown = MODE_BUILD_ITEMS[mode].filter((label) => !build.has(label));

      expect(unknown, `unknown Build labels: ${unknown.join(', ')}`).toEqual([]);
    });
  }
});

describe('the default mode is usable', () => {
  const { operate, build } = navLabels();

  it('startup shows enough of the Operate nav to run a business', () => {
    // Not a magic number — the point is that a solopreneur can find their
    // money, their people and their diary. Three items is a broken app; this
    // asserts the floor that failure fell through.
    const visible = MODE_OPERATE_ITEMS.startup.filter((l) => operate.has(l));

    expect(visible.length).toBeGreaterThanOrEqual(6);
  });

  it('startup can reach money, people and schedule', () => {
    const visible = new Set(MODE_OPERATE_ITEMS.startup.filter((l) => operate.has(l)));

    expect(visible.has('Revenue'), 'no way to see money').toBe(true);
    expect(visible.has('Contacts'), 'no way to see customers').toBe(true);
    expect(visible.has('Calendar'), 'no way to see the diary').toBe(true);
  });

  it('startup can reach the Business Genome, which onboarding asks them to fill in', () => {
    // This was the sharpest single casualty: the list said "Blueprint", the nav
    // says "Business Genome", so the screen the whole onboarding funnels toward
    // was hidden from exactly the users being onboarded.
    expect(MODE_BUILD_ITEMS.startup.filter((l) => build.has(l))).toContain('Business Genome');
  });
});

describe('the modes are nested, not arbitrary', () => {
  // Progressive disclosure only makes sense if moving up a stage never takes
  // something away. Without this, "upgrading" could hide a feature someone was
  // already using.
  it('growth shows everything startup shows', () => {
    const missing = MODE_OPERATE_ITEMS.startup.filter((l) => !MODE_OPERATE_ITEMS.growth.includes(l));

    expect(missing, `growth loses: ${missing.join(', ')}`).toEqual([]);
  });

  it('enterprise shows everything growth shows', () => {
    const missing = MODE_OPERATE_ITEMS.growth.filter((l) => !MODE_OPERATE_ITEMS.enterprise.includes(l));

    expect(missing, `enterprise loses: ${missing.join(', ')}`).toEqual([]);
  });

  it('the same holds for Build', () => {
    expect(MODE_BUILD_ITEMS.startup.filter((l) => !MODE_BUILD_ITEMS.growth.includes(l))).toEqual([]);
    expect(MODE_BUILD_ITEMS.growth.filter((l) => !MODE_BUILD_ITEMS.enterprise.includes(l))).toEqual([]);
  });
});

describe('the mobile unread badge is attached to something that exists', () => {
  // Same class of defect, third instance in this file's neighbourhood. The
  // component gated the badge on `item.href === "/app/inbox"` while nav-config
  // declares that item as "/app/data-inbox", so the unread count never rendered
  // on mobile and nothing failed. It is a flag on the item now — a flag cannot
  // drift from itself the way two copies of a route string can.
  const nav = readFileSync(join(__dirname, '..', 'nav-config.ts'), 'utf8');
  const component = readFileSync(
    join(__dirname, '..', '..', 'components', 'layout', 'mobile-bottom-nav.tsx'),
    'utf8',
  );

  it('exactly one bottom-nav item claims the badge', () => {
    const block = nav.slice(nav.indexOf('export const mobileBottomNav'));
    const marked = [...block.slice(0, 900).matchAll(/showUnreadBadge: true/g)];

    expect(marked).toHaveLength(1);
  });

  it('the component reads the flag rather than matching a route', () => {
    expect(component).toMatch(/item\.showUnreadBadge\s*&&/);
    expect(component, 'still comparing against a hardcoded route').not.toMatch(
      /item\.href === ["']\/app\//,
    );
  });
});

describe('enterprise is complete, even though the filter skips it', () => {
  const { operate } = navLabels();

  it('lists every Operate label', () => {
    // use-app-layout short-circuits enterprise, so this list is never read at
    // runtime. That is exactly why it was wrong — it referenced "Accounting",
    // "Cash Flow", "Agreements" and "Calls", none of which exist. A list nobody
    // reads is where errors go to hide, and the other two modes were copied
    // from it.
    const missing = [...operate].filter((l) => !MODE_OPERATE_ITEMS.enterprise.includes(l));

    expect(missing, `enterprise omits: ${missing.join(', ')}`).toEqual([]);
  });
});
