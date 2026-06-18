import { Module } from '@nestjs/common';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { BusinessAssetsService } from './business-assets.service';
import { BusinessAssetsController } from './business-assets.controller';

@Module({
  imports: [TemporalFlowModule],
  providers: [BusinessAssetsService],
  controllers: [BusinessAssetsController],
  exports: [BusinessAssetsService],
})
export class BusinessAssetsModule {}
