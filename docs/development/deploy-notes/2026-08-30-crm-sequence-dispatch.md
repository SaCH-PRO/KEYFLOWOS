# Deploy Note: CRM Sequence Dispatch

**Date:** 2026-08-30  
**Commit:** `06e8652a` (CRM sequence dispatch fix)  
**Affected:** CRM sequences, outbound email, outbound WhatsApp

## What changed

CRM sequences now actually dispatch messages.

Previously the scheduler would:
- pick the correct sequence variant,
- resolve the copy,
- stamp `sentAt`,
- log the step to the contact timeline,
- emit `sequence.step_due`, and
- advance the enrollment.

The event had three listeners, all observers (AI processor, staleness marker, logger). Nothing created an `OutboundDelivery` or called the email/WhatsApp dispatch path, so no message ever left the system despite every surface looking successful.

The fix wires `sequence.step_due` to the same dispatch path flow automation uses, then drains the outbound queue before considering the step sent. If no channel is connected, the contact has no address, the body is empty, or the node is SMS-only (SMS provider is not wired), the dispatch returns a reason and `sentAt` is **not** stamped.

## Operational action required

On the first scheduler tick after this deploy, live sequences begin sending real email and WhatsApp messages to real contacts. Any enrollment that is mid-sequence will resume at its current node.

These are messages that have been silently dropped for as long as the bug has been in place. A contact sitting at step 4 for three weeks is about to hear from you.

**Before the deploy window:**
- Review currently active sequence enrollments.
- Consider pausing long-running or sensitive sequences until you can preview what they will send.
- Verify connected email (Gmail/Resend) and WhatsApp configurations are correct.

## Verification

- 11 tests cover the dispatcher and the new call site.
- Unwiring the call site fails only the two tests that assert dispatch occurs and that `sentAt` is conditional.
- Full suites: 368 unit files / 3,600 tests, 21 integration files / 153 tests — all green.
