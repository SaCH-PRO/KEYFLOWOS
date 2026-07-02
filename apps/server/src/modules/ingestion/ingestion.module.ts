import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { ConnectorModule } from '../../core/connectors/connector.module';
import { AiModule } from '../ai/ai.module';
import { CommerceModule } from '../commerce/commerce.module';
import { KeyInboxModule } from '../key-inbox/key-inbox.module';
import { IngestionOrchestrator } from './ingestion-orchestrator.service';
import { IngestionListener } from './ingestion.listener';
import { DataInboxService } from './data-inbox.service';
import { DataInboxController } from './data-inbox.controller';

@Module({
  imports: [PrismaModule, ConnectorModule, AiModule, KeyInboxModule, CommerceModule],
  controllers: [DataInboxController],
  providers: [IngestionOrchestrator, IngestionListener, DataInboxService],
  exports: [IngestionOrchestrator, DataInboxService],
})
export class IngestionModule {}
