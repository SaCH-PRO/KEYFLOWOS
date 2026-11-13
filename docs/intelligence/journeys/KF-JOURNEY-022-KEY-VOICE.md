# KF-JOURNEY-022 — KEY Voice

Checkpoint: J22-CONV-2026-09-17-01
Status: PROVISIONALLY TARGET-ALIGNED — NAMED VOICE SESSION / MODALITY CORE ONLY
Implementation forensic baseline: main@8f173bfe79f1418159cf4099ea18b0d60d203ec2.

Primary kernels: K1, K3, K5, K8, K9, K11.
Secondary kernels: K2, K7, K12.
Adjacent journeys: J2, J5, J13, J14, J15, J18, J20, J21, J23.

Production implementation remains READ-ONLY / UNAUTHORIZED. Runtime/model/provider/voice-session proof has not been executed.

## Definition

J22 models KEY voice as several physical modalities that must obey one semantic contract:

- external phone voice through Twilio Media Streams and OpenAI Realtime;
- authenticated in-app full-duplex voice through LiveKit and the voice-agent worker;
- authenticated TTS/STT APIs;
- browser push-to-talk/transcription feeding KEY conversation;
- older/richer phone lifecycle code whose reachability differs from the active bridge.

Prime law:

VOICE TRANSPORT
!= VOICE SESSION IDENTITY
!= CONVERSATION OCCURRENCE
!= ACTION AUTHORITY
!= BUSINESS EFFECT
!= PROVIDER / USAGE EVIDENCE

## Selected target

KF-REC-060 — Voice Session & Modality Contract

Trusted voice transport
→ VoiceSessionOccurrence
→ trusted Business binding
→ SessionPrincipal provenance
→ conversation turn / transcript evidence
→ ConversationOccurrence / processing policy
→ exact VoiceActionCandidate
→ K2/K3/K5 authority + governance / Clearance
→ ExecutionClaim
→ domain/provider effect
→ OutcomeEvidence
→ usage/provider-cost evidence
→ terminal/interrupted/unknown session state
→ recovery/reconciliation

This composes existing kernels rather than creating a voice-specific authorization engine.

## Phone Voice

Positive initial ingress seam:
- Twilio HTTP webhook validates provider signature over the visible URL, including businessId;
- missing signing configuration fails closed unless the explicit local-development escape hatch is enabled;
- authenticated HTTP ingress emits the business-scoped stream URL.

The active PhoneVoiceService then independently upgrades:
  /api/v1/cortex/phone/stream?businessId=<id>

and reads businessId from that WebSocket URL before an observed stream-specific signed capability or provider-account lookup.

This is the existing F226/C176 root. J22 only refines the fixed-baseline path exactness.

Target: authenticated HTTP ingress issues a bounded stream/session capability; the query parameter may route but must not itself establish consequential tenant authority.

## Phone Voice action governance

Phone voice exposes calendar conflict checks, booking creation and helpdesk ticket creation.

Malformed model function arguments are now rejected rather than executed with an empty object, a positive seam.

But PhoneVoiceService invokes FlowOrchestratorService.executeToolByName(), whose current implementation directly delegates to executeToolAction(). It does not itself run the chat path's governance evaluation.

This is not a new voice root. It is a manifestation of F224/C174 and the established J2/J15 direct-execution pressure.

External caller speech expresses customer intent; it is not Membership authority.

## Phone Voice evidence

The active bridge accumulates transcript in memory and best-effort updates KeyCallSession by callSid on stop/close. It does not create that row in the inspected active bridge.

A separate KeyCortexPhoneService contains richer session creation, called-number tenant resolution, callbacks, recording and analysis, but prior J5 tracing left its active production reachability unresolved.

Therefore active bridge transcript update is not proof that a durable session row exists. This remains J5/K8/J18 evidence pressure, not a new root.

## LiveKit in-app voice

