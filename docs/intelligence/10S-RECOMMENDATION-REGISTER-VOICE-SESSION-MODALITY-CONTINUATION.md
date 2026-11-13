# KeyFlowOS Recommendation Register — Voice Session & Modality Continuation

## KF-REC-060 — Establish a Voice Session & Modality Contract

Status: PROVISIONAL / STRONGLY SUPPORTED TARGET
Primary journey: J22 KEY Voice.

Preserve separate voice transports while requiring one semantic contract:

trusted voice transport
→ VoiceSessionOccurrence
→ business + session principal
→ ConversationOccurrence
→ exact VoiceActionCandidate
→ generic authority / Clearance
→ ExecutionClaim
→ effect / provider outcome
→ transcript + outcome evidence
→ usage/provider-cost evidence
→ terminal/recovery state

KF-REC-060 owns voice transport/session identity, transport-specific authentication/binding, session-principal provenance, VoiceSessionOccurrence-to-ConversationOccurrence linkage, voice-action handoff, transcript/session evidence linkage, voice metering participation and voice interruption/terminal semantics.

It delegates conversation processing to KF-REC-057, provider ingress to J14/K9, authority/governance to J2/J15/K2/K3/K5, generic evidence to K8, recovery to KF-REC-048, metering to KF-REC-058, privacy to J19 and public/bearer grants to KF-REC-059.

Migration direction:
1. bounded Phone Voice stream bootstrap capability;
2. trusted tenant derivation at each consequential transport;
3. map each mode to VoiceSessionOccurrence;
4. route material tools through canonical governed action;
5. persist transcript/tool/outcome references where required;
6. correlate realtime/TTS/STT with usage/provider cost;
7. preserve provider/session ids for recovery;
8. normalize terminal/interrupted/unknown state without one mandatory table;
9. apply J19 retention/correction to recordings/transcripts and derived knowledge.

Proof ratchets include replay/wrong-business rejection, text/voice governance parity, causal session/tool/outcome trace, realtime metering parity, provider/session race handling, interruption recovery and privacy correction.

No production implementation is authorized by KF-REC-060.
