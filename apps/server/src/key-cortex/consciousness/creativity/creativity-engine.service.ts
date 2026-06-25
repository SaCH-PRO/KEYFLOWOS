import { Injectable, Logger } from '@nestjs/common';

/**
 * =============================================================================
 * L6: Creativity Engine — SCAMPER Brainstorming Technique
 * =============================================================================
 * Generates novel ideas by systematically applying 7 SCAMPER operators to a
 * prompt:
 *   S — Substitute    C — Combine    A — Adapt
 *   M — Magnify/Minify    P — Put to other uses    E — Eliminate    R — Reverse
 * =============================================================================
 */

type ScamperOperator = 'S' | 'C' | 'A' | 'M' | 'P' | 'E' | 'R';

interface ScamperPrompt {
  operator: ScamperOperator;
  name: string;
  question: string;
}

const SCAMPER_PROMPTS: ScamperPrompt[] = [
  { operator: 'S', name: 'Substitute', question: 'What can be substituted? What other ingredients, materials, people, processes?' },
  { operator: 'C', name: 'Combine', question: 'What can be combined? What units, features, purposes?' },
  { operator: 'A', name: 'Adapt', question: 'What can be adapted? What else is like this? What ideas does this suggest?' },
  { operator: 'M', name: 'Magnify/Minify', question: 'What can be magnified or minified? What can be added, made stronger, made smaller?' },
  { operator: 'P', name: 'Put to other uses', question: 'What other uses are possible? New ways to use as-is, or modified?' },
  { operator: 'E', name: 'Eliminate', question: 'What can be eliminated? What rules, parts, features, processes?' },
  { operator: 'R', name: 'Reverse/Rearrange', question: 'What can be reversed or rearranged? What other arrangement, sequence, pattern?' },
];

@Injectable()
export class CreativityEngine {
  private readonly logger = new Logger(CreativityEngine.name);

  /**
   * Generate creative ideas using the SCAMPER technique.
   *
   * Returns up to 7 ideas (one per SCAMPER operator), each scored by
   * novelty and relevance.
   */
  async brainstorm(prompt: string): Promise<{ description: string; score: number }[]> {
    try {
      this.logger.debug(`Brainstorming ideas for: ${prompt.substring(0, 60)}...`);

      const ideas: { description: string; score: number }[] = [];
      const keywords = this.extractKeywords(prompt);

      for (const scamper of SCAMPER_PROMPTS) {
        const idea = this.generateIdea(scamper, prompt, keywords);
        const score = this.scoreIdea(idea, keywords);
        ideas.push({ description: idea, score });
      }

      // Sort by score descending
      ideas.sort((a, b) => b.score - a.score);

      this.logger.verbose(`Brainstorm complete: ${ideas.length} ideas generated`);
      return ideas;
    } catch (err) {
      this.logger.warn(`Brainstorming failed: ${(err as Error).message}`);
      // Return a single fallback idea
      return [{ description: `Direct approach: ${prompt}`, score: 0.5 }];
    }
  }

  /** Generate a single idea using one SCAMPER operator. */
  private generateIdea(scamper: ScamperPrompt, prompt: string, keywords: string[]): string {
    const keyword = keywords[0] || 'this approach';
    const secondary = keywords[1] || 'the current method';

    switch (scamper.operator) {
      case 'S':
        return `[${scamper.name}] Replace ${keyword} with an alternative from an adjacent industry. ${scamper.question} Applied to: "${prompt.substring(0, 80)}"`;
      case 'C':
        return `[${scamper.name}] Combine ${keyword} with ${secondary} into a hybrid offering. ${scamper.question} Explore fusion opportunities.`;
      case 'A':
        return `[${scamper.name}] Adapt a successful pattern from a different domain to ${keyword}. ${scamper.question} Look for analogous solutions.`;
      case 'M':
        return `[${scamper.name}] Scale ${keyword} to 10x its current scope, then identify the bottleneck. ${scamper.question}`;
      case 'P':
        return `[${scamper.name}] Repurpose ${keyword} for an entirely different customer segment or use case. ${scamper.question}`;
      case 'E':
        return `[${scamper.name}] Strip ${keyword} down to its absolute essence — remove 50% of components. ${scamper.question}`;
      case 'R':
        return `[${scamper.name}] Reverse the typical workflow: deliver the output first, then the process. ${scamper.question}`;
      default:
        return `[${scamper.name}] Apply ${scamper.name} to ${keyword}: ${scamper.question}`;
    }
  }

  /** Score an idea based on keyword coverage and structural diversity. */
  private scoreIdea(idea: string, keywords: string[]): number {
    let score = 0.5; // base

    // Keyword coverage bonus
    for (const kw of keywords) {
      if (idea.toLowerCase().includes(kw.toLowerCase())) {
        score += 0.05;
      }
    }

    // Length diversity — neither too short nor too long
    if (idea.length > 50 && idea.length < 300) {
      score += 0.1;
    }

    // Structural richness — contains actionable language
    const actionWords = ['replace', 'combine', 'adapt', 'scale', 'repurpose', 'strip', 'reverse', 'explore', 'apply'];
    for (const word of actionWords) {
      if (idea.toLowerCase().includes(word)) {
        score += 0.02;
      }
    }

    return Math.round(Math.min(1, score) * 100) / 100;
  }

  /** Extract meaningful keywords from the prompt. */
  private extractKeywords(prompt: string): string[] {
    // Remove common stop words and extract meaningful terms
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while']);

    const words = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    // Return unique keywords
    return [...new Set(words)].slice(0, 4);
  }
}
