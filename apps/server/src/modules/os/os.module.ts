import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { CommandModule } from '../command/command.module';
import { OsController } from './os.controller';
import { OsService } from './os.service';

@Module({
  imports: [PrismaModule, AuthModule, CommandModule],
  controllers: [OsController],
  providers: [OsService],
  exports: [OsService],
})
export class OsModule {}
