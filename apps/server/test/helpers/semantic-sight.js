/**
 * MEM-UNIFIED-SEMANTIC-SIGHT (orchestrator delta item A2): the one way a test builds a semantic sight that admits every
 * hit. Production code builds a SemanticSight only through readerSearchOptions (semantic-memory-sight.ts); the type is
 * branded so an object literal cannot stand in for it there. Plain JS, so tsc never pulls test/ into the build.
 */
export function admitAllSemanticSightForTests(includeDocumentExtractionCopies = true) {
  return {
    includeDocumentExtractionCopies,
    visibleTo: async (hits) => hits.map(() => true),
  };
}
