/**
 * "hi" should not cost what "should we take the series A" costs.
 *
 * The tool schemas serialise to roughly 53,000 characters — about 13,300 tokens,
 * and around 80% of everything sent on an ordinary turn. They were attached
 * unconditionally on both chat paths, so the thalamus's reflex tier bought only
 * a lower maxTokens cap, which changes nothing when the model was never going to
 * write 1,000 tokens in reply to "thanks".
 *
 * Dropping them on reflex is safe because of how narrow that tier is:
 * isBareAcknowledgement requires the WHOLE message to match a fixed greeting
 * list at <= 24 characters, plus simple complexity, no data requirement, low
 * emotional weight, and no attachments. By the time the tier is 'reflex' the
 * code has established the message is literally "hi" or "ok".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getOpenAiToolDefinitions } from './flow-tool-registry';

const src = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');

describe('the tool payload is worth caring about', () => {
  it('is large enough that sending it needlessly matters', () => {
    // Measured rather than assumed, so the premise of the whole optimisation is
    // checked rather than asserted.
    const serialized = JSON.stringify(getOpenAiToolDefinitions());
    const approxTokens = Math.round(serialized.length / 4);

    expect(approxTokens).toBeGreaterThan(5_000);
  });
});

describe('reflex sends no tools', () => {
  it('gates the tools payload on the tier, on every chat path', () => {
    const attachments = [...src.matchAll(/^\s*tools: /gm)];
    expect(attachments.length, 'expected both the streaming and blocking paths').toBe(2);

    for (const attach of attachments) {
      const clause = src.slice(attach.index!, attach.index! + 260);
      expect(clause, 'a chat path still sends tools regardless of tier').toMatch(
        /triage\?\.tier === 'reflex'\s*\n?\s*\? undefined/,
      );
    }
  });

  it('drops toolChoice with them', () => {
    // Sending toolChoice: 'auto' with no tools is at best noise and at worst a
    // provider error.
    const choices = [...src.matchAll(/toolChoice: /g)];
    expect(choices.length).toBe(2);

    for (const choice of choices) {
      const clause = src.slice(choice.index!, choice.index! + 80);
      expect(clause).toMatch(/reflex/);
    }
  });

  it('still sends tools on standard and deliberate', () => {
    // The saving must not become a capability loss. Only reflex is excluded.
    //
    // The non-reflex branch used to inline `getOpenAiToolDefinitions()` here,
    // in two places, and both ignored selectToolsForRequest — which is why the
    // 128-tool cap inside it had never run. It now hands over `selectedTools`,
    // so this checks the whole path rather than the presence of one call:
    // non-reflex must attach the selected menu, AND that menu must come from
    // the selector. Grepping for the old literal would now pass on a hard-coded
    // empty array.
    const attach = src.slice(src.indexOf('tools: triage?.tier'));
    expect(attach.slice(0, 400)).toMatch(/:\s*selectedTools/);
    expect(src).toMatch(/const selectedTools = await this\.selectToolsForRequest\(/);
    expect(src).toMatch(/const all = getOpenAiToolDefinitions\(\);/);
  });
});

describe('the tier that triggers this is genuinely narrow', () => {
  const triage = readFileSync(join(__dirname, '..', 'key-cortex', 'cognitive-triage.service.ts'), 'utf8');

  it('reflex requires the WHOLE message to be an acknowledgement', () => {
    // Anchored, not a substring match. An earlier version matched anywhere,
    // which meant "ok delete that contact" graded simple — and under this
    // change that would now also lose its tools, which is the failure this
    // assertion exists to prevent.
    const fn = triage.slice(triage.indexOf('private isBareAcknowledgement('));
    expect(fn.slice(0, 900)).toMatch(/\^\(hi\|hello/);
    expect(fn.slice(0, 900)).toMatch(/\$\//);
  });

  it('reflex requires a short message', () => {
    const fn = triage.slice(triage.indexOf('private isBareAcknowledgement('));
    expect(fn.slice(0, 900)).toMatch(/length > 24/);
  });

  it('an attachment can never be reflex', () => {
    const fn = triage.slice(triage.indexOf('private tierFor('));
    expect(fn.slice(0, 1200)).toMatch(/hasAttachments/);
  });
});
