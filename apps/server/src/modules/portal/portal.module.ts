import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PortalContentService } from './portal-content.service';

@Module({
  imports: [PrismaModule],
  providers: [PortalService, PortalContentService],
  controllers: [PortalController],
  exports: [PortalService, PortalContentService],
})
export class PortalModule {}
