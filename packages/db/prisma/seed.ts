import { db } from "../src/client";

async function seed() {
  console.log("🌱 Seeding database…");

  // Seed business templates if empty
  const templateCount = await db.businessTemplate.count();
  if (templateCount === 0) {
    const templates = [
      {
        name: "salon",
        displayName: "Salon & Beauty",
        description: "Hair, nails, spa, and beauty service businesses.",
        icon: "💇",
        industry: "Beauty & Wellness",
        archetype: "LOCAL_SERVICE",
        config: {
          products: [
            { name: "Basic Haircut", description: "Standard haircut with styling", price: 150, currency: "TTD", category: "SERVICE", duration: 30 },
            { name: "Hair Wash & Blowout", description: "Shampoo, conditioning and professional blowout", price: 200, currency: "TTD", category: "SERVICE", duration: 45 },
            { name: "Full Colour Treatment", description: "Full head colour with professional products", price: 450, currency: "TTD", category: "SERVICE", duration: 120 },
            { name: "Manicure & Pedicure", description: "Full mani-pedi with polish", price: 250, currency: "TTD", category: "SERVICE", duration: 60 },
            { name: "Bridal Package", description: "Hair, makeup, and nails for the big day", price: 1500, currency: "TTD", category: "PACKAGE", duration: 180 },
          ],
          businessHours: {
            mon: { open: "00:00", close: "00:00", closed: true },
            tue: { open: "09:00", close: "19:00", closed: false },
            wed: { open: "09:00", close: "19:00", closed: false },
            thu: { open: "09:00", close: "19:00", closed: false },
            fri: { open: "09:00", close: "20:00", closed: false },
            sat: { open: "08:00", close: "17:00", closed: false },
            sun: { open: "00:00", close: "00:00", closed: true },
          },
          paymentRecommendations: ["WiPay (local cards & bank transfers)", "Cash on arrival", "Linx/debit at location"],
          emailTemplate: {
            subject: "Welcome to {{businessName}} — Your Beauty Awaits!",
            body: "Hi {{contactName}},\n\nThank you for choosing {{businessName}}! We are thrilled to have you as a client.\n\nBook your next appointment anytime through our online booking page. We look forward to making you look and feel amazing!\n\nWarm regards,\n{{businessName}}",
          },
        },
      },
      {
        name: "fitness",
        displayName: "Fitness & Wellness",
        description: "Gyms, yoga studios, personal trainers, and wellness coaches.",
        icon: "💪",
        industry: "Fitness & Wellness",
        archetype: "LOCAL_SERVICE",
        config: {
          products: [
            { name: "Single Class Drop-in", description: "One-time class pass", price: 75, currency: "TTD", category: "SERVICE", duration: 60 },
            { name: "Monthly Membership", description: "Unlimited classes for 30 days", price: 400, currency: "TTD", category: "PACKAGE" },
            { name: "Personal Training Session", description: "1-on-1 personal training", price: 250, currency: "TTD", category: "SERVICE", duration: 60 },
            { name: "10-Class Pack", description: "Bundle of 10 classes, use anytime", price: 600, currency: "TTD", category: "PACKAGE" },
            { name: "Nutrition Consultation", description: "Personalized nutrition plan and guidance", price: 350, currency: "TTD", category: "SERVICE", duration: 45 },
          ],
          businessHours: {
            mon: { open: "05:30", close: "21:00", closed: false },
            tue: { open: "05:30", close: "21:00", closed: false },
            wed: { open: "05:30", close: "21:00", closed: false },
            thu: { open: "05:30", close: "21:00", closed: false },
            fri: { open: "05:30", close: "21:00", closed: false },
            sat: { open: "07:00", close: "14:00", closed: false },
            sun: { open: "07:00", close: "12:00", closed: false },
          },
          paymentRecommendations: ["WiPay (recurring & one-time)", "Cash payments", "Bank transfer for memberships"],
          emailTemplate: {
            subject: "Welcome to {{businessName}} — Let's Get Moving!",
            body: "Hi {{contactName}},\n\nWelcome to the {{businessName}} family! We are excited to help you reach your fitness goals.\n\nCheck out our class schedule and book your first session. Remember, consistency is key!\n\nStay strong,\n{{businessName}}",
          },
        },
      },
      {
        name: "photography",
        displayName: "Photography & Media",
        description: "Photographers, videographers, and media creators.",
        icon: "📷",
        industry: "Media & Creative",
        archetype: "LOCAL_SERVICE",
        config: {
          products: [
            { name: "Portrait Session", description: "1-hour portrait session with 10 edited photos", price: 800, currency: "TTD", category: "SERVICE", duration: 60 },
            { name: "Event Coverage (Half Day)", description: "4-hour event coverage with edited gallery", price: 2000, currency: "TTD", category: "SERVICE", duration: 240 },
            { name: "Wedding Package", description: "Full-day wedding coverage, album included", price: 5000, currency: "TTD", category: "PACKAGE", duration: 480 },
            { name: "Product Photography (10 items)", description: "10 product shots with white background", price: 1200, currency: "TTD", category: "SERVICE", duration: 120 },
            { name: "Social Media Content Pack", description: "20 branded images for social media", price: 1500, currency: "TTD", category: "PACKAGE" },
          ],
          businessHours: {
            mon: { open: "08:00", close: "18:00", closed: false },
            tue: { open: "08:00", close: "18:00", closed: false },
            wed: { open: "08:00", close: "18:00", closed: false },
            thu: { open: "08:00", close: "18:00", closed: false },
            fri: { open: "08:00", close: "18:00", closed: false },
            sat: { open: "09:00", close: "14:00", closed: false },
            sun: { open: "00:00", close: "00:00", closed: true },
          },
          paymentRecommendations: ["WiPay (deposits & final payments)", "PayPal (international clients)", "Bank transfer for large packages"],
          emailTemplate: {
            subject: "Welcome to {{businessName}} — Let's Capture Your Story!",
            body: "Hi {{contactName}},\n\nThank you for reaching out to {{businessName}}! We would love to help capture your special moments.\n\nFeel free to browse our portfolio and get in touch to discuss your vision. We will create something amazing together!\n\nBest,\n{{businessName}}",
          },
        },
      },
      {
        name: "consulting",
        displayName: "Consulting & Professional Services",
        description: "Consultants, coaches, agencies, and professional service providers.",
        icon: "🤝",
        industry: "Professional Services",
        archetype: "DIGITAL_PRODUCT",
        config: {
          products: [
            { name: "Discovery Call", description: "Free 30-minute introductory consultation", price: 0, currency: "TTD", category: "SERVICE", duration: 30 },
            { name: "Strategy Session", description: "1-hour deep-dive strategy consultation", price: 500, currency: "TTD", category: "SERVICE", duration: 60 },
            { name: "Monthly Retainer — Starter", description: "10 hours of consulting per month", price: 2500, currency: "TTD", category: "PACKAGE" },
            { name: "Monthly Retainer — Growth", description: "25 hours of consulting per month", price: 5000, currency: "TTD", category: "PACKAGE" },
            { name: "Project-Based Engagement", description: "Custom project scope and deliverables", price: 8000, currency: "TTD", category: "PACKAGE" },
          ],
          businessHours: {
            mon: { open: "08:00", close: "18:00", closed: false },
            tue: { open: "08:00", close: "18:00", closed: false },
            wed: { open: "08:00", close: "18:00", closed: false },
            thu: { open: "08:00", close: "18:00", closed: false },
            fri: { open: "08:00", close: "18:00", closed: false },
            sat: { open: "09:00", close: "14:00", closed: false },
            sun: { open: "00:00", close: "00:00", closed: true },
          },
          paymentRecommendations: ["WiPay (invoicing)", "PayPal (international clients)", "Bank transfer for retainers"],
          emailTemplate: {
            subject: "Welcome to {{businessName}} — Let's Grow Together!",
            body: "Hi {{contactName}},\n\nThank you for your interest in {{businessName}}. We are passionate about helping businesses like yours succeed.\n\nLet us schedule a discovery call to understand your needs and explore how we can add value. Looking forward to working with you!\n\nBest regards,\n{{businessName}}",
          },
        },
      },
      {
        name: "food",
        displayName: "Food & Beverage",
        description: "Restaurants, caterers, bakeries, cafes, and food trucks.",
        icon: "🍽️",
        industry: "Food & Beverage",
        archetype: "LOCAL_SERVICE",
        config: {
          products: [
            { name: "Lunch Special", description: "Daily lunch plate with protein, sides and drink", price: 45, currency: "TTD", category: "PRODUCT" },
            { name: "Catering — Small Event (20 pax)", description: "Buffet-style catering for up to 20 guests", price: 2000, currency: "TTD", category: "PACKAGE" },
            { name: "Catering — Large Event (50 pax)", description: "Full-service catering for up to 50 guests", price: 4500, currency: "TTD", category: "PACKAGE" },
            { name: "Weekly Meal Prep (5 meals)", description: "5 prepped meals delivered weekly", price: 350, currency: "TTD", category: "PACKAGE" },
            { name: "Custom Cake / Pastry", description: "Custom cake or pastry order", price: 500, currency: "TTD", category: "PRODUCT" },
          ],
          businessHours: {
            mon: { open: "07:00", close: "20:00", closed: false },
            tue: { open: "07:00", close: "20:00", closed: false },
            wed: { open: "07:00", close: "20:00", closed: false },
            thu: { open: "07:00", close: "20:00", closed: false },
            fri: { open: "07:00", close: "22:00", closed: false },
            sat: { open: "08:00", close: "22:00", closed: false },
            sun: { open: "09:00", close: "16:00", closed: false },
          },
          paymentRecommendations: ["Cash on delivery", "WiPay (online orders)", "Linx/debit at location"],
          emailTemplate: {
            subject: "Welcome to {{businessName}} — Great Food Awaits!",
            body: "Hi {{contactName}},\n\nThank you for trying {{businessName}}! We take pride in serving delicious, freshly prepared food.\n\nCheck out our menu and place your next order. We can not wait to serve you again!\n\nBon appétit,\n{{businessName}}",
          },
        },
      },
      {
        name: "retail",
        displayName: "Retail & E-commerce",
        description: "Retail shops, boutiques, and online stores.",
        icon: "🛍️",
        industry: "Retail",
        archetype: "LOCAL_SERVICE",
        config: {
          products: [
            { name: "Featured Product", description: "Your flagship product", price: 150, currency: "TTD", category: "PRODUCT" },
            { name: "Gift Bundle", description: "Curated gift set with 3-5 items", price: 350, currency: "TTD", category: "PACKAGE" },
            { name: "Custom Order", description: "Made-to-order item with personalization", price: 250, currency: "TTD", category: "PRODUCT" },
            { name: "Subscription Box (Monthly)", description: "Monthly curated selection delivered to your door", price: 200, currency: "TTD", category: "PACKAGE" },
          ],
          businessHours: {
            mon: { open: "08:00", close: "18:00", closed: false },
            tue: { open: "08:00", close: "18:00", closed: false },
            wed: { open: "08:00", close: "18:00", closed: false },
            thu: { open: "08:00", close: "18:00", closed: false },
            fri: { open: "08:00", close: "18:00", closed: false },
            sat: { open: "09:00", close: "14:00", closed: false },
            sun: { open: "00:00", close: "00:00", closed: true },
          },
          paymentRecommendations: ["WiPay (online store)", "PayPal (international shipping)", "Cash on pickup", "Linx/debit in-store"],
          emailTemplate: {
            subject: "Welcome to {{businessName}} — Shop Local, Shop Smart!",
            body: "Hi {{contactName}},\n\nThank you for shopping with {{businessName}}! We appreciate your support for local business.\n\nBrowse our latest collection and enjoy free delivery on orders over $500 TTD. Follow us on social media for exclusive deals!\n\nHappy shopping,\n{{businessName}}",
          },
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
