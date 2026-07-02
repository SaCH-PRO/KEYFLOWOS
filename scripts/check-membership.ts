import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const business = await p.business.findFirst();
  console.log('business', business?.id);
  const membership = await p.membership.findUnique({
    where: { userId_businessId: { userId: '381d115d-b2b4-4a32-b493-1989cf9b9355', businessId: business!.id } },
  });
  console.log('membership', membership);
}
main().finally(() => p.$disconnect());
