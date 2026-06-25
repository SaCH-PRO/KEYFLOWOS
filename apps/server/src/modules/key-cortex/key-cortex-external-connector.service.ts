/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                 KEY EXTERNAL CONNECTOR SERVICE                            ║
 * ║        Universal Plugin Engine for KeyFlowOS Integrations                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Injectable NestJS service that manages connections to 20+ external services,
 * executes actions with retry logic, handles webhooks, and supports custom
 * user-defined connectors.
 *
 * @module key-cortex-external-connector
 * @version 1.0.0
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
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { lastValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
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
import { StripeConnector } from './connectors/stripe.connector';
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
      ['stripe', StripeConnector],
      ['twilio', TwilioConnector],
      ['google_sheets', GoogleSheetsConnector],
      ['notion', NotionConnector],
    ]);

    // Build placeholder connectors for services without dedicated files yet
    this.buildPlaceholderConnectors();

    this.logger.log(
      `External Connector Service initialized with ${this.connectorRegistry.size} connector definitions`,
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
    await this.redis.setex(cacheKey, 3600, JSON.stringify(definitions));

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
    } catch (err) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Connection test failed';
      this.logger.warn(
        `Connection test failed for ${definition.name} (business: ${businessId}): ${errorMessage}`,
      );
      // Continue saving — the instance will be in 'error' status
    }

    // 4. Save to database
    const instance = await this.prisma.externalConnectorInstance.create({
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

    // Cache the instance
    const cacheKey = `${CONNECTOR_INSTANCE_CACHE_PREFIX}${instance.id}`;
    await this.redis.setex(cacheKey, 300, JSON.stringify(instance));

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
    const webhooks = await this.prisma.webhookRegistration.findMany({
      where: { connectorId },
    });
    for (const wh of webhooks) {
      try {
        await this.unregisterWebhookExternal(wh);
      } catch (err) {
        this.logger.warn(`Failed to unregister webhook ${wh.id}: ${err}`);
      }
    }

    // Delete webhooks from DB
    await this.prisma.webhookRegistration.deleteMany({
      where: { connectorId },
    });

    // Delete instance
    await this.prisma.externalConnectorInstance.delete({
      where: { id: connectorId },
    });

    // Remove from cache
    await this.redis.del(`${CONNECTOR_INSTANCE_CACHE_PREFIX}${connectorId}`);

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
    const instance = await this.prisma.externalConnectorInstance.findFirst({
      where: { id: connectorId, businessId },
    });

    if (!instance) {
      throw new NotFoundException({
        code: ErrorCodes.CONNECTOR_NOT_FOUND,
        message: `Connector instance not found: ${connectorId}`,
      });
    }

    // Update cache
    await this.redis.setex(cacheKey, 300, JSON.stringify(instance));

    return instance as ExternalConnectorInstance;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ACTION EXECUTION
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Execute an action on a configured connector.
   *
   * 1. Loads the connector instance (decrypts credentials)
   * 2. Finds the action definition
   * 3. Builds the HTTP request with auth headers
   * 4. Executes with retry logic (3x exponential backoff)
   * 5. Logs execution and emits event
   * 6. Returns result
   */
  async execute(input: ExecuteActionInput & { businessId: string; requestId?: string }): Promise<ExternalExecutionResult> {
    const { connectorId, action, parameters = {}, businessId, requestId = this.generateId('req'), timeoutMs } = input;
    const startedAt = Date.now();

    // 1. Load connector instance
    const instance = await this.getConnectorInstance(connectorId, businessId);
    const definition = await this.getConnectorDefinition(instance.definitionId);

    // 2. Find action definition
    const actionDef = definition.actions.find((a) => a.name === action);
    if (!actionDef) {
      throw new BadRequestException({
        code: ErrorCodes.ACTION_NOT_FOUND,
        message: `Action '${action}' not found for ${definition.name}`,
        availableActions: definition.actions.map((a) => a.name),
      });
    }

    // 3. Decrypt credentials
    const credentials = this.decryptCredentials(instance.config);

    // 4. Build and execute request with retries
    let lastError: ExecutionError | undefined;
    const retryConfig = definition.rateLimit
      ? {
          ...DEFAULT_RETRY_CONFIG,
          maxRetries: 3,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
        }
      : DEFAULT_RETRY_CONFIG;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        const result = await this.executeRequest(
          definition,
          actionDef,
          credentials,
          parameters,
          timeoutMs || DEFAULT_TIMEOUT_MS,
        );

        // Update execution stats
        await this.prisma.externalConnectorInstance.update({
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

        const executionResult: ExternalExecutionResult = {
          success: true,
          data: result.data,
          statusCode: result.statusCode,
          durationMs: Date.now() - startedAt,
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
      } catch (err) {
        const execError = this.normalizeError(err, definition.id);
        lastError = execError;

        // Check if we should retry
        const shouldRetry =
          attempt < retryConfig.maxRetries &&
          execError.retryable &&
          (!retryConfig.retryableStatusCodes ||
            retryConfig.retryableStatusCodes.includes(
              (err as any)?.response?.status || 0,
            ));

        if (!shouldRetry) {
          break;
        }

        // Calculate backoff delay
        const delay = Math.min(
          retryConfig.baseDelayMs * Math.pow(retryConfig.backoffMultiplier, attempt),
          retryConfig.maxDelayMs,
        );

        this.logger.warn(
          `Execution attempt ${attempt + 1} failed for ${definition.name}.${action} (${connectorId}), ` +
          `retrying in ${delay}ms: ${execError.message}`,
        );

        await this.sleep(delay);
      }
    }

    // All retries exhausted — record failure
    await this.prisma.externalConnectorInstance.update({
      where: { id: connectorId },
      data: {
        failureCount: { increment: 1 },
        status: 'error',
        errorMessage: lastError?.message || 'Execution failed after retries',
      },
    });

    await this.redis.del(`${CONNECTOR_INSTANCE_CACHE_PREFIX}${connectorId}`);

    const failedResult: ExternalExecutionResult = {
      success: false,
      error: lastError,
      durationMs: Date.now() - startedAt,
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
    } catch (err) {
      this.logger.warn(
        `External webhook registration failed for ${definition.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Continue — we'll still store the registration for manual verification
    }

    // Store registration
    const registration = await this.prisma.webhookRegistration.create({
      data: {
        id: webhookId,
        connectorId,
        eventType,
        url: callbackUrl,
        secret,
        status: 'active',
        externalWebhookId,
        signatureHeader: this.getSignatureHeaderName(definition.id),
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
    const registration = await this.prisma.webhookRegistration.findUnique({
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
        payload,
        signature,
        registration.secret,
        registration.signatureHeader || '',
        headers,
      );
      if (!isValid) {
        this.logger.warn(`Webhook signature verification failed for ${webhookId}`);

        await this.prisma.webhookRegistration.update({
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
    await this.prisma.webhookRegistration.update({
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

    const webhooks = await this.prisma.webhookRegistration.findMany({
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
    const registration = await this.prisma.webhookRegistration.findUnique({
      where: { id: webhookId },
      include: { connectorInstance: true },
    });

    if (!registration || registration.connectorInstance.businessId !== businessId) {
      throw new NotFoundException({
        code: ErrorCodes.WEBHOOK_NOT_FOUND,
        message: `Webhook not found: ${webhookId}`,
      });
    }

    const updated = await this.prisma.webhookRegistration.update({
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

    const customConnector = await this.prisma.customConnector.create({
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
    const connectors = await this.prisma.customConnector.findMany({
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
    const connector = await this.prisma.customConnector.findFirst({
      where: { id: connectorId, businessId },
    });

    if (!connector) {
      throw new NotFoundException({
        code: ErrorCodes.CONNECTOR_NOT_FOUND,
        message: `Custom connector not found: ${connectorId}`,
      });
    }

    await this.prisma.customConnector.delete({
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

    let status: ConnectorStatus = instance.status as ConnectorStatus;
    let errorMessage: string | undefined = instance.errorMessage || undefined;

    try {
      await this.testConnection(definition, credentials);
      status = 'connected';
      errorMessage = undefined;
    } catch (err) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Connection check failed';
    }

    // Update if status changed
    if (status !== instance.status) {
      await this.prisma.externalConnectorInstance.update({
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
    const instances = await this.prisma.externalConnectorInstance.findMany({
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

    const updated = await this.prisma.externalConnectorInstance.update({
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
    } catch (err) {
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
      const instance = await this.prisma.externalConnectorInstance.findUnique({
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
    } catch (err) {
      this.logger.warn(`Failed to unregister external webhook ${registration.id}: ${err}`);
    }
  }

  /**
   * Verify a webhook signature using HMAC-SHA256.
   */
  private verifyWebhookSignature(
    payload: Record<string, unknown>,
    signature: string,
    secret: string,
    signatureHeader: string,
    headers: Record<string, string>,
  ): boolean {
    try {
      const payloadStr = JSON.stringify(payload);

      switch (signatureHeader) {
        case 'x-hub-signature-256': // GitHub-style
        case 'x-slack-signature': // Slack
        case 'x-notion-signature': // Notion
        case 'x-twilio-signature': { // Twilio
          const expected = createHmac('sha256', secret).update(payloadStr).digest('hex');
          const provided = signature.replace('sha256=', '').trim();
          return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
        }
        case 'stripe-signature': { // Stripe
          // Stripe signatures have timestamp + signature format
          const elements = signature.split(',');
          const signatureHash = elements.find((e) => e.startsWith('v1='));
          if (!signatureHash) return false;
          const provided = signatureHash.replace('v1=', '');
          const expected = createHmac('sha256', secret)
            .update(`${elements.find((e) => e.startsWith('t='))?.replace('t=', '')}.${payloadStr}`)
            .digest('hex');
          return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
        }
        case 'x-shopify-hmac-sha256': { // Shopify
          const expected = createHmac('sha256', secret).update(payloadStr).digest('base64');
          return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
        }
        default: {
          // Generic HMAC-SHA256
          const expected = createHmac('sha256', secret).update(payloadStr).digest('hex');
          const provided = signature.replace('sha256=', '').replace('sha1=', '').trim();
          return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
        }
      }
    } catch {
      return false;
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

// ── Import needed for HMAC and timing-safe comparison ──────────────────────
import { createHmac, timingSafeEqual } from 'crypto';
