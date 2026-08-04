/**
 * Business epigenetics — expression, not structure.
 *
 * The genome says what a business HAS. This says how it WORKS, and the two are
 * independent: identical structure, completely different behaviour.
 *
 * Two properties carry the design.
 *
 *   DECLARED REACHES THE PROMPT. The operator filled in brand voice, tone and
 *   doNotSay during onboarding, which creates an expectation those are honoured.
 *   Before this they were read almost nowhere on the path the chat uses.
 *
 *   OBSERVED CAN DISAGREE. A blueprint claiming "high risk tolerance" while the
 *   owner rejects four of five proposals does not describe a bold business. The
 *   declaration is an aspiration; the approval record is the phenotype. The
 *   mismatch is reported, never silently resolved.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexEpigeneticsService, type Epigenome } from './key-cortex-epigenetics.service';

const BIZ = 'biz_1';
const T0 = new Date('2026-08-03T12:00:00Z');

function makePrisma(opts: { blueprint?: any; approvals?: string[] } = {}) {
  const seen: Record<string, any> = {};
  return {
    seen,
    prisma: {
      client: {
        businessBlueprint: {
          findUnique: vi.fn(async ({ where }: any) => {
            seen.blueprint = where;
            return opts.blueprint ?? null;
          }),
        },
        approvalRequest: {
          findMany: vi.fn(async ({ where, take }: any) => {
            seen.approval = where;
            seen.approvalTake = take;
            return (opts.approvals ?? []).map((status) => ({ status }));
          }),
        },
      },
    } as never,
  };
}

function makeService(opts: { blueprint?: any; approvals?: string[] } = {}) {
  const { seen, prisma } = makePrisma(opts);
  return { seen, service: new KeyCortexEpigeneticsService(prisma) };
}

/** n decisions with the given approval fraction. */
function decisions(n: number, approvedFraction: number): string[] {
  const approved = Math.round(n * approvedFraction);
  return [...Array(approved).fill('approved'), ...Array(n - approved).fill('rejected')];
}

describe('declared style reaches the prompt', () => {
  const blueprint = {
    brand: { voice: 'plain and direct', tone: 'warm', doNotSay: ['synergy', 'leverage'] },
    constraints: { riskTolerance: 'low' },
    aiPreferences: { outreachStyle: 'short emails', reportingCadence: 'weekly', autonomyLevel: 2 },
  };

  it('renders voice, tone and outreach style', async () => {
    const { service } = makeService({ blueprint });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text).toMatch(/plain and direct/);
    expect(text).toMatch(/warm/);
    expect(text).toMatch(/short emails/);
  });

  it('states forbidden phrases as a hard constraint', async () => {
    // The operator was invited to declare these. Rendering them as a soft
    // preference would make that invitation misleading.
    const { service } = makeService({ blueprint });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text).toMatch(/Never use these words/);
    expect(text).toMatch(/"synergy"/);
  });

  it('prefers the AI-specific tone over the brand writing tone', async () => {
    const { service } = makeService({
      blueprint: { ...blueprint, aiPreferences: { tone: 'terse' } },
    });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text).toMatch(/Tone: terse/);
  });

  it('says nothing at all when the business has declared nothing', async () => {
    // Emitting "no style configured" on every message spends tokens to say
    // nothing and trains the model to skim the section.
    const { service } = makeService({ blueprint: null, approvals: [] });
    expect(service.render(await service.express(BIZ, T0))).toBeNull();
  });

  it('survives a blueprint whose JSON columns are the wrong shape', async () => {
    const { service } = makeService({
      blueprint: { brand: 'not an object', constraints: [], aiPreferences: null },
    });
    await expect(service.express(BIZ, T0)).resolves.toBeTruthy();
  });
});

