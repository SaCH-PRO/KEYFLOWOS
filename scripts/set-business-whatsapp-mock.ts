import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const id = process.argv[2];
  const existing = await prisma.business.findUnique({ where: { id }, select: { metaData: true } });
  const meta = (existing?.metaData as Record<string, unknown> | null) ?? {};
  const updated = await prisma.business.update({
    where: { id },
    data: { metaData: { ...meta, whatsapp: { provider: 'mock' } } },
  });
  console.log(JSON.stringify(updated.metaData, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
