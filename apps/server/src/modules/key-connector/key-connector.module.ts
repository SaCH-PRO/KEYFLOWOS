import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../../core/prisma/prisma.module';

import { KeyConnectorService } from './key-connector.service';
import { KeyConnectorController } from './key-connector.controller';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { HealthCheckService } from './health/health-check.service';
import { SyncEngineService } from './sync/sync-engine.service';
import { AiGatewayService } from './ai-gateway/ai-gateway.service';

/**
 * ── Key Connector Module ───────────────────────────────────────────────
 * Universal connector module for KeyFlowOS.
 *
 * Unifies three integration subsystems:
 *   1. IntegrationHub  — 16 external providers (OAuth2 / API key)
 *   2. Connect         — Deep sync (Google / Outlook contacts, forms)
 *   3. KeyCortex       — 19 internal business modules (AI routing)
 *
 * Imports:
 *   • PrismaModule        — Database access via @keyflow/db
 *   • HttpModule          — HTTP client for external API calls
 *   • IntegrationHubModule — (forwardRef) External provider orchestration
 *
 * Exports:
 *   • KeyConnectorService — Public API for other modules
 * ───────────────────────────────────────────────────────────────────────
 */

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    // IntegrationHubModule is imported via forwardRef to break the
    // circular dependency that exists when IntegrationHub also needs
    // to call back into KeyConnector.
    // forwardRef(() => IntegrationHubModule),
  ],
  controllers: [KeyConnectorController],
  providers: [
    KeyConnectorService,
    ProviderRegistryService,
    HealthCheckService,
    SyncEngineService,
    AiGatewayService,
  ],
  exports: [KeyConnectorService],
})
export class KeyConnectorModule {}
