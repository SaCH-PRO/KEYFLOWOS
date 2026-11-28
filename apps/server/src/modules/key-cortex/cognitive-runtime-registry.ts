/**
 * RR-COG-RUNTIME-ENTRY-CENSUS (D-261, D-262, D-17, D-208, D-129)
 *
 * Read-only exact-match inventory of every entry point in `apps/server/src`
 * that starts a KEY cognitive turn (`FlowOrchestratorService.chat`/`streamChat`,
 * `KeyCortexConsciousnessService.processConsciously`,
 * `KeyCortexReasoningService.processQuery`,
 * `KeyCortexQueryPipelineService.processQuery`) or passes `tools` / `toolChoice`
 * to a model/realtime bridge call.
 *
 * Enforced by `cognitive-runtime-census.spec.ts`:
 *  - Any unregistered cognitive entry or model tool-offering call fails CI.
 *  - Any stale entry whose call site was removed fails CI.
 *  - Every `processConsciously` caller MUST be `owner-only` (D-208, D-129).
 *
 * D-17 keeps both Flow and Cortex pipelines in v1; this first slice converges
 * nothing and makes zero runtime or schema changes.
 */

export type CognitiveRuntimeId =
  | 'flow-orchestrator'
  | 'cortex-consciousness'
  | 'cortex-reasoning'
  | 'cortex-query-pipeline'
  | 'intent-parser'
  | 'phone-voice-realtime';

export type CognitiveReachability = 'member' | 'memberless' | 'owner-only';

export type CognitiveAuthorityPath =
  | 'Flow confirmation boundary'
  | 'Cortex autonomy orchestrator'
  | 'none (read-only)';

export type CognitiveEntrySignal =
  | 'flow-chat'
  | 'flow-stream-chat'
  | 'processConsciously'
  | 'processQuery'
  | 'model-tools-call';

export interface CognitiveRuntimeEntry {
  readonly runtimeId: CognitiveRuntimeId;
  readonly file: string;
  readonly method: string;
  readonly signal: CognitiveEntrySignal;
  readonly reachableBy: CognitiveReachability;
  readonly toolsOffered: boolean;
  readonly authorityPath: CognitiveAuthorityPath;
  readonly notes: string;
}

