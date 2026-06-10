import { db } from './src/client';

async function main() {
  // Restore tags column
  await db.$executeRaw`
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
  `;
  console.log('Restored tags column');
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
