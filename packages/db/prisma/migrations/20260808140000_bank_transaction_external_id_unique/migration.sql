-- Let the database enforce statement dedupe, because application memory cannot.
--
-- BankImportService.persist() dedupes by reading the existing rows in the
-- statement's date range, building a Set of bank-assigned ids, and deciding in
-- memory. There is no constraint behind that decision, so two ingests that
-- interleave both read the same empty Set and both insert.
--
-- That is not hypothetical. Widening the read-write window to 150ms and running
-- two concurrent imports of the same 2-row OFX produced FOUR rows, with each
-- FITID stored twice. The natural window on a local socket is narrow enough to
-- hide it; a production round trip, a large statement, or the 5am cron
-- overlapping someone pressing "Sweep now" is not.
--
-- It is also the worst possible defect to leave to chance, because a duplicated
-- bank line is indistinguishable from a real one. Reconciliation matches it to
-- a ledger entry that does not exist, the account "fails to balance" by exactly
-- one transaction, and the person looking has no reason to suspect the importer.
--
-- Partial, because only OFX/QFX/MT940 carry an id. CSV and QIF have none, so
-- their rows have no externalId and are excluded — their dedupe stays the
-- (date, amount, reference) heuristic, which is why BankImportResult reports
-- `exactDedupe: false` for them. After this index that flag means something
-- precise: true = the database guarantees it, false = we did our best.
--
-- Note the quoted "rawData". BankTransaction.rawData has no @map in
-- schema.prisma, so the column keeps its camelCase name while every other
-- column on the table is snake_case.

CREATE UNIQUE INDEX IF NOT EXISTS "bank_transactions_account_external_id_key"
  ON "bank_transactions" ("account_id", (("rawData"->>'externalId')))
  WHERE "rawData"->>'externalId' IS NOT NULL;
