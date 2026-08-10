/**
 * A business should be able to choose which AI provider KEY runs on.
 *
 * The gateway already had working implementations for OpenAI, Anthropic, xAI and
 * Moonshot, per-provider BYOK key storage, and an availability check. What it
 * did not have was any way to express a choice: resolveStrategy took a
 * parameter literally named `_preferences` and never read it, so routing was
 * whatever the table said, forever.
 *
 * The design constraint that shapes everything here: only OpenAI is reliably
 * configured today. A preference for a provider with no key must therefore be
 * harmless — the business gets a working assistant, not an error — while still
 * being visible in the UI so someone has a reason to go and supply that key.
 *
 * So: PROMOTION, not pinning. The preferred provider is tried first; the
 * original chain stays behind it.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelGatewayService, SELECTABLE_PROVIDERS } from './model-gateway.service';
import { LangfuseService } from './langfuse.service';

/** Runs the real resolveStrategy against a stub instance. */
function resolve(instance: unknown, request: any, mode: string, preferences: any) {
  const impl = (
    ModelGatewayService.prototype as unknown as Record<string, (...a: unknown[]) => any>
  ).resolveStrategy;
  return impl.call(instance, request, mode, preferences);
}

const TABLE = {
  balanced: {
    analysis: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [{ provider: 'anthropic', model: 'claude-3-5-haiku-20241022' }],
    },
    general: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [],
    },
  },
};

/** `available` lists the providers that have a key configured. */
function makeInstance(available: string[]) {
  return Object.assign(Object.create(ModelGatewayService.prototype), {
    routingTable: TABLE,
    logger: { warn: vi.fn(), log: vi.fn() },
    isProviderAvailable: (p: string) => available.includes(p),
    isCircuitOpen: () => false,
  });
}

const req = { taskCategory: 'analysis', businessId: 'biz_1' };

describe('a choice actually changes where the request goes', () => {
  it('promotes the preferred provider to primary', () => {
    const strategy = resolve(makeInstance(['openai', 'anthropic']), req, 'balanced', {
      aiMode: 'balanced',
      preferredProvider: 'anthropic',
    });

    expect(strategy.primary.provider).toBe('anthropic');
  });

  it('keeps the original chain behind it', () => {
    // Promotion, not replacement. A preference must not remove the safety net.
    const strategy = resolve(makeInstance(['openai', 'anthropic']), req, 'balanced', {
      aiMode: 'balanced',
      preferredProvider: 'anthropic',
    });

    expect(strategy.fallbacks.some((f: any) => f.provider === 'openai')).toBe(true);
  });

  it('does not duplicate the promoted candidate in its own fallbacks', () => {
    const strategy = resolve(makeInstance(['openai', 'anthropic']), req, 'balanced', {
      aiMode: 'balanced',
      preferredProvider: 'anthropic',
    });

    const dupes = strategy.fallbacks.filter(
      (f: any) => f.provider === strategy.primary.provider && f.model === strategy.primary.model,
    );
    expect(dupes).toEqual([]);
  });

  it('uses the model the table already trusts that provider with', () => {
    // Rather than a generic default, when the chain already names one for this
    // task. Picking a model the provider does not serve would turn a preference
    // into a hard failure.
    const strategy = resolve(makeInstance(['openai', 'anthropic']), req, 'balanced', {
      aiMode: 'balanced',
      preferredProvider: 'anthropic',
    });

    expect(strategy.primary.model).toBe('claude-3-5-haiku-20241022');
  });

  it('falls back to a known-good model when the chain does not name one', () => {
    const strategy = resolve(makeInstance(['openai', 'xai']), req, 'balanced', {
      aiMode: 'balanced',
      preferredProvider: 'xai',
    });

    expect(strategy.primary.provider).toBe('xai');
    expect(strategy.primary.model).toBeTruthy();
  });
});

describe('choosing a provider you have no key for is harmless', () => {
  // The load-bearing property while only OpenAI is configured.

  it('ignores a preference for an unconfigured provider', () => {
    const strategy = resolve(makeInstance(['openai']), req, 'balanced', {
      aiMode: 'balanced',
      preferredProvider: 'anthropic',
    });

    expect(strategy.primary.provider).toBe('openai');
  });

  it('behaves exactly as if nothing had been chosen', () => {
    const withPreference = resolve(makeInstance(['openai']), req, 'balanced', {
      aiMode: 'balanced',
      preferredProvider: 'kimi',
    });
    const without = resolve(makeInstance(['openai']), req, 'balanced', { aiMode: 'balanced' });

    expect(withPreference).toEqual(without);
  });

  it('leaves routing untouched when no preference is set', () => {
    const strategy = resolve(makeInstance(['openai', 'anthropic']), req, 'balanced', {
      aiMode: 'balanced',
    });

    expect(strategy.primary.provider).toBe('openai');
    expect(strategy.primary.model).toBe('gpt-4o-mini');
  });

  it('is a no-op when the preference already matches the default', () => {
    const strategy = resolve(makeInstance(['openai', 'anthropic']), req, 'balanced', {
      aiMode: 'balanced',
      preferredProvider: 'openai',
    });

    expect(strategy).toEqual(TABLE.balanced.analysis);
  });
});

