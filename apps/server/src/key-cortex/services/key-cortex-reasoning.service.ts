import { Injectable, Logger } from '@nestjs/common';
import { ConsciousnessOrchestrator } from '../consciousness/orchestrator/consciousness-orchestrator.service';
import { ConsciousnessInput, ConsciousnessOutput } from '../consciousness/types/consciousness.types';

/**
 * =============================================================================
 * KeyCortexReasoning — ReAct Reasoning Bridge
 * =============================================================================
 * Implements a ReAct (Reasoning + Acting) loop that:
 *   1. Receives a query from the conversation layer
 *   2. Runs the consciousness pipeline for initial reasoning
 *   3. If the output is insufficient, triggers follow-up reasoning cycles
 *   4. Returns the final synthesised response
 *
 * This is the primary reasoning bridge between the consciousness system
 * and the rest of the KEY application.
 * =============================================================================
 */

interface ReasoningStep {
  step: number;
  action: string;
  observation: string;
  confidence: number;
}

@Injectable()
export class KeyCortexReasoning {
  private readonly logger = new Logger(KeyCortexReasoning.name);

  /** Maximum number of ReAct iterations to prevent infinite loops. */
  private readonly MAX_ITERATIONS = 3;

  constructor(private readonly orchestrator: ConsciousnessOrchestrator) {}

  /**
   * Execute a ReAct reasoning cycle on the user query.
   *
   * The loop continues until confidence is above threshold or max iterations
   * is reached.
   */
  async reason(
    query: string,
    userId: string,
    businessId: string,
    genomeContext?: string,
  ): Promise<ConsciousnessOutput & { reasoningSteps: ReasoningStep[] }> {
    try {
      this.logger.debug(`ReAct reasoning started for user=${userId}`);

      const steps: ReasoningStep[] = [];
      let iteration = 0;
      let bestOutput: ConsciousnessOutput | null = null;

      // Iteration 1: Initial reasoning via consciousness pipeline
      const initialInput: ConsciousnessInput = {
        query,
        userId,
        businessId,
        genomeContext,
        priority: 'depth',
      };

      const initialResult = await this.orchestrator.process(initialInput);
      steps.push({
        step: 1,
        action: 'consciousness-pipeline',
        observation: `Layers: ${initialResult.layersUsed.join(', ')}`,
        confidence: initialResult.confidence,
      });
      bestOutput = initialResult;

      // Iterations 2+: ReAct loop if confidence is low
      while (iteration < this.MAX_ITERATIONS - 1 && bestOutput.confidence < 0.6) {
        iteration++;
        this.logger.verbose(`ReAct iteration ${iteration + 1}: confidence=${bestOutput.confidence} < 0.6, re-reasoning`);

        // Refine query with self-critique
        const refinedQuery = this.refineQuery(query, bestOutput);
        const refinedInput: ConsciousnessInput = {
          query: refinedQuery,
          userId,
          businessId,
          genomeContext,
          priority: 'creativity',
        };

        const refinedResult = await this.orchestrator.process(refinedInput);
        steps.push({
          step: iteration + 1,
          action: 'self-critique-refinement',
          observation: `Refined confidence: ${refinedResult.confidence}`,
          confidence: refinedResult.confidence,
        });

        // Keep the best result
        if (refinedResult.confidence > bestOutput.confidence) {
          bestOutput = refinedResult;
        }
      }

      this.logger.verbose(`ReAct complete: ${steps.length} steps, final confidence=${bestOutput.confidence}`);

      return {
        ...bestOutput,
        reasoningSteps: steps,
      };
    } catch (err) {
      this.logger.error(`ReAct reasoning failed: ${(err as Error).message}`);

      // Graceful degradation
      return {
        response: `I analysed your request but encountered a reasoning fault. Here's what I can tell you: "${query}" requires more context for a confident answer.`,
        confidence: 0.2,
        layersUsed: ['error-recovery'],
        reasoningTrace: `ReAct error: ${(err as Error).message}`,
        reasoningSteps: [{ step: 0, action: 'error-recovery', observation: 'Reasoning pipeline failed', confidence: 0.1 }],
      };
    }
  }

  /**
   * Refine a query using self-critique from a previous reasoning result.
   * Adds "what am I missing?" framing to the original query.
   */
  private refineQuery(originalQuery: string, previousOutput: ConsciousnessOutput): string {
    const critiques: string[] = [
      `Re-examining: "${originalQuery}" — previous analysis had confidence ${previousOutput.confidence}. What critical factors were overlooked?`,
      `Second-pass analysis: "${originalQuery}" — considering edge cases and alternative interpretations.`,
      `Deep-dive: "${originalQuery}" — what would make this advice wrong, and how can I strengthen it?`,
    ];

    // Deterministic selection based on confidence level
    if (previousOutput.confidence < 0.4) return critiques[2];
    if (previousOutput.confidence < 0.5) return critiques[1];
    return critiques[0];
  }
}
