import { db } from "../src/client";

async function seed() {
  console.log("🌱 Seeding database…");

  // Seed business templates if empty
  const templateCount = await db.businessTemplate.count();
  if (templateCount === 0) {
    const templates = [
      {
        name: "freelancer",
        displayName: "Freelancer",
        description: "Perfect for freelancers, consultants, and solo digital professionals.",
        icon: "💻",
        industry: "Technology",
        archetype: "DIGITAL_PRODUCT",
        config: {
          products: [
            { name: "Web Design", description: "Custom website design service", price: 2500, category: "SERVICE" },
            { name: "Logo Design", description: "Professional logo design package", price: 800, category: "SERVICE" },
          ],
          expenseCategories: [
            { name: "Software", icon: "🖥️" },
            { name: "Equipment", icon: "⚙️" },
            { name: "Marketing", icon: "📣" },
          ],
        },
      },
      {
        name: "restaurant-food",
        displayName: "Restaurant / Food",
        description: "For restaurants, caterers, and food service businesses.",
        icon: "🍽️",
        industry: "Food & Beverage",
        archetype: "LOCAL_SERVICE",
        config: {
          products: [
            { name: "Catering Service", description: "Full catering for events", price: 5000, category: "SERVICE" },
          ],
          expenseCategories: [
            { name: "Ingredients", icon: "🥬" },
            { name: "Equipment", icon: "🍳" },
          ],
        },
      },
    ];

    for (const t of templates) {
      await db.businessTemplate.create({ data: t });
    }
    console.log(`  → Seeded ${templates.length} business templates`);
  } else {
    console.log("  → Business templates already exist, skipping");
  }

  // Seed courses if empty
  const courseCount = await db.course.count();
  if (courseCount === 0) {
    const courses = [
      {
        title: "Getting Started with KeyFlowOS",
        description: "Learn the basics of KeyFlowOS and set up your business for success.",
        category: "Business",
        difficulty: "BEGINNER",
        duration: 15,
        isPublished: true,
        isFree: true,
        lessons: {
          create: [
            { id: "gs-1", title: "Welcome to KeyFlowOS", content: "Learn what KeyFlowOS is and how it can help your business grow.", order: 1 },
            { id: "gs-2", title: "Setting Up Your Profile", content: "Configure your business profile, add your logo, and set up branding.", order: 2 },
          ],
        },
      },
      {
        title: "Mastering Your Cash Flow",
        description: "Understand and optimize your business cash flow for sustainable growth.",
        category: "Finance",
        difficulty: "BEGINNER",
        duration: 20,
        isPublished: true,
        isFree: true,
        lessons: {
          create: [
            { id: "cf-1", title: "Understanding Cash Flow", content: "Cash flow fundamentals.", order: 1 },
            { id: "cf-2", title: "Tracking Income", content: "Track all revenue streams.", order: 2 },
          ],
        },
      },
    ];

    for (const c of courses) {
      await db.course.create({ data: c });
    }
    console.log(`  → Seeded ${courses.length} courses`);
  } else {
    console.log("  → Courses already exist, skipping");
  }

  // Seed cohorts if empty
  const cohortCount = await db.cohort.count();
  if (cohortCount === 0) {
    const cohorts = [
      { name: "Caribbean Founders Circle", description: "A community for Caribbean entrepreneurs.", maxMembers: 10, industry: "General", isActive: true },
      { name: "Service Business Owners", description: "Connect with other service-based business owners.", maxMembers: 10, industry: "Services", isActive: true },
    ];

    for (const c of cohorts) {
      await db.cohort.create({ data: c });
    }
    console.log(`  → Seeded ${cohorts.length} cohorts`);
  } else {
    console.log("  → Cohorts already exist, skipping");
  }

  console.log("✅ Seed complete.");
}

seed()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
