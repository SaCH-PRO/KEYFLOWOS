import { Injectable, Logger } from '@nestjs/common';
import { CAPABILITY_MAP_SEED } from './capability-map.seed';
import type {
  CapabilityDomain,
  CapabilityMode,
  CapabilityModel,
  CapabilityModelSummary,
  CapabilityTarget,
  CoverageMatch,
  CoverageResult,
} from './capability-map.types';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'our', 'your', 'their',
  'have', 'will', 'want', 'need', 'make', 'get', 'set', 'new', 'all', 'any', 'more',
  'business', 'customer', 'customers', 'help', 'using', 'use', 'via', 'per', 'across',
]);

/**
 * CapabilityModelService — the M0 loader for the KEY capability model.
 *
 * Loads the derived, governance-annotated capability map (generated from the flow
 * tool registry + cortex capability registry) and exposes it to the rest of the AI
 * module. This is the seam every future skill/agent registers against: a capability
 * has a `mode` (its governance contract) and a `status` (active vs planned), so the
 * system can report what it can actually do — and, crucially, what it must NOT
 * auto-execute (human-gated).
 *
 * `getCoverage()` is a deliberately-honest v0: keyword overlap, no fabricated
 * "you can do X%" number. The M2 capability resolver replaces the retrieval with
 * embeddings + LLM reranking.
 */
@Injectable()
export class CapabilityModelService {
  private readonly logger = new Logger(CapabilityModelService.name);
  private readonly model: CapabilityModel = CAPABILITY_MAP_SEED;

  /** The full capability model. */
  getModel(): CapabilityModel {
    return this.model;
  }

  getSummary(): CapabilityModelSummary {
    return this.model.summary;
  }

  /** Lightweight domain list (no per-domain tool/capability arrays). */
  listDomains(): Array<Pick<CapabilityDomain, 'id' | 'label' | 'toolCount' | 'capCount' | 'targetsActive' | 'targetsPlanned' | 'targetsTotal'>> {
    return this.model.domains.map((d) => ({
      id: d.id,
      label: d.label,
      toolCount: d.toolCount,
      capCount: d.capCount,
      targetsActive: d.targetsActive,
      targetsPlanned: d.targetsPlanned,
      targetsTotal: d.targetsTotal,
    }));
  }

  getDomain(id: string): CapabilityDomain | undefined {
    return this.model.domains.find((d) => d.id === id);
  }

  /** Every planned (declared-but-not-built) capability — the build backlog. */
  listPlanned(): Array<CapabilityTarget & { domainId: string; domainLabel: string }> {
    return this.model.domains.flatMap((d) =>
      d.targets
        .filter((t) => t.status === 'planned')
        .map((t) => ({ ...t, domainId: d.id, domainLabel: d.label })),
    );
  }

  /**
   * The governance contract for a capability: the mode it runs in, and whether it
   * is allowed to execute autonomously. Human-gated capabilities never are.
   */
  isAutonomyAllowed(mode: CapabilityMode): boolean {
    return mode === 'agentic';
  }

  /**
   * Heuristic coverage answer for a free-text goal. v0 = keyword overlap only.
   * Returns the tools/capabilities/targets that match, the domains touched, the
   * mode mix, and any planned (not-yet-built) capabilities that are likely blockers.
   */
  getCoverage(goal: string): CoverageResult {
    const tokens = this.tokenize(goal);
    const matched: CoverageMatch[] = [];

    for (const d of this.model.domains) {
      for (const t of d.tools) {
        const score = this.score(tokens, `${t.name} ${t.description}`);
        if (score > 0) matched.push({ domainId: d.id, domainLabel: d.label, kind: 'tool', name: t.name, mode: t.mode, score });
      }
      for (const c of d.capabilities) {
        const score = this.score(tokens, `${c.name} ${c.description}`);
        if (score > 0) matched.push({ domainId: d.id, domainLabel: d.label, kind: 'capability', name: c.name, mode: c.mode, score });
      }
      for (const tg of d.targets) {
        const score = this.score(tokens, `${tg.label} ${tg.why}`);
        if (score > 0) matched.push({ domainId: d.id, domainLabel: d.label, kind: 'target', name: tg.label, mode: tg.mode, status: tg.status, score });
      }
    }

    matched.sort((a, b) => b.score - a.score);
    const top = matched.slice(0, 25);

    const domainScores = new Map<string, { domainId: string; domainLabel: string; matches: number }>();
    for (const m of matched) {
      const cur = domainScores.get(m.domainId) ?? { domainId: m.domainId, domainLabel: m.domainLabel, matches: 0 };
      cur.matches += 1;
      domainScores.set(m.domainId, cur);
    }
    const domainsTouched = [...domainScores.values()].sort((a, b) => b.matches - a.matches);

    const modeMix: Partial<Record<CapabilityMode, number>> = {};
    for (const m of top) modeMix[m.mode] = (modeMix[m.mode] ?? 0) + 1;

    const touchedIds = new Set(domainsTouched.map((d) => d.domainId));
    const relevantPlanned = matched
      .filter((m) => m.kind === 'target' && m.status === 'planned')
      .map((m) => ({ domainLabel: m.domainLabel, capability: m.name, mode: m.mode }));
    // also surface planned targets in the single most-relevant domain even if the
    // goal didn't name them — they're likely blockers for that domain's work.
    if (relevantPlanned.length === 0 && domainsTouched.length > 0) {
      const topDomain = this.getDomain(domainsTouched[0].domainId);
      if (topDomain) {
        for (const tg of topDomain.targets.filter((t) => t.status === 'planned')) {
          relevantPlanned.push({ domainLabel: topDomain.label, capability: tg.label, mode: tg.mode });
        }
      }
    }
    void touchedIds;

    return {
      goal,
      method: 'keyword-overlap-v0',
      matchCount: matched.length,
      matched: top,
      domainsTouched,
      modeMix,
      relevantPlanned,
      note:
        'Heuristic keyword overlap (v0). No single coverage percentage is reported — ' +
        'that requires decomposing the goal into required capabilities, which is the ' +
        'M2 capability resolver (embedding retrieval + LLM reranking). Treat planned ' +
        'items as likely blockers, and human-gated matches as non-autonomous by rule.',
    };
  }

  private tokenize(goal: string): string[] {
    return (goal.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  }

  private score(tokens: string[], text: string): number {
    const hay = text.toLowerCase();
    let s = 0;
    for (const tok of tokens) if (hay.includes(tok)) s += 1;
    return s;
  }
}
