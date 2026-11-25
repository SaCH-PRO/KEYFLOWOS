/**
 * W11-QUERY-DTO-COERCION (P75, BUG-011):
 * Verifies ListIngestionItemsQuery under the exact production ValidationPipe
 * options (`GLOBAL_VALIDATION_PIPE_OPTIONS` = `{ whitelist: true, transform: true }`):
 *   - `{ limit: '25' }` (what Data Inbox sends) coerces to number `25` (RED before: 400).
 *   - `{ sortOrder: 'sideways' }` and `{ sortBy: 'id' }` fail with 400 (RED before: accepted -> Prisma 500).
 *   - `{}` yields defaults `sortBy: 'createdAt'`, `sortOrder: 'desc'`, `limit: 25`.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import * as appBootstrap from '../../../app-bootstrap';
import { ListIngestionItemsQuery } from './ingestion-item.dto';

function makeProductionPipe() {
  const opts =
    ((appBootstrap as Record<string, unknown>).GLOBAL_VALIDATION_PIPE_OPTIONS as
      | { whitelist: true; transform: true }
      | undefined) ?? { whitelist: true, transform: true };
  return new ValidationPipe(opts);
}

describe('ListIngestionItemsQuery under production ValidationPipe (W11-QUERY-DTO-COERCION, BUG-011)', () => {
  it('RED-BEFORE: coerces string limit="25" to number 25', async () => {
    const pipe = makeProductionPipe();
    const out = (await pipe.transform(
      { limit: '25' },
      { type: 'query', metatype: ListIngestionItemsQuery },
    )) as ListIngestionItemsQuery;
    expect(out).toBeInstanceOf(ListIngestionItemsQuery);
    expect(out.limit).toBe(25);
    expect(typeof out.limit).toBe('number');
  });

  it('RED-BEFORE: rejects invalid sortOrder="sideways" and invalid sortBy="id" with 400 BadRequestException', async () => {
    const pipe = makeProductionPipe();
    await expect(
      pipe.transform({ sortOrder: 'sideways' }, { type: 'query', metatype: ListIngestionItemsQuery }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform({ sortBy: 'id' }, { type: 'query', metatype: ListIngestionItemsQuery }),
    ).rejects.toThrow(BadRequestException);
  });

  it('applies defaults createdAt / desc / 25 for empty query and accepts valid sortBy & sortOrder', async () => {
    const pipe = makeProductionPipe();
    const empty = (await pipe.transform(
      {},
      { type: 'query', metatype: ListIngestionItemsQuery },
    )) as ListIngestionItemsQuery;
    expect(empty.sortBy).toBe('createdAt');
    expect(empty.sortOrder).toBe('desc');
    expect(empty.limit).toBe(25);

    const valid = (await pipe.transform(
      { sortBy: 'confidence', sortOrder: 'asc', limit: '50' },
      { type: 'query', metatype: ListIngestionItemsQuery },
    )) as ListIngestionItemsQuery;
    expect(valid.sortBy).toBe('confidence');
    expect(valid.sortOrder).toBe('asc');
    expect(valid.limit).toBe(50);
  });
});
