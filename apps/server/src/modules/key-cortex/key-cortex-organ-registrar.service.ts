/**
 * KEY Cortex Organ Registrar
 *
 * At module boot, collects tool definitions from every organ adapter
 * and registers them in the canonical KeyCortexToolRegistry.
 *
 * This is the "wiring stage" of the peripheral nervous system:
 * organs expose their capabilities; the brain sees one unified tool surface.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KeyCortexToolRegistryService } from './key-cortex-tool-registry.service';
import type { IKeyOrganAdapter } from './organs/key-organ-adapter.interface';
import { KeyCortexSafeDatabaseService } from './key-cortex-safe-database.service';
import { TemporalFlowAdapterService } from './organs/temporal-flow-adapter.service';
import { KeyInboxAdapterService } from './organs/key-inbox-adapter.service';
import { KeyGenomeAdapterService } from './organs/key-genome-adapter.service';
import { StorelinkAdapterService } from './organs/storelink-adapter.service';
import { KeyConnectorAdapterService } from './organs/key-connector-adapter.service';

@Injectable()
export class KeyCortexOrganRegistrarService implements OnModuleInit {
  private readonly logger = new Logger(KeyCortexOrganRegistrarService.name);

  constructor(
    private readonly registry: KeyCortexToolRegistryService,
    private readonly temporalFlowAdapter: TemporalFlowAdapterService,
    private readonly keyInboxAdapter: KeyInboxAdapterService,
    private readonly keyGenomeAdapter: KeyGenomeAdapterService,
    private readonly storelinkAdapter: StorelinkAdapterService,
    private readonly keyConnectorAdapter: KeyConnectorAdapterService,
    private readonly safeDatabase: KeyCortexSafeDatabaseService,
  ) {}

  /**
   * Every organ plugged into the peripheral nervous system.
   *
   * Exposed because the registrar was previously the only thing holding these
   * references, and it used them for exactly one purpose: harvesting
   * listTools() at boot. That is the efferent half — brain acting on organs.
   * The afferent half, organs reporting their state back, needs the same list.
   */
  listAdapters(): IKeyOrganAdapter[] {
    return [
      this.temporalFlowAdapter,
      this.keyInboxAdapter,
      this.keyGenomeAdapter,
      this.storelinkAdapter,
      this.keyConnectorAdapter,
    ];
  }

  onModuleInit(): void {
    const adapters = this.listAdapters();

    let totalTools = 0;
    for (const adapter of adapters) {
      const tools = adapter.listTools();
      this.registry.registerMany(tools);
      totalTools += tools.length;
      this.logger.log(`[registrar] ${adapter.organId}: ${tools.length} tools`);
    }

    // Phase 3 Skeleton: safe database wrappers
    const dbTools = [
      this.safeDatabase.getQueryToolDefinition(),
      this.safeDatabase.getUpdateToolDefinition(),
    ];
    this.registry.registerMany(dbTools);
    totalTools += dbTools.length;
    this.logger.log(`[registrar] safe_database: ${dbTools.length} tools`);

    this.logger.log(`[registrar] Total organ tools registered: ${totalTools}`);
  }
}
