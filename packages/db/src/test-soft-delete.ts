import { db } from "./client";

async function main() {
  console.log("🧪 Running soft-delete middleware test...");

  // 1) Create a test business
  const business = await db.business.create({
    data: { name: `Test Business ${Date.now()}`, ownerId: "test-owner-id" },
  });
  console.log(`- Created test business: ${business.id}`);

  // 2) Create a contact under that business
  const contact = await db.contact.create({
    data: {
      firstName: "Test",
      lastName: "SoftDelete",
      email: `test-soft-delete-${Date.now()}@example.com`,
      businessId: business.id,
    },
    select: { id: true }, // only what we need
  });
  console.log(`- Created test contact: ${contact.id}`);

  // 3) Delete (soft-delete via extension)
  await db.contact.delete({ where: { id: contact.id } });
  console.log(`- Executed soft delete on contact: ${contact.id}`);

  // 4) Verify findMany excludes soft-deleted rows
  const allContacts = await db.contact.findMany({
    where: { businessId: business.id },
    select: { id: true },
  });

  if (allContacts.some((c) => c.id === contact.id)) {
    console.error("❌ FAILED: Soft-deleted contact was found by findMany.");
    process.exit(1);
  } else {
    console.log("- ✅ PASSED: findMany correctly excludes soft-deleted contact.");
  }

  // 5) Verify findUnique also excludes soft-deleted rows
  const foundById = await db.contact.findUnique({
    where: { id: contact.id },
  });

  if (foundById) {
    console.error("❌ FAILED: findUnique retrieved soft-deleted contact by default.");
    process.exit(1);
  } else {
    console.log("- ✅ PASSED: findUnique correctly excludes soft-deleted contact.");
  }

  // 6) Verify raw DB shows deletedAt set (bypasses extension)
  const rawContact = await db.$queryRaw<[{ deletedAt: Date | null }]>`SELECT "deletedAt" FROM "Contact" WHERE id = ${contact.id}`;
  if (rawContact.length > 0 && rawContact[0].deletedAt) {
    console.log(`- ✅ PASSED: Raw query confirms deletedAt is set to: ${rawContact[0].deletedAt}`);
  } else {
    console.error("❌ FAILED: Raw query shows deletedAt is not set or record not found.");
    process.exit(1);
  }

  // 7) Clean up (hard delete)
  await db.$executeRaw`DELETE FROM "Contact" WHERE id = ${contact.id}`;
  await db.$executeRaw`DELETE FROM "Business" WHERE id = ${business.id}`;
  console.log("- Cleaned up test data.");
  console.log("🎉 Test completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });