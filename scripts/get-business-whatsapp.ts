import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const business = await prisma.business.findUnique({
    where: { id: process.argv[2] },
    select: { metaData: true },
  });
  console.log(JSON.stringify(business?.metaData, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
