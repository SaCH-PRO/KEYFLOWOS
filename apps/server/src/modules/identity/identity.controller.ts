import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IdentityService } from './identity.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateBusinessDto } from './dto/create-business.dto';
import { BootstrapDto } from './dto/bootstrap.dto';
import { AiUsageService } from '../ai/ai-usage.service';

@Controller('identity')
export class IdentityController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@Req() req: Request) {
    const user = (req as any).user as { id?: string } | undefined;
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    return this.identity.getUser(user.id);
  }

  @UseGuards(AuthGuard)
  @Patch('me')
  async updateMe(@Req() req: Request, @Body() body: { firstName?: string; lastName?: string; phone?: string; name?: string }) {
    const user = (req as any).user as { id?: string } | undefined;
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    return this.identity.updateUser(user.id, body);
  }

  @UseGuards(AuthGuard)
  @Get('businesses')
  listBusinesses(@Req() req: Request) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.listBusinesses(user?.id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId')
  getBusiness(@Param('businessId') businessId: string) {
    return this.identity.getBusiness(businessId);
  }

  @Get('businesses/slug/:slug')
  getBusinessBySlug(@Param('slug') slug: string) {
    return this.identity.getPublicBusiness(slug);
  }

  @Get('businesses/slug-check/:slug')
  async checkSlugAvailability(@Param('slug') slug: string, @Req() req: Request) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.checkSlugAvailability(slug, user?.id);
  }

  @Get('businesses/public/:businessId')
  getPublicBusiness(@Param('businessId') businessId: string) {
    return this.identity.getPublicBusinessById(businessId);
  }

  @UseGuards(AuthGuard)
  @Post('businesses')
  createBusiness(@Body() body: CreateBusinessDto, @Req() req: Request) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.createBusiness({
      name: body.name,
      ownerId: body.ownerId ?? user?.id,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId')
  updateBusiness(
    @Param('businessId') businessId: string,
    @Body() body: {
      name?: string;
      slug?: string;
      timezone?: string;
      currency?: string;
      logo?: string;
      address?: string;
      phone?: string;
      email?: string;
      website?: string;
      facebookHandle?: string;
      instagramHandle?: string;
      twitterHandle?: string;
      linkedinHandle?: string;
      tiktokHandle?: string;
      youtubeHandle?: string;
      whatsappNumber?: string;
      primaryColor?: string;
      secondaryColor?: string;
      defaultTaxRate?: number;
      complianceStatus?: string;
      complianceData?: Record<string, boolean>;
      lastHealthCheck?: string;
      storeEnabled?: boolean;
      businessHours?: Record<string, { open: string; close: string; closed: boolean }>;
      onboardingComplete?: boolean;
      tagline?: string;
      description?: string;
      city?: string;
      country?: string;
      metaData?: Record<string, any>;
      headline?: string;
      bio?: string;
      skills?: string[];
      businessStage?: string;
      interests?: string[];
    },
  ) {
    return this.identity.updateBusiness(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/generate-profile')
  async generateProfile(
    @Param('businessId') businessId: string,
    @Body() body: { name?: string; industry?: string; skills?: string[]; businessStage?: string; description?: string },
  ) {
    const prompt = [
      `Generate a professional profile for a business/entrepreneur with the following info:`,
      body.name ? `Business Name: ${body.name}` : '',
      body.industry ? `Industry: ${body.industry}` : '',
      body.skills?.length ? `Skills/Expertise: ${body.skills.join(', ')}` : '',
      body.businessStage ? `Business Stage: ${body.businessStage}` : '',
      body.description ? `Description: ${body.description}` : '',
      '',
      'Return a JSON object with exactly two fields:',
      '1. "headline": A concise professional headline (max 120 chars) that captures what this business/person does',
      '2. "bio": A polished professional bio (2-3 sentences, max 300 chars) that presents them compellingly to a community of entrepreneurs',
      '',
      'Return ONLY the JSON object, no markdown formatting.',
    ].filter(Boolean).join('\n');

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'profile-generate',
      messages: [
        { role: 'system', content: 'You are a professional copywriter specializing in business profiles. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      maxTokens: 300,
      temperature: 0.8,
    });

    try {
      const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return { headline: parsed.headline || '', bio: parsed.bio || '' };
    } catch {
      return { headline: '', bio: result.content };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/document-guidance')
  async getDocumentGuidance(@Param('businessId') businessId: string) {
    const business = await this.identity.getBusiness(businessId);
    const recommendations = generateDocumentRecommendations(
      business.industry || '',
      business.businessStage || '',
      business.country || '',
      business.city || '',
    );
    return { recommendations };
  }

  @Get('businesses/community-profile/:businessId')
  async getCommunityProfile(@Param('businessId') businessId: string) {
    return this.identity.getBusinessCommunityProfile(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/team')
  listTeamMembers(@Param('businessId') businessId: string) {
    return this.identity.listTeamMembers(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/team')
  inviteTeamMember(
    @Param('businessId') businessId: string,
    @Body() body: { email: string; role: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.inviteTeamMember(businessId, body.email, body.role, user?.id ?? '');
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/team/:membershipId')
  updateMemberRole(
    @Param('businessId') businessId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { role: string },
  ) {
    return this.identity.updateMemberRole(businessId, membershipId, body.role);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/team/:membershipId')
  removeTeamMember(
    @Param('businessId') businessId: string,
    @Param('membershipId') membershipId: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id?: string } | undefined;
    return this.identity.removeTeamMember(businessId, membershipId, user?.id ?? '');
  }

  @UseGuards(AuthGuard)
  @Post('bootstrap')
  async bootstrap(@Body() body: BootstrapDto, @Req() req: Request) {
    const identity = this.identity ?? new IdentityService(new PrismaService());
    const user = (req as any).user as { id?: string; email?: string } | undefined;
    if (!user?.id || !user?.email) {
      throw new UnauthorizedException('Missing authenticated user');
    }

    return identity.bootstrapUser({
      userId: user.id,
      email: body.email ?? user.email,
      username: body.username,
      name: body.name,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      avatarUrl: body.avatarUrl,
      company: body.company,
    });
  }
}

interface DocumentRecommendation {
  category: 'Legal' | 'Financial' | 'Creative' | 'Constitutional';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

function generateDocumentRecommendations(
  industry: string,
  businessStage: string,
  country: string,
  city: string,
): DocumentRecommendation[] {
  const recs: DocumentRecommendation[] = [];
  const ind = industry.toLowerCase();
  const stage = businessStage.toLowerCase();

  recs.push({
    category: 'Legal',
    title: 'Business Registration Certificate',
    description: 'Ensure your business is properly registered with the relevant government authority.',
    priority: 'high',
  });

  recs.push({
    category: 'Legal',
    title: 'Terms of Service',
    description: 'Define the rules and guidelines for using your products or services.',
    priority: 'high',
  });

  recs.push({
    category: 'Legal',
    title: 'Privacy Policy',
    description: 'Required if you collect any personal data from customers or website visitors.',
    priority: 'high',
  });

  recs.push({
    category: 'Financial',
    title: 'Business Bank Account',
    description: 'Separate personal and business finances with a dedicated business account.',
    priority: 'high',
  });

  if (stage === 'startup' || stage === 'idea') {
    recs.push({
      category: 'Financial',
      title: 'Business Plan & Financial Projections',
      description: 'Essential for securing funding and guiding your early-stage growth strategy.',
      priority: 'high',
    });
  }

  if (stage === 'growth' || stage === 'scaling') {
    recs.push({
      category: 'Financial',
      title: 'Financial Audit Report',
      description: 'Regular financial audits help maintain investor confidence and regulatory compliance.',
      priority: 'medium',
    });
  }

  if (ind.includes('health') || ind.includes('food') || ind.includes('wellness') || ind.includes('fitness')) {
    recs.push({
      category: 'Constitutional',
      title: 'Health & Safety Compliance Plan',
      description: 'Your industry typically requires health and safety certifications and regular inspections.',
      priority: 'high',
    });
    recs.push({
      category: 'Legal',
      title: 'Professional Liability Insurance',
      description: 'Protect your business against claims of negligence or inadequate service.',
      priority: 'medium',
    });
  }

  if (ind.includes('tech') || ind.includes('software') || ind.includes('digital') || ind.includes('saas')) {
    recs.push({
      category: 'Legal',
      title: 'Intellectual Property Protection',
      description: 'Consider patents, trademarks, or copyrights for your digital products and brand.',
      priority: 'medium',
    });
    recs.push({
      category: 'Constitutional',
      title: 'Data Protection Compliance',
      description: 'Ensure compliance with data protection regulations (GDPR, CCPA, etc.).',
      priority: 'high',
    });
  }

  if (ind.includes('retail') || ind.includes('ecommerce') || ind.includes('commerce')) {
    recs.push({
      category: 'Legal',
      title: 'Return & Refund Policy',
      description: 'Clear return policies protect both you and your customers.',
      priority: 'medium',
    });
    recs.push({
      category: 'Constitutional',
      title: 'Consumer Protection Compliance',
      description: 'Ensure your business meets local consumer protection regulations.',
      priority: 'medium',
    });
  }

  if (ind.includes('creative') || ind.includes('design') || ind.includes('media') || ind.includes('art') || ind.includes('photography')) {
    recs.push({
      category: 'Creative',
      title: 'Copyright & Licensing Agreements',
      description: 'Protect your creative works and clarify usage rights with clients.',
      priority: 'high',
    });
    recs.push({
      category: 'Creative',
      title: 'Portfolio & Brand Guidelines',
      description: 'Document your brand standards and showcase your best work professionally.',
      priority: 'medium',
    });
  }

  if (ind.includes('consulting') || ind.includes('service') || ind.includes('agency')) {
    recs.push({
      category: 'Legal',
      title: 'Client Service Agreement',
      description: 'A detailed contract outlining scope, deliverables, timelines, and payment terms.',
      priority: 'high',
    });
    recs.push({
      category: 'Legal',
      title: 'Non-Disclosure Agreement (NDA)',
      description: 'Protect confidential information shared between you and your clients.',
      priority: 'medium',
    });
  }

  recs.push({
    category: 'Financial',
    title: 'Tax Registration & Compliance',
    description: country ? `Ensure you are registered for all applicable taxes in ${country}.` : 'Register for applicable business taxes in your jurisdiction.',
    priority: 'high',
  });

  recs.push({
    category: 'Constitutional',
    title: 'Business License & Permits',
    description: city ? `Check ${city} local requirements for business operating licenses and permits.` : 'Verify local licensing and permit requirements for your business type.',
    priority: 'medium',
  });

  recs.push({
    category: 'Creative',
    title: 'Brand Identity Package',
    description: 'Logo, color palette, typography, and brand voice guidelines for consistent marketing.',
    priority: 'low',
  });

  return recs;
}
