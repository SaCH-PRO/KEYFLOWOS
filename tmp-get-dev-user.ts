import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({
    where: { email: 'dev@keyflow.local' },
    select: { id: true, email: true, role: true },
  });
  console.log(JSON.stringify(user));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
