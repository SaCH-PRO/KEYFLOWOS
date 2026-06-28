import { Injectable, Optional, Inject } from '@nestjs/common';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import {
  CortexPersona,
  CortexContextSnapshot,
} from './key-cortex.types';
import {
  GenomeEnrichedContext,
  GenomeRecommendation,
} from './key-cortex-reasoning.types';

/**
 * KeyCortexSystemPromptService
 *
 * Builds v2/v3 system prompts and enriches context snapshots with module and
 * genome data.
 */
@Injectable()
export class KeyCortexSystemPromptService {
  constructor(
    private readonly personalityService: KeyCortexPersonalityService,
    @Optional()
    @Inject(KeyCortexConnectorService)
    private readonly connectorService?: KeyCortexConnectorService,
  ) {}

  /**
   * Build a genome-aware system prompt.
   */
  buildV3SystemPrompt(
    persona: CortexPersona,
    context: CortexContextSnapshot,
    v2Context: Record<string, unknown> | undefined,
    genomeContext: GenomeEnrichedContext,
    rankedRecommendations: GenomeRecommendation[],
    hasParsedCommands?: boolean,
  ): string {
    const basePrompt = this.buildV2SystemPrompt(
      persona,
      context,
      v2Context,
      hasParsedCommands,
    );

    const genomeBlock = this.buildGenomeContextBlock(
      genomeContext,
      rankedRecommendations,
    );

    const behavioralGuidance = this.buildGenomeBehavioralGuidance(
      genomeContext.dnaScores,
    );

    const parts = [basePrompt, genomeBlock, behavioralGuidance].filter(Boolean);

    return parts.join('\n\n');
  }

  /**
   * Build an enhanced v2 system prompt.
   */
  buildV2SystemPrompt(
    persona: CortexPersona,
    context: CortexContextSnapshot,
    v2Context?: Record<string, unknown>,
    hasParsedCommands?: boolean,
  ): string {
    const basePrompt = this.personalityService.buildSystemPrompt(
      persona,
      context,
    );

    const roleExpertise = this.personalityService.getRoleSystemPrompt(persona);

    let capabilitiesBlock = '';
    if (this.connectorService) {
      try {
        capabilitiesBlock =
          (this.connectorService as any).formatCapabilitiesForPrompt();
      } catch {
        capabilitiesBlock = '';
      }
    }

    let v2ContextBlock = '';
    if (v2Context && Object.keys(v2Context).length > 0) {
      const summaries: string[] = [];
      for (const [mod, ctx] of Object.entries(v2Context)) {
        if (ctx && typeof ctx === 'object') {
          const summary = this.summarizeModuleContext(mod, ctx as any);
          if (summary) summaries.push(summary);
        }
      }
      if (summaries.length > 0) {
        v2ContextBlock = `=== MODULE SNAPSHOTS ===\n${summaries.join('\n')}\n========================`;
      }
    }

    const commandHint = hasParsedCommands
      ? '\nI have detected actionable commands in your message and will execute them after confirming with you.'
      : '';

    const parts = [
      basePrompt,
      roleExpertise,
      capabilitiesBlock,
      v2ContextBlock,
      commandHint,
    ].filter(Boolean);

    return parts.join('\n\n');
  }

  /**
   * Build the genome context block for the system prompt.
   */
  buildGenomeContextBlock(
    genomeContext: GenomeEnrichedContext,
    rankedRecommendations: GenomeRecommendation[],
  ): string {
    const lines: string[] = ['=== GENOME INTELLIGENCE ==='];

    lines.push('DNA Scores:');
    for (const [key, score] of Object.entries(genomeContext.dnaScores)) {
      const bar =
        '█'.repeat(Math.round(score / 10)) +
        '░'.repeat(10 - Math.round(score / 10));
      lines.push(`  ${key}: ${bar} ${score}%`);
    }

    lines.push(`Genome Stage: ${genomeContext.genomeStage}`);
    lines.push(`Executive Readiness: ${genomeContext.executiveReadiness}%`);

    const urgentSignals = genomeContext.signals.filter(
      (s: any) => s.severity === 'critical' || s.severity === 'high',
    );
    if (urgentSignals.length > 0) {
      lines.push(`\n🚨 URGENT SIGNALS (${urgentSignals.length}):`);
      for (const signal of urgentSignals) {
        lines.push(
          `  [${signal.severity.toUpperCase()}] ${signal.module}: ${signal.message}`,
        );
      }
    }

    const top5 = rankedRecommendations.slice(0, 5);
    if (top5.length > 0) {
      lines.push(`\n📋 TOP RECOMMENDATIONS:`);
      for (const rec of top5) {
        lines.push(
          `  ${rec.impact === 'high' ? '🔥' : rec.impact === 'medium' ? '⚡' : '•'} [${rec.impact.toUpperCase()}] ${rec.title} (${rec.category}, ${Math.round(rec.confidence * 100)}% confidence)`,
        );
      }
    }

    if (genomeContext.opportunities.length > 0) {
      const topOpps = genomeContext.opportunities
        .sort((a: any, b: any) => b.estimatedValue - a.estimatedValue)
        .slice(0, 3);
      lines.push(`\n💰 TOP OPPORTUNITIES:`);
      for (const opp of topOpps) {
        lines.push(
          `  ${opp.title}: $${opp.estimatedValue.toLocaleString()} (${opp.category})`,
        );
      }
    }

    lines.push('=========================');

    return lines.join('\n');
  }