describe('observed style is inferred from behaviour, carefully', () => {
  it('reads a high approval rate as bold', async () => {
    const { service } = makeService({ approvals: decisions(20, 0.9) });
    const e = await service.express(BIZ, T0);

    expect(e.observed.riskAppetite).toBe('bold');
  });

  it('reads a low approval rate as cautious', async () => {
    const { service } = makeService({ approvals: decisions(20, 0.2) });
    const e = await service.express(BIZ, T0);

    expect(e.observed.riskAppetite).toBe('cautious');
  });

  it('refuses to infer a personality from a handful of clicks', async () => {
    const { service } = makeService({ approvals: decisions(3, 0) });
    const e = await service.express(BIZ, T0);

    expect(e.observed.riskAppetite).toBeNull();
    expect(e.observed.approvalRate).toBeNull();
  });

  it('counts approvals case-insensitively', async () => {
    // The repo writes both 'approved' and 'APPROVED' to approval tables. A case
    // mismatch here would read every business as maximally cautious.
    const { service } = makeService({ approvals: Array(10).fill('APPROVED') });
    const e = await service.express(BIZ, T0);

    expect(e.observed.riskAppetite).toBe('bold');
  });

  it('quotes the sample size, so the claim can be judged', async () => {
    const { service } = makeService({ approvals: decisions(12, 0.25) });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text).toMatch(/12 proposed actions/);
    expect(text).toMatch(/25%/);
  });
});

describe('when declaration and behaviour disagree', () => {
  it('names the mismatch instead of silently picking one', async () => {
    const { service } = makeService({
      blueprint: { constraints: { riskTolerance: 'high' } },
      approvals: decisions(20, 0.15),
    });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text).toMatch(/mismatch/i);
    expect(text).toMatch(/blueprint says "high"/);
    expect(text).toMatch(/reads cautious/);
  });

  it('says which one to trust for what', async () => {
    const { service } = makeService({
      blueprint: { constraints: { riskTolerance: 'high' } },
      approvals: decisions(20, 0.15),
    });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text).toMatch(/Trust the behaviour for how boldly/);
    expect(text).toMatch(/declaration for how they want to be spoken to/);
  });

  it('stays quiet when they agree', async () => {
    const { service } = makeService({
      blueprint: { constraints: { riskTolerance: 'cautious' } },
      approvals: decisions(20, 0.2),
    });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text).not.toMatch(/mismatch/i);
  });

  it('never rewrites the blueprint', () => {
    // Inferring "you claim bold but act cautious" and quietly editing the
    // operator's own declaration would be presumptuous and unauditable.
    const code = readFileSync(join(__dirname, 'key-cortex-epigenetics.service.ts'), 'utf8');
    expect(code).not.toMatch(/businessBlueprint\.(update|upsert|create)/);
  });
});

describe('it modulates, it does not decide', () => {
  const code = readFileSync(join(__dirname, 'key-cortex-epigenetics.service.ts'), 'utf8');

  it('tells the model this changes style, not truth', async () => {
    const { service } = makeService({ blueprint: { brand: { voice: 'direct' } } });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text).toMatch(/never changes what is true/i);
    expect(text).toMatch(/still needs approval/i);
  });

  it('has no hands', () => {
    expect(code).not.toMatch(/executeTool|toolRegistry|executeToolDirectly/);
  });

  it('only reads the two tables it needs', () => {
    const models = new Set(code.match(/this\.prisma\.client\.(\w+)/g) ?? []);
    expect(models).toEqual(
      new Set(['this.prisma.client.businessBlueprint', 'this.prisma.client.approvalRequest']),
    );
  });

  it('reads the approval model that is actually written to', () => {
    // AiApprovalRequest exists in the schema with ZERO references anywhere —
    // nothing reads or writes it. Observing it would look correct and see
    // nothing, forever.
    expect(code).toMatch(/client\.approvalRequest/);
    expect(code).not.toMatch(/client\.aiApprovalRequest/);
  });
});

