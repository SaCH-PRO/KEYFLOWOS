import { db } from '@keyflow/db';

async function main() {
  try {
    const count = await db.business.count();
    console.log('business count:', count);
    const businesses = await db.business.findMany({ take: 5, select: { id: true, name: true } });
    console.log('businesses:', JSON.stringify(businesses, null, 2));
  } catch (err) {
    console.error('query error:', (err as Error).message);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();
