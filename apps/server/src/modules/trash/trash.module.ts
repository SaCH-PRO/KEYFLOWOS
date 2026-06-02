import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { TrashController } from './trash.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TrashController],
})
export class TrashModule {}