describe('tenancy and bounds', () => {
  it('scopes both reads to the business and bounds the sample', async () => {
    const { seen, service } = makeService({ approvals: decisions(10, 0.5) });
    await service.express(BIZ, T0);

    expect(seen.blueprint.businessId).toBe(BIZ);
    expect(seen.approval.businessId).toBe(BIZ);
    expect(seen.approvalTake).toBeGreaterThan(0);
  });

  it('only counts decided requests', async () => {
    // A pending request is not a judgement; counting it would read a busy week
    // as caution. Escalated/delegated are excluded too — passing a decision
    // upward is not refusing it.
    const { seen, service } = makeService({ approvals: decisions(10, 0.5) });
    await service.express(BIZ, T0);

    const statuses: string[] = seen.approval.status.in;
    expect(statuses.map((s) => s.toLowerCase())).toEqual(['approved', 'rejected', 'approved', 'rejected']);
    expect(statuses.join(',')).not.toMatch(/pending|escalated|delegated/i);
  });
});

describe('the chat path is synchronous', () => {
  it('describeForPrompt does not return a Promise', () => {
    const { service } = makeService();
    // Returning one would render as "[object Promise]" in the system prompt.
    expect(service.describeForPrompt(BIZ, T0)).not.toBeInstanceOf(Promise);
  });

  it('returns null before the first derivation completes', () => {
    // Failure direction is toward KEY's default voice, which is the safe way to
    // be wrong on the first message after a restart.
    const { service } = makeService({ blueprint: { brand: { voice: 'direct' } } });
    expect(service.describeForPrompt(BIZ, T0)).toBeNull();
  });

  it('serves the cached expression once derived', async () => {
    const { service } = makeService({ blueprint: { brand: { voice: 'direct' } } });
    await service.express(BIZ, T0);

    expect(service.describeForPrompt(BIZ, T0)).toMatch(/direct/);
  });

  it('a failing derivation cannot break a chat turn', () => {
    const broken = {
      client: {
        businessBlueprint: { findUnique: () => Promise.reject(new Error('db down')) },
        approvalRequest: { findMany: () => Promise.reject(new Error('db down')) },
      },
    } as never;
    const service = new KeyCortexEpigeneticsService(broken);

    expect(() => service.describeForPrompt(BIZ, T0)).not.toThrow();
  });
});

describe('it is actually wired, not merely written', () => {
  const module = readFileSync(join(__dirname, 'key-cortex.module.ts'), 'utf8');
  const triage = readFileSync(join(__dirname, 'cognitive-triage.service.ts'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
    .join('\n');

  it('is registered in providers AND exports', () => {
    expect((module.match(/KeyCortexEpigeneticsService,/g) ?? []).length).toBe(2);
  });

  it('reaches the system prompt through standingContext', () => {
    const block = triage.slice(triage.indexOf('private standingContext('));
    const body = block.slice(0, block.indexOf('\n  private '));
    expect(body).toMatch(/this\.epigenetics\?\.describeForPrompt\(businessId\)/);
    expect(body).toMatch(/parts\.push\(style\)/);
  });

  it('did not shift the pre-existing constructor positions', () => {
    // The specs construct triage positionally, so INSERTING a parameter feeds
    // every later stub into the wrong slot. That happened once today and the
    // only symptom was peekBody never being called.
    //
    // Asserting "mine is last" would be wrong tomorrow — it broke the moment the
    // next service was appended. The durable invariant is that the three
    // parameters the specs actually pass keep their positions.
    const ctor = triage.slice(triage.indexOf('constructor('), triage.indexOf(') {}'));
    const params = [...ctor.matchAll(/private readonly (\w+)\?/g)].map((m) => m[1]);
    expect(params.slice(0, 3)).toEqual(['router', 'endocrine', 'interoception']);
  });
});

describe('operator free text cannot run away with the prompt', () => {
  it('caps a pasted document in a brand field', async () => {
    // voice/tone/doNotSay have no length limit anywhere in the stack and are
    // spliced into the system prompt of EVERY message.
    const huge = 'x'.repeat(50_000);
    const { service } = makeService({ blueprint: { brand: { voice: huge } } });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text.length).toBeLessThan(1_000);
    expect(text).toMatch(/\.\.\./);
  });

  it('caps each forbidden phrase too', async () => {
    const { service } = makeService({
      blueprint: { brand: { doNotSay: Array(50).fill('y'.repeat(5_000)) } },
    });
    const text = service.render(await service.express(BIZ, T0))!;

    expect(text.length).toBeLessThan(3_000);
  });
});
