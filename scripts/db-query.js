process.on('uncaughtException', (e) => { console.error('uncaught', e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('unhandled', e.message || e); process.exit(1); });

const { PrismaClient } = require('C:/Users/sachd/Downloads/KEYFLOWOS/packages/db/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('querying...');
  const count = await prisma.business.count();
  console.log('business count:', count);
  const businesses = await prisma.business.findMany({ take: 3, select: { id: true, name: true } });
  console.log('businesses:', JSON.stringify(businesses, null, 2));
  await prisma.$disconnect();
}

main();
setTimeout(() => { console.error('timeout'); process.exit(2); }, 8000);