export const COGNITIVE_RUNTIME_ENTRIES: readonly CognitiveRuntimeEntry[] = [
  // ── FlowOrchestratorService callers & internal model/escalation sites ──
  {
    runtimeId: 'flow-orchestrator',
    file: 'apps/server/src/modules/ai/flow.controller.ts',
    method: 'flowChat',
    signal: 'flow-chat',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Flow confirmation boundary',
    notes:
      'POST /ai/businesses/:businessId/flow/chat — authenticated business member turn passing user.id through FlowOrchestratorService.chat.',
  },
  {
    runtimeId: 'flow-orchestrator',
    file: 'apps/server/src/modules/ai/flow.controller.ts',
    method: 'flowChatStream',
    signal: 'flow-stream-chat',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Flow confirmation boundary',
    notes:
      'POST /ai/businesses/:businessId/flow/chat/stream — authenticated SSE streaming turn passing user.id through FlowOrchestratorService.streamChat.',
  },
  {
    runtimeId: 'flow-orchestrator',
    file: 'apps/server/src/modules/ai/flow.controller.ts',
    method: 'confirmAction',
    signal: 'flow-chat',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Flow confirmation boundary',
    notes:
      'POST /ai/businesses/:businessId/flow/confirm — authenticated member confirmation resume invoking FlowOrchestratorService.chat with member-bound confirmation token.',
  },
  {
    runtimeId: 'flow-orchestrator',
    file: 'apps/server/src/modules/structure/staff-chat-bridge.service.ts',
    method: 'routeInboundMessage',
    signal: 'flow-chat',
    reachableBy: 'memberless',
    toolsOffered: true,
    authorityPath: 'Flow confirmation boundary',
    notes:
      'WhatsApp/SMS staff bridge calling FlowOrchestratorService.chat with userId=undefined, bounded by server-only jobRoleEnvelope and positionHolderUserId.',
  },
  {
    runtimeId: 'flow-orchestrator',
    file: 'apps/server/src/modules/chatwoot/chatwoot.service.ts',
    method: 'handleWebhook',
    signal: 'flow-chat',
    reachableBy: 'memberless',
    toolsOffered: true,
    authorityPath: 'Flow confirmation boundary',
    notes:
      'Chatwoot customer-support webhook calling FlowOrchestratorService.chat with no userId on surface helpdesk.',
  },
  {
    runtimeId: 'flow-orchestrator',
    file: 'apps/server/src/modules/ai/flow-orchestrator.service.ts',
    method: 'chat',
    signal: 'model-tools-call',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Flow confirmation boundary',
    notes:
      'ModelGatewayService.complete call offering selected FLOW_TOOLS with toolChoice auto (omitted on reflex tier) under Flow confirmation & member-scope boundary.',
  },
  {
    runtimeId: 'flow-orchestrator',
    file: 'apps/server/src/modules/ai/flow-orchestrator.service.ts',
    method: 'streamChat',
    signal: 'model-tools-call',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Flow confirmation boundary',
    notes:
      'ModelGatewayService.streamComplete call offering selected FLOW_TOOLS with toolChoice auto (omitted on reflex tier) under Flow confirmation & member-scope boundary.',
  },
  {
    runtimeId: 'cortex-consciousness',
    file: 'apps/server/src/modules/ai/flow-orchestrator.service.ts',
    method: 'deliberate',
    signal: 'processConsciously',
    reachableBy: 'owner-only',
    toolsOffered: false,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'Deliberative escalation from Flow into KeyCortexConsciousnessService.processConsciously; gated owner-only via mayReadFullKeyContext (D-129/D-140/D-208), falling back to member viewer fast path when withheld.',
  },

  // ── IntentParserService tool-forced structured extraction ──
  {
    runtimeId: 'intent-parser',
    file: 'apps/server/src/modules/ai/intent-parser.service.ts',
    method: 'parse',
    signal: 'model-tools-call',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'none (read-only)',
    notes:
      'ModelGatewayService.complete forcing toolChoice parse_intent purely for structured JSON extraction; executes no tool side effects.',
  },

  // ── KeyCortexConsciousnessService & KeyCortexReasoningService callers ──
  {
    runtimeId: 'cortex-consciousness',
    file: 'apps/server/src/modules/key-cortex/key-cortex.controller.ts',
    method: 'consciousChat',
    signal: 'processConsciously',
    reachableBy: 'owner-only',
    toolsOffered: false,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'POST /api/v1/cortex/conscious/chat (ai:write) invoking KeyCortexConsciousnessService.processConsciously; gated owner-only via mayReadFullKeyContext (D-129/D-208).',
  },
  {
    runtimeId: 'cortex-consciousness',
    file: 'apps/server/src/modules/key-cortex/key-cortex.controller.ts',
    method: 'consciousStream',
    signal: 'processConsciously',
    reachableBy: 'owner-only',
    toolsOffered: false,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'SSE /api/v1/cortex/conscious/stream invoking KeyCortexConsciousnessService.processConsciously; gated owner-only via mayReadFullKeyContext (D-129/D-208).',
  },
  {
    runtimeId: 'cortex-reasoning',
    file: 'apps/server/src/modules/key-cortex/key-cortex.controller.ts',
    method: 'chat',
    signal: 'processQuery',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'POST /api/v1/cortex/chat — authenticated member turn delegating to KeyCortexReasoningService.processQuery with request actorId.',
  },
  {
    runtimeId: 'cortex-query-pipeline',
    file: 'apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts',
    method: 'processQuery',
    signal: 'processQuery',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'KeyCortexReasoningService.processQuery delegating turn execution to KeyCortexQueryPipelineService.processQuery.',
  },
  {
    runtimeId: 'cortex-reasoning',
    file: 'apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts',
    method: 'streamReasoning',
    signal: 'processQuery',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'Async streaming reasoning wrapper invoking this.processQuery with authenticated userId/businessId.',
  },
  {
    runtimeId: 'cortex-query-pipeline',
    file: 'apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts',
    method: 'processQuery',
    signal: 'model-tools-call',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'ModelGatewayService.complete passing Cortex organ/action tool definitions gated by memberToolLoop and Cortex autonomy orchestrator.',
  },
  {
    runtimeId: 'cortex-query-pipeline',
    file: 'apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts',
    method: 'streamQuery',
    signal: 'model-tools-call',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'ModelGatewayService.streamComplete passing Cortex organ/action tool definitions gated by memberToolLoop and Cortex autonomy orchestrator.',
  },

  // ── PhoneVoice Realtime Bridge ──
  {
    runtimeId: 'phone-voice-realtime',
    file: 'apps/server/src/modules/phone-voice/phone-voice.service.ts',
    method: 'handleClient',
    signal: 'model-tools-call',
    reachableBy: 'memberless',
    toolsOffered: true,
    authorityPath: 'Flow confirmation boundary',
    notes:
      'Telephony WebSocket bridge offering RECEPTIONIST_TOOLS (calendar_check_conflicts, bookings_create_booking, helpdesk_create_ticket) to OpenAI Realtime and dispatching via FlowOrchestratorService.executeToolByName on PHONE_SURFACE.',
  },
];
