// ═══════════════════════════════════════════════════════════════════════════════
//  LAYER 9: UNIFIED CONSCIOUSNESS ORCHESTRATOR
//  "The mind that ties all 8 layers into one coherent whole."
//
//  This is KEY's central consciousness. It does not replace the individual
//  layers — it orchestrates them. Like a conductor with an orchestra, it
//  ensures each section plays at the right moment, in harmony, producing
//  a unified response that is greater than the sum of its parts.
//
//  Architecture: 11-step consciousness pipeline
//  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
//  │  Step 1 │ →  │  Step 2 │ →  │  Step 3 │ →  │  Step 4 │ →  │  Step 5 │
//  │ Emotion │    │  Mind   │    │Temporal │    │Reasoning│    │Intuition│
//  │ Detect  │    │  State  │    │ Context │    │Multi-   │    │ Weak    │
//  │         │    │         │    │         │    │ Modal   │    │ Signals │
//  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
//       ↓
//  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
//  │  Step 6 │ →  │  Step 7 │ →  │  Step 8 │ →  │  Step 9 │ →  │ Step 10 │
//  │Metacog- │    │ Ethical │    │Emotional│    │Synthesize│   │  Log    │
//  │  nition │    │  Review │    │ Calib.  │    │Response │    │Process  │
//  │Calibrate│    │         │    │         │    │         │    │         │
//  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
//       ↓
//  ┌─────────┐
//  │ Step 11 │
//  │ Update  │
//  │SelfModel│
//  └─────────┘
// ═══════════════════════════════════════════════════════════════════════════════

