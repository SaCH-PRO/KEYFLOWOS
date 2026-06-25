-- FIN2: cash- vs accrual-basis flag per business + processor fee on payments.
ALTER TABLE "businesses" ADD COLUMN "accounting_basis" TEXT NOT NULL DEFAULT 'CASH';
ALTER TABLE "payments" ADD COLUMN "processor_fee" DOUBLE PRECISION DEFAULT 0;
