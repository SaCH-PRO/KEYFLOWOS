/**
 * Dev-only helper: fetch the local dev user record.
 *
 * NEVER run this in production or against a real user database.
 * The script exits unless NODE_ENV=development.
 */
import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV !== 'development') {
  console.error('This script is only allowed in NODE_ENV=development');
  process.exit(1);
}

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