describe('an explicit per-request override still wins', () => {
  it('beats the business preference', () => {
    // Overrides are used by callers that know exactly what they need; a user
    // preference must not silently redirect them.
    const strategy = resolve(makeInstance(['openai', 'anthropic']), {
      ...req,
      providerOverride: 'openai',
      modelOverride: 'gpt-4o',
    }, 'balanced', { aiMode: 'balanced', preferredProvider: 'anthropic' });

    expect(strategy.primary).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });
});

describe('the choice is offered, and its state is honest', () => {
  const src = readFileSync(join(__dirname, 'model-gateway.service.ts'), 'utf8');
  const controller = readFileSync(join(__dirname, 'ai.controller.ts'), 'utf8');

  it('offers Gemini, which the gateway could not reach at all before', () => {
    // Google was absent from AiProvider entirely, so it was not merely
    // unconfigured — there was no code path to it. Listing a provider the
    // gateway cannot call would be a menu item that silently does nothing,
    // which the implementation test below enforces.
    expect(SELECTABLE_PROVIDERS).toContain('google');
  });

  it('reaches Gemini through the OpenAI-compatible endpoint, not a bespoke client', () => {
    // Google publishes an OpenAI-shaped surface. Using it means the same tool
    // schema and the same tool_calls contract as every other provider — no
    // translation layer to silently lose tool calling in, which is exactly how
    // the Anthropic streaming path broke.
    expect(src).toMatch(/generativelanguage\.googleapis\.com\/v1beta\/openai/);
  });

  it('sends tools on the Gemini streaming path', () => {
    const fn = src.slice(src.indexOf('private async *streamGoogle('));
    expect(fn.slice(0, 3000)).toMatch(/params\.tools = request\.tools/);
    expect(fn.slice(0, 3000)).toMatch(/tool_call_delta/);
  });

  it('offers more than one provider', () => {
    expect(SELECTABLE_PROVIDERS.length).toBeGreaterThan(1);
    expect(SELECTABLE_PROVIDERS).toContain('openai');
  });

  it('only offers providers that have a real implementation', () => {
    // Listing a provider the gateway cannot call would be a menu item that
    // silently does nothing.
    // Named explicitly rather than derived. The methods are callOpenAi and
    // callXai, which no simple capitalisation rule produces — the derived
    // version built a regex matching nothing, and would have silently "passed"
    // for a provider with no implementation had the assertion been negative.
    const implementations: Record<string, string> = {
      openai: 'callOpenAi',
      anthropic: 'callAnthropic',
      xai: 'callXai',
      kimi: 'callKimi',
      google: 'callGoogle',
    };

    for (const provider of SELECTABLE_PROVIDERS) {
      const method = implementations[provider];
      expect(method, `${provider} is selectable but absent from this map`).toBeDefined();
      expect(src, `no call implementation for ${provider}`).toMatch(
        new RegExp(`private async ${method}\\(`),
      );
    }
  });

  it('reports availability separately from selectability', () => {
    // The distinction is the point: everything is selectable, only some are
    // usable today, and the UI needs both to explain why.
    const fn = src.slice(src.indexOf('async listSelectableProviders('));
    expect(fn.slice(0, 2500)).toMatch(/available:/);
    expect(fn.slice(0, 2500)).toMatch(/selectable: true/);
    expect(fn.slice(0, 2500)).toMatch(/reason/);
  });

  it('every dispatchable provider has metrics and a circuit breaker', () => {
    // Three separate hardcoded provider literals existed — metrics init,
    // circuit-breaker init, and getProviderHealth — and adding `google` today
    // updated none of them. Not cosmetic: every recorder guards with
    // `if (metrics)` / `if (circuit)` and isCircuitOpen returns false for a
    // provider it holds no state for, so a failing Gemini endpoint recorded no
    // errors, never tripped its breaker, and would have been re-tried on every
    // single request with the fallback chain paying each time.
    //
    // Asserted through the public health surface rather than by reading the
    // literals, so the next provider added is covered by construction.
    const gateway = new ModelGatewayService({} as never, {} as never, new LangfuseService());
    const health = gateway.getProviderHealth();
    const reported = health.map((h) => h.provider);

    for (const provider of SELECTABLE_PROVIDERS) {
      expect(reported, `${provider} is selectable but absent from health`).toContain(provider);
    }
  });

  it('reports health for a provider that has never been called', () => {
    // The metrics entry has to EXIST, not merely be reachable once traffic
    // flows — which is the difference between an undefined map lookup and a
    // zeroed record.
    const gateway = new ModelGatewayService({} as never, {} as never, new LangfuseService());
    const google = gateway.getProviderHealth().find((h) => h.provider === 'google');

    expect(google).toBeDefined();
    expect(google!.errorRate).toBe(0);
    expect(google!.circuitOpen).toBe(false);
  });

  it('is reachable over HTTP, behind the tenant guard', () => {
    const route = controller.indexOf("@Get('businesses/:businessId/ai/providers')");
    expect(route).toBeGreaterThan(-1);
    expect(controller.slice(route - 120, route)).toMatch(/AuthGuard, BusinessGuard/);
  });

  it('can be read and written through the preferences endpoint', () => {
    expect(controller).toMatch(/preferredProvider: prefs\.preferredProvider/);
    expect(controller).toMatch(/updates\.preferredProvider/);
  });
});
