import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { PeopleFlowController } from './people-flow.controller';
import { PeopleOverviewService } from './people-overview.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PeopleFlowController],
  providers: [PeopleOverviewService],
  exports: [PeopleOverviewService],
})
export class PeopleFlowModule {}
