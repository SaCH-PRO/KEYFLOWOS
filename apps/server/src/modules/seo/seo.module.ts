import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { SeoController } from './seo.controller';
import { SeoService } from './seo.service';
import { SeoGoogleSearchConsoleService } from './seo-gsc.service';
import { SeoGoogleAnalyticsService } from './seo-ga4.service';
import { SeoContentService } from './seo-content.service';
import { SeoListener } from './seo.listener';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [SeoController],
  providers: [
    SeoService,
    SeoGoogleSearchConsoleService,
    SeoGoogleAnalyticsService,
    SeoContentService,
    SeoListener,
  ],
  exports: [
    SeoService,
    SeoGoogleSearchConsoleService,
    SeoGoogleAnalyticsService,
    SeoContentService,
  ],
})
export class SeoModule {}
