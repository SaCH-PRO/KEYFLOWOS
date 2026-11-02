/**
 * V1-53b-QUOTE-RESIDUALS: KEY ai-execute finds a quote by its number exactly.
 *
 * Before this packet, executeCommand resolved the quote for convert_quote and
 * send_quote with `quoteNumber: { contains: String(quoteNumber) }` and took
 * the first match: "Q-1" matched Q-10 and Q-11 as well as Q-1, so the command
 * moved whichever row the database returned first; an absent "Q-2" moved Q-20.
 *
 * Contract pinned here:
 *   - the number is matched exactly within the business (not deleted); a
 *     case-insensitive equality is the most the lookup allows, and only when
 *     no row has the exact spelling;
 *   - LIKE wildcards in the number (`%`, `_`, `\`) are literal characters
 *     (Prisma sends an insensitive `equals` to Postgres as ILIKE with the
 *     value unescaped, so they would otherwise match other quotes);
 *   - an absent number answers a not-found error and an ambiguous one (two
 *     rows equal ignoring case, neither spelled as asked) an ambiguous error;
 *     neither moves any quote.
 *
 * The Prisma client is an in-memory stand-in that applies the where clause the
 * way Postgres does (an insensitive `equals` is an ILIKE, `contains` a
 * case-sensitive LIKE '%v%'), and refuses any filter it does not model, so a
 * lookup cannot pass here by using an operator the stand-in ignores.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CommerceAiService } from './commerce-ai.service';

const BIZ = 'biz_v53b';
const OTHER = 'biz_v53b_other';
const ACTOR = 'user_v53b';

type Row = { id: string; businessId: string; quoteNumber: string; deletedAt: Date | null };

const ROWS: Row[] = [
  // Q-10 and Q-11 come first, as an unordered findFirst may return them.
  { id: 'q_10', businessId: BIZ, quoteNumber: 'Q-10', deletedAt: null },
  { id: 'q_11', businessId: BIZ, quoteNumber: 'Q-11', deletedAt: null },
  { id: 'q_1', businessId: BIZ, quoteNumber: 'Q-1', deletedAt: null },
  { id: 'q_20', businessId: BIZ, quoteNumber: 'Q-20', deletedAt: null },
  { id: 'q_2_deleted', businessId: BIZ, quoteNumber: 'Q-2', deletedAt: new Date('2026-10-01T00:00:00Z') },
  { id: 'q_2_other', businessId: OTHER, quoteNumber: 'Q-2', deletedAt: null },
  { id: 'q_1_other', businessId: OTHER, quoteNumber: 'Q-1', deletedAt: null },
  // Two spellings of one number ((businessId, quoteNumber) is unique case-sensitively).
  { id: 'qt_a_upper', businessId: BIZ, quoteNumber: 'QT-A', deletedAt: null },
  { id: 'qt_a_lower', businessId: BIZ, quoteNumber: 'qt-a', deletedAt: null },
  // Rows a LIKE wildcard would reach.
  { id: 'q_x1', businessId: BIZ, quoteNumber: 'QX1', deletedAt: null },
  { id: 'q_us1', businessId: BIZ, quoteNumber: 'Q_1', deletedAt: null },
];

/** Postgres LIKE/ILIKE: `%` any run, `_` one character, `\` escapes the next character. */
function likeToRegExp(pattern: string, insensitive: boolean): RegExp {
  let src = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\' && i + 1 < pattern.length) {
      src += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (ch === '%') src += '[\\s\\S]*';
    else if (ch === '_') src += '[\\s\\S]';
    else src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${src}$`, insensitive ? 'i' : '');
}

function matchesString(value: string, filter: unknown): boolean {
  if (typeof filter === 'string') return value === filter;
  if (filter && typeof filter === 'object') {
    const f = filter as Record<string, unknown>;
    const keys = Object.keys(f).filter((k) => k !== 'mode');
    const insensitive = f.mode === 'insensitive';
    if (f.mode !== undefined && f.mode !== 'insensitive' && f.mode !== 'default') throw new Error(`unmodelled mode ${String(f.mode)}`);
    if (keys.length === 1 && keys[0] === 'equals' && typeof f.equals === 'string') {
      // Prisma sends an insensitive equals to Postgres as ILIKE with the value as is.
      return insensitive ? likeToRegExp(f.equals, true).test(value) : value === f.equals;
    }
    if (keys.length === 1 && keys[0] === 'contains' && typeof f.contains === 'string') {
      return insensitive ? value.toLowerCase().includes(f.contains.toLowerCase()) : value.includes(f.contains);
    }
  }
  throw new Error(`unmodelled string filter ${JSON.stringify(filter)}`);
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'businessId' || key === 'id') {
      if (typeof cond !== 'string') throw new Error(`unmodelled ${key} filter ${JSON.stringify(cond)}`);
      if (row[key] !== cond) return false;
    } else if (key === 'deletedAt') {
      if (cond !== null) throw new Error(`unmodelled deletedAt filter ${JSON.stringify(cond)}`);
      if (row.deletedAt !== null) return false;
    } else if (key === 'quoteNumber') {
      if (!matchesString(row.quoteNumber, cond)) return false;
    } else {
      throw new Error(`unmodelled where key ${key}`);
    }
  }
  return true;
}

function project(row: Row, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [k, on] of Object.entries(select)) if (on) out[k] = row[k as keyof Row];
  return out;
}

function makeService() {
  const quote = {
    findFirst: vi.fn(async (args: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const hit = ROWS.find((r) => matches(r, args.where));
      return hit ? project(hit, args.select) : null;
    }),
    findMany: vi.fn(async (args: { where: Record<string, unknown>; select?: Record<string, boolean>; take?: number }) => {
      const hits = ROWS.filter((r) => matches(r, args.where)).map((r) => project(r, args.select));
      return typeof args.take === 'number' ? hits.slice(0, args.take) : hits;
    }),
    findUnique: vi.fn(async () => {
      throw new Error('findUnique is not modelled here');
    }),
    update: vi.fn(async () => {
      throw new Error('the quote actions move a quote through CommerceService.updateQuoteStatus, never a direct write');
    }),
  };
  const prisma = { client: { quote } };
  const commerce = { updateQuoteStatus: vi.fn(async (input: { quoteId: string; status: string }) => ({ id: input.quoteId, status: input.status })) };
  const stats = { invalidateCache: vi.fn() };
  const service = new CommerceAiService(
    prisma as never,
    {} as never,
    stats as never,
    {} as never,
    commerce as never,
  );
  return { service, commerce, quote };
}

let ctx: ReturnType<typeof makeService>;
beforeEach(() => {
  ctx = makeService();
});

function movedIds() {
  return ctx.commerce.updateQuoteStatus.mock.calls.map((c) => (c[0] as { quoteId: string }).quoteId);
}

describe('V1-53b ai-execute: a quote number resolves exactly within the business', () => {
  it('convert_quote "Q-1" accepts Q-1, not Q-10 or Q-11', async () => {
    const res = await ctx.service.executeCommand(BIZ, 'convert_quote', { quoteNumber: 'Q-1' }, ACTOR);
    expect(res).toMatchObject({ success: true, quoteId: 'q_1' });
    expect(ctx.commerce.updateQuoteStatus).toHaveBeenCalledTimes(1);
    expect(ctx.commerce.updateQuoteStatus).toHaveBeenCalledWith({ quoteId: 'q_1', status: 'ACCEPTED', actorId: ACTOR, businessId: BIZ });
  });

  it('send_quote "Q-1" sends Q-1, not Q-10 or Q-11', async () => {
    const res = await ctx.service.executeCommand(BIZ, 'send_quote', { quoteNumber: 'Q-1' }, ACTOR);
    expect(res).toMatchObject({ success: true, quoteId: 'q_1' });
    expect(ctx.commerce.updateQuoteStatus).toHaveBeenCalledTimes(1);
    expect(ctx.commerce.updateQuoteStatus).toHaveBeenCalledWith({ quoteId: 'q_1', status: 'SENT', actorId: ACTOR, businessId: BIZ });
  });

  it('a number differing only in case resolves to the one quote spelled that way ignoring case', async () => {
    const res = await ctx.service.executeCommand(BIZ, 'convert_quote', { quoteNumber: 'q-1' }, ACTOR);
    expect(res).toMatchObject({ success: true, quoteId: 'q_1' });
    expect(movedIds()).toEqual(['q_1']);
  });

  it('surrounding whitespace is not part of the number', async () => {
    const res = await ctx.service.executeCommand(BIZ, 'send_quote', { quoteNumber: '  Q-1 ' }, ACTOR);
    expect(res).toMatchObject({ success: true, quoteId: 'q_1' });
    expect(movedIds()).toEqual(['q_1']);
  });

  it('an absent number is not found and moves nothing (Q-2: only Q-20 here, a deleted Q-2, and another tenant\'s Q-2)', async () => {
    for (const action of ['convert_quote', 'send_quote']) {
      const res = await ctx.service.executeCommand(BIZ, action, { quoteNumber: 'Q-2' }, ACTOR);
      expect(res).toMatchObject({ success: false, code: 'quote_not_found' });
      expect(String((res as { error?: string }).error)).toMatch(/not found/i);
    }
    expect(ctx.commerce.updateQuoteStatus).not.toHaveBeenCalled();
    expect(ctx.quote.update).not.toHaveBeenCalled();
  });

  it('a prefix of several numbers is not found and moves nothing ("Q-" matches no quote exactly)', async () => {
    const res = await ctx.service.executeCommand(BIZ, 'convert_quote', { quoteNumber: 'Q-' }, ACTOR);
    expect(res).toMatchObject({ success: false, code: 'quote_not_found' });
    expect(ctx.commerce.updateQuoteStatus).not.toHaveBeenCalled();
  });

  it('LIKE wildcards are literal: "Q-1%" and "q-1_" match no quote, "q_1" matches only Q_1 (not QX1)', async () => {
    for (const quoteNumber of ['Q-1%', 'q-1_', 'Q%', '%', '_']) {
      const res = await ctx.service.executeCommand(BIZ, 'convert_quote', { quoteNumber }, ACTOR);
      expect(res, quoteNumber).toMatchObject({ success: false, code: 'quote_not_found' });
    }
    expect(ctx.commerce.updateQuoteStatus).not.toHaveBeenCalled();

    const res = await ctx.service.executeCommand(BIZ, 'send_quote', { quoteNumber: 'q_1' }, ACTOR);
    expect(res).toMatchObject({ success: true, quoteId: 'q_us1' });
    expect(movedIds()).toEqual(['q_us1']);
  });

  it('two quotes equal ignoring case, neither spelled as asked, is ambiguous and moves nothing', async () => {
    for (const action of ['convert_quote', 'send_quote']) {
      const res = await ctx.service.executeCommand(BIZ, action, { quoteNumber: 'Qt-A' }, ACTOR);
      expect(res).toMatchObject({ success: false, code: 'quote_ambiguous' });
      const error = String((res as { error?: string }).error);
      expect(error).toMatch(/ambiguous|more than one/i);
      expect(error).toContain('QT-A');
      expect(error).toContain('qt-a');
    }
    expect(ctx.commerce.updateQuoteStatus).not.toHaveBeenCalled();
  });

  it('the exact spelling wins over a case variant', async () => {
    const upper = await ctx.service.executeCommand(BIZ, 'send_quote', { quoteNumber: 'QT-A' }, ACTOR);
    expect(upper).toMatchObject({ success: true, quoteId: 'qt_a_upper' });
    const lower = await ctx.service.executeCommand(BIZ, 'send_quote', { quoteNumber: 'qt-a' }, ACTOR);
    expect(lower).toMatchObject({ success: true, quoteId: 'qt_a_lower' });
    expect(movedIds()).toEqual(['qt_a_upper', 'qt_a_lower']);
  });

  it('another tenant\'s quote is never reached, and every read is bound to the business and live rows', async () => {
    await ctx.service.executeCommand(BIZ, 'convert_quote', { quoteNumber: 'Q-1' }, ACTOR);
    await ctx.service.executeCommand(BIZ, 'send_quote', { quoteNumber: 'Qt-A' }, ACTOR);
    expect(movedIds()).toEqual(['q_1']);
    const reads = [...ctx.quote.findFirst.mock.calls, ...ctx.quote.findMany.mock.calls].map((c) => c[0] as { where: Record<string, unknown> });
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.where.businessId).toBe(BIZ);
      expect(read.where.deletedAt).toBeNull();
    }
  });

  it('a missing or blank number is refused before any read', async () => {
    for (const params of [{}, { quoteNumber: '' }, { quoteNumber: '   ' }]) {
      const res = await ctx.service.executeCommand(BIZ, 'convert_quote', params, ACTOR);
      expect(res).toMatchObject({ success: false, error: 'Quote number is required' });
    }
    expect(ctx.quote.findFirst).not.toHaveBeenCalled();
    expect(ctx.quote.findMany).not.toHaveBeenCalled();
    expect(ctx.commerce.updateQuoteStatus).not.toHaveBeenCalled();
  });
});
