import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const owned = await p.business.findMany({ where: { ownerId: '381d115d-b2b4-4a32-b493-1989cf9b9355' }, take: 5 });
  console.log('owned', owned.map((b) => ({ id: b.id, name: b.name })));
  const member = await p.membership.findMany({ where: { userId: '381d115d-b2b4-4a32-b493-1989cf9b9355' }, take: 5, include: { business: true } });
  console.log('member', member.map((m) => ({ id: m.businessId, name: m.business.name, role: m.role })));
}
main().finally(() => p.$disconnect());
