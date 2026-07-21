import { Module, forwardRef } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { BillsController } from './bills.controller';
import { RecurringExpensesController } from './recurring-expenses.controller';
import { RecurringExpenseService } from './recurring-expense.service';
import { FinanceModule } from '../finance/finance.module';
import { TimelineModule } from '../timeline/timeline.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [FinanceModule, TimelineModule, forwardRef(() => AiModule)],
  controllers: [ExpensesController, BillsController, RecurringExpensesController],
  providers: [ExpensesService, RecurringExpenseService],
  exports: [ExpensesService, RecurringExpenseService],
})
export class ExpensesModule {}
