import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { SopController } from './sop.controller';
import { SopService } from './sop.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SopController],
  providers: [SopService],
  exports: [SopService],
})
export class SopModule {}
