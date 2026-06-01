import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { PeopleFlowController } from './people-flow.controller';
import { PeopleOverviewService } from './people-overview.service';
import { RelationshipHealthService } from './relationship-health.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PeopleFlowController],
  providers: [PeopleOverviewService, RelationshipHealthService],
  exports: [PeopleOverviewService, RelationshipHealthService],
})
export class PeopleFlowModule {}
