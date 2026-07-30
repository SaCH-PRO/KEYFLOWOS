# Unified Bespoke KEYFLOWOS Chat Shell — Execution Plan

## Vision
Replace the fragmented `CopilotPanel`, `KeyCommandCenter`, `KeyPresence`, and `KeyVoiceButton` experiences with a single, bespoke, globally-available KEY chat shell. The new shell is first-party code (no Vercel AI SDK / assistant-ui runtime dependency), supports text, voice, file/image attachments, streaming, tool approvals, and session history, and is wired into the existing `FlowOrchestratorService` backend.

---

## Phase 1 — Strategic Foundation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Employee-replacement audit | ✅ Done | KEY is a broad co-pilot, not yet autonomous. Blockers documented: safety shell, rollback/compensation, webhook security, unified ingestion, closed learning loop. |
| 1.2 | Define scope: absorb legacy surfaces, keep command palette + push-to-talk | ✅ Done | New shell replaces chat surfaces; command palette and spacebar push-to-talk preserved in `KeyAgent`. |

---

## Phase 2 — Frontend Bespoke Chat Shell

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Shared types (`KeyChatAttachment`, `KeyChatMessage`, `KeyChatSession`, `KeyChatPageContext`, etc.) | ✅ Done | `apps/web/src/components/key/chat/types.ts` |
| 2.2 | Global React context/store (`KeyChatProvider`, `useKeyChat`) | ✅ Done | `apps/web/src/components/key/chat/key-chat-store.tsx` |
| 2.3 | Low-level SSE stream hook (`useKeyStream`) | ✅ Done | Parses `/flow/chat/stream`. Fixed attachment `contentType` mapping. |
| 2.4 | Chat actions hook (`useKeyChatActions`) | ✅ Done | Sends messages, handles confirmations, non-streaming fallback, loads/deletes sessions. |
| 2.5 | Voice input hook (`useVoiceInput`) + mic button | ✅ Done | Records audio, posts to `/voice/transcribe`, injects transcript into input. |
| 2.6 | Chat panel component (`KeyChatPanel`) | ✅ Done | Slide-over, responsive widths, history sidebar toggle. |
| 2.7 | Message list + bubbles + greeting | ✅ Done | `KeyChatMessages`, `KeyChatGreeting`. |
| 2.8 | Composer with drag/drop/paste attachments | ✅ Done | `KeyChatInput` reuses `useUpload`. `KeyAttachmentPreview`. |
| 2.9 | Markdown/code/tool-approval renderer | ✅ Done | `KeyMessageRenderer` + `KeyPlanCard`. |
| 2.10 | History sidebar (`KeyChatHistory`) | ✅ Done | UI exists and loads `/flow/sessions`; `chat()`/`streamChat()` now persist each turn to `FlowSession`. |
| 2.11 | Global integration (provider in `app/app/layout.tsx`, `KeyChatBubble`, `KeyAgent`) | ✅ Done | `KeyChatProvider` wraps app; `KeyAgent` opens new panel. |

---

## Phase 3 — Backend Chat Wiring

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Accept `attachments` + `sessionId` on chat endpoints | ✅ Done | `AiFlowController.flowChat` and `flowChatStream` accept attachments and `sessionId`. |
| 3.2 | Forward attachments to orchestrator | ✅ Done | `FlowOrchestratorService.chat()` / `streamChat()` accept `attachments?: FlowAttachment[]`. |
| 3.3 | Extract document/image content via `DocumentIntelligenceService` | ✅ Done | `buildAttachmentContext()` enriches the user message with OCR/structured extraction. |
| 3.4 | Use enriched message for role detection, memory, and LLM prompt | ✅ Done | Both `chat()` and `streamChat()` use enriched message. |
| 3.5 | Session persistence (save/load `FlowSession` messages) | ✅ Done | Every turn now saves user + assistant messages to `FlowSession`; new sessions get a generated `sessionId` returned to the frontend. |
| 3.6 | Multimodal payload compatibility for Anthropic/xAI fallback | ✅ Done | `model-gateway.service.ts` now converts OpenAI-style content arrays to Anthropic text/image blocks in both `callAnthropic` and `streamAnthropic`. xAI still accepts the OpenAI format natively. |
| 3.7 | Secure attachment access (public URL vs S3/objectPath fallback) | ✅ Done | `buildAttachmentContext()` now reads attachments via `objectPath` from S3 and passes base64 to `DocumentIntelligenceService`; URL is the fallback. |

