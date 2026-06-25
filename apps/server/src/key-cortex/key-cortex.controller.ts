import { Controller, Post, Body, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ConsciousnessOrchestrator } from './consciousness/orchestrator/consciousness-orchestrator.service';
import { ConsciousnessInput } from './consciousness/types/consciousness.types';
import { KeyCortexReasoning } from './services/key-cortex-reasoning.service';
import { ModelGateway } from './services/model-gateway.service';

/**
 * =============================================================================
 * KeyCortexController — HTTP API Surface
 * =============================================================================
 * Exposes the consciousness system via REST endpoints:
 *
 *   POST /key-cortex/process    — Full consciousness pipeline
 *   POST /key-cortex/reason     — ReAct reasoning with steps
 *   GET  /key-cortex/health     — Module health check
 *   GET  /key-cortex/providers  — AI provider status
 * =============================================================================
 */
@Controller('key-cortex')
export class KeyCortexController {
  constructor(
    private readonly orchestrator: ConsciousnessOrchestrator,
    private readonly reasoning: KeyCortexReasoning,
    private readonly modelGateway: ModelGateway,
  ) {}

  /**
   * POST /key-cortex/process
   *
   * Run the full 9-layer consciousness pipeline on a user query.
   * This is the primary endpoint for KEY consciousness interactions.
   */
  @Post('process')
  @HttpCode(HttpStatus.OK)
  async process(@Body() input: ConsciousnessInput) {
    const start = Date.now();
    const result = await this.orchestrator.process(input);
    return {
      ...result,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * POST /key-cortex/reason
   *
   * Run the ReAct reasoning loop with full step visibility.
   * Returns the reasoning chain for debugging and transparency.
   */
  @Post('reason')
  @HttpCode(HttpStatus.OK)
  async reason(
    @Body()
    body: {
      query: string;
      userId: string;
      businessId: string;
      genomeContext?: string;
    },
  ) {
    const start = Date.now();
    const result = await this.reasoning.reason(
      body.query,
      body.userId,
      body.businessId,
      body.genomeContext,
    );
    return {
      ...result,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * GET /key-cortex/health
   *
   * Health check endpoint for monitoring and load balancers.
   */
  @Get('health')
  health() {
    return {
      status: 'ok',
      module: 'key-cortex',
      layers: 9,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GET /key-cortex/providers
   *
   * Check status of all configured AI providers.
   */
  @Get('providers')
  async providers() {
    const statuses = await this.modelGateway.getProviderStatus();
    return {
      providers: statuses,
      count: statuses.length,
      available: statuses.filter(p => p.available).length,
    };
  }
}
