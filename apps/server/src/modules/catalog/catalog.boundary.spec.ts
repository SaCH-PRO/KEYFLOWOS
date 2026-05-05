import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Module-boundary test for the Shared Catalog (task S1).
 *
 * Ensures no module outside `apps/server/src/modules/catalog` writes to
 * Product or Service via Prisma. Reads (`findMany`, `findFirst`,
 * `count`, `findUnique`) are still allowed anywhere.
 */

const SERVER_SRC = path.resolve(__dirname, '..', '..');
const CATALOG_DIR = path.resolve(__dirname);

const WRITE_METHODS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
];

// Match Prisma client / transaction writes only:
//   prisma.client.product.create(...)
//   db.product.update(...)
//   tx.product.create(...)
//   client.service.create(...)
// Avoid false positives like `this.service.update(...)` (NestJS service classes).
const CLIENT_PREFIX = '(?:client|db|tx|prisma\\.client|this\\.prisma\\.client|this\\.db|this\\.client)';
const PRODUCT_PATTERNS = WRITE_METHODS.map(
  m => new RegExp(`${CLIENT_PREFIX}\\.product\\.${m}\\b`),
);
const SERVICE_PATTERNS = WRITE_METHODS.map(
  m => new RegExp(`${CLIENT_PREFIX}\\.service\\.${m}\\b`),
);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('Catalog module boundary', () => {
  it('forbids Product/Service Prisma writes outside the Catalog module', async () => {
    const files = await walk(SERVER_SRC);
    const offenders: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      if (file.startsWith(CATALOG_DIR + path.sep)) continue;

      const content = await fs.readFile(file, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        // Skip comments
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        const matches = [
          ...PRODUCT_PATTERNS.filter(p => p.test(line)),
          ...SERVICE_PATTERNS.filter(p => p.test(line)),
        ];
        if (matches.length > 0) {
          offenders.push({
            file: path.relative(SERVER_SRC, file),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }

    if (offenders.length > 0) {
      const detail = offenders
        .map(o => `  ${o.file}:${o.line}  ${o.text}`)
        .join('\n');
      throw new Error(
        `Catalog boundary violation: Product/Service Prisma writes found ` +
        `outside apps/server/src/modules/catalog. Use CatalogService instead.\n${detail}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