---

## Phase 4 — Voice & Rich Input

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | Push-to-talk (spacebar) preserved | ✅ Done | `KeyAgent` handles spacebar hold. |
| 4.2 | Inline mic in composer | ✅ Done | `KeyChatInput` mic uses `useVoiceInput`. |
| 4.3 | TTS integration | ✅ Done | Existing `TtsProvider`/`components/tts` reused. |
| 4.4 | File attachments (image/PDF/document) | ✅ Done | Upload via presigned URL, preview, forward to backend. |

---

## Phase 5 — Tool Approvals & Streaming UX

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Render pending confirmation cards | ✅ Done | `KeyPlanCard` rendered inside messages. |
| 5.2 | Confirm/deny flows call `/flow/confirm` | ✅ Done | `useKeyChatActions.confirmAction` → `sendFlowChat` with `pendingConfirmation`. |
| 5.3 | Verify streaming `confirmation_required` chunks update UI correctly | ✅ Done | `KeyMessageRenderer` falls back to `pendingConfirmations`; `processStreamChunk` maps confirmations to `plan`. |
| 5.4 | Tool result rendering after execution | ✅ Done | `tool_results` chunks now update the matching plan steps to `completed`/`failed` and clear `requiresConfirmation`. |

---

## Phase 6 — Legacy Deprecation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | Deprecate/remove `CopilotPanel` | ✅ Done | Deleted `components/ai/copilot-panel.tsx`. |
| 6.2 | Deprecate/remove `KeyCommandCenter` | ✅ Done | Deleted `components/key/KeyCommandCenter.tsx`. |
| 6.3 | Deprecate/remove `KeyPresence` | ✅ Done | Deleted `components/key/key-presence.tsx`. |
| 6.4 | Deprecate/remove old `KeyVoiceButton` | ✅ Done | Deleted `components/key/KeyVoiceButton.tsx`. |

---

## Phase 7 — Trust / Safety / Audit Gaps (Strategic, Not in This Shell)

These were identified in the employee-replacement audit and are intentionally out of scope for the chat-shell refactor, but they remain the next strategic blockers for autonomous operation:

| # | Task | Status |
|---|------|--------|
| 7.1 | Safety-shell wiring | Not Done |
| 7.2 | Rollback / compensation tooling | Not Done |
| 7.3 | Webhook security hardening | Not Done |
| 7.4 | Unified ingestion split | Not Done |
| 7.5 | Closed learning loop | Not Done |

---

## Verification Commands

```bash
# Server typecheck + build
cd apps/server && pnpm typecheck && pnpm build

# Web typecheck
cd apps/web && pnpm typecheck

# Full dev launch
bash scripts/launch-dev.sh
```

---

## Recommended Next Tasks (in order)

1. **S3/objectPath fallback** — if the public attachment URL fails, read the object via `objectPath` and pass base64 to `DocumentIntelligenceService`.
2. **Anthropic multimodal gateway support** — convert OpenAI-style content arrays to Anthropic content blocks in `model-gateway.service.ts`.
3. **Polish session UX** — auto-open newly created sessions, optimistic titles, and loading states while history is restored.
4. **End-to-end smoke test** — run `bash scripts/launch-dev.sh`, trigger a tier-2 tool call (e.g., `create_task`) via the new chat shell, and confirm the approval card renders, confirms, and resolves.
