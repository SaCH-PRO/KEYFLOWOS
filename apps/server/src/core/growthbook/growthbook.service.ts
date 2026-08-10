import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GrowthBookClient, type UserContext } from '@growthbook/growthbook';

/**
 * Dynamic feature flags & experimentation for KEYFLOW OS, backed by GrowthBook.
 *
 * This complements — it does not replace — the existing `FeatureFlagsService`
 * (`modules/feature-flags`), which is a DB-backed nav gate: static "coming
 * soon" toggles with per-email bypass, edited by an operator. That system
 * cannot express a *dynamic* rollout — enable a change for 10% of businesses,
 * flip it off without a deploy, target by plan or country, or run an A/B test.
 * GrowthBook is exactly that layer, and as the plugin integration phases land
 * each new one ships behind a flag here and is switched on per business.
 *
 * Same contract as the Langfuse shim and the Sentry module: env-gated and dark
 * by default. With no GROWTHBOOK_CLIENT_KEY the service is disabled and every
 * flag resolves to the fallback the *calling code* supplies, so a missing
 * config can only mean "the safe default" — never a crash, never an accidental
 * on. A GrowthBook outage degrades the same way: evaluation is local against
 * the cached payload, and an unknown flag returns the fallback.
 *
 * GrowthBookClient is the multi-user server client — one shared instance holds
 * the feature definitions and each call is evaluated against a per-request
 * UserContext, so there is no per-business object to construct or leak.
 */
@Injectable()
export class GrowthBookService implements OnModuleInit {
  private readonly logger = new Logger(GrowthBookService.name);

  private readonly clientKey = process.env.GROWTHBOOK_CLIENT_KEY;
  private readonly apiHost = process.env.GROWTHBOOK_API_HOST || 'https://cdn.growthbook.io';

  /** True only when a client key is present; drives the dark-by-default path. */
  readonly enabled: boolean;

  private client?: GrowthBookClient;

  constructor() {
    this.enabled = !!this.clientKey;
    if (!this.enabled) {
      this.logger.log(
        'GROWTHBOOK_CLIENT_KEY not set — dynamic flags disabled (every flag resolves to the code-supplied fallback)',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    try {
      this.client = new GrowthBookClient({
        apiHost: this.apiHost,
        clientKey: this.clientKey,
      });
      await this.client.init({ timeout: 3000 });
      this.logger.log(
        `Dynamic flags enabled — loaded ${Object.keys(this.client.getFeatures()).length} definitions from GrowthBook`,
      );
    } catch (err: unknown) {
      // Loading the payload failed. Keep the client (evaluation still returns
      // fallbacks) but do not take the server down over a flag service.
      this.logger.warn(
        `GrowthBook init failed, flags will resolve to fallbacks: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Resolve a boolean flag for a business. Returns `fallback` whenever flags are
   * disabled, the client has not loaded, or the key is unknown — the caller's
   * default is the source of truth for "off".
   */
  isEnabled(key: string, ctx: FlagContext = {}, fallback = false): boolean {
    if (!this.enabled || !this.client) return fallback;
    try {
      return this.client.getFeatureValue(key, fallback, this.toUserContext(ctx));
    } catch (err: unknown) {
      this.logger.warn(
        `Flag eval failed for "${key}", using fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }

  /**
   * Resolve a typed flag value (string/number/JSON). Same fallback semantics as
   * `isEnabled`.
   */
  getValue<T extends string | number | boolean | object>(
    key: string,
    fallback: T,
    ctx: FlagContext = {},
  ): T {
    if (!this.enabled || !this.client) return fallback;
    try {
      return this.client.getFeatureValue(key, fallback, this.toUserContext(ctx)) as T;
    } catch (err: unknown) {
      this.logger.warn(
        `Flag eval failed for "${key}", using fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }

  private toUserContext(ctx: FlagContext): UserContext {
    return {
      attributes: {
        // `id` is GrowthBook's default hashing attribute for % rollouts, so a
        // business lands in the same bucket on every call.
        id: ctx.businessId ?? 'anonymous',
        ...(ctx.businessId ? { businessId: ctx.businessId } : {}),
        ...ctx.attributes,
      },
    };
  }
}

export interface FlagContext {
  /** Drives deterministic percentage rollouts; also exposed as `businessId`. */
  businessId?: string;
  /** Extra targeting attributes (plan, role, country, …). */
  attributes?: Record<string, unknown>;
}
