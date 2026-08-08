import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { IdentityModule } from '../identity/identity.module';
import { RiscAdminController } from './risc-admin.controller';
import { RiscController } from './risc.controller';
import { RiscRetentionService } from './risc-retention.service';
import { RiscService } from './risc.service';

@Module({
  imports: [PrismaModule, AuthModule, IdentityModule],
  controllers: [RiscController, RiscAdminController],
  providers: [RiscService, RiscRetentionService],
  exports: [RiscService],
})
export class RiscModule {}
