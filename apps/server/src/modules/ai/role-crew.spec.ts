/**
 * One turn, more than one hat.
 *
 * THE SENTENCE THIS EXISTS FOR:
 *
 *     "The client cancelled — refund them and release their booking slot."
 *
 * One ordinary instruction, two departments, and until now structurally
 * impossible. Scored, it comes out operations 6, support 2, finance 2, so
 * `operations` wins the argmax — and `operations` has `bookings_*` and no
 * `payments_*`. Send the user to /app/inbox instead so `support` wins and you
 * get a role whose blockedTools contains `bookings_cancel_booking` and which
 * has no refund tool either. Neither hat can finish the sentence. That is what
 * the audit meant by "structurally impossible": not a missing tool, a missing
 * hat.
 *
 * The tests below are ordered as the argument runs: prove the old behaviour is
 * unchanged, prove the crew is assembled conservatively, prove it cannot be
 * used to escalate, and only then prove the sentence executes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RoleEngineService, type BusinessRole } from './role-engine.service';

/** The engine's scorer needs no I/O; these three deps are never touched by it. */
function engine(): RoleEngineService {
  return new RoleEngineService({} as never, {} as never, {} as never);
}

const THE_SENTENCE = 'The client cancelled — refund them and release their booking slot.';

describe('crew resolution', () => {
  let re: RoleEngineService;
  beforeEach(() => {
    re = engine();
  });

  // ── The refactor changed nothing about the old answer ─────────────────────
  it('detectRoleFromContext returns exactly what the argmax of the scores is', async () => {
    // scoreRoles + argmax were lifted verbatim out of detectRoleFromContext.
    // If that extraction had altered a weight, a seed or the tie order, this is
    // where it would show — the primary is computed by the same two functions
    // the public method now composes.
    for (const msg of [
      THE_SENTENCE,
      'send the invoice to Priya',
      'book me for Tuesday',
      'what is our pipeline looking like',
      'the newsletter needs to go out',
      'hello',
    ]) {
      const detected = await re.detectRoleFromContext({ message: msg });
      const { primary } = await re.resolveCrew({ message: msg });
      expect(primary, `primary must equal detectRoleFromContext for: ${msg}`).toBe(detected);
    }
  });

  it('a general turn is a crew of one, which is exactly the behaviour today', async () => {
    const { primary, crew } = await re.resolveCrew({ message: 'hello' });
    expect(primary).toBe('general');
    expect(crew).toEqual(['general']);
  });

  // ── Assembly is conservative ──────────────────────────────────────────────
  it('never staffs more than three hats', async () => {
    const { crew } = await re.resolveCrew({
      message: 'refund the invoice, cancel the booking, email the campaign, close the deal, fix the ticket',
    });
    expect(crew.length).toBeLessThanOrEqual(3);
  });

  it('a role that scored nothing never joins', async () => {
    const { crew, scores } = await re.resolveCrew({ message: 'send the invoice to Priya' });
    for (const r of crew) {
      if (r === crew[0]) continue;
      expect(scores[r], `${r} joined the crew on a score below the floor`).toBeGreaterThanOrEqual(2);
    }
  });

  it('general is a fallback, never a colleague', async () => {
    // general.maxRiskTier is 1, so as a member it would clamp every multi-role
    // turn to tier 1 — the ceiling is a MIN over grantors. And its allowlist is
    // broad enough that its presence would make the crew mean nothing.
    const { crew } = await re.resolveCrew({ message: THE_SENTENCE });
    expect(crew.length).toBeGreaterThan(1);
    expect(crew.slice(1)).not.toContain('general');
  });

  // ── The clause that stops "do it" recruiting the operator ─────────────────
  it('no crew member may out-rank the primary', async () => {
    // ROLE_SWITCH_KEYWORDS.operator matches "do it" — a phrase in half of all
    // real messages — and operator's allowlist includes execute_custom_logic.
    // Without clause (C) this sentence recruits the most powerful role in the
    // product as a side effect of ordinary phrasing.
    const { primary, crew } = await re.resolveCrew({
      message: 'refund them and release the slot, do it',
    });
    const ceiling = re.getRoleDefinition(primary).maxRiskTier;
    for (const r of crew) {
      expect(
        re.getRoleDefinition(r).maxRiskTier,
        `${r} out-ranks the primary ${primary}`,
      ).toBeLessThanOrEqual(ceiling);
    }
  });

  it('is deterministic — the same request resolves the same crew twice', async () => {
    const a = await re.resolveCrew({ message: THE_SENTENCE, route: '/app/bookings' });
    const b = await re.resolveCrew({ message: THE_SENTENCE, route: '/app/bookings' });
    expect(a.crew).toEqual(b.crew);
    // Two replicas that disagreed here would staff different crews for one
    // request, which is why ROLE_ORDER is a frozen literal and not Object.keys.
  });
});

