/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                 KEY EXTERNAL CONNECTOR SERVICE                            ║
 * ║        Universal Plugin Engine for KeyFlowOS Integrations                 ║
 * ║         Production-hardened: circuit breaker, rate limiting,             ║
 * ║         retries, health checks, OAuth refresh, sandbox mode              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Injectable NestJS service that manages connections to 20+ external services,
 * executes actions with retry logic, handles webhooks, and supports custom
 * user-defined connectors.
 *
 * @module key-cortex-external-connector
 * @version 2.0.0
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { lastValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { createHash, randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'crypto';
import { URL } from 'url';

// ── Type imports ────────────────────────────────────────────────────────────
import {
  ExternalService,
  ExternalConnectorDefinition,
  ExternalConnectorInstance,
  ExternalExecutionRequest,
  ExternalExecutionResult,
  ExternalAction,
  ExecutionError,
  WebhookRegistration,
  WebhookPayload,
  CustomConnector,
  ConfigField,
  ConnectInput,
  RegisterWebhookInput,
  CreateCustomConnectorInput,
  ExecuteActionInput,
  ConnectorStatus,
  ConnectorStatusChangeEvent,
  WebhookReceivedEvent,
  RetryConfig,
  OAuthTokenData,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_TIMEOUT_MS,
  CONNECTOR_DEF_CACHE_PREFIX,
  CONNECTOR_INSTANCE_CACHE_PREFIX,
  CONNECTOR_STATUS_CHANGE_EVENT,
  WEBHOOK_RECEIVED_EVENT,
  ACTION_EXECUTED_EVENT,
  ErrorCodes,
  ErrorCode,
} from './key-cortex-external-connector.types';

// ── Connector definitions ───────────────────────────────────────────────────
import { SlackConnector } from './connectors/slack.connector';
import { ShopifyConnector } from './connectors/shopify.connector';
import { SalesforceConnector } from './connectors/salesforce.connector';
import { StripeExternalConnector } from './connectors/stripe.connector';
import { TwilioConnector } from './connectors/twilio.connector';
import { GoogleSheetsConnector } from './connectors/google-sheets.connector';
import { NotionConnector } from './connectors/notion.connector';

/** Encryption algorithm for credential storage */
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
/** Key length for AES-256 */
const KEY_LENGTH = 32;
/** IV length for GCM mode */
const IV_LENGTH = 16;
/** Auth tag length for GCM mode */
const AUTH_TAG_LENGTH = 16;

// ════════════════════════════════════════════════════════════════════════════
// PRODUCTION HARDENING — INTERFACES
// ════════════════════════════════════════════════════════════════════════════

/** Circuit breaker state machine for fault tolerance */
interface CircuitBreakerState {
  status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  successCount: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxAttempts: number;
}

/** Rate limit configuration per connector */
interface RateLimit {
  requestsPerSecond: number;
  requestsPerMinute: number;
  requestsPerHour: number;
  burstAllowance: number;
}

/** Token bucket state for distributed rate limiting */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
}

/** Connector health check result */
interface ConnectorHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  lastChecked: Date;
  message?: string;
  rateLimitRemaining?: number;
}

/** Sanitized external request log entry */
interface RequestLog {
  requestId: string;
  connectorId: string;
  action: string;
  method: string;
  url: string;
  statusCode?: number;
  durationMs: number;
  retryCount: number;
  errorCode?: string;
  timestamp: Date;
}

/** Sandbox execution result wrapper */
interface SandboxResult {
  success: boolean;
  data?: unknown;
  error?: string;
  executedInSandbox: true;
  wouldHaveMutated: boolean;
}

/**
 * External Connector Service — the universal integration engine.
 *
 * Provides a unified interface for connecting to 20+ external services,
 * executing actions with robust error handling, managing webhooks, and
 * supporting user-defined custom connectors.
 */
@Injectable()
export class KeyCortexExternalConnectorService {
  private readonly logger = new Logger(KeyCortexExternalConnectorService.name);

  /** Master encryption key — loaded from environment */
  private readonly encryptionKey: Buffer;

  /** In-memory registry of pre-built connector definitions */
  private readonly connectorRegistry: Map<ExternalService, ExternalConnectorDefinition>;

  // ══════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING — STATE
  // ══════════════════════════════════════════════════════════════════════════

  /** Circuit breaker states per connector instance */
  private readonly circuitBreakers: Map<string, CircuitBreakerState> = new Map();

  /** Token bucket states per connector (in-memory fallback when Redis unavailable) */
  private readonly tokenBuckets: Map<string, TokenBucket> = new Map();

  /** OAuth token cache: connectorId → token data with expiry */
  private readonly tokenCache: Map<string, { token: string; expiresAt: Date; refreshToken: string }> = new Map();

  /** Health check cache: connectorId → cached health result */
  private readonly healthCache: Map<string, { health: ConnectorHealth; cachedAt: number }> = new Map();

  /** Health check cache TTL in milliseconds (60 seconds) */
  private readonly HEALTH_CACHE_TTL_MS = 60000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly httpService: HttpService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    // Load encryption key from environment or generate a deterministic one
    const keySource = process.env.KEY_CONNECTOR_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || 'keyflow-connector-default-key-32bytes!';
    this.encryptionKey = createHash('sha256').update(keySource).digest();

    // Initialize connector registry with all pre-built connectors
    this.connectorRegistry = new Map([
      ['slack', SlackConnector],
      ['shopify', ShopifyConnector],
      ['salesforce', SalesforceConnector],
      ['stripe', StripeExternalConnector],
      ['twilio', TwilioConnector],
      ['google_sheets', GoogleSheetsConnector],
      ['notion', NotionConnector],
    ]);

    // Build placeholder connectors for services without dedicated files yet
    this.buildPlaceholderConnectors();

    this.logger.log(
      `External Connector Service initialized with ${this.connectorRegistry.size} connector definitions (v2.0.0 — production hardened)`,
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONNECTOR DEFINITIONS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Return all available connector definitions (pre-built + custom templates).
   * Results are cached in Redis for 1 hour.
   */
  async getConnectorDefinitions(): Promise<ExternalConnectorDefinition[]> {
    const cacheKey = `${CONNECTOR_DEF_CACHE_PREFIX}all`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ExternalConnectorDefinition[];
      } catch {
        // fall through to fetch from registry
      }
    }

    const definitions = Array.from(this.connectorRegistry.values());

    // Cache for 1 hour
    await (this.redis as any).setex(cacheKey, 3600, JSON.stringify(definitions));

