import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { CommandController } from './command.controller';
import { CommandService } from './command.service';
import { CommandGeneratorService } from './command-generator.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CommandController],
  providers: [CommandService, CommandGeneratorService],
  exports: [CommandService, CommandGeneratorService],
})
export class CommandModule {}
