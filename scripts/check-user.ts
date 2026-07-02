import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
p.user.findUnique({ where: { id: '381d115d-b2b4-4a32-b493-1989cf9b9355' }, select: { id: true, email: true, role: true } })
  .then((u) => console.log(u))
  .finally(() => p.$disconnect());
