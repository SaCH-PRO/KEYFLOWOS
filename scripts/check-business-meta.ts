import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const b = await prisma.business.findUnique({
    where: { id: process.argv[2] },
    select: { id: true, name: true, metaData: true },
  });
  console.log(JSON.stringify(b, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
