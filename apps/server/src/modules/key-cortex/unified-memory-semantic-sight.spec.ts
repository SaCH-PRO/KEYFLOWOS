/**
 * MEM-UNIFIED-SEMANTIC-SIGHT (D-257, D-234; orchestrator delta item B3): the copies of document extractions are searched
 * only when the read asks for extractions AND the reader's semantic sight admits them. Either one false: the search is
 * told to leave them out (before its limit). The integration suite (V74U) proves the reads over the real store.
 */
import { describe, it, expect, vi } from 'vitest';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';
import { admitAllSemanticSightForTests } from '../../../test/helpers/semantic-sight.js';

async function searchParamsFor(documentExtractions: boolean | undefined, sightIncludes: boolean) {
  const search = vi.fn(async () => []);
  const db = { client: new Proxy({}, { get: () => ({ findMany: vi.fn(async () => []) }) }) };
  const service = new UnifiedMemoryRetrievalService(db as any, { search } as any);
  await service.retrieveContext('biz_1', {
    query: 'q',
    semanticSight: admitAllSemanticSightForTests(sightIncludes),
    ...(documentExtractions === undefined ? {} : { documentExtractions }),
  });
  expect(search).toHaveBeenCalledTimes(1);
  return (search.mock.calls[0] as any)[0];
}

describe('MEM-UNIFIED-SEMANTIC-SIGHT: extraction copies need both the read and the sight', () => {
  it.each([
    [true, false, false],
    [true, true, true],
    [false, true, false],
    [undefined, true, false],
    [false, false, false],
  ])('documentExtractions %s with a sight that includes copies %s: the search includes them %s', async (asked, sightIncludes, expected) => {
    expect((await searchParamsFor(asked, sightIncludes)).includeDocumentExtractionCopies).toBe(expected);
  });
});
