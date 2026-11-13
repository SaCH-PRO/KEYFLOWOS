# J22 KEY Voice — Microtrace 001

Checkpoint: J22-M001-2026-09-17-01
Baseline: main@8f173bfe79f1418159cf4099ea18b0d60d203ec2
Result: NAMED VOICE MODES TRACED; EXISTING ROOTS REUSED; VOICE SESSION CONTRACT SELECTED.

## Source scope

Inspected:
- PhoneVoiceController / PhoneVoiceService / RealtimeBridgeService;
- KeyCortexPhoneService as session-lifecycle reachability comparison;
- LivekitController / LivekitService;
- apps/voice-agent/src/main.ts;
- VoiceController, KeyflowVoiceService and KeyCortexVoiceService;
- browser live voice / push-to-talk surfaces;
- VoiceSession / KeyCallSession schema;
- FlowOrchestrator executeToolByName();
- J5 voice pressure and KF-REC-057.

No model/provider/runtime voice test was executed.

## Source refinements

1. Active fixed-baseline Phone Voice stream path is /api/v1/cortex/phone/stream; earlier F226 text carries an older/alternate path string, but the root is unchanged.
2. executeToolByName() directly calls executeToolAction(); the current comment overstates equivalence to the governed chat envelope.
3. Active PhoneVoiceService updates KeyCallSession but does not create it; the richer KeyCortexPhoneService creation lifecycle has unresolved active reachability.
4. LiveKit has a stronger server-created room + server-minted token + signed webhook seam.
5. The LiveKit agent worker directly creates SupportTicket for handoff and does not demonstrate generic governed-action admission.
6. The LiveKit agent transcript hook is a no-op.
7. KeyflowVoiceService performs pre-effect audio admission; KeyCortexVoiceService records audio usage post-effect.
8. Phone and LiveKit realtime provider usage is not connected to AiUsage/LLMProviderCost in this inspected source scope.

## Anti-duplication

No F234/C184 allocation.

Observed defects are already owned by F226/F224/F222/F225/F231 and their parent contracts.

A voice-specific composition target remains necessary, so KF-REC-060 is allocated.

## Closure

J22 is provisionally target-aligned at the named voice-session/modality core. Runtime, provider, exhaustive caller, privacy and migration proof remain open.