describe('crew authority', () => {
  let re: RoleEngineService;
  beforeEach(() => {
    re = engine();
  });

  it('the crew allows a tool iff some member allows it on its own terms', () => {
    const crew: BusinessRole[] = ['operations', 'finance'];
    expect(re.crewAllows(crew, 'payments_refund_charge')).toBe(true);
    expect(re.grantorsOf(crew, 'payments_refund_charge')).toEqual(['finance']);
    expect(re.crewAllows(crew, 'bookings_cancel_booking')).toBe(true);
    expect(re.grantorsOf(crew, 'bookings_cancel_booking')).toEqual(['operations']);
  });

  it('the block of one member does not veto the grant of another', () => {
    // general.blockedTools contains bookings_cancel_booking. That is a
    // statement about general's OWN authority, not a business-wide
    // prohibition — a union-veto would make a crew strictly weaker than its
    // weakest member, and would kill the worked example below.
    expect(re.isToolAllowed('general', 'bookings_cancel_booking')).toBe(false);
    expect(re.isToolAllowed('operations', 'bookings_cancel_booking')).toBe(true);
    expect(re.crewAllows(['general', 'operations'], 'bookings_cancel_booking')).toBe(true);
  });

  it('a crew still cannot reach a tool no member grants', () => {
    const crew: BusinessRole[] = ['marketing', 'support'];
    expect(re.crewAllows(crew, 'payments_refund_charge')).toBe(false);
    expect(re.grantorsOf(crew, 'payments_refund_charge')).toEqual([]);
    // Scope is added by membership, never invented by it.
  });

  it('grantorsOf returns members in crew order, so the primary is named first', () => {
    const both = re.grantorsOf(['finance', 'operations', 'support'], 'fetch_contact');
    expect(both[0]).toBe('finance');
  });
});

describe('the sentence', () => {
  it('"refund them and release their booking slot" reaches BOTH tools in one turn', async () => {
    const re = engine();
    const { primary, crew, scores } = await re.resolveCrew({ message: THE_SENTENCE });

    // The old behaviour, preserved and now demonstrably insufficient on its own.
    expect(primary).toBe('operations');
    expect(re.isToolAllowed('operations', 'payments_refund_charge')).toBe(false);

    // Both departments are recruited by their own switch keywords: "refund"
    // scores finance and support, "slot" scores operations.
    expect(scores.finance).toBeGreaterThanOrEqual(2);
    expect(crew).toContain('finance');

    // And the sentence completes.
    expect(re.crewAllows(crew, 'payments_refund_charge')).toBe(true);
    expect(re.crewAllows(crew, 'bookings_cancel_booking')).toBe(true);
    expect(re.grantorsOf(crew, 'payments_refund_charge')).toContain('finance');
    expect(re.grantorsOf(crew, 'bookings_cancel_booking')).toContain('operations');
  });

  it('and the single-hat turn it replaces could not — either way round', async () => {
    const re = engine();
    // This is the negative control for the test above, written as a test rather
    // than as a comment: it pins the defect, so if someone ever widens
    // operations to include payments_* the pair stops proving anything and this
    // goes red to say so.
    expect(re.crewAllows(['operations'], 'payments_refund_charge')).toBe(false);
    expect(re.crewAllows(['support'], 'payments_refund_charge')).toBe(false);
    expect(re.crewAllows(['support'], 'bookings_cancel_booking')).toBe(false);
    expect(re.crewAllows(['finance'], 'bookings_cancel_booking')).toBe(false);
  });
});
