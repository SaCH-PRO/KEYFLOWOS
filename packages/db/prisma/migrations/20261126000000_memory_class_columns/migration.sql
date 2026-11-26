-- MEM-CLASS-COLUMNS (P125, D-257): additive nullable provenance classification columns.
-- No defaults, no index changes; reversible by dropping data_class and module_scope
-- from ai_memories, ai_memory_embeddings, and temporal_flow_memories.

ALTER TABLE "ai_memories"
  ADD COLUMN "data_class" TEXT,
  ADD COLUMN "module_scope" TEXT[];

ALTER TABLE "ai_memory_embeddings"
  ADD COLUMN "data_class" TEXT,
  ADD COLUMN "module_scope" TEXT[];

ALTER TABLE "temporal_flow_memories"
  ADD COLUMN "data_class" TEXT,
  ADD COLUMN "module_scope" TEXT[];
