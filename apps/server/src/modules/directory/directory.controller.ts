import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PublicRateLimitGuard, PublicRateLimit } from '../../core/guards/public-rate-limit.guard';

const MOCK_BUSINESSES = [
  {
    slug: 'island-glow-spa',
    name: 'Island Glow Spa',
    logoUrl: null,
    tagline: 'Radiant skin, island soul',
    headline: 'Premium skincare and wellness treatments in the heart of Trinidad',
    industry: 'Beauty',
    city: 'Port of Spain',
    country: 'Trinidad & Tobago',
    website: 'https://islandglow.example.com',
    publishedAt: '2024-01-15T00:00:00.000Z',
  },
  {
    slug: 'coconut-cove-barbers',
    name: 'Coconut Cove Barbers',
    logoUrl: null,
    tagline: 'Sharp cuts by the shore',
    headline: 'Traditional and modern grooming for gentlemen',
    industry: 'Services',
    city: 'Scarborough',
    country: 'Trinidad & Tobago',
    website: null,
    publishedAt: '2024-02-20T00:00:00.000Z',
  },
  {
    slug: 'spice-isle-kitchen',
    name: 'Spice Isle Kitchen',
    logoUrl: null,
    tagline: 'Authentic Grenadian flavours',
    headline: 'Home-style cooking with fresh local ingredients',
    industry: 'Food',
    city: "St. George's",
    country: 'Grenada',
    website: 'https://spiceisle.example.com',
    publishedAt: '2024-03-10T00:00:00.000Z',
  },
  {
    slug: 'reef-wellness',
    name: 'Reef & Wellness',
    logoUrl: null,
    tagline: 'Healing from the sea',
    headline: 'Holistic health and physiotherapy services',
    industry: 'Health',
    city: 'Bridgetown',
    country: 'Barbados',
    website: null,
    publishedAt: '2024-04-05T00:00:00.000Z',
  },
  {
    slug: 'sunset-boutique',
    name: 'Sunset Boutique',
    logoUrl: null,
    tagline: 'Island fashion finds',
    headline: 'Curated Caribbean clothing and accessories',
    industry: 'Retail',
    city: 'Kingston',
    country: 'Jamaica',
    website: 'https://sunsetboutique.example.com',
    publishedAt: '2024-05-12T00:00:00.000Z',
  },
  {
    slug: 'tropical-twist-salon',
    name: 'Tropical Twist Salon',
    logoUrl: null,
    tagline: 'Braids, beauty & beyond',
    headline: 'Expert hair braiding and beauty services',
    industry: 'Beauty',
    city: 'Castries',
    country: 'St. Lucia',
    website: null,
    publishedAt: '2024-06-01T00:00:00.000Z',
  },
];

const CATEGORIES = ['Beauty', 'Health', 'Food', 'Services', 'Retail'];

@Controller('directory')
export class DirectoryController {
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(120, 60_000)
  @Get('businesses')
  listBusinesses(
    @Query('category') category?: string,
    @Query('q') q?: string,
  ) {
    let items = [...MOCK_BUSINESSES];

    if (category && category.trim()) {
      const cat = category.trim();
      items = items.filter((b) => b.industry?.toLowerCase() === cat.toLowerCase());
    }

    if (q && q.trim()) {
      const query = q.trim().toLowerCase();
      items = items.filter(
        (b) =>
          b.name.toLowerCase().includes(query) ||
          b.tagline?.toLowerCase().includes(query) ||
          b.headline?.toLowerCase().includes(query) ||
          b.city?.toLowerCase().includes(query) ||
          b.industry?.toLowerCase().includes(query),
      );
    }

    const categoryCounts = CATEGORIES.map((c) => ({
      value: c,
      count: MOCK_BUSINESSES.filter((b) => b.industry === c).length,
    }));

    return {
      items,
      total: items.length,
      filters: {
        categories: categoryCounts,
      },
    };
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(120, 60_000)
  @Get('businesses/:slug')
  getBusiness(@Param('slug') slug: string) {
    const business = MOCK_BUSINESSES.find((b) => b.slug === slug);
    if (!business) {
      return { success: false, error: 'Business not found' };
    }
    return { success: true, business };
  }
}