Positive seams:
- voice-session creation is AuthGuard + BusinessGuard protected;
- server creates room metadata with businessId/userId;
- server mints the join token;
- durable VoiceSession is created;
- room/participant reads re-check business ownership;
- client hangup is business/session scoped and idempotent;
- LiveKit webhook is provider-signature verified.

The browser workspace id remains selection context only; server-side guards establish the session boundary.

## LiveKit agent worker

The voice-agent worker reads businessId/userId from server-created room metadata and uses OpenAI Realtime.

Its current transfer_to_human tool directly creates a SupportTicket in the database.

That mutation does not demonstrate the generic capability/effective-authority/Clearance boundary. It strengthens F224/J2/J15/K3/K5 and does not receive a new J22 finding.

A broad voice session does not pre-clear future business tools.

## Transcript / outcome evidence

VoiceSession has transcript, summary, toolCalls, commandItems and terminal timestamps, but the current voice-agent agent_speech_committed hook is explicitly a no-op for future transcript persistence.

VoiceSession ACTIVE/ENDED therefore does not prove complete conversation or tool/outcome evidence.

This is K8/KF-REC-057 pressure, not a new root.

## TTS/STT and realtime metering

KeyflowVoiceService uses AiUsageService.trackAudio(), which applies pre-effect admission.

KeyCortexVoiceService calls OpenAI audio directly and records usage afterward with trackAudioUsage().

Phone RealtimeBridgeService and the LiveKit voice-agent worker use direct realtime provider paths; this trace did not establish AiUsageService/LLMProviderCost integration for them.

These are existing F231/C181 / KF-REC-058 specializations. J22 allocates no duplicate finding.

## Session contract invariants

1. Every consequential independently reachable voice transport has a verifiable session boundary.
2. BusinessId comes from trusted transport/session binding, not caller-controlled routing alone.
3. Voice participant identity is not Membership authority.
4. External caller intent is not operator authority.
5. Authenticated in-app voice does not pre-clear arbitrary tools.
6. Every material voice tool is an exact governed capability.
7. VoiceSessionOccurrence links to, but does not replace, J5 ConversationOccurrence.
8. Transport connection success is not business-action success.
9. Transcript presence is evidence, not authority.
10. Session ENDED is not proof all consequences succeeded.
11. Realtime uncertainty remains explicit.
12. Voice usage participates in KF-REC-058 admission/metering.
13. Realtime effects receive stable usage/provider-cost evidence.
14. Missing evidence is repaired without replaying the conversation/model effect.
15. Provider webhook authenticity does not eliminate tenant/current-session checks.
16. Human handoff/ticket creation is a real business capability.
17. Multiple transports may stay physically separate.
18. Recordings/transcripts follow J19 privacy/retention/correction rules.

## Allocation

No new finding or contradiction IDs.

Reused:
- F226/C176 — Phone Voice transport/tenant binding;
- F224/C174 plus F043/F054 — direct action governance;
- F222/C172 — conversation occurrence ownership;
- F225/C175 — truthful provider/conversation evidence;
- F231/C181 — voice admission/metering;
- KF-REC-048 — recovery;
- KF-REC-057 — conversation action;
- KF-REC-058 — entitlement/metering;
- KF-REC-059 — public/bearer boundary where applicable.

New recommendation: KF-REC-060 — Voice Session & Modality Contract.

## Proof obligations

J22-P01 through J22-P18 cover stream authentication/replay, wrong-business substitution, governance parity, external-caller authority, LiveKit token/webhook binding, session-end races, transcript/tool causal evidence, interrupted-session truth, TTS/STT and realtime metering, handoff governance, privacy, provider replay and VoiceSession/ConversationOccurrence linkage.

Bindings: 0. Runtime status: NOT_EXECUTED.

## Disposition

J22 = PROVISIONALLY_TARGET_ALIGNED_NAMED_VOICE_SESSION_MODALITY_CORE_ONLY.

All 25 canonical journeys now have dedicated dossiers. That is complete journey coverage, not implementation or runtime completion.

Next: whole-OS convergence closure.
