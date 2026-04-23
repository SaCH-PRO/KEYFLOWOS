import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { BusinessContextService } from './business-context.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [IdentityController],
  providers: [IdentityService, BusinessContextService],
  exports: [IdentityService, BusinessContextService],
})
export class IdentityModule {}
