import { Module, forwardRef } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [PrismaModule, forwardRef(() => CrmModule)],
  controllers: [AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
