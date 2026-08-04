/**
 * KEY Cortex — Business Epigenetics
 *
 * The genome is what a business IS. The epigenome is how that genome gets
 * EXPRESSED — and two businesses with identical structure behave nothing alike.
 * Same industry, same headcount, same revenue: one ships on Friday afternoon,
 * the other requires three sign-offs. Neither difference is in the genome.
 *
 * `BusinessGenome` stores `dnaScores`, `stage`, `readinessScore`,
 * `executiveReadiness`, `growthTrajectory`. Every field is a number, an enum or
 * a completeness score. It is a good description of what a business HAS and says
 * nothing about how it WORKS.
 *
 * ─── Where the style already lives ───────────────────────────────────────────
 *
 * Mostly it is already recorded, and simply never read on the path that matters.
 * `BusinessBlueprint` holds `brand.voice`, `brand.tone`, `brand.doNotSay`,
 * `constraints.riskTolerance` and `aiPreferences` (autonomyLevel, tone,
 * outreachStyle, reportingCadence). An operator fills these in during
 * onboarding, which creates a reasonable expectation that KEY will honour them.
 *
 * It largely does not. `riskTolerance`, `aiPreferences.*` and the output
 * templates are read only inside `modules/ai/**`; exactly one cortex path
 * surfaces brand voice at all, and the route the chat UI actually uses reads
 * none of it. So the operator's declared voice mostly does not reach the words
 * KEY says.
 *
 * ─── Declared is not the same as true ────────────────────────────────────────
 *
 * The more interesting half, and the reason this is epigenetics rather than a
 * settings reader: what a business SAYS about itself and what it DOES diverge,
 * and the behaviour is the better evidence.
 *
 * A blueprint declaring "high risk tolerance, move fast" while the owner rejects
 * four of every five proposed actions does not have a high risk tolerance. The
 * declaration is an aspiration; the rejection rate is the phenotype. Expression
 * is modulated by environment — that is the whole idea — so this service reads
 * both and lets observation temper declaration.
 *
 * ─── What it does NOT do ─────────────────────────────────────────────────────
 *
 * It never changes the blueprint. Inferring "you claim to be bold but you are
 * cautious" and silently rewriting the operator's own declaration would be
 * presumptuous and unauditable. It reports both, and says which is which.
 *
 * It also carries no authority. Risk appetite here BIASES how KEY frames a
 * recommendation; it never overrides ethics, evidence, approval requirements or
 * the role ceiling. Those remain the authorities on what is permitted.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/** How far back approval behaviour is read. One quarter of working habits. */
const OBSERVATION_DAYS = 90;

/** Below this many decisions, a rejection rate is noise rather than a habit. */
const MIN_DECISIONS_FOR_INFERENCE = 8;

/** Bound on rows read per business. Every cortex read is bounded. */
const SAMPLE_LIMIT = 200;

/** Cached expression is re-derived after this long. */
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Cap on any single free-text field taken from the blueprint.
 *
 * voice, tone, outreachStyle, reportingCadence and every doNotSay entry are
 * operator-supplied strings with no length limit anywhere in the stack, and they
 * are spliced into the system prompt of EVERY message. Without a bound, one
 * pasted document in a brand field crowds out the user's actual question on
 * every turn thereafter.
 */
const MAX_FIELD_CHARS = 160;

export type RiskAppetite = 'cautious' | 'balanced' | 'bold';

export interface Epigenome {
  /** What the operator declared in the blueprint. Null when unset. */
  declared: {
    voice: string | null;
    tone: string | null;
    doNotSay: string[];
    riskTolerance: string | null;
    outreachStyle: string | null;
    reportingCadence: string | null;
    autonomyLevel: number | null;
  };
  /** What the business's own behaviour shows. Null when there is too little. */
  observed: {
    riskAppetite: RiskAppetite | null;
    approvalRate: number | null;
    decisionsSeen: number;
  };
  computedAt: Date;
}

@Injectable()
export class KeyCortexEpigeneticsService {
  private readonly logger = new Logger(KeyCortexEpigeneticsService.name);

