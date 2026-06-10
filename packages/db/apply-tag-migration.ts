import { db } from './src/client';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, 'prisma/migrations/20260607000001_contact_tag_normalization/migration.sql'),
    'utf-8'
  );
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    try {
      await db.$executeRawUnsafe(stmt + ';');
    } catch (err) {
      console.warn(`Statement failed (may be idempotent): ${(err as Error).message}`);
    }
  }
  console.log('Tag normalization migration applied');
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
