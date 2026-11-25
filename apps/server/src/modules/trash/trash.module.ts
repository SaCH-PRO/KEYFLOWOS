import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { CrmModule } from '../crm/crm.module';
import { TrashController } from './trash.controller';

@Module({
  imports: [PrismaModule, CrmModule],
  controllers: [TrashController],
})
export class TrashModule {}