  /**
   * businessId → expression. Working state, so `describeForPrompt` can be
   * synchronous: it is read from `CognitiveTriageService.standingContext`, which
   * runs on the request path for every message. Same reasoning, and same
   * pattern, as the endocrine and immune services.
   */
  private readonly expression = new Map<string, Epigenome>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Derive expression from the blueprint and from behaviour.
   *
   * `now` is injectable because the observation window and the cache both depend
   * on it, and an untestable window is an unverified one.
   */
  async express(businessId: string, now: Date = new Date()): Promise<Epigenome> {
    const [declared, observed] = await Promise.all([
      this.readDeclared(businessId),
      this.readObserved(businessId, now),
    ]);

    const epigenome: Epigenome = { declared, observed, computedAt: now };
    this.expression.set(businessId, epigenome);
    return epigenome;
  }

  /**
   * The prompt section, or null when this business has expressed nothing.
   *
   * Synchronous. Hydration is kicked off but not awaited — the failure direction
   * is toward KEY's default voice, which is the safe way to be wrong on the
   * first message after a restart.
   */
  describeForPrompt(businessId: string, now: Date = new Date()): string | null {
    const cached = this.expression.get(businessId);
    const stale = !cached || now.getTime() - cached.computedAt.getTime() > CACHE_TTL_MS;

    if (stale && !this.inFlight.has(businessId)) {
      this.inFlight.add(businessId);
      void this.express(businessId, now)
        .catch((err) =>
          this.logger.warn(
            `[epigenetics] expression failed for ${businessId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        )
        .finally(() => this.inFlight.delete(businessId));
    }

    if (!cached) return null;
    return this.render(cached);
  }

  /** Rendered separately so it can be tested without touching the database. */
  render(e: Epigenome): string | null {
    const lines: string[] = [];
    const d = e.declared;

    if (d.voice) lines.push(`- Voice: ${d.voice}`);
    if (d.tone) lines.push(`- Tone: ${d.tone}`);
    if (d.outreachStyle) lines.push(`- Outreach style: ${d.outreachStyle}`);
    if (d.reportingCadence) lines.push(`- Reporting cadence: ${d.reportingCadence}`);
    if (d.riskTolerance) lines.push(`- Stated risk tolerance: ${d.riskTolerance}`);

    if (d.doNotSay.length > 0) {
      // Listed as a hard constraint rather than a preference: the operator was
      // invited to declare forbidden language, and that invitation implies it
      // will be honoured.
      lines.push(
        `- Never use these words or phrases: ${d.doNotSay.slice(0, 12).map((s) => `"${s}"`).join(', ')}`,
      );
    }

    const o = e.observed;
    if (o.riskAppetite && o.approvalRate !== null) {
      const pct = Math.round(o.approvalRate * 100);
      lines.push(
        `- Observed risk appetite: ${o.riskAppetite} — this business approved ${pct}% of ` +
          `${o.decisionsSeen} proposed actions in the last ${OBSERVATION_DAYS} days.`,
      );

      // Naming the disagreement is the point. Silently overriding the operator's
      // own declaration with an inference would be unauditable.
      const declaredAppetite = this.normaliseDeclared(d.riskTolerance);
      if (declaredAppetite && declaredAppetite !== o.riskAppetite) {
        lines.push(
          `- Note the mismatch: the blueprint says "${d.riskTolerance}" but the approval record ` +
            `reads ${o.riskAppetite}. Trust the behaviour for how boldly to pitch a recommendation, ` +
            `and the declaration for how they want to be spoken to.`,
        );
      }
    }

    if (lines.length === 0) return null;

    return [
      'HOW THIS BUSINESS WORKS — its own declared style, and what its behaviour shows:',
      ...lines,
      'This shapes HOW you say things and how boldly you recommend. It never changes what is true,',
      'what the evidence supports, or what still needs approval.',
    ].join('\n');
  }

  /** Blueprint-declared style. Absent blueprint is normal, not an error. */
  private async readDeclared(businessId: string): Promise<Epigenome['declared']> {
    const empty: Epigenome['declared'] = {
      voice: null, tone: null, doNotSay: [], riskTolerance: null,
      outreachStyle: null, reportingCadence: null, autonomyLevel: null,
    };

    const row = await this.prisma.client.businessBlueprint
      .findUnique({
        where: { businessId },
        select: { brand: true, constraints: true, aiPreferences: true },
      })
      .catch(() => null);

    if (!row) return empty;

    const brand = this.obj((row as any).brand);
    const constraints = this.obj((row as any).constraints);
    const prefs = this.obj((row as any).aiPreferences);

    return {
      voice: this.str(brand.voice),
      // aiPreferences.tone is the more specific instruction to KEY; brand.tone
      // describes the business's own writing. Prefer the former when both exist.
      tone: this.str(prefs.tone) ?? this.str(brand.tone),
      doNotSay: this.strArray(brand.doNotSay),
      riskTolerance: this.str(constraints.riskTolerance),
      outreachStyle: this.str(prefs.outreachStyle),
      reportingCadence: this.str(prefs.reportingCadence),
      autonomyLevel: Number.isFinite(prefs.autonomyLevel) ? Number(prefs.autonomyLevel) : null,
    };
  }

  /** Risk appetite as revealed by what the business actually approves. */
  private async readObserved(businessId: string, now: Date): Promise<Epigenome['observed']> {
    const since = new Date(now.getTime() - OBSERVATION_DAYS * 24 * 60 * 60 * 1000);

    // ApprovalRequest, not AiApprovalRequest. The latter model exists in the
    // schema and has ZERO references anywhere in the codebase — nothing reads or
    // writes it — so observing it would have made this service permanently
    // blind while looking entirely correct.
    //
    // Statuses are declared lowercase here ("pending | approved | rejected |
    // escalated | delegated") but the repo writes both cases to various approval
    // tables, and a case mismatch is the same silent blindness. Both are matched
    // rather than assuming.
    const rows = await this.prisma.client.approvalRequest
      .findMany({
        where: {
          businessId,
          createdAt: { gte: since },
          // Only decided requests. A pending one is not a judgement, and
          // counting it would read a busy week as caution. 'escalated' and
          // 'delegated' are deliberately excluded too: passing a decision
          // upward is not the same as refusing it.
          status: { in: ['approved', 'rejected', 'APPROVED', 'REJECTED'] },
        },
        select: { status: true },
        take: SAMPLE_LIMIT,
      })
      .catch(() => [] as any[]);

    const decisionsSeen = rows.length;
    if (decisionsSeen < MIN_DECISIONS_FOR_INFERENCE) {
      // Say nothing rather than infer a personality from three clicks.
      return { riskAppetite: null, approvalRate: null, decisionsSeen };
    }

    const approved = rows.filter(
      (r: any) => String(r.status).toLowerCase() === 'approved',
    ).length;
    const approvalRate = approved / decisionsSeen;

    return {
      riskAppetite: approvalRate >= 0.8 ? 'bold' : approvalRate >= 0.5 ? 'balanced' : 'cautious',
      approvalRate,
      decisionsSeen,
    };
  }

  /** Free-text risk tolerance onto the same scale, for comparison only. */
  private normaliseDeclared(value: string | null): RiskAppetite | null {
    if (!value) return null;
    const v = value.toLowerCase();
    if (/\b(high|bold|aggressive|fast)\b/.test(v)) return 'bold';
    if (/\b(low|cautious|conservative|careful|averse)\b/.test(v)) return 'cautious';
    if (/\b(medium|moderate|balanced)\b/.test(v)) return 'balanced';
    return null;
  }

  private obj(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  }

  private str(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Bounded here rather than at render time, so every consumer of Epigenome
    // inherits the limit instead of each having to remember it.
    return trimmed.length > MAX_FIELD_CHARS
      ? `${trimmed.slice(0, MAX_FIELD_CHARS)}...`
      : trimmed;
  }

  private strArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => (v.trim().length > MAX_FIELD_CHARS ? `${v.trim().slice(0, MAX_FIELD_CHARS)}...` : v.trim()));
  }
}