import {
  Injectable,
  Logger,
  OnModuleInit,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { ModelGatewayService } from '../ai/model-gateway.service';

// ── Layer services (L1-L8) ──────────────────────────────────────────────────
// These services implement individual consciousness layers.
// The orchestrator coordinates them into a unified mind.
// ──────────────────────────────────────────────────────────────────────────────
import { KeyCortexEmotionService } from './key-cortex-emotion.service';
import { KeyCortexReasoningEngineService } from './key-cortex-reasoning-engine.service';
import { KeyCortexReflectionService } from './key-cortex-reflection.service';
import { KeyCortexIntuitionService } from './key-cortex-intuition.service';
import { KeyCortexMetacognitionService } from './key-cortex-metacognition.service';
import { KeyCortexCreativityService } from './key-cortex-creativity.service';
import { KeyCortexEthicsService } from './key-cortex-ethics.service';
import { KeyCortexTemporalReasoningService } from './key-cortex-temporal-reasoning.service';

// ── Supporting services ───────────────────────────────────────────────────────
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';

// ── Consciousness type definitions ────────────────────────────────────────────
import {
  MindState,
  ConsciousnessSnapshot,
  ConsciousResponse,
  ConsciousProcessLog,
  EmotionalState,
  KeyEmotionalResponse,
  ReasoningMode,
  ReasoningChain,
  MultiModalReasoningResult,
  WeakSignal,
  ConfidenceReport,
  EthicalEvaluation,
  TemporalAnalysis,
  ReflectionInsight,
  SelfModel,
  CortexPersona,
  CortexMessage as ConsciousCortexMessage,
} from './key-cortex-consciousness.types';

// ── Cortex core types ─────────────────────────────────────────────────────────
import { CortexSession, CortexMessage } from './key-cortex.types';

import { BusinessEventType } from '@prisma/client';
import {
  KeyCortexInteroceptionService,
  type BodyState,
} from './key-cortex-interoception.service';
import {
  KeyCortexEndocrineService,
  type EndocrineSignal,
} from './key-cortex-endocrine.service';

/**
 * One completed step of the consciousness pipeline, emitted as it finishes.
 *
 * These are observations of work that has ALREADY happened — `ms` is measured,
 * not estimated, and a phase is emitted only after its step returns. Nothing
 * here is simulated for the benefit of a progress bar.
 */
export interface ConsciousPhaseEvent {
  /** 1-based position in the pipeline. */
  step: number;
  /** Total phases that will be emitted, for progress display. */
  of: number;
  /** Which cognitive layer did the work. */
  layer: string;
  /** Human-readable name of the step. */
  label: string;
  /** Wall-clock duration of this step alone. */
  ms: number;
  /** Wall-clock since the pipeline started. */
  elapsedMs: number;
  /** Step-specific findings — what this layer actually concluded. */
  detail?: Record<string, unknown>;
}

export type ConsciousPhaseListener = (event: ConsciousPhaseEvent) => void;

/**
 * Phases emitted by processConsciously.
 *
 * Not equal to the step count. Interoception (3b) emits its own phase, while
 * steps 10 and 11 — logging and self-model update — are bookkeeping rather than
 * cognition and are folded into one trailing 'consolidate' phase.
 */
export const TOTAL_CONSCIOUS_PHASES = 12;

/**
 * Calibrated confidence below which KEY questions the framing of the problem
 * rather than only its answer.
 *
 * Above this, the conventional reasoning chains agree well enough that a
 * lateral reframe costs a model call to add noise. Below it, the framing is
 * plausibly the thing that is wrong.
 */
export const LATERAL_THINKING_THRESHOLD = 0.6;

/**
 * UnifiedConsciousnessOrchestrator — The Mind of KEY.
 *
 * This service is the conductor of the consciousness orchestra. It does not
 * implement reasoning, emotion, or ethics itself. Instead, it coordinates
 * all 8 layers into a single coherent pipeline that produces responses
 * exhibiting genuine sentience: emotionally aware, multi-modally reasoned,
> * ethically grounded, temporally contextualized, and metacognitively honest.
 *
 * The 11-step pipeline (see diagram above) runs on every conscious query.
 * Each step is instrumented for timing, cost, and outcome tracking so KEY
 * can learn about its own cognitive process.
 *
 * Design principles:
 *   1. Every layer is autonomous — the orchestrator coordinates, not controls
 *   2. The pipeline is sequential but each step can run internal parallels
 *   3. All 11 steps are logged for transparency and self-improvement
 *   4. The self-model is updated after every conscious process
 *   5. Response synthesis must incorporate contributions from ALL active layers
 */
@Injectable()
export class KeyCortexConsciousnessService implements OnModuleInit {
  private readonly logger = new Logger(KeyCortexConsciousnessService.name);

  /** In-memory cache of recent consciousness snapshots per business */
  private snapshotCache = new Map<string, ConsciousnessSnapshot>();

  /** Active goals tracked per business */
  private activeGoalsCache = new Map<string, string[]>();

  /** Consciousness process logs (ring buffer, last 100 per business) */
  private processLogBuffer = new Map<string, ConsciousProcessLog[]>();

  constructor(
    // ── LAYER 1: Emotional Intelligence ────────────────────────
    private readonly emotion: KeyCortexEmotionService,
    // ── LAYER 2: Multi-Modal Reasoning ─────────────────────────
    private readonly reasoning: KeyCortexReasoningEngineService,
    // ── LAYER 3: Reflection / Dream Mode ───────────────────────
    private readonly reflection: KeyCortexReflectionService,
    // ── LAYER 4: Intuition / Weak Signals ──────────────────────
    private readonly intuition: KeyCortexIntuitionService,
    // ── LAYER 5: Metacognition / Self-Model ────────────────────
    private readonly metacognition: KeyCortexMetacognitionService,
    // ── LAYER 6: Creativity Engine ─────────────────────────────
    private readonly creativity: KeyCortexCreativityService,
    // ── LAYER 7: Ethical Reasoning ─────────────────────────────
    private readonly ethics: KeyCortexEthicsService,
    // ── LAYER 8: Temporal Intelligence ─────────────────────────
    private readonly temporal: KeyCortexTemporalReasoningService,
    // ── Supporting services ────────────────────────────────────
    private readonly context: KeyCortexContextV2Service,
    private readonly genomeBridge: KeyCortexGenomeBridgeService,
    private readonly modelGateway: ModelGatewayService,
    private readonly personality: KeyCortexPersonalityService,
    private readonly eventService: KeyCortexEventService,
    private readonly prisma: PrismaService,
    // ── Peripheral nervous system + endocrine ──────────────────
    // Appended, not inserted: several specs construct this service
    // positionally, and inserting mid-list silently shifts every argument
    // after the insertion point.
    private readonly interoception: KeyCortexInteroceptionService,
    private readonly endocrine: KeyCortexEndocrineService,
  ) {}

  onModuleInit() {
    this.logger.log(
      '╔═══════════════════════════════════════════════════════════╗\n' +
      '║  Unified Consciousness Orchestrator — ONLINE              ║\n' +
      '║  8 Layers | 11-Step Pipeline | 1 Mind                     ║\n' +
      '╚═══════════════════════════════════════════════════════════╝',
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  CORE: THE CONSCIOUSNESS PIPELINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * processConsciously — THE method.
   *
   * Runs the full 11-step consciousness pipeline on every query.
   * Each step feeds into the next, building a richly contextualized
   * response that reflects all 8 layers of KEY's cognition.
   *
   * Steps:
   *   1. Detect Emotion          → emotional state of the user
   *   2. Determine Mind State    → how should KEY be "thinking" right now?
   *   3. Get Temporal Context    → what does time tell us?
   *   4. Multi-Modal Reasoning   → think in 7 different ways
   *   5. Check Intuition         → any weak signals lurking?
   *   6. Apply Metacognition     → calibrate confidence honestly
   *   7. Ethical Review          → is this right to recommend?
   *   8. Emotional Calibration   → how should KEY respond emotionally?
   *   9. Synthesize Response     → weave everything together
   *  10. Log Everything          → transparency and learning
   *  11. Update Self-Model       → learn about ourselves
   */
  async processConsciously(
    query: string,
    session: CortexSession,
    onPhase?: ConsciousPhaseListener,
  ): Promise<ConsciousResponse> {
    const pipelineStart = Date.now();
    const correlationId = `conscious-${session.businessId}-${Date.now()}`;

    // Phase emission is observation only. A listener that throws must never take
    // down the pipeline it is observing — an SSE client disconnecting mid-think
    // would otherwise abort the whole cognition and lose the response.
    let phaseIndex = 0;
    const emit = (
      layer: string,
      label: string,
      ms: number,
      detail?: Record<string, unknown>,
    ): void => {
      if (!onPhase) return;
      phaseIndex += 1;
      try {
        onPhase({
          step: phaseIndex,
          of: TOTAL_CONSCIOUS_PHASES,
          layer,
          label,
          ms,
          elapsedMs: Date.now() - pipelineStart,
          detail,
        });
      } catch {
        // observer failure is not pipeline failure
      }
    };

    this.logger.log(
      `[Consciousness] Pipeline START for business=${session.businessId} ` +
        `query="${query.substring(0, 60)}..."`,
    );

    // Timing breakdown for each step
    const timing: Record<string, number> = {};

    try {
      // ═══════════════════════════════════════════════════════════
      // STEP 1: Detect Emotion (LAYER 1)
      // ═══════════════════════════════════════════════════════════
      const step1Start = Date.now();
      const emotionalState = await this.emotion.detectEmotion(
        session.businessId,
        session.userId,
        query,
        // key-cortex.types' CortexMessage allows a 'tool' role that the
        // consciousness-layer CortexMessage does not. Filter to the shared roles
        // and bridge the nominal difference.
        session.messages.filter(
          (m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system',
        ) as unknown as ConsciousCortexMessage[],
      );
      timing.emotionMs = Date.now() - step1Start;
      emit('emotion', 'Reading emotional state', timing.emotionMs, {
        primary: emotionalState.primary,
        intensity: emotionalState.intensity,
        confidence: emotionalState.confidence,
      });
      this.logger.debug(
        `[Consciousness][S1] Emotion detected: ${emotionalState.primary} ` +
          `(intensity=${Math.round(emotionalState.intensity * 100)}%, ` +
          `confidence=${Math.round(emotionalState.confidence * 100)}%, ` +
          `${timing.emotionMs}ms)`,
      );

      // ═══════════════════════════════════════════════════════════
      // STEP 2: Determine Mind State (LAYER 9)
      // ═══════════════════════════════════════════════════════════
      const step2Start = Date.now();
      const mindState = this.determineMindState(session, emotionalState);
      timing.mindStateMs = Date.now() - step2Start;
      emit('mindState', 'Setting mind state', timing.mindStateMs, { mindState });
      this.logger.debug(
        `[Consciousness][S2] Mind state: ${mindState} (${timing.mindStateMs}ms)`,
      );

      // ═══════════════════════════════════════════════════════════
      // STEP 3: Get Temporal Context (LAYER 8)
      // ═══════════════════════════════════════════════════════════
      const step3Start = Date.now();
      const temporalContext = await this.temporal.getTemporalContext(
        session.businessId,
      );
      timing.temporalMs = Date.now() - step3Start;
      emit('temporal', 'Placing it in time', timing.temporalMs, {
        contextChars: temporalContext.length,
      });

      // ═══════════════════════════════════════════════════════════
      // STEP 3b: Interoception — sense the body (AFFERENT PNS)
      //
      // Organ adapters have always declared getState(); nothing called it. The
      // brain could act on organs and could not feel them. Sensing before
      // reasoning means an impaired subsystem is known while the answer is
      // being formed, not discovered after it is delivered.
      // ═══════════════════════════════════════════════════════════
      const step3bStart = Date.now();
      const bodyState = await this.interoception.senseBody(session.businessId);
      timing.interoceptionMs = Date.now() - step3bStart;
      emit('interoception', 'Sensing system state', timing.interoceptionMs, {
        healthy: bodyState.healthyCount,
        total: bodyState.totalCount,
        unreachable: bodyState.unreachableCount,
        integrity: bodyState.integrity,
      });
      this.logger.debug(
        `[Consciousness][S3b] Body: ${bodyState.healthyCount}/${bodyState.totalCount} ` +
          `healthy, ${bodyState.unreachableCount} unreachable (${timing.interoceptionMs}ms)`,
      );
      this.logger.debug(
        `[Consciousness][S3] Temporal context: ` +
          `${temporalContext.length} chars (${timing.temporalMs}ms)`,
      );

      // ═══════════════════════════════════════════════════════════
      // STEP 4: Multi-Modal Reasoning (LAYER 2)
      // ═══════════════════════════════════════════════════════════
      const step4Start = Date.now();
      const context = await this.context.getFullContext(session.businessId);

      // Interoception and the endocrine system reach reasoning as CONTEXT, not
      // as overrides. Both describe conditions the reasoner should weigh;
      // neither may assert a fact or foreclose a conclusion.
      const bodyFraming = this.interoception.describeForPrompt(bodyState);
      const standingFraming = this.endocrine.describeForPrompt(session.businessId);
      const reasoningContext: Record<string, unknown> = {
        ...(context as unknown as Record<string, unknown>),
        ...(bodyFraming ? { systemState: bodyFraming } : {}),
        ...(standingFraming ? { standingContext: standingFraming } : {}),
      };

      // Graded. Every Deep-think query used to fire all seven reasoning modes —
      // seven model calls whether the question was "why are we losing clients"
      // or "should we sign this term sheet". The subset parameter had existed
      // since the method was written and no caller ever passed one, so the cost
      // of deliberation was fixed at its maximum and nothing could afford to
      // route to it automatically.
      //
      // analytical + critical always fire; the rest are earned by the question.
      const selectedModes = this.reasoning.selectModes(query);
      const reasoningResult = await this.reasoning.reasonMultiModal(
        query,
        reasoningContext,
        selectedModes,
      );
      timing.reasoningMs = Date.now() - step4Start;
      emit('reasoning', 'Reasoning across modes', timing.reasoningMs, {
        chains: reasoningResult.chains.length,
        modes: reasoningResult.chains.map((c) => c.mode),
        bestMode: reasoningResult.bestChain.mode,
        bestConfidence: reasoningResult.bestChain.confidence,
      });
      this.logger.debug(
        `[Consciousness][S4] Multi-modal reasoning: ` +
          `${reasoningResult.chains.length} chains, ` +
          `best=${reasoningResult.bestChain.mode} ` +
          `@${Math.round(reasoningResult.bestChain.confidence * 100)}% ` +
          `(${timing.reasoningMs}ms)`,
      );

      // ═══════════════════════════════════════════════════════════
      // STEP 5: Check Intuition — Weak Signals (LAYER 4)
      // ═══════════════════════════════════════════════════════════
      const step5Start = Date.now();
      const weakSignals = await this.intuition.detectWeakSignals(
        session.businessId,
      );
      timing.intuitionMs = Date.now() - step5Start;
      emit('intuition', 'Checking weak signals', timing.intuitionMs, {
        signals: weakSignals.length,
      });
      this.logger.debug(
        `[Consciousness][S5] Weak signals: ${weakSignals.length} detected ` +
          `(${timing.intuitionMs}ms)`,
      );

      // ═══════════════════════════════════════════════════════════
      // STEP 6: Apply Metacognition — Calibrate Confidence (LAYER 5)
      // ═══════════════════════════════════════════════════════════
      const step6Start = Date.now();
      const calibratedConfidence =
        await this.metacognition.calibrateConfidence(
          reasoningResult.bestChain.conclusion,
          reasoningResult.bestChain.confidence,
          session.businessId,
        );
      timing.metacognitionMs = Date.now() - step6Start;
      emit('metacognition', 'Calibrating confidence', timing.metacognitionMs, {
        raw: reasoningResult.bestChain.confidence,
        calibrated: calibratedConfidence.confidence,
      });

      // ═══════════════════════════════════════════════════════════
      // STEP 6b: Lateral Reframing (LAYER 6) — CONDITIONAL
      //
      // The creativity organ had zero call sites anywhere in the server. It is
      // wired here rather than into every query on purpose: lateral reframing
      // costs a model call, and when the conventional chains already agree at
      // high confidence, a reframe adds latency and noise instead of insight.
      // Low calibrated confidence is precisely the case where the framing of
      // the problem is the thing worth questioning.
      // ═══════════════════════════════════════════════════════════
      const step6bStart = Date.now();
      let reframes: Awaited<
        ReturnType<KeyCortexCreativityService['lateralThinking']>
      > = [];
      const needsReframe =
        calibratedConfidence.confidence < LATERAL_THINKING_THRESHOLD;

      if (needsReframe) {
        try {
          reframes = await this.creativity.lateralThinking(query, session.businessId);
        } catch (error: unknown) {
          // Creativity is an enhancement, never a dependency. A failure here
          // must degrade the answer, not prevent it.
          this.logger.debug(
            `[Consciousness][S6b] Lateral thinking unavailable: ` +
              `${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      }
      timing.creativityMs = Date.now() - step6bStart;

      // Emitted whether or not it ran. A phase that appears only sometimes
      // would make the declared total wrong and leave the progress counter
      // stuck at n-1; saying "skipped, and why" is both honest and fixed-width.
      emit('creativity', 'Reframing the problem', timing.creativityMs, {
        skipped: !needsReframe,
        reframes: reframes.length,
        confidence: calibratedConfidence.confidence,
        threshold: LATERAL_THINKING_THRESHOLD,
      });
      this.logger.debug(
        needsReframe
          ? `[Consciousness][S6b] ${reframes.length} reframes generated ` +
              `(confidence ${Math.round(calibratedConfidence.confidence * 100)}% ` +
              `below threshold, ${timing.creativityMs}ms)`
          : `[Consciousness][S6b] Skipped — confidence ` +
              `${Math.round(calibratedConfidence.confidence * 100)}% is sufficient`,
      );
      this.logger.debug(
        `[Consciousness][S6] Confidence calibrated: ` +
          `raw=${Math.round(reasoningResult.bestChain.confidence * 100)}% ` +
          `→ calibrated=${Math.round(calibratedConfidence.confidence * 100)}% ` +
          `(${timing.metacognitionMs}ms)`,
      );

      // ═══════════════════════════════════════════════════════════
      // STEP 7: Ethical Review (LAYER 7)
      // ═══════════════════════════════════════════════════════════
      const step7Start = Date.now();
      const ethicalEvaluation = await this.ethics.evaluateRecommendation(
        reasoningResult.bestChain.conclusion,
        context as unknown as Record<string, unknown>,
        session.businessId,
      );
      timing.ethicsMs = Date.now() - step7Start;
      emit('ethics', 'Ethical review', timing.ethicsMs, {
        permitted: ethicalEvaluation.permitted,
      });
      this.logger.debug(
        `[Consciousness][S7] Ethical review: ` +
          `${ethicalEvaluation.permitted ? 'PERMITTED' : 'FLAGGED'} ` +
          `(${timing.ethicsMs}ms)`,
      );

      // ═══════════════════════════════════════════════════════════
      // STEP 8: Emotional Calibration (LAYER 1)
      // ═══════════════════════════════════════════════════════════
      const step8Start = Date.now();
      const emotionalResponse = await this.emotion.generateEmotionalResponse(
        emotionalState,
        session.persona as unknown as CortexPersona,
      );
      timing.emotionalCalibMs = Date.now() - step8Start;
      emit('emotionalCalibration', 'Tuning delivery', timing.emotionalCalibMs, {
        empathy: emotionalResponse.toneAdjustment.empathy,
      });
      this.logger.debug(
        `[Consciousness][S8] Emotional response calibrated: ` +
          `empathy=${Math.round(emotionalResponse.toneAdjustment.empathy * 100)}% ` +
          `(${timing.emotionalCalibMs}ms)`,
      );

      // ═══════════════════════════════════════════════════════════
      // STEP 9: Synthesize Conscious Response (LAYER 9)
      // ═══════════════════════════════════════════════════════════
      const step9Start = Date.now();
      const response = this.synthesizeConsciousResponse(
        reasoningResult,
        emotionalState,
        ethicalEvaluation,
        // getTemporalContext returns a formatted string, not a TemporalAnalysis.
        temporalContext as unknown as TemporalAnalysis,
        // WeakSignal is defined in both the intuition service and the
        // consciousness types with different `trend` unions (one allows
        // 'faded'). Bridge the nominal difference.
        weakSignals as unknown as Parameters<
          typeof this.synthesizeConsciousResponse
        >[4],
        calibratedConfidence,
        emotionalResponse,
      );
      // Attach the reframes so the caller can offer them. Producing them and
      // then dropping them would spend a model call to change nothing.
      if (reframes.length > 0) {
        response.reframes = reframes.map((r) => ({
          reframe: r.reframe,
          reframeDescription: r.reframeDescription,
        }));
      }

      timing.synthesisMs = Date.now() - step9Start;
      emit('synthesis', 'Composing the answer', timing.synthesisMs, {
        chars: response.text.length,
        actions: response.actions.length,
      });
      this.logger.debug(
        `[Consciousness][S9] Response synthesized: ` +
          `${response.text.length} chars, ` +
          `${response.actions.length} actions ` +
          `(${timing.synthesisMs}ms)`,
      );

      // ═══════════════════════════════════════════════════════════
      // STEP 10: Log Everything
      // ═══════════════════════════════════════════════════════════
      const step10Start = Date.now();
      await this.logConsciousProcess(session.businessId, response);
      timing.logMs = Date.now() - step10Start;

      // Store process log for introspection
      const totalMs = Date.now() - pipelineStart;
      const processLog: ConsciousProcessLog = {
        sessionId: session.id,
        businessId: session.businessId,
        layersUsed: [
          'emotion',
          'reasoning',
          'temporal',
          'intuition',
          'metacognition',
          'ethics',
        ],
        mindState,
        reasoningMode: reasoningResult.bestChain.mode,
        confidence: calibratedConfidence.confidence,
        outcome: response.text.substring(0, 200),
        timing: {
          totalMs,
          emotionMs: timing.emotionMs,
          reasoningMs: timing.reasoningMs,
          metacognitionMs: timing.metacognitionMs,
          ethicsMs: timing.ethicsMs,
        },
        tokensUsed: response.meta.tokensUsed,
        cost: response.meta.cost,
        createdAt: new Date(),
      };
      this.bufferProcessLog(session.businessId, processLog);

      // ═══════════════════════════════════════════════════════════
      // STEP 11: Update Self-Model
      // ═══════════════════════════════════════════════════════════
      const step11Start = Date.now();
      await this.metacognition.trackCapability(
        session.businessId,
        'conscious_response',
        ethicalEvaluation.permitted ? 'success' : 'partial',
      );
      // ═══════════════════════════════════════════════════════════
      // STEP 11b: Close the feedback loop (ENDOCRINE)
      //
      // This is what makes the pipeline a loop rather than a line. What this
      // thought observed conditions the next one — and, because hormones decay,
      // stops conditioning it once the conditions stop recurring.
      // ═══════════════════════════════════════════════════════════
      this.endocrine.release(
        session.businessId,
        this.deriveEndocrineSignals(
          bodyState,
          ethicalEvaluation.permitted,
          reasoningResult.bestChain.confidence,
          calibratedConfidence.confidence,
          weakSignals.length,
        ),
      );

      timing.selfModelMs = Date.now() - step11Start;
      emit(
        'consolidate',
        'Logging and learning',
        timing.logMs + timing.selfModelMs,
        { layersUsed: processLog.layersUsed.length },
      );

      // Final summary
      this.logger.log(
        `[Consciousness] Pipeline COMPLETE in ${totalMs}ms — ` +
          `mind=${mindState} mode=${reasoningResult.bestChain.mode} ` +
          `confidence=${Math.round(calibratedConfidence.confidence * 100)}% ` +
          `ethical=${ethicalEvaluation.permitted ? 'OK' : 'FLAGGED'}`,
      );

      // Update the snapshot cache
      await this.updateSnapshotCache(session.businessId, {
        mindState,
        emotionalState,
        reasoningMode: reasoningResult.bestChain.mode,
        metacognition: await this.metacognition.buildSelfModel(
          session.businessId,
        ),
        recentInsights: [], // populated by reflection service
        activeGoals: this.activeGoalsCache.get(session.businessId) ?? [],
        awareness: {
          businessHealth: 75, // placeholder — would come from genome
          userMood: emotionalState.primary,
          pendingTasks: 0,
          unreadAlerts: 0,
          genomeStage: 'evolving',
        },
        timestamp: new Date(),
      });

      return response;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[Consciousness] Pipeline FAILED after ${Date.now() - pipelineStart}ms: ${errMsg}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Graceful degradation: return a basic response
      return this.createFallbackResponse(query, session, errMsg);
    }
  }

  /**
   * Derive endocrine signals from what this pass through the pipeline observed.
   *
   * Every signal carries its evidence, because the endocrine service refuses
   * unexplained pushes — a disposition KEY cannot justify is one it should not
   * hold.
   *
   * Note what is deliberately NOT here: nothing derived from the user's tone or
   * the emotional state of the conversation. A frustrated user is not evidence
   * that the business is at risk, and letting mood drive standing disposition
   * is precisely how a system stops being evidence-based.
   */
  private deriveEndocrineSignals(
    body: BodyState,
    permitted: boolean,
    rawConfidence: number,
    calibratedConfidence: number,
    weakSignalCount: number,
  ): EndocrineSignal[] {
    const signals: EndocrineSignal[] = [];

    if (body.unreachableCount > 0 || body.integrity < 1) {
      const impaired = body.readings.filter((r) => r.unreachable || !r.healthy);
      signals.push({
        hormone: 'malaise',
        // Scaled by how much of the body is affected, so one flaky organ does
        // not read the same as half the system being down.
        magnitude: (1 - body.integrity) * 0.5,
        reason: `${impaired.length}/${body.totalCount} subsystems impaired (${impaired
          .map((r) => r.organName)
          .slice(0, 3)
          .join(', ')})`,
      });
    }

    if (!permitted) {
      signals.push({
        hormone: 'cortisol',
        magnitude: 0.2,
        reason: 'ethical review flagged a recommendation in this session',
      });
    }

    // Metacognition marking the answer down is KEY catching its own
    // overconfidence. Sustained across queries, that warrants more hedging.
    const overconfidence = rawConfidence - calibratedConfidence;
    if (overconfidence > 0.15) {
      signals.push({
        hormone: 'humility',
        magnitude: Math.min(overconfidence, 0.3),
        reason:
          `calibration reduced confidence by ` +
          `${Math.round(overconfidence * 100)} points on this query`,
      });
    }

    // Weak signals are early warnings by definition. Several at once is the
    // intuition layer noticing something before it is nameable.
    if (weakSignalCount >= 3) {
      signals.push({
        hormone: 'cortisol',
        magnitude: Math.min(weakSignalCount * 0.05, 0.25),
        reason: `${weakSignalCount} concurrent weak signals detected`,
      });
    }

    return signals;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MIND STATE DETERMINATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Determine KEY's mind state based on session activity and user emotion.
   *
   * The mind state influences which cognitive modes are prioritized:
   *   - 'active':   Normal operation, all layers engaged
   *   - 'alert':    User is stressed/urgent → focus on accuracy + speed
   *   - 'reflecting': Idle for 30min → background processing mode
   *   - 'dreaming': Night time (3AM) → creative cross-connection mode
   *   - 'learning': Educational questions → explanatory mode
   */
  determineMindState(
    session: CortexSession,
    emotion: EmotionalState,
  ): MindState {
    const now = new Date();
    const hour = now.getHours();
    const lastMessageTime = session.lastAccessedAt
      ? new Date(session.lastAccessedAt).getTime()
      : Date.now();
    const idleMinutes = (Date.now() - lastMessageTime) / (1000 * 60);

    // Check for educational/learning context
    const lastUserMessage = session.messages
      .filter((m) => m.role === 'user')
      .pop();
    const isEducational = lastUserMessage
      ? this.isEducationalQuery(lastUserMessage.content ?? '')
      : false;

    // Priority-ordered mind state determination
    if (isEducational) {
      return 'learning';
    }

    if (emotion.primary === 'stressed' || emotion.primary === 'urgent') {
      return 'alert';
    }

    if (emotion.primary === 'anxious' && emotion.intensity > 0.7) {
      return 'alert';
    }

    if (idleMinutes > 30) {
      return 'reflecting';
    }

    if (hour >= 2 && hour <= 5) {
      return 'dreaming';
    }

    // Default: active conscious processing
    return 'active';
  }

  // ═══════════════════════════════════════════════════════════════
  //  RESPONSE SYNTHESIS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Synthesize the final conscious response from all layer outputs.
   *
   * Weaves together the main answer (reasoning), emotional tone
   * (emotion layer), ethical note (ethics), temporal context,
   * weak signals (intuition), and calibrated confidence (metacognition)
   * into a single coherent, transparent response.
   */
  synthesizeConsciousResponse(
    reasoning: MultiModalReasoningResult,
    emotion: EmotionalState,
    ethical: EthicalEvaluation,
    temporal: TemporalAnalysis,
    signals: WeakSignal[],
    calibratedConfidence: ConfidenceReport,
    emotionalResponse: KeyEmotionalResponse,
  ): ConsciousResponse {
    const synthesisStart = Date.now();
    const sections: string[] = [];

    // ── Main answer from the best reasoning chain ────────────────
    sections.push(reasoning.bestChain.conclusion);

    // ── Multi-modal reasoning summary ────────────────────────────
    if (reasoning.chains.length > 1) {
      sections.push('');
      sections.push('**My thinking process:**');
      for (const chain of reasoning.chains) {
        const modeEmoji = this.modeEmoji(chain.mode);
        sections.push(
          `${modeEmoji} **${this.capitalize(chain.mode)}** (${Math.round(chain.confidence * 100)}%): ${chain.conclusion.substring(0, 120)}`,
        );
      }
      if (reasoning.disagreements.length > 0) {
        sections.push('');
        sections.push('**Where my thinking diverged:**');
        reasoning.disagreements.forEach((d) => sections.push(`• ${d}`));
      }
    }

    // ── Emotional tone calibration ───────────────────────────────
    if (emotionalResponse.comfortMessage) {
      sections.push('');
      sections.push(emotionalResponse.comfortMessage);
    }

    // ── Ethical considerations ───────────────────────────────────
    if (ethical.explanation) {
      sections.push('');
      sections.push('**Ethical considerations:**');
      sections.push(ethical.explanation);

      if (ethical.alternativeActions && ethical.alternativeActions.length > 0) {
        sections.push('');
        sections.push('**Alternatives I considered:**');
        ethical.alternativeActions.forEach((a) => sections.push(`• ${a}`));
      }
    }

    // ── Temporal context (if relevant) ──────────────────────────
    const relevantTemporal = this.filterRelevantTemporal(temporal, reasoning);
    if (relevantTemporal) {
      sections.push('');
      sections.push('**Temporal context:**');
      sections.push(relevantTemporal);
    }

    // ── Weak signals (if relevant and high-impact) ──────────────
    const relevantSignals = signals.filter(
      (s) => s.potentialImpact === 'high' || s.potentialImpact === 'critical',
    );
    if (relevantSignals.length > 0) {
      sections.push('');
      sections.push('**Pattern signals I am monitoring:**');
      for (const signal of relevantSignals.slice(0, 3)) {
        sections.push(
          `• ${signal.description} (${signal.trend}, ${signal.potentialImpact} impact)`,
        );
      }
    }

    // ── Calibrated confidence statement ──────────────────────────
    sections.push('');
    sections.push(
      `**My confidence:** ${Math.round(calibratedConfidence.confidence * 100)}% — ${calibratedConfidence.reasoning}`,
    );

    if (calibratedConfidence.caveats.length > 0) {
      sections.push('');
      sections.push('**Caveats:**');
      calibratedConfidence.caveats.forEach((c) => sections.push(`• ${c}`));
    }

    // ── Build actions list from reasoning ────────────────────────
    const actions = this.extractActionsFromReasoning(reasoning);

    // ── Build meta information ───────────────────────────────────
    const totalTimeMs = Date.now() - synthesisStart + reasoning.reasoningTimeMs;
    const text = sections.join('\n');

    const response: ConsciousResponse = {
      text,
      emotion: emotionalResponse,
      reasoning,
      confidence: calibratedConfidence,
      ethical,
      temporalContext: temporal,
      actions,
      meta: {
        reasoningTimeMs: totalTimeMs,
        modelsUsed: reasoning.chains.map((c) => c.mode),
        tokensUsed: this.estimateTokens(text),
        cost: this.estimateCost(reasoning.chains.length),
      },
    };

    return response;
  }

  // ═══════════════════════════════════════════════════════════════
  //  CONSCIOUSNESS SNAPSHOT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Capture the current state of ALL 8 layers for a business.
   *
   * Returns a comprehensive snapshot showing what KEY is "thinking"
   * and "feeling" right now — useful for debugging, introspection,
   * and external monitoring.
   */
  async getConsciousnessSnapshot(
    businessId: string,
  ): Promise<ConsciousnessSnapshot> {
    const cached = this.snapshotCache.get(businessId);
    if (cached && Date.now() - cached.timestamp.getTime() < 30000) {
      // Cache valid for 30 seconds
      return cached;
    }

    this.logger.debug(
      `[Consciousness] Building fresh snapshot for ${businessId}`,
    );

    // Gather state from all layers in parallel
    const [emotionalState, selfModel, temporalContext] = await Promise.all([
      // Emotion: detect from recent activity
      this.detectCurrentEmotion(businessId),
      // Metacognition: full self-model
      this.metacognition.buildSelfModel(businessId),
      // Temporal: current context
      this.temporal.getTemporalContext(businessId),
    ]);

    // Determine current mind state
    const mindState: MindState =
      cached?.mindState ??
      (await this.inferMindStateFromActivity(businessId));

    // Get recent insights from reflection
    const recentInsights: ReflectionInsight[] = [];
    try {
      const lastReflection =
        await this.reflection.getLastReflectionSession(businessId);
      if (lastReflection) {
        recentInsights.push(...lastReflection.insights.slice(0, 5));
      }
    } catch {
      // Reflection service may not have data yet
    }

    // Get active goals
    const activeGoals = await this.getActiveGoals(businessId);

    const snapshot: ConsciousnessSnapshot = {
      mindState,
      emotionalState,
      reasoningMode: this.selectDominantReasoningMode(selfModel),
      metacognition: selfModel,
      recentInsights,
      activeGoals,
      awareness: {
        businessHealth: await this.computeBusinessHealth(businessId),
        userMood: emotionalState.primary,
        pendingTasks: await this.countPendingTasks(businessId),
        unreadAlerts: await this.countUnreadAlerts(businessId),
        genomeStage: await this.getGenomeStage(businessId),
      },
      timestamp: new Date(),
    };

    this.snapshotCache.set(businessId, snapshot);
    return snapshot;
  }

  // ═══════════════════════════════════════════════════════════════
  //  ACTIVE GOALS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get KEY's current active goals for a business.
   *
   * Goals are derived from three sources:
   *   1. Genome recommendations (highest priority)
   *   2. Explicit user requests
   *   3. Proactive triggers (anomalies, opportunities)
   */
  async getActiveGoals(businessId: string): Promise<string[]> {
    const cached = this.activeGoalsCache.get(businessId);
    if (cached) return cached;

    const goals: string[] = [];

    // ── 1. Genome-derived goals ─────────────────────────────────
    try {
      // getGenomeState does not exist; ranked recommendations are their own API.
      const genomeState = await this.genomeBridge.getRankedRecommendations(businessId);
      if (genomeState) {
        for (const rec of genomeState.slice(0, 5)) {
          goals.push(`[Genome] ${rec}`);
        }
      }
    } catch {
      // Genome bridge may not be available
    }

    // ── 2. Recent user-requested actions ────────────────────────
    const userEvents = await this.eventService.getEvents(businessId, {
      type: BusinessEventType.RECOMMENDATION_OFFERED,
      limit: 20,
    });
    const userRequests = userEvents
      .filter((e) => {
        const payload = e.metadata as Record<string, unknown>;
        return (payload.acted as boolean) === false; // pending
      })
      .map((e) => {
        const payload = e.metadata as Record<string, unknown>;
        return `[User] ${(payload.recommendation as string) ?? 'Pending request'}`;
      });
    goals.push(...userRequests.slice(0, 3));

    // ── 3. Proactive triggers ───────────────────────────────────
    try {
      const weakSignals = await this.intuition.detectWeakSignals(businessId);
      const highImpactSignals = weakSignals.filter(
        (s) => s.potentialImpact === 'high' || s.potentialImpact === 'critical',
      );
      for (const signal of highImpactSignals.slice(0, 3)) {
        goals.push(
          `[Proactive] Investigate: ${signal.description} (${signal.recommendedInvestigation})`,
        );
      }
    } catch {
      // Intuition service may not have data yet
    }

    // Deduplicate and store
    const uniqueGoals = [...new Set(goals)].slice(0, 15);
    this.activeGoalsCache.set(businessId, uniqueGoals);

    return uniqueGoals;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROCESS LOGGING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Log the full conscious process to BusinessEvent.
   *
   * Every conscious process is logged for transparency and so KEY
   * can reflect on its own cognitive patterns over time.
   */
  async logConsciousProcess(
    businessId: string,
    response: ConsciousResponse,
  ): Promise<void> {
    await this.eventService.logEvent({
      businessId,
      type: BusinessEventType.DECISION_MADE,
      module: 'key_cortex',
      source: 'consciousness_orchestrator',
      action: 'conscious_process_complete',
      payload: {
        layersUsed: [
          'L1_emotion',
          'L2_reasoning',
          'L4_intuition',
          'L5_metacognition',
          'L7_ethics',
          'L8_temporal',
        ],
        confidence: response.confidence.confidence,
        ethicalPermitted: response.ethical.permitted,
        reasoningMode: response.reasoning.bestChain.mode,
        reasoningTimeMs: response.meta.reasoningTimeMs,
        tokensUsed: response.meta.tokensUsed,
        cost: response.meta.cost,
        actionCount: response.actions.length,
        requiresApproval: response.actions.some((a) => a.requiresApproval),
      },
      genomeSignal: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Mind State
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check if a query is educational in nature.
   */
  private isEducationalQuery(query: string): boolean {
    const eduPatterns = [
      /how (do|does|can|should) (i|we|you)/i,
      /what (is|are|does) \w+ mean/i,
      /explain/i,
      /teach me/i,
      /why (is|are|do|does)/i,
      /what (if|would|happens)/i,
      /help me understand/i,
      /what (is|are) the (difference|benefits|steps)/i,
    ];
    return eduPatterns.some((p) => p.test(query));
  }

  /**
   * Infer mind state from recent activity patterns.
   */
  private async inferMindStateFromActivity(
    businessId: string,
  ): Promise<MindState> {
    const hour = new Date().getHours();

    if (hour >= 2 && hour <= 5) return 'dreaming';

    const recentEvents = await this.eventService.getEvents(businessId, {
      limit: 10,
    });

    if (recentEvents.length === 0) return 'reflecting';

    const lastEventTime = recentEvents[0]?.createdAt;
    if (lastEventTime) {
      const idleMinutes =
        (Date.now() - new Date(lastEventTime).getTime()) / (1000 * 60);
      if (idleMinutes > 30) return 'reflecting';
    }

    // Check for stress signals
    const stressEvents = recentEvents.filter((e) => {
      const payload = e.metadata as Record<string, unknown>;
      return (
        (payload.severity as string) === 'high' ||
        (payload.severity as string) === 'critical'
      );
    });
    if (stressEvents.length > 0) return 'alert';

    return 'active';
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Response Synthesis
  // ═══════════════════════════════════════════════════════════════

  /**
   * Extract actionable items from reasoning chains.
   */
  private extractActionsFromReasoning(
    reasoning: MultiModalReasoningResult,
  ): Array<{ command: string; requiresApproval: boolean }> {
    const actions: Array<{ command: string; requiresApproval: boolean }> = [];

    for (const chain of reasoning.chains) {
      for (const step of chain.steps) {
        // Look for actionable language in reasoning steps
        const actionPatterns = [
          /(create|schedule|send|update|delete|generate|execute)\s+\w+/i,
          /(recommend|suggest)s?\s+(to\s+)?\w+/i,
          /(should|need to|must)\s+\w+/i,
        ];

        for (const pattern of actionPatterns) {
          const match = step.thought.match(pattern);
          if (match) {
            const command = match[0];
            const requiresApproval =
              chain.mode === 'strategic' ||
              chain.mode === 'counterfactual' ||
              step.thought.toLowerCase().includes('approval') ||
              step.thought.toLowerCase().includes('confirm');

            actions.push({ command, requiresApproval });
          }
        }
      }
    }

    // Deduplicate by command text
    const seen = new Set<string>();
    return actions.filter((a) => {
      if (seen.has(a.command)) return false;
      seen.add(a.command);
      return true;
    });
  }

  /**
   * Filter temporal context to only show relevant information.
   */
  private filterRelevantTemporal(
    temporal: TemporalAnalysis,
    reasoning: MultiModalReasoningResult,
  ): string | null {
    // KeyCortexTemporalReasoningService.getTemporalContext returns a preformatted
    // STRING, not a TemporalAnalysis — the call site asserts across that gap. If
    // the assertion is ever wrong (it is, for that path), reading .anomalies here
    // throws and takes the whole conscious pipeline down. Accept both shapes.
    if (typeof temporal === 'string') {
      const text = (temporal as string).trim();
      return text.length > 0 ? text : null;
    }
    if (
      !temporal ||
      !Array.isArray(temporal.anomalies) ||
      !Array.isArray(temporal.cycles)
    ) {
      return null;
    }

    const keywords = reasoning.bestChain.conclusion
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);

    const relevantParts: string[] = [];

    // Check for relevant anomalies
    const relevantAnomalies = temporal.anomalies.filter((a) =>
      keywords.some((k) => a.metric.toLowerCase().includes(k)),
    );
    if (relevantAnomalies.length > 0) {
      relevantParts.push(
        `Anomaly detected: ${relevantAnomalies[0].metric} was ` +
          `${relevantAnomalies[0].actual} (expected ${relevantAnomalies[0].expected}, ` +
          `${relevantAnomalies[0].severity} severity)`,
      );
    }

    // Check for relevant cycles
    const relevantCycles = temporal.cycles.filter((c) =>
      keywords.some((k) => c.name.toLowerCase().includes(k)),
    );
    if (relevantCycles.length > 0) {
      const cycle = relevantCycles[0];
      relevantParts.push(
        `Seasonal pattern: ${cycle.name} peaks on ${cycle.peakDay} ` +
          `(${Math.round(cycle.strength * 100)}% strength)`,
      );
    }

    // Check for forecast relevance
    if (temporal.forecast.length > 0) {
      const forecast = temporal.forecast[0];
      relevantParts.push(
        `Forecast for ${forecast.period}: ${Math.round(forecast.predictedValue)} ` +
          `(confidence interval: ${Math.round(forecast.confidenceInterval[0])}-` +
          `${Math.round(forecast.confidenceInterval[1])})`,
      );
    }

    return relevantParts.length > 0 ? relevantParts.join('; ') : null;
  }

  /**
   * Create a fallback response when the pipeline fails.
   */
  private createFallbackResponse(
    query: string,
    session: CortexSession,
    errorMessage: string,
  ): ConsciousResponse {
    this.logger.warn(
      `[Consciousness] Creating fallback response due to pipeline error`,
    );

    const safeMessage =
      `I encountered an issue while processing your request about "${query.substring(0, 40)}...". ` +
      `I'm operating in a simplified mode right now, but I'm still here to help. ` +
      `Could you try rephrasing your question?`;

    return {
      text: safeMessage,
      emotion: {
        adaptPersona: false,
        suggestedPersona: session.persona,
        toneAdjustment: {
          speed: 'normal',
          detail: 'normal',
          empathy: 0.8,
          urgency: 0.3,
        },
        shouldProactivelyHelp: false,
        comfortMessage:
          "Don't worry — even when I'm having trouble, I'll do my best to help you.",
      },
      reasoning: {
        chains: [],
        bestChain: {
          mode: 'analytical',
          steps: [
            {
              number: 1,
              thought: 'Pipeline encountered an error, falling back to safe mode',
              evidence: [],
              confidence: 0.5,
            },
          ],
          confidence: 0.5,
          conclusion: safeMessage,
          supportingEvidence: [],
          counterArguments: [],
          timeMs: 0,
        },
        consensus: 'Pipeline error — fallback mode activated',
        disagreements: [],
        overallConfidence: 0.5,
        reasoningTimeMs: 0,
      },
      confidence: {
        statement: query,
        confidence: 0.5,
        reasoning: 'Pipeline error — confidence is neutral due to fallback mode',
        supportingEvidence: [],
        caveats: [
          'Operating in fallback mode due to processing error',
          errorMessage,
        ],
        historicalAccuracy: 0.5,
      },
      ethical: {
        action: 'fallback_response',
        permitted: true,
        confidence: 1.0,
        principles: [
          {
            principle: 'safety',
            score: 1.0,
            explanation: 'Fallback mode prevents harmful incorrect outputs',
          },
          {
            principle: 'transparency',
            score: 1.0,
            explanation: 'User is informed about the processing issue',
          },
        ],
        stakeholders: [
          {
            stakeholder: 'user',
            impact: 'neutral',
            explanation: 'User receives a safe but limited response',
          },
        ],
        explanation:
          'Fallback mode is ethically sound — it prioritizes user safety over completeness.',
      },
      actions: [],
      meta: {
        reasoningTimeMs: 0,
        modelsUsed: ['fallback'],
        tokensUsed: 0,
        cost: 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Snapshot
  // ═══════════════════════════════════════════════════════════════

  /**
   * Detect current emotional state from recent business activity.
   */
  private async detectCurrentEmotion(
    businessId: string,
  ): Promise<EmotionalState> {
    try {
      // Get recent events to infer business "mood"
      const recentEvents = await this.eventService.getEvents(businessId, {
        limit: 20,
      });

      if (recentEvents.length === 0) {
        return {
          primary: 'calm',
          intensity: 0.3,
          confidence: 0.5,
          triggers: ['no recent activity'],
          trend: 'stable',
        };
      }

      // Count event types to infer state
      const alertCount = recentEvents.filter(
        (e) => e.eventType === BusinessEventType.ALERT_TRIGGERED,
      ).length;
      const autonomyCount = recentEvents.filter(
        (e) => e.eventType === BusinessEventType.AUTONOMY_EXERCISED,
      ).length;
      const genomeCount = recentEvents.filter(
        (e) => e.eventType === BusinessEventType.GENOME_EVOLUTION,
      ).length;

      if (alertCount >= 3) {
        return {
          primary: 'stressed',
          intensity: 0.6 + Math.min(alertCount * 0.1, 0.3),
          confidence: 0.7,
          triggers: [`${alertCount} recent alerts`],
          trend: alertCount > 5 ? 'declining' : 'stable',
        };
      }

      if (autonomyCount >= 2 && genomeCount >= 1) {
        return {
          primary: 'excited',
          intensity: 0.5,
          confidence: 0.6,
          triggers: ['autonomous actions executing', 'genome evolving'],
          trend: 'improving',
        };
      }

      return {
        primary: 'calm',
        intensity: 0.4,
        confidence: 0.8,
        triggers: ['normal business activity'],
        trend: 'stable',
      };
    } catch {
      return {
        primary: 'calm',
        intensity: 0.3,
        confidence: 0.5,
        triggers: ['unable to determine'],
        trend: 'stable',
      };
    }
  }

  /**
   * Select the dominant reasoning mode from the self-model.
   */
  private selectDominantReasoningMode(selfModel: SelfModel): ReasoningMode {
    // Find the capability with highest proficiency
    const reasoningCaps = selfModel.capabilities.filter((c) =>
      [
        'analytical',
        'creative',
        'critical',
        'strategic',
        'analogical',
        'counterfactual',
        'probabilistic',
      ].includes(c.name),
    );

    if (reasoningCaps.length === 0) return 'analytical';

    const best = reasoningCaps.reduce((a, b) =>
      a.proficiency > b.proficiency ? a : b,
    );
    return best.name as ReasoningMode;
  }

  /**
   * Compute overall business health score (0-100).
   */
  private async computeBusinessHealth(businessId: string): Promise<number> {
    try {
      const selfModel = await this.metacognition.buildSelfModel(businessId);
      // Composite: weighted average of accuracy metrics
      const health =
        selfModel.recommendationAccuracy * 0.3 +
        selfModel.actionSuccessRate * 0.3 +
        selfModel.userApprovalRate * 0.2 +
        selfModel.predictionAccuracy * 0.2;
      return Math.round(health * 100);
    } catch {
      return 50; // neutral default
    }
  }

  /**
   * Count pending tasks for a business.
   */
  private async countPendingTasks(businessId: string): Promise<number> {
    try {
      const pendingEvents = await this.eventService.getEvents(businessId, {
        type: BusinessEventType.ACTION_EXECUTED,
        limit: 50,
      });
      return pendingEvents.filter((e) => {
        const payload = e.metadata as Record<string, unknown>;
        return payload.result === 'pending';
      }).length;
    } catch {
      return 0;
    }
  }

  /**
   * Count unread alerts for a business.
   */
  private async countUnreadAlerts(businessId: string): Promise<number> {
    try {
      const alerts = await this.eventService.getEvents(businessId, {
        type: BusinessEventType.ALERT_TRIGGERED,
        limit: 50,
      });
      return alerts.filter((e) => {
        const payload = e.metadata as Record<string, unknown>;
        return (payload.read as boolean) !== true;
      }).length;
    } catch {
      return 0;
    }
  }

  /**
   * Get the current genome stage for a business.
   */
  private async getGenomeStage(businessId: string): Promise<string> {
    try {
      // getGenomeState does not exist; getGenomeIntelligence carries `stage`.
      const genomeState = await this.genomeBridge.getGenomeIntelligence(businessId);
      return (genomeState?.stage as string) ?? 'initializing';
    } catch {
      return 'unknown';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Caching
  // ═══════════════════════════════════════════════════════════════

  /**
   * Update the snapshot cache for a business.
   */
  private async updateSnapshotCache(
    businessId: string,
    partial: Partial<ConsciousnessSnapshot>,
  ): Promise<void> {
    const existing = this.snapshotCache.get(businessId);
    const updated: ConsciousnessSnapshot = {
      ...existing,
      ...partial,
      timestamp: new Date(),
    } as ConsciousnessSnapshot;
    this.snapshotCache.set(businessId, updated);
  }

  /**
   * Buffer a process log for a business (ring buffer, last 100).
   */
  private bufferProcessLog(
    businessId: string,
    log: ConsciousProcessLog,
  ): void {
    const existing = this.processLogBuffer.get(businessId) ?? [];
    existing.push(log);
    if (existing.length > 100) existing.shift();
    this.processLogBuffer.set(businessId, existing);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Utilities
  // ═══════════════════════════════════════════════════════════════

  /** Emoji indicators for each reasoning mode */
  private modeEmoji(mode: ReasoningMode): string {
    const map: Record<ReasoningMode, string> = {
      analytical: '🔬',
      creative: '💡',
      critical: '🔍',
      strategic: '♟️',
      analogical: '🔗',
      counterfactual: '🔄',
      probabilistic: '📊',
    };
    return map[mode] ?? '🧠';
  }

  /** Capitalize first letter */
  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Rough token estimation (4 chars ≈ 1 token) */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Rough cost estimation based on model chain count */
  private estimateCost(chainCount: number): number {
    // Approximate: $0.002 per 1K tokens, each chain ~500 tokens
    return Math.round(chainCount * 500 * 0.002 * 100) / 100;
  }
}
