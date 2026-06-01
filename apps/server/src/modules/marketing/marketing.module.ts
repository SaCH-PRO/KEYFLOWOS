import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { MarketingController } from './marketing.controller';
import { MarketingCampaignService } from './marketing-campaign.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MarketingController],
  providers: [MarketingCampaignService],
  exports: [MarketingCampaignService],
})
export class MarketingModule {}
