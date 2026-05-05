import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { BillsController } from './bills.controller';
import { RecurringExpensesController } from './recurring-expenses.controller';
import { RecurringExpenseService } from './recurring-expense.service';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [FinanceModule],
  controllers: [ExpensesController, BillsController, RecurringExpensesController],
  providers: [ExpensesService, RecurringExpenseService],
  exports: [ExpensesService, RecurringExpenseService],
})
export class ExpensesModule {}
