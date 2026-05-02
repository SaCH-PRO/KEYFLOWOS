import { Module } from '@nestjs/common';
import { GrowthIntelligenceController } from './growth-intelligence.controller';
import { CustomerJourneyService } from './customer-journey.service';
import { AttributionService } from './attribution.service';
import { GrowthIntelligenceService } from './growth-intelligence.service';
import { JourneyListenerService } from './journey-listener.service';

@Module({
  controllers: [GrowthIntelligenceController],
  providers: [
    CustomerJourneyService,
    AttributionService,
    GrowthIntelligenceService,
    JourneyListenerService,
  ],
  exports: [
    CustomerJourneyService,
    AttributionService,
    GrowthIntelligenceService,
  ],
})
export class GrowthIntelligenceModule {}
