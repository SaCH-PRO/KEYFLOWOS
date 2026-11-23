/**
 * FU-KEY-GENOME-READS-RESIDUAL (D-235), orchestrator acceptance (correctness M2; security dead-code note): the legacy
 * genome reads of KeyCortexReasoningService and KeyCortexInteractionService had no production caller and bypassed the
 * reader projection the live paths use (KeyCortexGenomeContextService + genomeContextForReader). They are deleted rather
 * than left for a future caller to wire in unprojected: the reasoning service's getGenomeEnrichedContext (and its
 * business-wide genome:context cache), shouldSuggestProactiveAction, getProactiveSuggestions, explainDecision and
 * generateSuggestions (which rendered the unprojected snapshot); the interaction service's explainDecision.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexReasoningService } from '../key-cortex-reasoning.service';
import { KeyCortexInteractionService } from '../key-cortex-interaction.service';

const source = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

describe('the legacy, unprojected genome reads are gone (orchestrator acceptance, correctness M2)', () => {
  it.each(['getGenomeEnrichedContext', 'shouldSuggestProactiveAction', 'getProactiveSuggestions', 'explainDecision', 'generateSuggestions'])(
    'RED-BEFORE: KeyCortexReasoningService has no %s',
    (method) => {
      expect((KeyCortexReasoningService.prototype as any)[method]).toBeUndefined();
    },
  );

  it('RED-BEFORE: KeyCortexInteractionService has no explainDecision; its live method stays', () => {
    expect((KeyCortexInteractionService.prototype as any).explainDecision).toBeUndefined();
    expect(typeof (KeyCortexInteractionService.prototype as any).learnFromInteraction).toBe('function');
  });

  it('RED-BEFORE: the reasoning service keeps no business-wide genome:context cache of its own', () => {
    expect(source('key-cortex-reasoning.service.ts')).not.toMatch(/genome:context:/);
  });

  it.each(['generateId', 'impactNumberToLevel', 'getDefaultSuggestions'])(
    'RED-BEFORE (delta review MINOR-1): the helper %s, used only by the deleted methods, is gone too',
    (method) => {
      expect((KeyCortexReasoningService.prototype as any)[method]).toBeUndefined();
    },
  );

  it('RED-BEFORE (delta review MINOR-1): no TTL setting is left that configures nothing', () => {
    const src = source('key-cortex-reasoning.service.ts');
    expect(src).not.toMatch(/GENOME_CONTEXT_TTL/);
    expect(src).not.toMatch(/KEY_CORTEX_GENOME_CONTEXT_TTL_SECONDS/);
  });

  it('control: the live entry points of the reasoning service stay', () => {
    for (const method of ['processQuery', 'streamQuery']) expect(typeof (KeyCortexReasoningService.prototype as any)[method], method).toBe('function');
  });
});
