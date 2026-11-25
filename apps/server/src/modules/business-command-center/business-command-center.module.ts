import { Module, forwardRef } from '@nestjs/common';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { KeyAutonomyModule } from '../key-autonomy/key-autonomy.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { BusinessGenomeModule } from '../business-genome/business-genome.module';
import { BusinessAssetsModule } from '../business-assets/business-assets.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { KeyGenomeModule } from '../business-genome/key-genome/key-genome.module';
import { FinanceModule } from '../finance/finance.module';
import { CommerceModule } from '../commerce/commerce.module';
import { BusinessCommandCenterController } from './business-command-center.controller';
import { BusinessCommandCenterService } from './business-command-center.service';
import { CommandCenterKeyGenomeBridgeService } from './command-center-key-genome-bridge.service';
import { TodayController } from './today.controller';
import { TodayService } from './today.service';

@Module({
  imports: [
    IntelligenceModule,
    KeyAutonomyModule,
    TemporalFlowModule,
    BusinessGenomeModule,
    BusinessAssetsModule,
    BlueprintModule,
    KeyGenomeModule,
    forwardRef(() => FinanceModule),
    forwardRef(() => CommerceModule),
  ],
  controllers: [BusinessCommandCenterController, TodayController],
  providers: [BusinessCommandCenterService, CommandCenterKeyGenomeBridgeService, TodayService],
  exports: [BusinessCommandCenterService, CommandCenterKeyGenomeBridgeService, TodayService],
})
export class BusinessCommandCenterModule {}
