import { Injectable, Logger } from '@nestjs/common';

/**
 * =============================================================================
 * Genome Context Assembler — Business DNA Reader
 * =============================================================================
 * Assembles the full business context ("genome") for a given businessId by
 * reading from the database.  The genome includes:
 *   - Business profile (industry, stage, size)
 *   - Financial health indicators
 *   - Strategic priorities
 *   - Team composition
 *   - Recent milestones / challenges
 *
 * In the current implementation this uses a mock database interface.
 * Production would inject a Prisma / TypeORM repository.
 * =============================================================================
 */

interface BusinessGenome {
  businessId: string;
  name: string;
  industry: string;
  stage: string;
  employeeCount: number;
  annualRevenue: string;
  strategicPriorities: string[];
  keyChallenges: string[];
  recentMilestones: string[];
  financialHealth: string;
  marketPosition: string;
}

@Injectable()
export class GenomeContextAssembler {
  private readonly logger = new Logger(GenomeContextAssembler.name);

  /** In-memory mock database — production: replace with Prisma query. */
  private readonly mockDb = new Map<string, BusinessGenome>([
    ['biz-demo-001', {
      businessId: 'biz-demo-001',
      name: 'Acme SaaS Corp',
      industry: 'B2B Software',
      stage: 'growth',
      employeeCount: 45,
      annualRevenue: '$2.4M ARR',
      strategicPriorities: ['expand enterprise segment', 'reduce churn to <5%', 'achieve profitability'],
      keyChallenges: ['long enterprise sales cycles', 'competition from well-funded rivals', 'talent retention'],
      recentMilestones: ['launched enterprise tier', 'hit 100 paying customers', 'raised Series A'],
      financialHealth: 'stable-burn',
      marketPosition: 'niche-leader',
    }],
  ]);

  /**
   * Assemble the full business context string for injection into the
   * consciousness pipeline.
   */
  async assembleContext(businessId: string): Promise<string> {
    try {
      this.logger.debug(`Assembling genome context for business=${businessId}`);

      // Fetch from database (mock or real)
      const genome = await this.fetchFromDatabase(businessId);

      if (!genome) {
        this.logger.warn(`No genome found for business=${businessId}, returning empty context`);
        return '';
      }

      const context = this.formatGenome(genome);
      this.logger.verbose(`Genome context assembled: ${context.length} chars`);

      return context;
    } catch (err) {
      this.logger.warn(`Genome assembly failed: ${(err as Error).message}`);
      return ''; // Graceful degradation — empty context is safe
    }
  }

  /** Fetch business genome from persistent storage. */
  private async fetchFromDatabase(businessId: string): Promise<BusinessGenome | null> {
    // Production: return this.prisma.business.findUnique({ where: { id: businessId } })
    return this.mockDb.get(businessId) ?? null;
  }

  /** Format genome into a structured context string for the LLM. */
  private formatGenome(g: BusinessGenome): string {
    const parts: string[] = [
      `## Business Profile`,
      `Name: ${g.name}`,
      `Industry: ${g.industry}`,
      `Stage: ${g.stage}`,
      `Employees: ${g.employeeCount}`,
      `Revenue: ${g.annualRevenue}`,
      `Market Position: ${g.marketPosition}`,
      `Financial Health: ${g.financialHealth}`,
      ``,
      `## Strategic Priorities`,
      ...g.strategicPriorities.map(p => `- ${p}`),
      ``,
      `## Key Challenges`,
      ...g.keyChallenges.map(c => `- ${c}`),
      ``,
      `## Recent Milestones`,
      ...g.recentMilestones.map(m => `- ${m}`),
    ];

    return parts.join('\n');
  }
}
