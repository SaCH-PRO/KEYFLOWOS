import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';

@Module({
  imports: [PrismaModule],
  controllers: [SiteController],
  providers: [SiteService],
})
export class SiteModule {}
