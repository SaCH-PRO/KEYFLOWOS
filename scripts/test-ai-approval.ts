import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const businessId = 'cmqzajbza00009z4cv6lygpj9';
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) {
    console.error('Business not found');
    process.exit(1);
  }
  console.log('Business:', business.id, business.name);

  const item = await prisma.aiApprovalItem.create({
    data: {
      businessId,
      status: 'pending',
      riskTier: 3,
      toolName: 'test_tool',
      module: 'operations',
      title: 'Test AI approval item',
      description: 'End-to-end test of approval center',
      rationale: 'Test rationale',
      expectedBenefit: 'Confirm resolve path works',
      risks: 'None for test',
      inputPayload: { foo: 'bar' },
      affectedEntities: [{ type: 'test' }],
    },
  });
  console.log('Created item:', item.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
