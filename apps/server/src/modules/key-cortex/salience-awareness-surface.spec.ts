/**
 * Arc A: the ranked concerns finally reach a human without being asked.
 *
 * The amygdala computes up to ten concerns per pass, each with a written
 * summary — "12 overdue invoices in 24h against a normal of 3/day, escalating".
 * Eight were discarded outright, and the surviving two escaped only as the
 * `reason` riding on a hormone, inside a prompt block that explicitly forbids
 * treating them as reportable fact.
 *
 * So the arc terminated in a change of TONE. The owner learned the number only
 * if they happened to open the chat and ask something it bore on; if nobody
 * spoke to KEY, the appraisal expired silently and the invoices stayed overdue.
 *
 * This closes it to the awareness feed, which is already live and already
 * rendered on the command centre. Deliberately NOT to an action: this service
 * states in its own header that it has no hands, and giving a background sweep
 * the ability to act on a business is a product decision, not a missing wire.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AWARENESS_TYPES } from './key-cortex-awareness.service';
import { KeyCortexSalienceService } from './key-cortex-salience.service';

const BIZ = 'biz_1';

function threat(signal: string) {
  return {
    signal,
    summary: `${signal} is escalating`,
    valence: 'threat' as const,
    salience: 0.8,
    recentCount: 12,
    baselineRate: 3,
    escalating: true,
  };
}

/**
 * Drives the REAL appraise() with the two rankers stubbed, so persistence is
 * observed rather than inferred from the shape of the source.
 */
function makeSalience(
  threats: ReturnType<typeof threat>[],
  opts: { opportunities?: ReturnType<typeof threat>[]; withEndocrine?: boolean } = {},
) {
  const upserts: any[] = [];
  const deletes: any[] = [];

  const service = Object.assign(Object.create(KeyCortexSalienceService.prototype), {
    prisma: {
      client: {
        keyCortexMemory: {
          upsert: vi.fn(async (a: any) => {
            upserts.push(a);
          }),
          deleteMany: vi.fn(async (a: any) => {
            deletes.push(a);
          }),
        },
      },
    },
    current: new Map(),
    logger: { log: vi.fn(), warn: vi.fn() },
    endocrine: opts.withEndocrine === false ? undefined : { release: vi.fn() },
  });

  service.rank = vi.fn(async () => threats);
  service.rankOpportunities = vi.fn(async () => opts.opportunities ?? []);

  return { upserts, deletes, service, appraise: () => service.appraise(BIZ) };
}

const server = readFileSync(join(__dirname, 'key-cortex-salience.service.ts'), 'utf8');
const awareness = readFileSync(join(__dirname, 'key-cortex-awareness.service.ts'), 'utf8');
const panel = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'web', 'src', 'components', 'key', 'KeyAwarenessPanel.tsx'),
  'utf8',
);

describe('the concerns are written where something reads them', () => {
  it('salience persists them', () => {
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    expect(fn.slice(0, 2600)).toMatch(/keyCortexMemory\.upsert/);
  });

  it('is called from the appraisal, not merely defined', async () => {
    // The failure this codebase repeats: a complete method nothing invokes.
    //
    // This assertion used to read the SOURCE of appraise for the substring
    // `await this.persistConcerns(`. It passed for weeks while the call sat
    // below `if (all.length === 0 || !this.endocrine) return all;` and was
    // unreachable in the case that mattered. Text proximity is not reachability;
    // run the method.
    const h = makeSalience([threat('overdue_invoice')]);
    await h.appraise();

    expect(h.upserts).toHaveLength(1);
  });

  it('uses the types the awareness feed actually whitelists', () => {
    // A discriminator the reader does not recognise is written and silently
    // dropped — the exact shape of three separate defects found today.
    const declared = Object.values(AWARENESS_TYPES);
    expect(declared).toContain('salience_concern');
    expect(declared).toContain('salience_momentum');

    expect(server).toMatch(/MEMORY_TYPE_CONCERN = 'salience_concern'/);
    expect(server).toMatch(/MEMORY_TYPE_MOMENTUM = 'salience_momentum'/);
  });

  it('renders the summary salience already wrote', () => {
    const fn = awareness.slice(awareness.indexOf('private headlineFor('));
    expect(fn.slice(0, 1400)).toMatch(/case 'concern':/);
    expect(fn.slice(0, 1400)).toMatch(/str\('summary'\)/);
  });
});

