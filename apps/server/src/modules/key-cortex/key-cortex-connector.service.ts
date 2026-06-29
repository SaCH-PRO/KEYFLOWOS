/**
 * KEY Universal Connector Service
 * --------------------------------
 * Slimmed dispatch facade that routes AI-generated commands to the correct
 * module adapter.  Registry, context assembly, and per-module execution logic
 * were extracted into focused services during Phase 0.7.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ModuleName,
  ModuleCapability,
  ConnectorCommand,
  ConnectorResult,
  FullBusinessContext,
} from './key-cortex-connector.types';

import { KeyCortexCapabilityRegistryService } from './key-cortex-capability-registry.service';
import { KeyCortexContextAssemblyService } from './key-cortex-context-assembly.service';

import {
  CrmAdapterService,
  CommerceAdapterService,
  BookingsAdapterService,
  ContentAdapterService,
  CommunicationsAdapterService,
  FlowAdapterService,
  AutopilotAdapterService,
  TemporalAdapterService,
  InboxAdapterService,
  NotificationsAdapterService,
  ProjectsAdapterService,
  ActivityAdapterService,
  SocialAdapterService,
  KeyCortexBridgeAdapterService,
} from './adapters';

@Injectable()
export class KeyCortexConnectorService {
  private readonly logger = new Logger(KeyCortexConnectorService.name);

  constructor(
    private readonly registry: KeyCortexCapabilityRegistryService,
    private readonly contextAssembly: KeyCortexContextAssemblyService,
    private readonly crm: CrmAdapterService,
    private readonly commerce: CommerceAdapterService,
    private readonly bookings: BookingsAdapterService,
    private readonly content: ContentAdapterService,
    private readonly communications: CommunicationsAdapterService,
    private readonly flow: FlowAdapterService,
    private readonly autopilot: AutopilotAdapterService,
    private readonly temporal: TemporalAdapterService,
    private readonly inbox: InboxAdapterService,
    private readonly notifications: NotificationsAdapterService,
    private readonly projects: ProjectsAdapterService,
    private readonly activity: ActivityAdapterService,
    private readonly social: SocialAdapterService,
    private readonly bridge: KeyCortexBridgeAdapterService,
  ) {
    this.adapterMap = {
      crm: this.crm,
      commerce: this.commerce,
      bookings: this.bookings,
      content: this.content,
      communications: this.communications,
      flow: this.flow,
      autopilot: this.autopilot,
      temporal: this.temporal,
      inbox: this.inbox,
      notifications: this.notifications,
      projects: this.projects,
      activity: this.activity,
      genome: this.bridge,
      intelligence: this.bridge,
      analytics: this.bridge,
      finance: this.bridge,
      settings: this.bridge,
      social: this.social,
      keystore: undefined,
    };
  }

  private readonly adapterMap: Record<
    ModuleName,
    { execute(command: ConnectorCommand): Promise<ConnectorResult> } | undefined
  >;

  // ═══════════════════════════════════════════════════════════════════════════
  //  1. PUBLIC API — Capabilities
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Return every registered capability across all modules.
   */
  getAllCapabilities(): ModuleCapability[] {
    return this.registry.getAllCapabilities();
  }

  /**
   * Return capabilities for a subset of modules.
   */
  getCapabilities(modules: ModuleName[]): ModuleCapability[] {
    return this.registry.getCapabilities(modules);
  }

  /**
   * Format the full capability registry as a human-readable text block
   * suitable for injection into an AI system-prompt context window.
   */
  formatCapabilitiesForPrompt(): string {
    return this.registry.formatCapabilitiesForPrompt();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. PUBLIC API — Command Execution
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a ConnectorCommand by routing it to the correct module adapter.
   */
  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      const adapter = this.adapterMap[command.module];
      if (!adapter) {
        return this.fail(command, start, `Unknown module: ${command.module}`);
      }
      return await adapter.execute(command);
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`execute error [${command.module}.${command.action}]: ${msg}`, (error as Error).stack);
      return this.fail(command, start, msg);
    }
  }

  /**
   * Execute a read-only query on a module.
   */
  async query(
    module: ModuleName,
    queryName: string,
    params: Record<string, unknown>,
    businessId: string,
    userId: string,
  ): Promise<ConnectorResult> {
    const command: ConnectorCommand = {
      module,
      action: queryName,
      parameters: params,
      businessId,
      userId,
      source: 'key_cortex',
      timestamp: new Date(),
      correlationId: this.generateCorrelationId(),
    };
    return this.execute(command);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. PUBLIC API — Context Assembly
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Gather context slices from ALL modules to build a comprehensive
   * business snapshot for the AI reasoning engine.
   */
  async getFullContext(businessId: string): Promise<FullBusinessContext> {
    return this.contextAssembly.getFullContext(businessId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private ok(command: ConnectorCommand, start: number, data: unknown): ConnectorResult {
    return {
      success: true,
      data,
      executionTimeMs: Date.now() - start,
      command,
    };
  }

  private fail(command: ConnectorCommand, start: number, error: string): ConnectorResult {
    return {
      success: false,
      error,
      executionTimeMs: Date.now() - start,
      command,
    };
  }

  private generateCorrelationId(): string {
    return `kc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
