import { Module } from '@nestjs/common';
import { ActionsController } from './actions.controller';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ActionsController],
})
export class ActionsModule {}
