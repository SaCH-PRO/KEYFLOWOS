import { db } from './src/client';

async function main() {
  const tagCount = await db.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int as count FROM tags`;
  const junctionCount = await db.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int as count FROM contact_tags`;
  console.log('Tags:', tagCount[0].count);
  console.log('ContactTags:', junctionCount[0].count);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