describe('a resolved concern disappears', () => {
  it('deletes concerns that no longer clear the floor', async () => {
    // The half that is easy to forget and matters most. Without it the
    // dashboard goes on reporting twelve overdue invoices after they are paid,
    // and a stale fact stated confidently is worse than no fact.
    const h = makeSalience([threat('overdue_invoice')]);
    await h.appraise();

    expect(h.deletes).toHaveLength(1);
    expect(h.deletes[0].where.key.notIn).toEqual(['overdue_invoice']);
  });

  it('RETRACTS when the appraisal comes back empty', async () => {
    // The case the whole delete exists for, and the one it did not run in.
    // `if (all.length === 0 || !this.endocrine) return all;` sat above the
    // persist call, so the moment every concern resolved — the good news — the
    // rows saying otherwise became permanent. Nothing else in the system ever
    // clears them, and getAwareness applies no default age filter.
    const h = makeSalience([]);
    await h.appraise();

    expect(h.deletes).toHaveLength(1);
    expect(h.deletes[0].where.key.notIn).toEqual([]);
    expect(h.upserts).toEqual([]);
  });

  it('surfaces even with no endocrine service wired', async () => {
    // It is @Optional, and it gated visibility. A deployment without hormones
    // showed the owner nothing at all.
    const h = makeSalience([threat('overdue_invoice')], { withEndocrine: false });
    await h.appraise();

    expect(h.upserts).toHaveLength(1);
  });

  it('scopes the delete to one business', async () => {
    // Without businessId this clears every tenant's concerns on every hourly
    // appraisal. The guard establishes who is asking; it does not constrain
    // what a query touches.
    const h = makeSalience([threat('overdue_invoice')]);
    await h.appraise();

    expect(h.deletes[0].where.businessId).toBe(BIZ);
  });

  it('retracts only its own memory types', async () => {
    // notIn: [] on an empty appraisal matches every row, so the type filter is
    // the only thing standing between a quiet week and a wiped memory store.
    const h = makeSalience([]);
    await h.appraise();

    expect(h.deletes[0].where.type.in).toEqual(['salience_concern', 'salience_momentum']);
  });

  it('refreshes one row per signal rather than accumulating hourly', () => {
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    expect(fn.slice(0, 2600)).toMatch(/conc_\$\{businessId\}_\$\{c\.signal\}/);
  });
});

describe('it does not overstate what it knows', () => {
  it('records full confidence, because these are counts and not inferences', () => {
    // The panel renders confidence as "N% confident". Writing the salience
    // score there would express uncertainty about a number that was counted
    // exactly — false modesty about the wrong thing.
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    expect(fn.slice(0, 2600)).toMatch(/confidence: 1,/);
    expect(fn.slice(0, 2600)).toMatch(/salience: c\.salience/);
  });

  it('a failed write cannot undo the hormone release that already happened', () => {
    const fn = server.slice(server.indexOf('private async persistConcerns('));
    expect(fn.slice(0, 2600)).toMatch(/catch/);
  });
});

describe('the UI knows what it is being sent', () => {
  it('has metadata for both new kinds', () => {
    // KIND_META[item.kind] ?? KIND_META.weakSignal means a missing entry
    // silently relabels an escalating threat as a teal "Weak signal", and the
    // filter-chip loop over Object.keys(KIND_META) hides its count entirely.
    // Server and client whitelists have to move together.
    expect(panel).toMatch(/concern: \{/);
    expect(panel).toMatch(/momentum: \{/);
  });

  it('distinguishes threat from momentum visually', () => {
    // Rendering new bookings in threat red would be actively wrong.
    const concern = panel.slice(panel.indexOf('concern: {'), panel.indexOf('concern: {') + 200);
    const momentum = panel.slice(panel.indexOf('momentum: {'), panel.indexOf('momentum: {') + 200);
    expect(concern).toMatch(/rose/);
    expect(momentum).toMatch(/emerald/);
  });

  it('accepts them in its kind union', () => {
    const union = panel.slice(panel.indexOf('type AwarenessKind'), panel.indexOf('type AwarenessKind') + 240);
    expect(union).toMatch(/"concern"/);
    expect(union).toMatch(/"momentum"/);
  });

  it('every server-side awareness type has a client-side rendering', () => {
    // The durable version of the assertion above: adding a sixth kind on the
    // server without touching the panel fails here rather than rendering as
    // something it is not.
    const clientKinds = panel.slice(panel.indexOf('const KIND_META'), panel.indexOf('const KIND_META') + 2000);
    for (const key of Object.keys(AWARENESS_TYPES)) {
      expect(clientKinds, `panel has no entry for "${key}"`).toMatch(new RegExp(`${key}: \\{`));
    }
  });
});

describe('it still has no hands', () => {
  it('surfaces the concern without acting on the business', () => {
    // The service says so in its own header, and the efferent bridge exists but
    // is deliberately not crossed here. Autonomous action from a background
    // sweep is a product decision.
    const code = server
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');

    expect(code).not.toMatch(/executeTool|toolRegistry|executeToolDirectly|emailService/);
  });

  it('writes only its own memory types', () => {
    const code = server
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');
    const writes = code.match(/this\.prisma\.client\.(\w+)\.(upsert|create|update|deleteMany)/g) ?? [];

    for (const write of writes) {
      expect(write).toMatch(/keyCortexMemory/);
    }
  });
});
