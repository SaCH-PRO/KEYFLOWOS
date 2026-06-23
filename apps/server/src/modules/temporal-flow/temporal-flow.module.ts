import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { RedisModule } from '../../core/redis/redis.module';
import { AiModule } from '../ai/ai.module';
import { KeyGenomeModule } from '../business-genome/key-genome/key-genome.module';
import { TemporalFlowController } from './temporal-flow.controller';
import { TemporalFlowService } from './temporal-flow.service';
import { TemporalFlowMemoryService } from './temporal-flow-memory.service';
import { TemporalFlowKeyInboxListener } from './temporal-flow-key-inbox.listener';
import { TemporalFlowMemoryQueueService } from './temporal-flow-memory.queue.service';
import { TemporalFlowGenomeBridgeService } from './temporal-flow-genome-bridge.service';

@Module({
  imports: [PrismaModule, AuthModule, RedisModule, AiModule, KeyGenomeModule],
  controllers: [TemporalFlowController],
  providers: [
    TemporalFlowService,
    TemporalFlowMemoryService,
    TemporalFlowKeyInboxListener,
    TemporalFlowMemoryQueueService,
    TemporalFlowGenomeBridgeService,
  ],
  exports: [
    TemporalFlowService,
    TemporalFlowMemoryService,
    TemporalFlowGenomeBridgeService,
  ],
})
export class TemporalFlowModule {}
