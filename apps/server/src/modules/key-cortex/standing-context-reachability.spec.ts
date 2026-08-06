/**
 * Six "live" subsystems reach the user through one string, on two lines.
 *
 * CognitiveTriageService.triage() assembles `standingContext` from six body
 * systems — endocrine, interoception, immune, salience, epigenetics, incentive —
 * each via a describeForPrompt() call. FlowOrchestratorService appends that
 * string to the system prompt in the non-streaming path, and again in the
 * streaming one.
 *
 * That is the ENTIRE delivery mechanism. Those six services have crons,
 * persistence, tenant scoping and their own tests, and every one of them is
 * inert as far as a user is concerned if either append is deleted. Nothing else
 * reads standingContext. No test failed if it went missing, because each
 * subsystem's own tests assert that it produces a description — not that anyone
 * consumes it.
 *
 * That is the same defect as TrustExplanationService, which was written,
 * injected and never registered, and sat undetected because the injection site
 * looked wired. The difference is only that this one is currently connected.
 *
 * Two paths matter independently. Streaming is what the product actually uses
 * for chat; a fix applied to one and not the other is how half a feature ships.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MODULES = path.join(__dirname, '..');
const triage = fs.readFileSync(path.join(__dirname, 'cognitive-triage.service.ts'), 'utf8');
const orchestrator = fs.readFileSync(
  path.join(MODULES, 'ai', 'flow-orchestrator.service.ts'),
  'utf8',
);

/** The six systems whose only route to a human is this string. */
const BODY_SYSTEMS = [
  'endocrine',
  'interoception',
  'immune',
  'salience',
  'epigenetics',
  'incentive',
] as const;

describe('standingContext is assembled from every body system', () => {
  for (const system of BODY_SYSTEMS) {
    it(`${system} contributes to the prompt`, () => {
      expect(
        new RegExp(`this\\.${system}\\??\\.describeForPrompt\\(`).test(triage),
        `${system} no longer feeds standingContext — it still runs, still writes to its ` +
          'own store, and no longer reaches the user in any way',
      ).toBe(true);
    });
  }

  it('all six are still there, so a system cannot be dropped silently', () => {
    const wired = BODY_SYSTEMS.filter((s) =>
      new RegExp(`this\\.${s}\\??\\.describeForPrompt\\(`).test(triage),
    );

    expect(wired).toHaveLength(BODY_SYSTEMS.length);
  });
});

describe('standingContext reaches the model on every path', () => {
  /**
   * Both appends, counted rather than matched once. A single `indexOf` passes
   * when the streaming path has lost its copy, which is precisely the asymmetry
   * worth guarding: streaming is the path the chat UI uses.
   */
  const appends = [...orchestrator.matchAll(/triage\??\.standingContext/g)];

  it('is consumed by the orchestrator at all', () => {
    expect(
      appends.length,
      'nothing reads triage.standingContext — six subsystems are computing for no one',
    ).toBeGreaterThan(0);
  });

  it('is appended in both the streaming and non-streaming paths', () => {
    // Guarded read plus interpolation = one delivery site. Two sites, two paths.
    const deliveries = [...orchestrator.matchAll(/\$\{triage\.standingContext\}/g)];

    expect(
      deliveries.length,
      'expected the standing context to be interpolated into the system prompt twice — ' +
        'once for the non-streaming path and once for streaming. Losing one silently ' +
        'disables the CNS for whichever path lost it',
    ).toBeGreaterThanOrEqual(2);
  });

  it('is appended to the system prompt, not merely referenced', () => {
    // A reference that never lands in systemPrompt would satisfy the counts
    // above while delivering nothing.
    expect(
      /systemPrompt\s*\+=\s*`[\s\S]{0,40}\$\{triage\.standingContext\}/.test(orchestrator),
      'standingContext is referenced but not concatenated onto the system prompt',
    ).toBe(true);
  });
});
