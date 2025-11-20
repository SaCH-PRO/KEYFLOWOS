// packages/db/src/test-soft-delete.ts
import { db } from "./index";

async function main() {
  console.log("🧪 Running soft-delete middleware test...");

  // 1) Create a test business
  const business = await db.business.create({
    data: { name: `Test Business ${Date.now()}`, ownerId: "test-owner-id" },
  });
  console.log(`   - Created test business: ${business.id}`);

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
  console.log(`   - Created test contact: ${contact.id}`);

  // 3) Delete (soft-delete via extension)
  await db.contact.delete({ where: { id: contact.id } });
  console.log(`   - Executed soft delete on contact: ${contact.id}`);

  // 4) Verify findMany excludes soft-deleted rows
  const allContacts = await db.contact.findMany({
    where: { businessId: business.id },
    select: { id: true },
  });

  if (allContacts.some((c: { id: string }) => c.id === contact.id)) {
    console.error("❌ FAILED: Soft-deleted contact was found by findMany.");
    process.exit(1);
  } else {
    console.log("   - ✅ PASSED: findMany correctly excludes soft-deleted contact.");
  }

  // 5) Verify findUnique still works (we did NOT modify findUnique in the extension)
  const foundById = await db.contact.findUnique({
    where: { id: contact.id },
    select: { id: true },
  });
  if (foundById?.id === contact.id) {
    console.log("   - ✅ PASSED: findUnique correctly retrieves soft-deleted contact.");
  } else {
    console.error("❌ FAILED: findUnique could not retrieve soft-deleted contact.");
    process.exit(1);
  }

  // 6) Verify raw DB shows deleted_at set (bypasses extension)
  const raw = await db.$queryRaw<{ deleted_at: Date | null }[]>`
    SELECT deleted_at FROM contacts WHERE id = ${contact.id}
  `;
  if (raw.length > 0 && raw[0].deleted_at) {
    console.log(`   - ✅ PASSED: Raw query confirms deleted_at is set to: ${raw[0].deleted_at}`);
  } else {
    console.error("❌ FAILED: Raw query shows deleted_at is not set.");
    process.exit(1);
  }

  // 7) Clean up (hard delete)
  await db.$executeRaw`DELETE FROM contacts WHERE id = ${contact.id}`;
  await db.$executeRaw`DELETE FROM businesses WHERE id = ${business.id}`;
  console.log("   - Cleaned up test data.");
  console.log("🎉 Test completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
