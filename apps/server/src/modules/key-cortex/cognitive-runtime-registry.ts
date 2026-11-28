/**
 * RR-COG-RUNTIME-ENTRY-CENSUS (D-261, D-262, D-17, D-208, D-129)
 *
 * Read-only exact-match inventory of every entry point in `apps/server/src`
 * that starts a KEY cognitive turn (`FlowOrchestratorService.chat`/`streamChat`,
 * `KeyCortexConsciousnessService.processConsciously`,
 * `KeyCortexReasoningService.processQuery`/`streamQuery`/`streamReasoning`,
 * `KeyCortexQueryPipelineService.processQuery`/`streamQuery`) or passes
 * `tools` / `toolChoice` / `tool_choice` to a model or realtime bridge call.
 *
 * Enforced by `cognitive-runtime-census.spec.ts`:
 *  - Any unregistered cognitive entry or model/realtime tool-offering call fails CI.
 *  - Any stale entry whose call site was removed fails CI.
 *  - Every `processConsciously` caller MUST be `owner-only` (D-208, D-129),
 *    and `KeyCortexConsciousnessService.processConsciously` MUST invoke
 *    `mayReadFullKeyContext(...)` in an early-return guard before Step 1.
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

export type CognitiveReachability =
  | 'member'
  | 'member-and-memberless'
  | 'memberless'
  | 'owner-only';

export type CognitiveAuthorityPath =
  | 'Flow confirmation boundary'
  | 'Cortex autonomy orchestrator'
  | 'PhoneVoice dispatch + memberless allowlist + KeyActionBoundary'
  | 'none (read-only)';

export type CognitiveEntrySignal =
  | 'flow-chat'
  | 'flow-stream-chat'
  | 'processConsciously'
  | 'processQuery'
  | 'streamQuery'
  | 'streamReasoning'
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
    reachableBy: 'member-and-memberless',
    toolsOffered: true,
    authorityPath: 'Flow confirmation boundary',
    notes:
      'AiUsageService.trackAndComplete (wrapping ModelGatewayService) offering selected FLOW_TOOLS with toolChoice auto (omitted on reflex tier); reached by both member HTTP callers and memberless bridges (staff-chat-bridge, chatwoot), bounded by memberless-key-tools.ts / jobRoleEnvelope and Flow confirmation boundary.',
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
      'AiUsageService.trackAndStream (wrapping ModelGatewayService) offering selected FLOW_TOOLS with toolChoice auto (omitted on reflex tier) under Flow confirmation & member-scope boundary.',
  },
  {
    runtimeId: 'cortex-consciousness',
    file: 'apps/server/src/modules/ai/flow-orchestrator.service.ts',
    method: 'deliberate',
    signal: 'processConsciously',
    reachableBy: 'owner-only',
    toolsOffered: false,
    authorityPath: 'none (read-only)',
    notes:
      'Deliberative escalation from Flow into KeyCortexConsciousnessService.processConsciously (proposal-only, no executor); gated owner-only via STEP 0 mayReadFullKeyContext (D-129/D-140/D-208), falling back to member fast path when withheld.',
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
      'AiUsageService.trackAndComplete (wrapping ModelGatewayService) forcing toolChoice parse_intent purely for structured JSON extraction; executes no tool side effects.',
  },

  // ── KeyCortexConsciousnessService & KeyCortexReasoningService callers ──
  {
    runtimeId: 'cortex-consciousness',
    file: 'apps/server/src/modules/key-cortex/key-cortex.controller.ts',
    method: 'consciousChat',
    signal: 'processConsciously',
    reachableBy: 'owner-only',
    toolsOffered: false,
    authorityPath: 'none (read-only)',
    notes:
      'POST /api/v1/cortex/conscious/chat (AuthGuard, BusinessGuard, ModuleScopeGuard ai:write) invoking KeyCortexConsciousnessService.processConsciously (proposal-only, no executor); gated owner-only via STEP 0 mayReadFullKeyContext (D-129/D-208).',
  },
  {
    runtimeId: 'cortex-consciousness',
    file: 'apps/server/src/modules/key-cortex/key-cortex.controller.ts',
    method: 'consciousStream',
    signal: 'processConsciously',
    reachableBy: 'owner-only',
    toolsOffered: false,
    authorityPath: 'none (read-only)',
    notes:
      'SSE /api/v1/cortex/conscious/stream (class-level AuthGuard, BusinessGuard — no route ModuleScopeGuard) invoking KeyCortexConsciousnessService.processConsciously (proposal-only, no executor); gated owner-only via STEP 0 mayReadFullKeyContext (D-129/D-208).',
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
    runtimeId: 'cortex-reasoning',
    file: 'apps/server/src/modules/key-cortex/key-cortex.controller.ts',
    method: 'streamChat',
    signal: 'streamQuery',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'GET /api/v1/cortex/chat/stream (SSE) — authenticated member streaming turn delegating to KeyCortexReasoningService.streamQuery with request actorId.',
  },
  {
    runtimeId: 'cortex-reasoning',
    file: 'apps/server/src/modules/key-cortex/key-cortex.controller.ts',
    method: 'streamEvents',
    signal: 'streamQuery',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'GET /api/v1/cortex/stream (SSE) — authenticated member turn invoking KeyCortexReasoningService.streamQuery when query message is supplied.',
  },
  {
    runtimeId: 'cortex-reasoning',
    file: 'apps/server/src/modules/key-cortex/key-cortex.gateway.ts',
    method: 'handleChat',
    signal: 'streamReasoning',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'WebSocket @SubscribeMessage("key:chat") — authenticated member socket turn invoking KeyCortexReasoningService.streamReasoning.',
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
    runtimeId: 'cortex-query-pipeline',
    file: 'apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts',
    method: 'streamQuery',
    signal: 'streamQuery',
    reachableBy: 'member',
    toolsOffered: true,
    authorityPath: 'Cortex autonomy orchestrator',
    notes:
      'KeyCortexReasoningService.streamQuery delegating streaming turn execution to KeyCortexQueryPipelineService.streamQuery.',
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
    authorityPath: 'PhoneVoice dispatch + memberless allowlist + KeyActionBoundary',
    notes:
      'Telephony WebSocket bridge offering RECEPTIONIST_TOOLS via RealtimeBridgeService.openSession; executeVoiceTool calls FlowOrchestratorService.executeToolByName (bypassing executeTool confirmation binding) and enforces PHONE_WRITES_OUTSIDE_THE_BOUNDARY, memberlessKeyToolRefusal, and KeyActionBoundary PHONE_STREAM refusal (note: calendar_check_conflicts omits { surface: PHONE_SURFACE }).',
  },
  {
    runtimeId: 'phone-voice-realtime',
    file: 'apps/server/src/modules/phone-voice/realtime-bridge.service.ts',
    method: 'openSession',
    signal: 'model-tools-call',
    reachableBy: 'memberless',
    toolsOffered: true,
    authorityPath: 'PhoneVoice dispatch + memberless allowlist + KeyActionBoundary',
    notes:
      'OpenAI Realtime WebSocket transport sending session.update with nested session.tools and session.tool_choice="auto" on behalf of PhoneVoiceService.handleClient.',
  },
];
