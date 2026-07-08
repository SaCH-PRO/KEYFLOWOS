export interface IndustryProduct {
  name: string;
  price: number;
  currency: string;
  category: string;
  duration?: number;
  description?: string;
}

export interface IndustryTemplate {
  id: string;
  label: string;
  keywords: string[];
  defaultProducts: IndustryProduct[];
  businessHours: Record<string, { open: string; close: string; closed: boolean }>;
  paymentRecommendations: string[];
  emailTemplate: {
    subject: string;
    body: string;
  };
}

const STANDARD_WEEKDAY_HOURS = {
  mon: { open: '08:00', close: '18:00', closed: false },
  tue: { open: '08:00', close: '18:00', closed: false },
  wed: { open: '08:00', close: '18:00', closed: false },
  thu: { open: '08:00', close: '18:00', closed: false },
  fri: { open: '08:00', close: '18:00', closed: false },
  sat: { open: '09:00', close: '14:00', closed: false },
  sun: { open: '00:00', close: '00:00', closed: true },
};

const SALON_HOURS = {
  mon: { open: '00:00', close: '00:00', closed: true },
  tue: { open: '09:00', close: '19:00', closed: false },
  wed: { open: '09:00', close: '19:00', closed: false },
  thu: { open: '09:00', close: '19:00', closed: false },
  fri: { open: '09:00', close: '20:00', closed: false },
  sat: { open: '08:00', close: '17:00', closed: false },
  sun: { open: '00:00', close: '00:00', closed: true },
};

const FITNESS_HOURS = {
  mon: { open: '05:30', close: '21:00', closed: false },
  tue: { open: '05:30', close: '21:00', closed: false },
  wed: { open: '05:30', close: '21:00', closed: false },
  thu: { open: '05:30', close: '21:00', closed: false },
  fri: { open: '05:30', close: '21:00', closed: false },
  sat: { open: '07:00', close: '14:00', closed: false },
  sun: { open: '07:00', close: '12:00', closed: false },
};