  /**
   * Build behavioral guidance based on DNA scores.
   */
  buildGenomeBehavioralGuidance(
    dnaScores: Record<string, number>,
  ): string {
    const guidance: string[] = [
      '=== GENOME-AWARE BEHAVIORAL GUIDANCE ===',
    ];

    for (const [key, score] of Object.entries(dnaScores)) {
      const category = key.toLowerCase();
      if (score < 30) {
        guidance.push(
          `${category.toUpperCase()} DNA is LOW (${score}%). Be proactive with ${category} suggestions. Recommend quick wins. Focus on fundamentals.`,
        );
      } else if (score < 60) {
        guidance.push(
          `${category.toUpperCase()} DNA is MODERATE (${score}%). Provide balanced ${category} recommendations. Highlight improvement opportunities.`,
        );
      } else if (score >= 80) {
        guidance.push(
          `${category.toUpperCase()} DNA is HIGH (${score}%). Leverage ${category} strengths in recommendations. Suggest advanced optimizations.`,
        );
      }
    }

    guidance.push('=========================');

    return guidance.join('\n');
  }

  /**
   * Enrich a context snapshot with data from the v2 context service.
   */
  enrichSnapshotFromV2(
    snapshot: CortexContextSnapshot,
    v2Context: Record<string, unknown>,
  ): void {
    try {
      const crmCtx = v2Context['crm'] as any;
      if (crmCtx?.contactCount) {
        snapshot.keyMetrics['totalContacts'] = crmCtx.contactCount;
      }

      const commerceCtx = v2Context['commerce'] as any;
      if (commerceCtx?.totalRevenue) {
        snapshot.keyMetrics['totalRevenue'] = commerceCtx.totalRevenue;
      }
      if (commerceCtx?.outstandingRevenue) {
        snapshot.keyMetrics['outstandingRevenue'] =
          commerceCtx.outstandingRevenue;
      }

      const bookingsCtx = v2Context['bookings'] as any;
      if (bookingsCtx?.upcomingCount) {
        snapshot.keyMetrics['upcomingBookings'] = bookingsCtx.upcomingCount;
      }
    } catch {
      // Non-critical enrichment
    }
  }

  /**
   * Enrich a context snapshot with genome data.
   */
  enrichSnapshotFromGenome(
    snapshot: CortexContextSnapshot,
    genomeContext: GenomeEnrichedContext,
  ): void {
    try {
      for (const [key, score] of Object.entries(genomeContext.dnaScores)) {
        snapshot.keyMetrics[`dna_${key}`] = score;
      }

      if (genomeContext.genomeStage) {
        snapshot.genomeStage = genomeContext.genomeStage;
      }

      if (genomeContext.executiveReadiness) {
        snapshot.executiveReadiness = genomeContext.executiveReadiness;
      }

      snapshot.keyMetrics['genomeRecommendations'] =
        genomeContext.recommendations.length;
      snapshot.keyMetrics['genomeSignals'] = genomeContext.signals.length;
      snapshot.keyMetrics['genomeOpportunities'] =
        genomeContext.opportunities.length;
    } catch {
      // Non-critical enrichment
    }
  }

  /**
   * Summarize a module's context for inclusion in the system prompt.
   */
  summarizeModuleContext(
    module: string,
    context: Record<string, unknown>,
  ): string {
    try {
      switch (module) {
        case 'crm': {
          const ctx = context as any;
          return `CRM: ${ctx.contactCount ?? '?'} contacts, ${ctx.leadCount ?? '?'} leads, ${ctx.recentContacts?.length ?? 0} recent interactions.`;
        }
        case 'commerce': {
          const ctx = context as any;
          return `Commerce: $${ctx.totalRevenue ?? 0} total revenue, $${ctx.outstandingRevenue ?? 0} outstanding, ${ctx.productCount ?? 0} products.`;
        }
        case 'bookings': {
          const ctx = context as any;
          return `Bookings: ${ctx.upcomingCount ?? 0} upcoming, ${ctx.todayCount ?? 0} today.`;
        }
        case 'autopilot': {
          const ctx = context as any;
          return `Autopilot: ${ctx.activeTaskCount ?? 0} active tasks, ${ctx.activeLoopCount ?? 0} active loops.`;
        }
        default:
          return `${module}: ${Object.keys(context).length} data points.`;
      }
    } catch {
      return '';
    }
  }
}