    return definitions;
  }

  /**
   * Get a single connector definition by service ID.
   */
  async getConnectorDefinition(
    serviceId: ExternalService,
  ): Promise<ExternalConnectorDefinition> {
    const def = this.connectorRegistry.get(serviceId);
    if (!def) {
      throw new NotFoundException({
        code: ErrorCodes.CONNECTOR_DEFINITION_NOT_FOUND,
        message: `Connector definition not found for service: ${serviceId}`,
      });
    }
    return def;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONNECTION MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Connect to an external service.
   *
   * 1. Validates the config against the connector's schema
   * 2. Encrypts credentials with AES-256-GCM
   * 3. Tests the connection by pinging the API
   * 4. Saves the connector instance to the database
   * 5. Emits status change event
   */
  async connect(input: ConnectInput): Promise<ExternalConnectorInstance> {
    const { definitionId, businessId, name, config, metadata } = input;

    // 1. Validate against connector schema
    const definition = await this.getConnectorDefinition(definitionId);
    const validationErrors = this.validateConfig(config, definition.configSchema);
    if (validationErrors.length > 0) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_CONFIG,
        message: `Invalid configuration for ${definition.name}`,
        errors: validationErrors,
      });
    }

    // 2. Encrypt credentials
    const encryptedConfig = this.encryptCredentials(config);

    // 3. Test connection before saving
    let status: ConnectorStatus = 'connected';
    let errorMessage: string | undefined;
    try {
      await this.testConnection(definition, config);
      this.logger.log(`Connection test successful for ${definition.name} (business: ${businessId})`);
    } catch (err: any) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Connection test failed';
      this.logger.warn(
        `Connection test failed for ${definition.name} (business: ${businessId}): ${errorMessage}`,
      );
      // Continue saving — the instance will be in 'error' status
    }

    // 4. Save to database
    const instance = await (this.prisma as any).externalConnectorInstance.create({
      data: {
        id: this.generateId('conn'),
        businessId,
        definitionId,
        name,
        config: encryptedConfig,
        status,
        errorMessage,
        metadata: metadata || {},
        executionCount: 0,
        failureCount: 0,
        lastUsedAt: status === 'connected' ? new Date() : undefined,
      },
    });

    // Initialize circuit breaker for this connector
    this.initializeCircuitBreaker(instance.id);

    // Cache the instance
    const cacheKey = `${CONNECTOR_INSTANCE_CACHE_PREFIX}${instance.id}`;
    await (this.redis as any).setex(cacheKey, 300, JSON.stringify(instance));

    // 5. Emit status change event
    this.emitStatusChange({
      connectorId: instance.id,
      businessId,
      previousStatus: 'pending',
      currentStatus: status,
      changedAt: new Date(),
      reason: errorMessage || 'Initial connection established',
    });

    this.logger.log(
      `Connector instance created: ${instance.id} (${definition.name}) for business ${businessId} — status: ${status}`,
    );

    return instance as ExternalConnectorInstance;
  }

  /**
   * Disconnect and remove a connector instance.
   */
  async disconnect(connectorId: string, businessId: string): Promise<void> {
    const instance = await this.getConnectorInstance(connectorId, businessId);

    // Clean up webhooks
    const webhooks = await (this.prisma as any).webhookRegistration.findMany({
      where: { connectorId },
    });
    for (const wh of webhooks) {
      try {
        await this.unregisterWebhookExternal(wh);
      } catch (err: any) {
        this.logger.warn(`Failed to unregister webhook ${wh.id}: ${err}`);
      }
    }

    // Delete webhooks from DB
    await (this.prisma as any).webhookRegistration.deleteMany({
      where: { connectorId },
    });

    // Delete instance
    await (this.prisma as any).externalConnectorInstance.delete({
      where: { id: connectorId },
    });

    // Remove from cache and hardening state
    await this.redis.del(`${CONNECTOR_INSTANCE_CACHE_PREFIX}${connectorId}`);
    this.circuitBreakers.delete(connectorId);
    this.tokenBuckets.delete(connectorId);
    this.tokenCache.delete(connectorId);
    this.healthCache.delete(connectorId);

    this.emitStatusChange({
      connectorId: instance.id,
      businessId,
      previousStatus: instance.status as ConnectorStatus,
      currentStatus: 'disconnected',
      changedAt: new Date(),
      reason: 'Connector disconnected by user',
    });

    this.logger.log(`Connector ${connectorId} disconnected and removed`);
  }

  /**
   * Get a connector instance with optional caching.
   */
  private async getConnectorInstance(
    connectorId: string,
    businessId: string,
  ): Promise<ExternalConnectorInstance> {
    // Try cache first
    const cacheKey = `${CONNECTOR_INSTANCE_CACHE_PREFIX}${connectorId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const instance = JSON.parse(cached) as ExternalConnectorInstance;
      if (instance.businessId === businessId) {
        return instance;
      }
    }

    // Fetch from database
    const instance = await (this.prisma as any).externalConnectorInstance.findFirst({
      where: { id: connectorId, businessId },
    });

    if (!instance) {
      throw new NotFoundException({
        code: ErrorCodes.CONNECTOR_NOT_FOUND,
        message: `Connector instance not found: ${connectorId}`,
      });
    }

    // Update cache
    await (this.redis as any).setex(cacheKey, 300, JSON.stringify(instance));

    return instance as ExternalConnectorInstance;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ACTION EXECUTION (Production Hardened)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Execute an action on a configured connector.
   *
   * 1. Checks circuit breaker state
   * 2. Enforces rate limits via token bucket
   * 3. Ensures valid OAuth token (auto-refresh)
   * 4. Loads the connector instance (decrypts credentials)
   * 5. Finds the action definition
   * 6. Builds the HTTP request with auth headers
   * 7. Executes with retry logic (exponential backoff + jitter)
   * 8. Logs execution and emits event
   * 9. Updates circuit breaker on success/failure
   * 10. Returns result
   */
  async execute(input: ExecuteActionInput & { businessId: string; requestId?: string }): Promise<ExternalExecutionResult> {
    const { connectorId, action, parameters = {}, businessId, requestId = this.generateId('req'), timeoutMs } = input;
    const startedAt = Date.now();

    // 1. Check circuit breaker
    const cb = this.getCircuitBreaker(connectorId);
    if (cb.status === 'OPEN') {
      const timeSinceLastFailure = Date.now() - (cb.lastFailureTime?.getTime() || 0);
      if (timeSinceLastFailure < cb.cooldownMs) {
        this.logger.warn(`Circuit breaker OPEN for ${connectorId}, rejecting request`);
        return {
          success: false,
          error: {
            code: ErrorCodes.CIRCUIT_BREAKER_OPEN,
            message: `Circuit breaker is OPEN for connector ${connectorId}. Retry after ${Math.ceil((cb.cooldownMs - timeSinceLastFailure) / 1000)}s`,
            retryable: true,
            retryAfterMs: cb.cooldownMs - timeSinceLastFailure,
          },
          durationMs: Date.now() - startedAt,
          requestId,
          executedAt: new Date(),
          retryCount: 0,
        };
      }
      // Transition to HALF_OPEN
      cb.status = 'HALF_OPEN';
      cb.failureCount = 0;
      cb.successCount = 0;
      this.logger.log(`Circuit breaker HALF_OPEN for ${connectorId}`);
    }

    // 2. Enforce rate limit
    const instance = await this.getConnectorInstance(connectorId, businessId);
    const definition = await this.getConnectorDefinition(instance.definitionId);

    if (definition.rateLimitHardened) {
      const rateCheck = await this.checkRateLimit(connectorId, definition.rateLimitHardened as any);
      if (!rateCheck.allowed) {
        return {
          success: false,
          error: {
            code: ErrorCodes.RATE_LIMITED,
            message: `Rate limit exceeded for ${definition.name}. Retry after ${rateCheck.retryAfterMs}ms`,
            retryable: true,
            retryAfterMs: rateCheck.retryAfterMs,
          },
          durationMs: Date.now() - startedAt,
          requestId,
          executedAt: new Date(),
          retryCount: 0,
        };
      }
    }

    // 3. Ensure valid OAuth token (auto-refresh if needed)
    const credentials = this.decryptCredentials(instance.config);
    if (definition.authType === 'oauth2' && definition.requiredScopes?.length) {
      try {
        const freshToken = await this.ensureValidToken(connectorId, definition, credentials);
        if (freshToken) {
          credentials['accessToken'] = freshToken;
        }
      } catch (err: any) {
        this.logger.warn(`Token refresh failed for ${connectorId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 4. Find action definition
    const actionDef = definition.actions.find((a) => a.name === action);
    if (!actionDef) {
      throw new BadRequestException({
        code: ErrorCodes.ACTION_NOT_FOUND,
        message: `Action '${action}' not found for ${definition.name}`,
        availableActions: definition.actions.map((a) => a.name),
      });
    }

    // 5. Execute with production-hardened retry logic
    const effectiveTimeout = timeoutMs || definition.timeoutConfig?.requestTimeoutMs || DEFAULT_TIMEOUT_MS;
    const retryConfig = (definition.retryConfig || DEFAULT_RETRY_CONFIG) as Required<RetryConfig>;

    let lastError: ExecutionError | undefined;
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      const requestStartedAt = Date.now();
      try {
        const result = await this.executeRequest(
          definition,
          actionDef,
          credentials,
          parameters,
          effectiveTimeout,
        );

        // Update circuit breaker on success
        this.recordSuccess(connectorId);

        // Update execution stats
        await (this.prisma as any).externalConnectorInstance.update({
          where: { id: connectorId },
          data: {
            executionCount: { increment: 1 },
            lastUsedAt: new Date(),
            status: 'connected',
            errorMessage: null,
          },
        });

        // Invalidate cache
        await this.redis.del(`${CONNECTOR_INSTANCE_CACHE_PREFIX}${connectorId}`);

        const durationMs = Date.now() - startedAt;

        // Log the request (sanitized)
        await this.logExternalRequest({
          requestId,
          connectorId,
          action,
          method: actionDef.method,
          url: this.buildUrl(definition, actionDef, credentials, parameters),
          statusCode: result.statusCode,
          durationMs,
          retryCount: attempt,
          timestamp: new Date(),
        });

        const executionResult: ExternalExecutionResult = {
          success: true,
          data: result.data,
          statusCode: result.statusCode,
          durationMs,
          requestId,
          executedAt: new Date(),
          retryCount: attempt,
          responseHeaders: result.headers,
        };

        // Emit execution event
        this.eventEmitter.emit(ACTION_EXECUTED_EVENT, {
          connectorId,
          businessId,
          action,
          definitionId: instance.definitionId,
          result: executionResult,
          parameters,
        });

        return executionResult;
      } catch (err: any) {
        const execError = this.normalizeError(err, definition.id);
        lastError = execError;

        // Check if error is retryable per connector config
        const isRetryableError = this.isRetryableError(err, definition);
        const shouldRetry = attempt < retryConfig.maxRetries && isRetryableError;

        if (!shouldRetry) {
          break;
        }

        // Exponential backoff with full jitter: delay = min(base * 2^attempt + random, max)
        const baseDelay = retryConfig.baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * baseDelay;
        const delay = Math.min(baseDelay + jitter, retryConfig.maxDelayMs);

        this.logger.warn(
          `Execution attempt ${attempt + 1} failed for ${definition.name}.${action} (${connectorId}), ` +
          `retrying in ${Math.round(delay)}ms: ${execError.message}`,
        );

        await this.sleep(delay);
      }
    }

    // All retries exhausted — record failure and update circuit breaker
    this.recordFailure(connectorId);

    await (this.prisma as any).externalConnectorInstance.update({
      where: { id: connectorId },
      data: {
        failureCount: { increment: 1 },
        status: 'error',
        errorMessage: lastError?.message || 'Execution failed after retries',
      },
    });

    await this.redis.del(`${CONNECTOR_INSTANCE_CACHE_PREFIX}${connectorId}`);

    const failedDuration = Date.now() - startedAt;

    // Log failed request
    await this.logExternalRequest({
      requestId,
      connectorId,
      action,
      method: actionDef.method,
      url: this.buildUrl(definition, actionDef, credentials, parameters),
      statusCode: lastError?.code === ErrorCodes.RATE_LIMITED ? 429 : undefined,
      durationMs: failedDuration,
      retryCount: retryConfig.maxRetries,
      errorCode: lastError?.code,
      timestamp: new Date(),
    });

    const failedResult: ExternalExecutionResult = {
      success: false,
      error: lastError,
      durationMs: failedDuration,
      requestId,
      executedAt: new Date(),
      retryCount: retryConfig.maxRetries,
    };

    // Emit execution event for failure
    this.eventEmitter.emit(ACTION_EXECUTED_EVENT, {
      connectorId,
      businessId,
      action,
      definitionId: instance.definitionId,
      result: failedResult,
      parameters,
      error: lastError,
    });

    return failedResult;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING — 1. CIRCUIT BREAKER
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Initialize a circuit breaker for a connector instance.
   */
  private initializeCircuitBreaker(connectorId: string): CircuitBreakerState {
    const state: CircuitBreakerState = {
      status: 'CLOSED',
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      failureThreshold: 5,
      cooldownMs: 60000,
      halfOpenMaxAttempts: 3,
    };
    this.circuitBreakers.set(connectorId, state);
    return state;
  }

  /**
   * Get the circuit breaker state for a connector.
   */
  private getCircuitBreaker(connectorId: string): CircuitBreakerState {
    let cb = this.circuitBreakers.get(connectorId);
    if (!cb) {
      cb = this.initializeCircuitBreaker(connectorId);
    }
    return cb;
  }

  /**
   * Record a successful request — resets failure count and potentially closes circuit.
   */
  private recordSuccess(connectorId: string): void {
    const cb = this.getCircuitBreaker(connectorId);
    cb.lastSuccessTime = new Date();

    if (cb.status === 'HALF_OPEN') {
      cb.successCount++;
      if (cb.successCount >= cb.halfOpenMaxAttempts) {
        cb.status = 'CLOSED';
        cb.failureCount = 0;
        cb.successCount = 0;
        this.logger.log(`Circuit breaker CLOSED for ${connectorId} after ${cb.halfOpenMaxAttempts} consecutive successes`);
      }
    } else if (cb.status === 'CLOSED') {
      cb.failureCount = 0;
    }
  }

  /**
   * Record a failed request — increments failure count and potentially opens circuit.
   */
  private recordFailure(connectorId: string): void {
    const cb = this.getCircuitBreaker(connectorId);
    cb.failureCount++;
    cb.lastFailureTime = new Date();

    if (cb.status === 'HALF_OPEN') {
      cb.status = 'OPEN';
      this.logger.warn(`Circuit breaker OPEN for ${connectorId} — failure in HALF_OPEN state`);
    } else if (cb.status === 'CLOSED' && cb.failureCount >= cb.failureThreshold) {
      cb.status = 'OPEN';
      this.logger.warn(`Circuit breaker OPEN for ${connectorId} after ${cb.failureThreshold} consecutive failures`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING — 2. TOKEN BUCKET RATE LIMITER
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Check if a request is allowed under the rate limit using a token bucket algorithm.
   * Uses Redis for distributed rate limiting, with in-memory fallback.
   */
  async checkRateLimit(
    connectorId: string,
    rateLimit: RateLimit,
  ): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    const now = Date.now();
    const redisKey = `rate_limit:${connectorId}`;

    // Try Redis first for distributed rate limiting
    try {
      const redisData = await this.redis.get(redisKey);
      let bucket: TokenBucket;

      if (redisData) {
        bucket = JSON.parse(redisData);
      } else {
        bucket = {
          tokens: rateLimit.burstAllowance,
          lastRefill: now,
          capacity: rateLimit.burstAllowance,
        };
      }

      // Refill tokens based on time elapsed (per-second rate)
      const elapsedMs = now - bucket.lastRefill;
      const tokensToAdd = (elapsedMs / 1000) * rateLimit.requestsPerSecond;
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        await (this.redis as any).setex(redisKey, 60, JSON.stringify(bucket));
        return { allowed: true };
      } else {
        // Calculate wait time for 1 token
        const tokensNeeded = 1 - bucket.tokens;
        const waitMs = Math.ceil((tokensNeeded / rateLimit.requestsPerSecond) * 1000);
        await (this.redis as any).setex(redisKey, 60, JSON.stringify(bucket));
        return { allowed: false, retryAfterMs: waitMs };
      }
    } catch {
      // Fallback to in-memory rate limiting if Redis is unavailable
      return this.checkRateLimitInMemory(connectorId, rateLimit);
    }
  }

  /**
   * In-memory token bucket rate limiter (fallback when Redis is unavailable).
   */
  private checkRateLimitInMemory(
    connectorId: string,
    rateLimit: RateLimit,
  ): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    const now = Date.now();
    let bucket = this.tokenBuckets.get(connectorId);

    if (!bucket) {
      bucket = {
        tokens: rateLimit.burstAllowance,
        lastRefill: now,
        capacity: rateLimit.burstAllowance,
      };
      this.tokenBuckets.set(connectorId, bucket);
    }

    // Refill tokens
    const elapsedMs = now - bucket.lastRefill;
    const tokensToAdd = (elapsedMs / 1000) * rateLimit.requestsPerSecond;
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return Promise.resolve({ allowed: true });
    } else {
      const tokensNeeded = 1 - bucket.tokens;
      const waitMs = Math.ceil((tokensNeeded / rateLimit.requestsPerSecond) * 1000);
      return Promise.resolve({ allowed: false, retryAfterMs: waitMs });
    }
  }

  /**
   * Consume a token from the bucket (for pre-flight rate limit check).
   */
  async consumeToken(connectorId: string): Promise<void> {
    const bucket = this.tokenBuckets.get(connectorId);
    if (bucket && bucket.tokens > 0) {
      bucket.tokens -= 1;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING — 3. RETRY WITH EXPONENTIAL BACKOFF + JITTER
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Execute a function with production-hardened retry logic.
   *
   * Implements: delay = min(baseDelay * 2^attempt + randomJitter, maxDelay)
   * Only retries on retryable status codes and network errors.
   * Tracks retry count per request.
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig,
    connectorId?: string,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await fn();
        if (connectorId) {
          this.recordSuccess(connectorId);
        }
        return result;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt >= config.maxRetries) {
          break;
        }

        // Check if error is retryable
        const isRetryable = this.isRetryableError(err, null);
        if (!isRetryable) {
          throw err;
        }

        // Exponential backoff with full jitter
        const baseDelay = config.baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * baseDelay;
        const delay = Math.min(baseDelay + jitter, config.maxDelayMs);

        this.logger.debug(
          `executeWithRetry attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms: ${lastError.message}`,
        );

        await this.sleep(delay);
      }
    }

    if (connectorId) {
      this.recordFailure(connectorId);
    }
    throw lastError || new Error('Execution failed after retries');
  }

  /**
   * Check if an error is retryable based on connector config.
   */
  private isRetryableError(
    err: unknown,
    definition: ExternalConnectorDefinition | null,
  ): boolean {
    if (err instanceof AxiosError) {
      const status = err.response?.status;

      // Check retryable status codes from definition
      if (definition?.retryConfig?.retryableStatusCodes && status) {
        return definition.retryConfig.retryableStatusCodes.includes(status);
      }

      // Default retryable HTTP status codes
      return [408, 429, 500, 502, 503, 504].includes(status || 0);
    }

    if (err instanceof Error) {
      // Check retryable network errors
      const retryableNetworkErrors = definition?.retryConfig?.retryableErrors || [
        'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE',
      ];
      return retryableNetworkErrors.some((code) => err.message.includes(code));
    }

    return false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING — 4. WEBHOOK SIGNATURE VERIFICATION
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Verify webhook signature using connector-specific security configuration.
   *
   * Supports HMAC-SHA256 and HMAC-SHA512 with hex or base64 encoding.
   * Validates timestamp tolerance when timestampHeader is configured.
   */
  async verifyWebhookSignature(
    connectorId: string,
    payload: string,
    signature: string,
    timestamp?: string,
  ): Promise<boolean> {
    try {
      // Load connector to get webhook security config
      const instance = await (this.prisma as any).externalConnectorInstance.findUnique({
        where: { id: connectorId },
      });
      if (!instance) return false;

      const definition = this.connectorRegistry.get(instance.definitionId as ExternalService);
      if (!definition?.webhookSecurity) {
        // No webhook security configured — accept (backward compatibility)
        return true;
      }

      const security = definition.webhookSecurity;
      const credentials = this.decryptCredentials(instance.config);
      const secret = credentials['signingSecret'] || credentials['webhookSecret'] || '';

      if (!secret) {
        this.logger.warn(`No webhook secret configured for ${connectorId}`);
        return true; // Accept if no secret configured (best-effort)
      }

      // Verify timestamp tolerance
      if (security.timestampHeader && timestamp) {
        const tolerance = security.timestampToleranceSeconds || 300;
        const now = Math.floor(Date.now() / 1000);
        const ts = parseInt(timestamp, 10);
        if (Math.abs(now - ts) > tolerance) {
          this.logger.warn(`Webhook timestamp too old for ${connectorId}: ${Math.abs(now - ts)}s > ${tolerance}s`);
          return false;
        }
      }

      // Compute expected signature
      const algorithm = security.signatureAlgorithm === 'hmac-sha512' ? 'sha512' : 'sha256';
      let payloadToSign = payload;

      // Slack prepends version to payload
      if (security.signatureHeader === 'x-slack-signature') {
        payloadToSign = `v0:${timestamp || Math.floor(Date.now() / 1000)}:${payload}`;
      }

      const expected = createHmac(algorithm, secret).update(payloadToSign).digest(security.signatureFormat);

      // Normalize signature for comparison
      let provided = signature;
      if (security.signatureHeader === 'x-slack-signature') {
        provided = signature.replace('v0=', '');
      }

      return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    } catch (err: any) {
      this.logger.error(`Webhook signature verification error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING — 5. HEALTH CHECK ENDPOINT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Check the health of a connector by pinging the external service.
   *
   * Returns: { status: 'healthy' | 'degraded' | 'unhealthy'; latencyMs; lastChecked }
   * Caches result for 60 seconds to avoid excessive health checks.
   */
  async healthCheck(connectorId: string): Promise<ConnectorHealth> {
    // Check cache first
    const cached = this.healthCache.get(connectorId);
    if (cached && Date.now() - cached.cachedAt < this.HEALTH_CACHE_TTL_MS) {
      return cached.health;
    }

    const instance = await (this.prisma as any).externalConnectorInstance.findUnique({
      where: { id: connectorId },
    });

    if (!instance) {
      return {
        status: 'unhealthy',
        latencyMs: 0,
        lastChecked: new Date(),
        message: 'Connector instance not found',
      };
    }

    const definition = this.connectorRegistry.get(instance.definitionId as ExternalService);
    if (!definition?.healthCheck) {
      return {
        status: 'healthy',
        latencyMs: 0,
        lastChecked: new Date(),
        message: 'No health check configured for this connector',
      };
    }

    const credentials = this.decryptCredentials(instance.config);
    const headers = this.buildAuthHeaders(definition, credentials);
    if (definition.defaultHeaders) {
      Object.assign(headers, definition.defaultHeaders);
    }

    const checkStartedAt = Date.now();
    let status: ConnectorHealth['status'];
    let latencyMs: number;
    let message: string | undefined;

    try {
      let url = (definition.baseUrl ?? '') + (definition.healthCheck.endpoint ?? '');
      url = url.replace('{accountSid}', credentials['accountSid'] || '');

      const response = await lastValueFrom(
        this.httpService.request({
          method: definition.healthCheck.method,
          url,
          headers,
          timeout: definition.timeoutConfig?.connectTimeoutMs || 10000,
        }),
      );

      latencyMs = Date.now() - checkStartedAt;

      if (response.status === definition.healthCheck.expectedStatus) {
        status = 'healthy';
        message = `Health check passed in ${latencyMs}ms`;
      } else {
        status = 'degraded';
        message = `Unexpected status: ${response.status} (expected ${definition.healthCheck.expectedStatus})`;
      }
    } catch (err: any) {
      latencyMs = Date.now() - checkStartedAt;
      status = 'unhealthy';
      message = err instanceof Error ? err.message : 'Health check failed';
    }

    const health: ConnectorHealth = {
      status,
      latencyMs,
      lastChecked: new Date(),
      message,
    };

    // Cache result
    this.healthCache.set(connectorId, { health, cachedAt: Date.now() });

    return health;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING — 6. OAUTH TOKEN REFRESH
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Ensure a valid OAuth token is available, refreshing before expiry.
   *
   * Refreshes 5 minutes before expiration.
   * Handles refresh failures gracefully.
   * Stores new tokens securely in cache and database.
   */
  async ensureValidToken(
    connectorId: string,
    definition: ExternalConnectorDefinition,
    credentials: Record<string, string>,
  ): Promise<string | null> {
    // Check in-memory cache first
    const cached = this.tokenCache.get(connectorId);
    if (cached && cached.expiresAt.getTime() > Date.now() + 300000) {
      return cached.token; // Token valid for more than 5 minutes
    }

    // No refresh token available
    if (!credentials['refreshToken'] && !credentials['clientSecret']) {
      return credentials['accessToken'] || credentials['botToken'] || null;
    }

    try {
      let refreshedToken: string | null = null;

      switch (definition.id) {
        case 'slack': {
          // Slack token refresh via OAuth.v2Access
          if (credentials['refreshToken'] && credentials['clientId'] && credentials['clientSecret']) {
            const response = await lastValueFrom(
              this.httpService.request({
                method: 'GET',
                url: 'https://slack.com/api/oauth.v2.access',
                params: {
                  refresh_token: credentials['refreshToken'],
                  client_id: credentials['clientId'],
                  client_secret: credentials['clientSecret'],
                  grant_type: 'refresh_token',
                },
                timeout: 10000,
              }),
            );
            refreshedToken = response.data?.access_token;
          }
          break;
        }
        case 'salesforce': {
          // Salesforce token refresh
          if (credentials['refreshToken'] && credentials['clientId'] && credentials['clientSecret']) {
            const instanceUrl = credentials['instanceUrl'];
            const response = await lastValueFrom(
              this.httpService.request({
                method: 'POST',
                url: `${instanceUrl}/services/oauth2/token`,
                data: {
                  grant_type: 'refresh_token',
                  refresh_token: credentials['refreshToken'],
                  client_id: credentials['clientId'],
                  client_secret: credentials['clientSecret'],
                },
                timeout: 10000,
              }),
            );
            refreshedToken = response.data?.access_token;
          }
          break;
        }
        case 'google_sheets': {
          // Google OAuth token refresh
          if (credentials['refreshToken'] && credentials['clientId'] && credentials['clientSecret']) {
            const response = await lastValueFrom(
              this.httpService.request({
                method: 'POST',
                url: 'https://oauth2.googleapis.com/token',
                data: {
                  grant_type: 'refresh_token',
                  refresh_token: credentials['refreshToken'],
                  client_id: credentials['clientId'],
                  client_secret: credentials['clientSecret'],
                },
                timeout: 10000,
              }),
            );
            refreshedToken = response.data?.access_token;
          }
          break;
        }
        case 'stripe': {
          // Stripe uses static API keys — no refresh needed
          return credentials['apiKey'] || null;
        }
        default: {
          // Generic OAuth2 refresh
          if (credentials['refreshToken'] && definition.sandboxEndpoints?.authUrl) {
            const response = await lastValueFrom(
              this.httpService.request({
                method: 'POST',
                url: definition.sandboxEndpoints.authUrl,
                data: {
                  grant_type: 'refresh_token',
                  refresh_token: credentials['refreshToken'],
                },
                timeout: 10000,
              }),
            );
            refreshedToken = response.data?.access_token;
          }
          break;
        }
      }

      if (refreshedToken) {
        // Update cache
        this.tokenCache.set(connectorId, {
          token: refreshedToken,
          expiresAt: new Date(Date.now() + 3300000), // 55 minutes
          refreshToken: credentials['refreshToken'],
        });

        // Optionally persist to database
        try {
          const instance = await (this.prisma as any).externalConnectorInstance.findUnique({
            where: { id: connectorId },
          });
          if (instance) {
            const updatedConfig = { ...credentials, accessToken: refreshedToken };
            await (this.prisma as any).externalConnectorInstance.update({
              where: { id: connectorId },
              data: { config: this.encryptCredentials(updatedConfig) },
            });
          }
        } catch (persistErr) {
          this.logger.warn(`Failed to persist refreshed token for ${connectorId}: ${persistErr}`);
        }

        this.logger.debug(`Token refreshed for ${connectorId} (${definition.id})`);
        return refreshedToken;
      }

      return credentials['accessToken'] || credentials['botToken'] || null;
    } catch (err: any) {
      this.logger.error(`Token refresh failed for ${connectorId}: ${err instanceof Error ? err.message : String(err)}`);
      // Return existing token as fallback
      return credentials['accessToken'] || credentials['botToken'] || null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING — 7. REQUEST/RESPONSE LOGGING
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Log all external requests (sanitized — no credentials).
   *
   * Logs request method, URL, status code, duration, and retry count.
   * Stores in BusinessEvent table for debugging and audit.
   */
  async logExternalRequest(request: RequestLog): Promise<void> {
    try {
      // Sanitize URL — remove API keys, tokens, and other sensitive data
      const sanitizedUrl = this.sanitizeUrl(request.url);

      // Store in database via BusinessEvent (or dedicated connector_logs table)
      await (this.prisma as any).businessEvent.create({
        data: {
          id: this.generateId('evt'),
          eventType: 'external_connector.request',
          source: 'key-cortex-external-connector',
          payload: {
            requestId: request.requestId,
            connectorId: request.connectorId,
            action: request.action,
            method: request.method,
            url: sanitizedUrl,
            statusCode: request.statusCode,
            durationMs: request.durationMs,
            retryCount: request.retryCount,
            errorCode: request.errorCode,
            timestamp: request.timestamp.toISOString(),
          } as any,
          metadata: {
            connectorId: request.connectorId,
            requestId: request.requestId,
          },
          severity: request.errorCode ? 'warning' : 'info',
          occurredAt: request.timestamp,
        },
      });

      // Also log to application logger
      if (request.errorCode) {
        this.logger.warn(
          `[${request.requestId}] ${request.method} ${sanitizedUrl} → ${request.statusCode || 'ERR'} (${request.durationMs}ms, ${request.retryCount} retries) — ${request.errorCode}`,
        );
      } else {
        this.logger.debug(
          `[${request.requestId}] ${request.method} ${sanitizedUrl} → ${request.statusCode} (${request.durationMs}ms, ${request.retryCount} retries)`,
        );
      }
    } catch (err: any) {
      // Logging should never fail the main request
      this.logger.debug(`Failed to log request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Sanitize a URL by removing credentials and tokens.
   */
  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove query parameters that might contain secrets
      const sensitiveParams = ['token', 'api_key', 'apikey', 'key', 'secret', 'password', 'auth'];
      for (const param of sensitiveParams) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.set(param, '[REDACTED]');
        }
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING — 8. SANDBOX MODE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Execute an action in sandbox mode.
   *
   * Uses sandbox/test endpoints when available.
   * Prevents accidental production mutations during testing.
   * Returns what would have happened without actually executing.
   */
  async executeInSandbox(
    connectorId: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<SandboxResult> {
    const instance = await (this.prisma as any).externalConnectorInstance.findUnique({
      where: { id: connectorId },
    });

    if (!instance) {
      return {
        success: false,
        error: 'Connector instance not found',
        executedInSandbox: true,
        wouldHaveMutated: false,
      };
    }

    const definition = this.connectorRegistry.get(instance.definitionId as ExternalService);
    if (!definition) {
      return {
        success: false,
        error: 'Connector definition not found',
        executedInSandbox: true,
        wouldHaveMutated: false,
      };
    }

    // Check if sandbox endpoints are configured
    if (!definition.sandboxEndpoints) {
      return {
        success: false,
        error: `Sandbox mode not available for ${definition.name}`,
        executedInSandbox: true,
        wouldHaveMutated: false,
      };
    }

    // Determine if action would mutate data
    const actionDef = definition.actions.find((a) => a.name === action);
    const wouldHaveMutated = actionDef
      ? actionDef.method === 'POST' || actionDef.method === 'PUT' || actionDef.method === 'PATCH' || actionDef.method === 'DELETE'
      : true;

    try {
      // For Stripe, use test mode API key (sk_test_ prefix)
      if (definition.id === 'stripe') {
        const credentials = this.decryptCredentials(instance.config);
        const testKey = credentials['apiKey']?.replace('sk_live_', 'sk_test_');
        if (testKey) {
          const testCredentials = { ...credentials, apiKey: testKey };
          const result = await this.executeRequest(
            definition,
            actionDef!,
            testCredentials,
            params,
            definition.timeoutConfig?.requestTimeoutMs || DEFAULT_TIMEOUT_MS,
          );
          return {
            success: true,
            data: result.data,
            executedInSandbox: true,
            wouldHaveMutated,
          };
        }
      }

      // For other connectors, return a simulated success response
      return {
        success: true,
        data: {
          sandbox: true,
          message: `Action "${action}" would execute against ${definition.sandboxEndpoints.baseUrl}`,
          method: actionDef?.method,
          endpoint: actionDef?.endpoint,
          parameters: params,
        },
        executedInSandbox: true,
        wouldHaveMutated,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        executedInSandbox: true,
        wouldHaveMutated,
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ACTION EXECUTION — INTERNAL
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Execute the HTTP request for an action.
   */
  private async executeRequest(
    definition: ExternalConnectorDefinition,
    action: ExternalAction,
    credentials: Record<string, string>,
    parameters: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ data: unknown; statusCode: number; headers: Record<string, string> }> {
    // Build URL from endpoint template
    let url = this.buildUrl(definition, action, credentials, parameters);

    // Build headers with auth
    const headers = this.buildAuthHeaders(definition, credentials);

    // Merge default headers
    if (definition.defaultHeaders) {
      Object.assign(headers, definition.defaultHeaders);
    }

    // Separate parameters by location
    const queryParams: Record<string, unknown> = {};
    const bodyParams: Record<string, unknown> = {};
    const pathParams: Record<string, unknown> = {};

    for (const paramDef of action.parameters) {
      const value = parameters[paramDef.name];
      if (value === undefined && paramDef.defaultValue !== undefined) {
        // Use default value
        if (paramDef.inQuery) queryParams[paramDef.name] = paramDef.defaultValue;
        if (paramDef.inBody) bodyParams[paramDef.name] = paramDef.defaultValue;
        if (paramDef.inPath) pathParams[paramDef.name] = paramDef.defaultValue;
        continue;
      }
      if (value === undefined) continue;

      if (paramDef.inQuery) queryParams[paramDef.name] = value;
      if (paramDef.inBody) bodyParams[paramDef.name] = value;
      if (paramDef.inPath) pathParams[paramDef.name] = value;
    }

    // Replace path parameters in URL
    for (const [key, value] of Object.entries(pathParams)) {
      url = url.replace(`{${key}}`, String(value));
    }

    // Build query string
    const queryString = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) {
        queryString.append(key, String(value));
      }
    }
    if (queryString.toString()) {
      url += (url.includes('?') ? '&' : '?') + queryString.toString();
    }

    // Build request config
    const config: AxiosRequestConfig = {
      method: action.method,
      url,
      headers,
      timeout: timeoutMs,
    };

    // Add body for non-GET requests
    if (action.method !== 'GET' && action.method !== 'DELETE' && Object.keys(bodyParams).length > 0) {
      // Handle form-encoded for Stripe
      if (definition.id === 'stripe') {
        const formData = new URLSearchParams();
        this.flattenObject(bodyParams, '', formData);
        config.data = formData.toString();
      } else {
        config.data = bodyParams;
      }
    }

    // Execute request
    const response = await lastValueFrom(this.httpService.request(config));

    return {
      data: response.data,
      statusCode: response.status,
      headers: response.headers as Record<string, string>,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // WEBHOOK MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Register a webhook with an external service.
   */
  async registerWebhook(input: RegisterWebhookInput): Promise<WebhookRegistration> {
    const { connectorId, eventType, callbackUrl, businessId } = input;

    const instance = await this.getConnectorInstance(connectorId, businessId);
    const definition = await this.getConnectorDefinition(instance.definitionId);

    // Verify the event type is valid for this connector
    const trigger = definition.triggers.find((t) => t.eventType === eventType);
    if (!trigger) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_CONFIG,
        message: `Event type '${eventType}' is not supported by ${definition.name}`,
        supportedEvents: definition.triggers.map((t) => t.eventType),
      });
    }

    // Generate a unique webhook ID and secret
    const webhookId = this.generateId('wh');
    const secret = randomBytes(32).toString('hex');

    // Register with external service (if the service supports programmatic registration)
    let externalWebhookId: string | undefined;
    try {
      externalWebhookId = await this.registerWebhookExternal(
        definition,
        instance,
        eventType,
        callbackUrl,
        secret,
      );
    } catch (err: any) {
      this.logger.warn(
        `External webhook registration failed for ${definition.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Continue — we'll still store the registration for manual verification
    }

    // Store registration
    const registration = await (this.prisma as any).webhookRegistration.create({
      data: {
        id: webhookId,
        connectorId,
        eventType,
        url: callbackUrl,
        secret,
        status: 'active',
        externalWebhookId,
        signatureHeader: definition.webhookSecurity?.signatureHeader || this.getSignatureHeaderName(definition.id),
        deliveryCount: 0,
        failureCount: 0,
      },
    });

    this.logger.log(
      `Webhook registered: ${webhookId} for ${definition.name}.${eventType} → ${callbackUrl}`,
    );

    return registration as WebhookRegistration;
  }

  /**
   * Handle an incoming webhook from an external service.
   */
  async handleWebhook(
    webhookId: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    signature?: string,
  ): Promise<{ success: boolean; eventEmitted: boolean }> {
    // Find the webhook registration
    const registration = await (this.prisma as any).webhookRegistration.findUnique({
      where: { id: webhookId },
      include: { connectorInstance: true },
    });

    if (!registration) {
      throw new NotFoundException({
        code: ErrorCodes.WEBHOOK_NOT_FOUND,
        message: `Webhook registration not found: ${webhookId}`,
      });
    }

    if (registration.status !== 'active') {
      this.logger.warn(`Webhook ${webhookId} is inactive, ignoring payload`);
      return { success: false, eventEmitted: false };
    }

    // Verify signature if a secret is configured
    if (registration.secret && signature) {
      const isValid = this.verifyWebhookSignature(
        payload as any,
        signature,
        registration.secret,
        headers[registration.signatureHeader || 'x-webhook-signature'] || '',
      );
      if (!isValid) {
        this.logger.warn(`Webhook signature verification failed for ${webhookId}`);

        await (this.prisma as any).webhookRegistration.update({
          where: { id: webhookId },
          data: {
            failureCount: { increment: 1 },
            lastError: 'Signature verification failed',
          },
        });

        throw new UnauthorizedException({
          code: ErrorCodes.WEBHOOK_VERIFICATION_FAILED,
          message: 'Webhook signature verification failed',
        });
      }
    }

    // Update delivery stats
    await (this.prisma as any).webhookRegistration.update({
      where: { id: webhookId },
      data: {
        deliveryCount: { increment: 1 },
        lastDeliveredAt: new Date(),
      },
    });

    // Build and emit webhook event
    const webhookPayload: WebhookPayload = {
      webhookId: registration.id,
      eventType: registration.eventType,
      body: payload,
      headers,
      signature,
      deliveredAt: new Date(),
    };

    const event: WebhookReceivedEvent = {
      webhookId: registration.id,
      connectorId: registration.connectorId,
      businessId: registration.connectorInstance.businessId,
      eventType: registration.eventType,
      payload,
      headers,
      receivedAt: new Date(),
    };

    // Emit to KeyFlowOS event bus for downstream processing
    this.eventEmitter.emit(WEBHOOK_RECEIVED_EVENT, event);

    // Also emit a typed event for the specific connector
    this.eventEmitter.emit(
      `key.cortex.webhook.${registration.connectorInstance.definitionId}.${registration.eventType}`,
      event,
    );

    this.logger.debug(
      `Webhook ${webhookId} processed: ${registration.eventType} from ${registration.connectorInstance.definitionId}`,
    );

    return { success: true, eventEmitted: true };
  }

  /**
   * List all webhooks for a connector.
   */
  async listWebhooks(connectorId: string, businessId: string): Promise<WebhookRegistration[]> {
    // Verify ownership
    await this.getConnectorInstance(connectorId, businessId);

    const webhooks = await (this.prisma as any).webhookRegistration.findMany({
      where: { connectorId },
      orderBy: { createdAt: 'desc' },
    });

    return webhooks as WebhookRegistration[];
  }

  /**
   * Deactivate a webhook.
   */
  async deactivateWebhook(
    webhookId: string,
    businessId: string,
  ): Promise<WebhookRegistration> {
    const registration = await (this.prisma as any).webhookRegistration.findUnique({
      where: { id: webhookId },
      include: { connectorInstance: true },
    });

    if (!registration || registration.connectorInstance.businessId !== businessId) {
      throw new NotFoundException({
        code: ErrorCodes.WEBHOOK_NOT_FOUND,
        message: `Webhook not found: ${webhookId}`,
      });
    }

    const updated = await (this.prisma as any).webhookRegistration.update({
      where: { id: webhookId },
      data: { status: 'inactive' },
    });

    return updated as WebhookRegistration;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CUSTOM CONNECTORS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Create a user-defined custom connector from configuration.
   */
  async createCustomConnector(
    input: CreateCustomConnectorInput,
  ): Promise<CustomConnector> {
    const { businessId, name, description, baseUrl, authConfig, actions, headers, timeoutMs, retryConfig } = input;

    // Validate base URL
    try {
      new URL(baseUrl);
    } catch {
      throw new BadRequestException({
        code: ErrorCodes.CUSTOM_CONNECTOR_INVALID,
        message: `Invalid base URL: ${baseUrl}`,
      });
    }

    // Validate actions have required fields
    for (const action of actions) {
      if (!action.name || !action.endpoint || !action.method) {
        throw new BadRequestException({
          code: ErrorCodes.CUSTOM_CONNECTOR_INVALID,
          message: `Action ${action.name || '(unnamed)'} is missing required fields (name, endpoint, method)`,
        });
      }
    }

    // Encrypt auth credentials
    const encryptedAuth = {
      ...authConfig,
      credentials: this.encryptCredentials(authConfig.credentials),
    };

    const customConnector = await (this.prisma as any).customConnector.create({
      data: {
        id: this.generateId('custom'),
        businessId,
        name,
        description,
        baseUrl,
        authConfig: encryptedAuth as any,
        actions: actions as any,
        headers: headers || {},
        timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS,
        retryConfig: retryConfig as any,
      },
    });

    this.logger.log(`Custom connector created: ${customConnector.id} (${name}) for business ${businessId}`);

    return customConnector as unknown as CustomConnector;
  }

  /**
   * Get custom connectors for a business.
   */
  async getCustomConnectors(businessId: string): Promise<CustomConnector[]> {
    const connectors = await (this.prisma as any).customConnector.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });

    return connectors as unknown as CustomConnector[];
  }

  /**
   * Delete a custom connector.
   */
  async deleteCustomConnector(
    connectorId: string,
    businessId: string,
  ): Promise<void> {
    const connector = await (this.prisma as any).customConnector.findFirst({
      where: { id: connectorId, businessId },
    });

    if (!connector) {
      throw new NotFoundException({
        code: ErrorCodes.CONNECTOR_NOT_FOUND,
        message: `Custom connector not found: ${connectorId}`,
      });
    }

    await (this.prisma as any).customConnector.delete({
      where: { id: connectorId },
    });

    this.logger.log(`Custom connector deleted: ${connectorId}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONNECTION STATUS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Check the connection status of a connector by pinging the external service.
   */
  async getConnectionStatus(
    connectorId: string,
    businessId: string,
  ): Promise<{ status: ConnectorStatus; errorMessage?: string; lastUsedAt?: Date; executionCount?: number }> {
    const instance = await this.getConnectorInstance(connectorId, businessId);
    const definition = await this.getConnectorDefinition(instance.definitionId);
    const credentials = this.decryptCredentials(instance.config);

    let status: ConnectorStatus;
    let errorMessage: string | undefined;

    try {
      await this.testConnection(definition, credentials);
      status = 'connected';
      errorMessage = undefined;
    } catch (err: any) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Connection check failed';
    }

    // Update if status changed
    if (status !== instance.status) {
      await (this.prisma as any).externalConnectorInstance.update({
        where: { id: connectorId },
        data: { status, errorMessage },
      });

      await this.redis.del(`${CONNECTOR_INSTANCE_CACHE_PREFIX}${connectorId}`);

      this.emitStatusChange({
        connectorId: instance.id,
        businessId,
        previousStatus: instance.status as ConnectorStatus,
        currentStatus: status,
        changedAt: new Date(),
        reason: errorMessage || 'Status check',
      });
    }

    return {
      status,
      errorMessage,
      lastUsedAt: instance.lastUsedAt,
      executionCount: instance.executionCount || 0,
    };
  }

  /**
   * List all connector instances for a business.
   */
  async getBusinessConnectors(businessId: string): Promise<ExternalConnectorInstance[]> {
    const instances = await (this.prisma as any).externalConnectorInstance.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });

    return instances as ExternalConnectorInstance[];
  }

  /**
   * Update a connector instance's configuration.
   */
  async updateConnector(
    connectorId: string,
    businessId: string,
    updates: { name?: string; config?: Record<string, string>; metadata?: Record<string, unknown> },
  ): Promise<ExternalConnectorInstance> {
    const instance = await this.getConnectorInstance(connectorId, businessId);

    const updateData: any = {};

    if (updates.name) updateData.name = updates.name;
    if (updates.config) {
      // Validate and encrypt new config
      const definition = await this.getConnectorDefinition(instance.definitionId);
      const errors = this.validateConfig(updates.config, definition.configSchema);
      if (errors.length > 0) {
        throw new BadRequestException({
          code: ErrorCodes.INVALID_CONFIG,
          message: 'Invalid configuration',
          errors,
        });
      }
      updateData.config = this.encryptCredentials(updates.config);
    }
    if (updates.metadata) updateData.metadata = updates.metadata;

    const updated = await (this.prisma as any).externalConnectorInstance.update({
      where: { id: connectorId },
      data: updateData,
    });

    // Invalidate cache
    await this.redis.del(`${CONNECTOR_INSTANCE_CACHE_PREFIX}${connectorId}`);

    this.logger.log(`Connector ${connectorId} updated`);

    return updated as ExternalConnectorInstance;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INTERNAL / PRIVATE METHODS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Build the full URL for an action request.
   */
  private buildUrl(
    definition: ExternalConnectorDefinition,
    action: ExternalAction,
    credentials: Record<string, string>,
    _parameters: Record<string, unknown>,
  ): string {
    let baseUrl = definition.baseUrl || '';

    // Replace template variables in base URL
    if (baseUrl.includes('{shop}') && credentials['shopDomain']) {
      baseUrl = baseUrl.replace('{shop}', credentials['shopDomain'].replace('.myshopify.com', ''));
    }
    if (baseUrl.includes('{instance}') && credentials['instanceUrl']) {
      try {
        const url = new URL(credentials['instanceUrl']);
        baseUrl = baseUrl.replace('{instance}', url.hostname);
      } catch {
        // keep as-is
      }
    }
    if (baseUrl.includes('{accountSid}') && credentials['accountSid']) {
      baseUrl = baseUrl.replace('{accountSid}', credentials['accountSid']);
    }

    return `${baseUrl}${action.endpoint}`;
  }

  /**
   * Build authentication headers based on connector auth type.
   */
  private buildAuthHeaders(
    definition: ExternalConnectorDefinition,
    credentials: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    switch (definition.authType) {
      case 'api_key':
        // Shopify uses X-Shopify-Access-Token header
        if (definition.id === 'shopify' && credentials['apiKey']) {
          headers['X-Shopify-Access-Token'] = credentials['apiKey'];
        }
        // Notion uses Authorization: Bearer
        else if (definition.id === 'notion' && credentials['integrationToken']) {
          headers['Authorization'] = `Bearer ${credentials['integrationToken']}`;
        }
        // Stripe uses Basic auth with API key as username
        else if (definition.id === 'stripe' && credentials['apiKey']) {
          const encoded = Buffer.from(`${credentials['apiKey']}:`).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
        }
        // Generic API key in header
        else if (credentials['apiKey']) {
          headers['Authorization'] = `Bearer ${credentials['apiKey']}`;
        } else if (credentials['api_key']) {
          headers['Authorization'] = `Bearer ${credentials['api_key']}`;
        }
        break;

      case 'oauth2':
        // OAuth2 Bearer token
        if (credentials['accessToken'] || credentials['botToken']) {
          const token = credentials['accessToken'] || credentials['botToken'];
          headers['Authorization'] = `Bearer ${token}`;
        }
        // Google Sheets uses refresh token — handled separately
        else if (credentials['refreshToken']) {
          // This would need a token refresh flow in production
          headers['Authorization'] = `Bearer ${credentials['refreshToken']}`;
        }
        break;

      case 'basic':
        // Twilio-style basic auth
        if (credentials['accountSid'] && credentials['authToken']) {
          const encoded = Buffer.from(
            `${credentials['accountSid']}:${credentials['authToken']}`,
          ).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
        } else if (credentials['username'] && credentials['password']) {
          const encoded = Buffer.from(
            `${credentials['username']}:${credentials['password']}`,
          ).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
        }
        break;

      case 'bearer':
        if (credentials['token']) {
          headers['Authorization'] = `Bearer ${credentials['token']}`;
        }
        break;

      default:
        break;
    }

    return headers;
  }

  /**
   * Test a connection by making a lightweight API call.
   */
  private async testConnection(
    definition: ExternalConnectorDefinition,
    credentials: Record<string, string>,
  ): Promise<void> {
    const headers = this.buildAuthHeaders(definition, credentials);
    if (definition.defaultHeaders) {
      Object.assign(headers, definition.defaultHeaders);
    }

    let testUrl: string;
    switch (definition.id) {
      case 'slack':
        testUrl = 'https://slack.com/api/auth.test';
        break;
      case 'shopify': {
        const shop = credentials['shopDomain'];
        const version = credentials['apiVersion'] || '2024-01';
        testUrl = `https://${shop}/admin/api/${version}/shop.json`;
        break;
      }
      case 'salesforce': {
        const instanceUrl = credentials['instanceUrl'] || definition.baseUrl;
        testUrl = `${instanceUrl}/services/data/v59.0/limits`;
        break;
      }
      case 'stripe':
        testUrl = 'https://api.stripe.com/v1/account';
        break;
      case 'twilio': {
        const accountSid = credentials['accountSid'];
        testUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;
        break;
      }
      case 'google_sheets':
        testUrl = 'https://sheets.googleapis.com/v4/spreadsheets?access_token=' + (credentials['accessToken'] || credentials['refreshToken'] || '');
        break;
      case 'notion':
        testUrl = 'https://api.notion.com/v1/users/me';
        break;
      default:
        testUrl = definition.baseUrl || '';
        break;
    }

    const response = await lastValueFrom(
      this.httpService.request({
        method: 'GET',
        url: testUrl,
        headers,
        timeout: 10000,
      }),
    );

    if (response.status >= 400) {
      throw new Error(`Connection test failed: HTTP ${response.status}`);
    }
  }

  /**
   * Register a webhook with the external service (best-effort).
   */
  private async registerWebhookExternal(
    definition: ExternalConnectorDefinition,
    _instance: ExternalConnectorInstance,
    _eventType: string,
    _callbackUrl: string,
    _secret: string,
  ): Promise<string | undefined> {
    // This is a best-effort registration. Many services require manual webhook
    // setup in their dashboards. For services that support programmatic
    // registration, implement the specific API call here.

    const credentials = this.decryptCredentials(_instance.config);
    const headers = this.buildAuthHeaders(definition, credentials);

    try {
      switch (definition.id) {
        case 'stripe': {
          const formData = new URLSearchParams();
          formData.append('url', _callbackUrl);
          formData.append('enabled_events[]', _eventType);

          const response = await lastValueFrom(
            this.httpService.request({
              method: 'POST',
              url: 'https://api.stripe.com/v1/webhook_endpoints',
              headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
              data: formData.toString(),
              timeout: 15000,
            }),
          );
          return response.data?.id;
        }
        case 'slack': {
          // Slack webhooks are configured per-app, not per-workspace via API
          return undefined;
        }
        case 'shopify': {
          const shop = credentials['shopDomain'];
          const version = credentials['apiVersion'] || '2024-01';
          const response = await lastValueFrom(
            this.httpService.request({
              method: 'POST',
              url: `https://${shop}/admin/api/${version}/webhooks.json`,
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              data: {
                webhook: {
                  topic: _eventType,
                  address: _callbackUrl,
                  format: 'json',
                },
              },
              timeout: 15000,
            }),
          );
          return response.data?.webhook?.id?.toString();
        }
        default:
          return undefined;
      }
    } catch (err: any) {
      this.logger.warn(`External webhook registration failed for ${definition.id}: ${err}`);
      return undefined;
    }
  }

  /**
   * Unregister a webhook from the external service.
   */
  private async unregisterWebhookExternal(
    registration: WebhookRegistration,
  ): Promise<void> {
    if (!registration.externalWebhookId) return;

    try {
      const instance = await (this.prisma as any).externalConnectorInstance.findUnique({
        where: { id: registration.connectorId },
      });
      if (!instance) return;

      const definition = await this.getConnectorDefinition(instance.definitionId as ExternalService);
      const credentials = this.decryptCredentials(instance.config);
      const headers = this.buildAuthHeaders(definition, credentials);

      switch (definition.id) {
        case 'stripe':
          await lastValueFrom(
            this.httpService.request({
              method: 'DELETE',
              url: `https://api.stripe.com/v1/webhook_endpoints/${registration.externalWebhookId}`,
              headers,
              timeout: 10000,
            }),
          );
          break;
        case 'shopify': {
          const shop = credentials['shopDomain'];
          const version = credentials['apiVersion'] || '2024-01';
          await lastValueFrom(
            this.httpService.request({
              method: 'DELETE',
              url: `https://${shop}/admin/api/${version}/webhooks/${registration.externalWebhookId}.json`,
              headers,
              timeout: 10000,
            }),
          );
          break;
        }
        default:
          break;
      }
    } catch (err: any) {
      this.logger.warn(`Failed to unregister external webhook ${registration.id}: ${err}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONFIGURATION VALIDATION
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Validate user-provided config against the connector's schema.
   */
  private validateConfig(
    config: Record<string, string>,
    schema: ConfigField[],
  ): Array<{ field: string; message: string }> {
    const errors: Array<{ field: string; message: string }> = [];

    for (const field of schema) {
      const value = config[field.name];

      // Check required fields
      if (field.required && (value === undefined || value === '')) {
        errors.push({ field: field.name, message: `${field.label} is required` });
        continue;
      }

      // Skip further validation if value is empty and not required
      if (!value) continue;

      // Validate URL format
      if (field.type === 'url' && value) {
        try {
          new URL(value);
        } catch {
          errors.push({ field: field.name, message: `${field.label} must be a valid URL` });
        }
      }

      // Validate regex pattern
      if (field.validationPattern && value) {
        const regex = new RegExp(field.validationPattern);
        if (!regex.test(value)) {
          errors.push({ field: field.name, message: `${field.label} format is invalid` });
        }
      }

      // Validate select options
      if (field.type === 'select' && field.options && value) {
        if (!field.options.some((opt) => opt.value === value)) {
          errors.push({
            field: field.name,
            message: `${field.label} must be one of: ${field.options.map((o) => o.value).join(', ')}`,
          });
        }
      }
    }

    return errors;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ENCRYPTION / DECRYPTION
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Encrypt credentials using AES-256-GCM.
   */
  private encryptCredentials(config: Record<string, string>): Record<string, string> {
    const encrypted: Record<string, string> = {};
    for (const [key, value] of Object.entries(config)) {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      let encryptedValue = cipher.update(value, 'utf8', 'base64');
      encryptedValue += cipher.final('base64');
      const authTag = cipher.getAuthTag();
      // Store as: iv:authTag:encryptedData
      encrypted[key] = `${iv.toString('base64')}:${authTag.toString('base64')}:${encryptedValue}`;
    }
    return encrypted;
  }

  /**
   * Decrypt credentials using AES-256-GCM.
   */
  private decryptCredentials(encryptedConfig: Record<string, string>): Record<string, string> {
    const decrypted: Record<string, string> = {};
    for (const [key, value] of Object.entries(encryptedConfig)) {
      try {
        const parts = value.split(':');
        // Handle legacy unencrypted values
        if (parts.length !== 3) {
          decrypted[key] = value;
          continue;
        }
        const iv = Buffer.from(parts[0], 'base64');
        const authTag = Buffer.from(parts[1], 'base64');
        const encryptedData = parts[2];
        const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv, {
          authTagLength: AUTH_TAG_LENGTH,
        });
        decipher.setAuthTag(authTag);
        let decryptedValue = decipher.update(encryptedData, 'base64', 'utf8');
        decryptedValue += decipher.final('utf8');
        decrypted[key] = decryptedValue;
      } catch {
        // If decryption fails, assume the value is plaintext (legacy)
        decrypted[key] = value;
      }
    }
    return decrypted;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ERROR HANDLING
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Normalize an error into a standardized ExecutionError.
   */
  private normalizeError(err: unknown, serviceId: ExternalService): ExecutionError {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const externalData = err.response?.data as any;

      // Determine if error is retryable
      const retryable = [408, 429, 500, 502, 503, 504].includes(status || 0);

      // Extract external error details
      let externalCode: string | undefined;
      let externalMessage: string | undefined;

      switch (serviceId) {
        case 'slack':
          if (!externalData?.ok) {
            externalCode = externalData?.error;
            externalMessage = externalData?.response_metadata?.messages?.[0];
          }
          break;
        case 'stripe':
          externalCode = externalData?.error?.code;
          externalMessage = externalData?.error?.message;
          break;
        case 'shopify':
          externalCode = externalData?.errors ? Object.keys(externalData.errors)[0] : undefined;
          externalMessage = externalData?.errors
            ? JSON.stringify(externalData.errors)
            : undefined;
          break;
        case 'twilio':
          externalCode = externalData?.code?.toString();
          externalMessage = externalData?.message;
          break;
        default:
          externalCode = externalData?.code || externalData?.error;
          externalMessage = externalData?.message || externalData?.error_description;
          break;
      }

      return {
        code: this.getErrorCodeForStatus(status || 0),
        message: err.message,
        externalCode,
        externalMessage,
        retryable,
        retryAfterMs: status === 429 ? 60000 : retryable ? 5000 : undefined,
      };
    }

    if (err instanceof Error) {
      const isTimeout = err.message.includes('timeout') || err.message.includes('ETIMEDOUT');
      const isNetwork = err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND');

      return {
        code: isTimeout
          ? ErrorCodes.TIMEOUT_ERROR
          : isNetwork
            ? ErrorCodes.NETWORK_ERROR
            : ErrorCodes.EXECUTION_FAILED,
        message: err.message,
        retryable: isTimeout || isNetwork,
        retryAfterMs: isTimeout ? 10000 : isNetwork ? 5000 : undefined,
      };
    }

    return {
      code: ErrorCodes.EXECUTION_FAILED,
      message: String(err),
      retryable: false,
    };
  }

  /**
   * Map HTTP status code to internal error code.
   */
  private getErrorCodeForStatus(status: number): ErrorCode {
    switch (status) {
      case 400:
        return ErrorCodes.INVALID_CONFIG;
      case 401:
        return ErrorCodes.AUTHENTICATION_FAILED;
      case 403:
        return ErrorCodes.AUTHORIZATION_FAILED;
      case 404:
        return ErrorCodes.CONNECTOR_NOT_FOUND;
      case 408:
        return ErrorCodes.TIMEOUT_ERROR;
      case 429:
        return ErrorCodes.RATE_LIMITED;
      case 500:
      case 502:
      case 503:
      case 504:
        return ErrorCodes.EXECUTION_FAILED;
      default:
        return ErrorCodes.EXECUTION_FAILED;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EVENT EMITTERS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Emit a connector status change event.
   */
  private emitStatusChange(event: ConnectorStatusChangeEvent): void {
    this.eventEmitter.emit(CONNECTOR_STATUS_CHANGE_EVENT, event);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Generate a unique prefixed ID.
   */
  private generateId(prefix: string): string {
    return `${prefix}_${randomBytes(12).toString('hex')}`;
  }

  /**
   * Sleep for a given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Flatten a nested object for form-encoded bodies (Stripe-style).
   */
  private flattenObject(
    obj: Record<string, unknown>,
    prefix: string,
    formData: URLSearchParams,
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}[${key}]` : key;
      if (value === null || value === undefined) continue;
      if (typeof value === 'object' && !Array.isArray(value)) {
        this.flattenObject(value as Record<string, unknown>, fullKey, formData);
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (typeof item === 'object') {
            this.flattenObject(item as Record<string, unknown>, `${fullKey}[${index}]`, formData);
          } else {
            formData.append(`${fullKey}[${index}]`, String(item));
          }
        });
      } else {
        formData.append(fullKey, String(value));
      }
    }
  }

  /**
   * Get the expected signature header name for a service.
   */
  private getSignatureHeaderName(serviceId: ExternalService): string {
    const headerMap: Record<string, string> = {
      slack: 'x-slack-signature',
      shopify: 'x-shopify-hmac-sha256',
      stripe: 'stripe-signature',
      twilio: 'x-twilio-signature',
      notion: 'x-notion-signature',
    };
    return headerMap[serviceId] || 'x-webhook-signature';
  }

  /**
   * Build placeholder connector definitions for services without dedicated files.
   * This provides basic metadata for all 20+ services.
   */
  private buildPlaceholderConnectors(): void {
    const placeholders: Array<{ id: ExternalService; name: string; category: ExternalConnectorDefinition['category']; authType: ExternalConnectorDefinition['authType']; website: string; baseUrl?: string }> = [
      { id: 'hubspot', name: 'HubSpot', category: 'crm', authType: 'oauth2', website: 'https://hubspot.com', baseUrl: 'https://api.hubapi.com' },
      { id: 'airtable', name: 'Airtable', category: 'productivity', authType: 'api_key', website: 'https://airtable.com', baseUrl: 'https://api.airtable.com/v0' },
      { id: 'mailchimp', name: 'Mailchimp', category: 'marketing', authType: 'api_key', website: 'https://mailchimp.com', baseUrl: 'https://us1.api.mailchimp.com/3.0' },
      { id: 'convertkit', name: 'ConvertKit', category: 'marketing', authType: 'api_key', website: 'https://convertkit.com', baseUrl: 'https://api.convertkit.com/v3' },
      { id: 'aweber', name: 'AWeber', category: 'marketing', authType: 'oauth2', website: 'https://aweber.com', baseUrl: 'https://api.aweber.com/1.0' },
      { id: 'klaviyo', name: 'Klaviyo', category: 'marketing', authType: 'api_key', website: 'https://klaviyo.com', baseUrl: 'https://a.klaviyo.com/api' },
      { id: 'zapier', name: 'Zapier', category: 'productivity', authType: 'api_key', website: 'https://zapier.com', baseUrl: 'https://zapier.com/api/v1' },
      { id: 'sendgrid', name: 'SendGrid', category: 'communication', authType: 'api_key', website: 'https://sendgrid.com', baseUrl: 'https://api.sendgrid.com/v3' },
      { id: 'microsoft_teams', name: 'Microsoft Teams', category: 'communication', authType: 'oauth2', website: 'https://teams.microsoft.com', baseUrl: 'https://graph.microsoft.com/v1.0' },
      { id: 'discord', name: 'Discord', category: 'communication', authType: 'api_key', website: 'https://discord.com', baseUrl: 'https://discord.com/api/v10' },
      { id: 'trello', name: 'Trello', category: 'productivity', authType: 'api_key', website: 'https://trello.com', baseUrl: 'https://api.trello.com/1' },
      { id: 'asana', name: 'Asana', category: 'productivity', authType: 'api_key', website: 'https://asana.com', baseUrl: 'https://app.asana.com/api/1.0' },
      { id: 'monday', name: 'Monday.com', category: 'productivity', authType: 'api_key', website: 'https://monday.com', baseUrl: 'https://api.monday.com/v2' },
      { id: 'custom', name: 'Custom Connector', category: 'custom', authType: 'api_key', website: 'https://keyflow.io/docs/custom-connectors' },
    ];

    for (const ph of placeholders) {
      if (!this.connectorRegistry.has(ph.id)) {
        this.connectorRegistry.set(ph.id, this.createPlaceholderDefinition(ph));
      }
    }
  }

  /**
   * Create a minimal connector definition for placeholder services.
   */
  private createPlaceholderDefinition(
    ph: { id: ExternalService; name: string; category: ExternalConnectorDefinition['category']; authType: ExternalConnectorDefinition['authType']; website: string; baseUrl?: string },
  ): ExternalConnectorDefinition {
    return {
      id: ph.id,
      name: ph.name,
      description: `Connect to ${ph.name} via the KeyFlowOS External Connector Framework`,
      category: ph.category,
      authType: ph.authType,
      logoUrl: `https://cdn.keyflow.io/connectors/${ph.id}.svg`,
      website: ph.website,
      docsUrl: `${ph.website}/developers`,
      baseUrl: ph.baseUrl,
      supportsOAuth: ph.authType === 'oauth2',
      actions: [
        {
          name: 'api_request',
          description: `Make a generic API request to ${ph.name}`,
          endpoint: '',
          method: 'GET',
          category: 'general',
          parameters: [
            {
              name: 'path',
              type: 'string',
              label: 'API Path',
              description: 'The API path to call (e.g., /users)',
              required: true,
              inPath: true,
            },
            {
              name: 'method',
              type: 'string',
              label: 'HTTP Method',
              description: 'HTTP method',
              required: false,
              defaultValue: 'GET',
              inBody: false,
              options: [
                { label: 'GET', value: 'GET' },
                { label: 'POST', value: 'POST' },
                { label: 'PUT', value: 'PUT' },
                { label: 'DELETE', value: 'DELETE' },
                { label: 'PATCH', value: 'PATCH' },
              ],
            },
            {
              name: 'body',
              type: 'json',
              label: 'Request Body',
              description: 'JSON request body',
              required: false,
              inBody: true,
            },
            {
              name: 'query',
              type: 'json',
              label: 'Query Parameters',
              description: 'Query parameters as JSON object',
              required: false,
              inQuery: true,
            },
          ],
          returns: '$.response',
        },
      ],
      triggers: [],
      configSchema: [
        {
          name: 'apiKey',
          type: 'password',
          label: 'API Key',
          description: `API key for ${ph.name}`,
          required: true,
          secret: true,
        },
        {
          name: 'baseUrl',
          type: 'url',
          label: 'Base URL',
          description: `Override the default base URL for ${ph.name}`,
          required: false,
          defaultValue: ph.baseUrl || '',
        },
      ],
      rateLimit: {
        requestsPerWindow: 100,
        windowSeconds: 60,
      },
    };
  }
}
