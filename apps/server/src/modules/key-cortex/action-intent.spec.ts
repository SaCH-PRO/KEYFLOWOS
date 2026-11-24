/**
 * RR-ACTION-INTENT-ONE-CLASSIFIER (D-261, D-262): KEY decides "does this message
 * ask me to DO something" in one place.
 *
 * Before this packet six hand-written regexes disagreed: Flow's deliberation
 * guard knew cancel / refund / pay / remove / mark, the Cortex router, the
 * reasoning and structured-output classifiers and the session intent extractor
 * did not. So on the Cortex query pipeline, with actions enabled, "cancel the
 * booking for Ada" got no actions layer and KEY answered an action request with
 * no hands, the failure cognitive-triage names as the worst one.
 *
 * Now one exported pure function, classifyActionIntent(text), carries the one
 * vocabulary and every site calls it. Each site keeps its own decision: Flow
 * still refuses deliberation for an action, the Cortex sites still require
 * enableActions. Authority is untouched: this only decides whether the actions
 * layer / tool-calling category is offered; every action still passes the same
 * autonomy, approval, confirmation and allowlist path as before.
 *
 * The six sites are driven as the deliberation spec drives Flow: through the
 * real methods on stub instances (the services' constructors want Prisma and
 * Redis, which these pure classifiers never touch).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { AdaptiveRouterService } from './adaptive-router.service';
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexStructuredOutputService } from './key-cortex-structured-output.service';
import { KeyCortexSessionService } from './key-cortex-session.service';
import { classifyActionIntent, ACTION_VERBS } from './action-intent';
import { CortexQuery } from './key-cortex.types';

const query = (text: string, enableActions = true): CortexQuery => ({
  text,
  businessId: 'biz_rr_intent',
  userId: 'user_rr_intent',
  enableActions,
});

/** Flow: the deliberation guard refuses (returns false) for an action message. */
function flowSaysAction(message: string): boolean {
  const impl = (
    FlowOrchestratorService.prototype as unknown as Record<string, (t: unknown, m: string, a: boolean) => boolean>
  ).shouldDeliberate;
  return impl.call({}, { tier: 'deliberate' }, message, false) === false;
}

async function routerVerdicts(text: string, enableActions = true) {
  const decision = await new AdaptiveRouterService().route(query(text, enableActions));
  return {
    category: decision.taskCategory === 'tool-calling',
    layers: decision.includeActions === true && decision.layers.includes('actions'),
  };
}

function reasoningSaysAction(text: string, enableActions = true): boolean {
  const impl = (KeyCortexReasoningService.prototype as unknown as Record<string, (q: CortexQuery) => string>)
    .classifyTaskCategory;
  return impl.call({}, query(text, enableActions)) === 'tool-calling';
}

function structuredSaysAction(text: string, enableActions = true): boolean {
  return new KeyCortexStructuredOutputService().classifyTaskCategory(query(text, enableActions)) === 'tool-calling';
}

function sessionSaysAction(text: string): boolean {
  const impl = (KeyCortexSessionService.prototype as unknown as Record<string, (t: string) => string>).extractIntent;
  return impl.call({}, text).startsWith('request to ');
}

async function allSix(text: string) {
  const router = await routerVerdicts(text);
  return {
    flow: flowSaysAction(text),
    routerCategory: router.category,
    routerLayers: router.layers,
    reasoning: reasoningSaysAction(text),
    structured: structuredSaysAction(text),
    session: sessionSaysAction(text),
  };
}

const ACTIONS = ['cancel the booking for Ada', 'refund Ada', 'pay the supplier', 'remove that task', 'mark invoice 12 paid'];
const NOT_ACTIONS = ['what did we sell last week', 'hi'];

describe('RR-ACTION-INTENT-ONE-CLASSIFIER: the six sites agree on what an action request is', () => {
  for (const text of ACTIONS) {
    it(`DoD RED: "${text}" is an action at all six sites`, async () => {
      const verdicts = await allSix(text);
      expect(verdicts).toEqual({
        flow: true,
        routerCategory: true,
        routerLayers: true,
        reasoning: true,
        structured: true,
        session: true,
      });
    });
  }

  for (const text of NOT_ACTIONS) {
    it(`"${text}" is not an action at any site`, async () => {
      const verdicts = await allSix(text);
      expect(verdicts).toEqual({
        flow: false,
        routerCategory: false,
        routerLayers: false,
        reasoning: false,
        structured: false,
        session: false,
      });
    });
  }

  it('negative control: with enableActions false no Cortex site offers actions, for every phrase', async () => {
    for (const text of [...ACTIONS, ...NOT_ACTIONS]) {
      const router = await routerVerdicts(text, false);
      expect(router, text).toEqual({ category: false, layers: false });
      expect(reasoningSaysAction(text, false), text).toBe(false);
      expect(structuredSaysAction(text, false), text).toBe(false);
    }
  });

  it('negative control: Flow still refuses to deliberate every action phrase (D-208 untouched) and still deliberates a judgement question', () => {
    for (const text of ACTIONS) expect(flowSaysAction(text), text).toBe(true);
    expect(flowSaysAction('should we take the series a term sheet')).toBe(false);
    expect(flowSaysAction('why are we losing clients')).toBe(false);
  });
});

describe('classifyActionIntent: the one vocabulary', () => {
  it('is the union of the six former vocabularies, word-bounded and case-insensitive, and names the verbs it found', () => {
    for (const verb of [
      'create', 'make', 'add', 'send', 'schedule', 'book', 'update', 'change', 'delete', 'remove', 'cancel', 'invoice',
      'draft', 'generate', 'assign', 'move', 'set', 'mark', 'pay', 'refund', 'publish', 'post', 'run', 'execute', 'build',
      'task', 'email', 'reminder', 'workflow',
    ]) {
      expect(ACTION_VERBS, verb).toContain(verb);
      expect(classifyActionIntent(`please ${verb} it`), verb).toEqual({ isAction: true, verbs: [verb] });
    }
    expect(classifyActionIntent('Cancel the booking and REFUND Ada')).toEqual({ isAction: true, verbs: ['cancel', 'refund'] });
    expect(classifyActionIntent('send it, then send another')).toEqual({ isAction: true, verbs: ['send'] });
  });

  it('does not match inside other words, and an empty or verb-free text is not an action', () => {
    for (const text of ['the payment was created yesterday', 'our bookings and invoices', 'a reminders digest', 'posted', 'runway', '', '   ', 'hi']) {
      expect(classifyActionIntent(text), text).toEqual({ isAction: false, verbs: [] });
    }
  });

  it('source control: none of the six sites keeps a private action-verb regex; each imports the classifier', () => {
    const files = [
      '../ai/flow-orchestrator.service.ts',
      './adaptive-router.service.ts',
      './key-cortex-reasoning.service.ts',
      './key-cortex-structured-output.service.ts',
      './key-cortex-session.service.ts',
    ];
    for (const file of files) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src, `${file} still carries a private action-verb regex`).not.toMatch(/\\b\(create\|(make|add)\|/);
      expect(src, `${file} does not import classifyActionIntent`).toMatch(/import \{[^}]*\bclassifyActionIntent\b[^}]*\} from '(\.\/|\.\.\/key-cortex\/)action-intent'/);
    }
  });
});
