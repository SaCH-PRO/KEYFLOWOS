import { Module } from '@nestjs/common';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { KeyAutonomyModule } from '../key-autonomy/key-autonomy.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { BusinessGenomeModule } from '../business-genome/business-genome.module';
import { BusinessAssetsModule } from '../business-assets/business-assets.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { KeyGenomeModule } from '../business-genome/key-genome/key-genome.module';
import { BusinessCommandCenterController } from './business-command-center.controller';
import { BusinessCommandCenterService } from './business-command-center.service';

@Module({
  imports: [
    IntelligenceModule,
    KeyAutonomyModule,
    TemporalFlowModule,
    BusinessGenomeModule,
    BusinessAssetsModule,
    BlueprintModule,
    KeyGenomeModule,
  ],
  controllers: [BusinessCommandCenterController],
  providers: [BusinessCommandCenterService],
  exports: [BusinessCommandCenterService],
})
export class BusinessCommandCenterModule {}