const FOOD_HOURS = {
  mon: { open: '07:00', close: '20:00', closed: false },
  tue: { open: '07:00', close: '20:00', closed: false },
  wed: { open: '07:00', close: '20:00', closed: false },
  thu: { open: '07:00', close: '20:00', closed: false },
  fri: { open: '07:00', close: '22:00', closed: false },
  sat: { open: '08:00', close: '22:00', closed: false },
  sun: { open: '09:00', close: '16:00', closed: false },
};

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    id: 'salon',
    label: 'Salon & Beauty',
    keywords: ['salon', 'beauty', 'hair', 'nails', 'spa', 'barber', 'braids', 'makeup', 'lashes', 'wax'],
    defaultProducts: [
      { name: 'Basic Haircut', price: 150, currency: 'TTD', category: 'SERVICE', duration: 30, description: 'Standard haircut with styling' },
      { name: 'Hair Wash & Blowout', price: 200, currency: 'TTD', category: 'SERVICE', duration: 45, description: 'Shampoo, conditioning and professional blowout' },
      { name: 'Full Colour Treatment', price: 450, currency: 'TTD', category: 'SERVICE', duration: 120, description: 'Full head colour with professional products' },
      { name: 'Manicure & Pedicure', price: 250, currency: 'TTD', category: 'SERVICE', duration: 60, description: 'Full mani-pedi with polish' },
      { name: 'Bridal Package', price: 1500, currency: 'TTD', category: 'PACKAGE', duration: 180, description: 'Hair, makeup, and nails for the big day' },
    ],
    businessHours: SALON_HOURS,
    paymentRecommendations: ['WiPay (local cards & bank transfers)', 'Cash on arrival', 'Linx/debit at location'],
    emailTemplate: {
      subject: 'Welcome to {{businessName}} — Your Beauty Awaits!',
      body: 'Hi {{contactName}},\n\nThank you for choosing {{businessName}}! We are thrilled to have you as a client.\n\nBook your next appointment anytime through our online booking page. We look forward to making you look and feel amazing!\n\nWarm regards,\n{{businessName}}',
    },
  },
  {
    id: 'fitness',
    label: 'Fitness & Wellness',
    keywords: ['fitness', 'gym', 'yoga', 'personal trainer', 'crossfit', 'pilates', 'wellness', 'workout', 'training'],
    defaultProducts: [
      { name: 'Single Class Drop-in', price: 75, currency: 'TTD', category: 'SERVICE', duration: 60, description: 'One-time class pass' },
      { name: 'Monthly Membership', price: 400, currency: 'TTD', category: 'PACKAGE', description: 'Unlimited classes for 30 days' },
      { name: 'Personal Training Session', price: 250, currency: 'TTD', category: 'SERVICE', duration: 60, description: '1-on-1 personal training' },
      { name: '10-Class Pack', price: 600, currency: 'TTD', category: 'PACKAGE', description: 'Bundle of 10 classes, use anytime' },
      { name: 'Nutrition Consultation', price: 350, currency: 'TTD', category: 'SERVICE', duration: 45, description: 'Personalized nutrition plan and guidance' },
    ],
    businessHours: FITNESS_HOURS,
    paymentRecommendations: ['WiPay (recurring & one-time)', 'Cash payments', 'Bank transfer for memberships'],
    emailTemplate: {
      subject: 'Welcome to {{businessName}} — Let\'s Get Moving!',
      body: 'Hi {{contactName}},\n\nWelcome to the {{businessName}} family! We are excited to help you reach your fitness goals.\n\nCheck out our class schedule and book your first session. Remember, consistency is key!\n\nStay strong,\n{{businessName}}',
    },
  },
  {
    id: 'photography',
    label: 'Photography & Media',
    keywords: ['photo', 'photography', 'video', 'videography', 'media', 'wedding photo', 'portrait', 'drone', 'event photo'],
    defaultProducts: [
      { name: 'Portrait Session', price: 800, currency: 'TTD', category: 'SERVICE', duration: 60, description: '1-hour portrait session with 10 edited photos' },
      { name: 'Event Coverage (Half Day)', price: 2000, currency: 'TTD', category: 'SERVICE', duration: 240, description: '4-hour event coverage with edited gallery' },
      { name: 'Wedding Package', price: 5000, currency: 'TTD', category: 'PACKAGE', duration: 480, description: 'Full-day wedding coverage, album included' },
      { name: 'Product Photography (10 items)', price: 1200, currency: 'TTD', category: 'SERVICE', duration: 120, description: '10 product shots with white background' },
      { name: 'Social Media Content Pack', price: 1500, currency: 'TTD', category: 'PACKAGE', description: '20 branded images for social media' },
    ],
    businessHours: STANDARD_WEEKDAY_HOURS,
    paymentRecommendations: ['WiPay (deposits & final payments)', 'PayPal (international clients)', 'Bank transfer for large packages'],
    emailTemplate: {
      subject: 'Welcome to {{businessName}} — Let\'s Capture Your Story!',
      body: 'Hi {{contactName}},\n\nThank you for reaching out to {{businessName}}! We would love to help capture your special moments.\n\nFeel free to browse our portfolio and get in touch to discuss your vision. We will create something amazing together!\n\nBest,\n{{businessName}}',
    },
  },
  {
    id: 'consulting',
    label: 'Consulting & Professional Services',
    keywords: ['consult', 'consulting', 'coach', 'advisor', 'freelance', 'agency', 'marketing', 'accounting', 'legal', 'design'],
    defaultProducts: [
      { name: 'Discovery Call', price: 0, currency: 'TTD', category: 'SERVICE', duration: 30, description: 'Free 30-minute introductory consultation' },
      { name: 'Strategy Session', price: 500, currency: 'TTD', category: 'SERVICE', duration: 60, description: '1-hour deep-dive strategy consultation' },
      { name: 'Monthly Retainer — Starter', price: 2500, currency: 'TTD', category: 'PACKAGE', description: '10 hours of consulting per month' },
      { name: 'Monthly Retainer — Growth', price: 5000, currency: 'TTD', category: 'PACKAGE', description: '25 hours of consulting per month' },
      { name: 'Project-Based Engagement', price: 8000, currency: 'TTD', category: 'PACKAGE', description: 'Custom project scope and deliverables' },
    ],
    businessHours: STANDARD_WEEKDAY_HOURS,
    paymentRecommendations: ['WiPay (invoicing)', 'PayPal (international clients)', 'Bank transfer for retainers'],
    emailTemplate: {
      subject: 'Welcome to {{businessName}} — Let\'s Grow Together!',
      body: 'Hi {{contactName}},\n\nThank you for your interest in {{businessName}}. We are passionate about helping businesses like yours succeed.\n\nLet us schedule a discovery call to understand your needs and explore how we can add value. Looking forward to working with you!\n\nBest regards,\n{{businessName}}',
    },
  },
  {
    id: 'food',
    label: 'Food & Beverage',
    keywords: ['food', 'restaurant', 'catering', 'bakery', 'bar', 'cafe', 'kitchen', 'doubles', 'roti', 'meal prep'],
    defaultProducts: [
      { name: 'Lunch Special', price: 45, currency: 'TTD', category: 'PRODUCT', description: 'Daily lunch plate with protein, sides and drink' },
      { name: 'Catering — Small Event (20 pax)', price: 2000, currency: 'TTD', category: 'PACKAGE', description: 'Buffet-style catering for up to 20 guests' },
      { name: 'Catering — Large Event (50 pax)', price: 4500, currency: 'TTD', category: 'PACKAGE', description: 'Full-service catering for up to 50 guests' },
      { name: 'Weekly Meal Prep (5 meals)', price: 350, currency: 'TTD', category: 'PACKAGE', description: '5 prepped meals delivered weekly' },
      { name: 'Custom Cake / Pastry', price: 500, currency: 'TTD', category: 'PRODUCT', description: 'Custom cake or pastry order' },
    ],
    businessHours: FOOD_HOURS,
    paymentRecommendations: ['Cash on delivery', 'WiPay (online orders)', 'Linx/debit at location'],
    emailTemplate: {
      subject: 'Welcome to {{businessName}} — Great Food Awaits!',
      body: 'Hi {{contactName}},\n\nThank you for trying {{businessName}}! We take pride in serving delicious, freshly prepared food.\n\nCheck out our menu and place your next order. We can not wait to serve you again!\n\nBon appétit,\n{{businessName}}',
    },
  },
  {
    id: 'retail',
    label: 'Retail & E-commerce',
    keywords: ['retail', 'shop', 'store', 'ecommerce', 'sell', 'product', 'clothing', 'jewelry', 'craft', 'handmade', 'boutique'],
    defaultProducts: [
      { name: 'Featured Product', price: 150, currency: 'TTD', category: 'PRODUCT', description: 'Your flagship product' },
      { name: 'Gift Bundle', price: 350, currency: 'TTD', category: 'PACKAGE', description: 'Curated gift set with 3-5 items' },
      { name: 'Custom Order', price: 250, currency: 'TTD', category: 'PRODUCT', description: 'Made-to-order item with personalization' },
      { name: 'Subscription Box (Monthly)', price: 200, currency: 'TTD', category: 'PACKAGE', description: 'Monthly curated selection delivered to your door' },
    ],
    businessHours: STANDARD_WEEKDAY_HOURS,
    paymentRecommendations: ['WiPay (online store)', 'PayPal (international shipping)', 'Cash on pickup', 'Linx/debit in-store'],
    emailTemplate: {
      subject: 'Welcome to {{businessName}} — Shop Local, Shop Smart!',
      body: 'Hi {{contactName}},\n\nThank you for shopping with {{businessName}}! We appreciate your support for local business.\n\nBrowse our latest collection and enjoy free delivery on orders over $500 TTD. Follow us on social media for exclusive deals!\n\nHappy shopping,\n{{businessName}}',
    },
  },
];

export function matchIndustryTemplate(businessType: string): IndustryTemplate {
  const lower = businessType.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);

  let best: IndustryTemplate | undefined;
  let bestScore = -1;

  for (const template of INDUSTRY_TEMPLATES) {
    // Count keyword matches, with a small bonus for multi-word keyword matches.
    const score = template.keywords.reduce((sum, kw) => {
      if (lower.includes(kw)) return sum + 1 + kw.split(/\s+/).length * 0.1;
      return sum;
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  }

  // Fall back to the generic consulting template if nothing matched at all.
  if (!best || bestScore === 0) {
    return INDUSTRY_TEMPLATES.find(t => t.id === 'consulting')!;
  }

  return best;
}

export function getTemplateById(id: string): IndustryTemplate | undefined {
  return INDUSTRY_TEMPLATES.find(t => t.id === id);
}
