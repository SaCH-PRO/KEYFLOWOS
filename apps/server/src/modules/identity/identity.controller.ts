import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { IdentityService } from './identity.service';
import { BusinessContextService } from './business-context.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { UpdatePasswordDto, UpdateUserDto } from './dto/update-user.dto';
import { GenerateFieldDto } from './dto/generate-field.dto';
import { GenerateProfileDto } from './dto/generate-profile.dto';
import { BootstrapDto } from './dto/bootstrap.dto';
import { AiUsageService } from '../ai/ai-usage.service';
import { CurrentUser, AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { OptionalAuthGuard } from '../../core/auth/optional-auth.guard';
import { generateDocumentRecommendations } from './document-guidance.util';
import { PROFILE_COMPLETENESS_FIELDS, COMPLETENESS_TIERS } from './profile-completeness.constants';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { Request } from 'express';

@Controller('identity')
export class IdentityController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(BusinessContextService) private readonly bizContext: BusinessContextService,
    @Inject(SupabaseAuthService) private readonly supabaseAuth: SupabaseAuthService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    return this.identity.getUser(user.id);
  }

  @UseGuards(AuthGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateUserDto) {
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    return this.identity.updateUser(user.id, body);
  }

  @UseGuards(AuthGuard)
  @Post('me/password')
  async updatePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Body() body: UpdatePasswordDto,
  ) {
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    if (!body.newPassword || body.newPassword.trim().length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    const requestToken = ((req as Request & { authToken?: string }).authToken ?? '').trim();
    const authToken = requestToken || (body.authTokenOverride ?? '').trim() || undefined;
    if (!authToken) {
      throw new UnauthorizedException('Missing session token for password update');
    }

    await this.supabaseAuth.updatePassword(authToken, body.newPassword.trim());
    return { success: true };
  }

  @UseGuards(AuthGuard)
  @Get('businesses')
  listBusinesses(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    return this.identity.listBusinesses(user.id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId')
  getBusiness(@Param('businessId') businessId: string) {
    return this.identity.getBusiness(businessId);
  }

  /**
   * Public storefront lookup by slug.
   * Returns public-safe business fields (name, logo, contact info, social links, etc.).
   * Used when a visitor navigates to a business's public URL by its human-readable slug.
   */
  @Get('businesses/slug/:slug')
  getBusinessBySlug(@Param('slug') slug: string) {
    return this.identity.getPublicBusiness(slug);
  }

  /**
   * Slug availability check — supports optional authentication.
   * When authenticated, returns `ownedByYou: true` if the requesting user already owns the slug.
   */
  @UseGuards(OptionalAuthGuard)
  @Get('businesses/slug-check/:slug')
  async checkSlugAvailability(@Param('slug') slug: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.identity.checkSlugAvailability(slug, user?.id);
  }

  /**
   * Public business lookup by database ID.
   * Returns the same public-safe fields as the slug endpoint.
   * Used for deep-links or integrations that reference a business by its stable UUID.
   */
  @Get('businesses/public/:businessId')
  getPublicBusiness(@Param('businessId') businessId: string) {
    return this.identity.getPublicBusinessById(businessId);
  }

  @UseGuards(AuthGuard)
  @Post('businesses')
  createBusiness(@Body() body: CreateBusinessDto, @CurrentUser() user: AuthenticatedUser) {
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    return this.identity.createBusiness({
      name: body.name,
      ownerId: user.id,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId')
  updateBusiness(
    @Param('businessId') businessId: string,
    @Body() body: UpdateBusinessDto,
  ) {
    return this.identity.updateBusiness(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai-generate-field')
  async generateField(
    @Param('businessId') businessId: string,
    @Body() body: GenerateFieldDto,
  ) {
    const ctx = await this.bizContext.gatherContext(businessId);
    const contextBlock = this.bizContext.buildContextBlock(ctx, body.context);

    const fieldPrompts: Record<string, string> = {
      tagline: [
        `Using everything you know about this business, write a catchy, professional tagline (max 100 chars).`,
        `The tagline should capture the essence of what the business does and who it serves.`,
        `If the business has services/products, reference its specialty. If it has a location, consider local flavor.`,
        `Return ONLY the tagline text, no quotes or explanation.`,
      ].join(' '),
      description: [
        `Using everything you know about this business, write a compelling business description (2-3 sentences, max 400 chars).`,
        `Focus on: what the business does, who it serves, what makes it unique, and the value it delivers.`,
        `If the business has a tagline, expand on it. Incorporate details about services/products, location, and expertise naturally.`,
        `Return ONLY the description text, no quotes or explanation.`,
      ].join(' '),
      skills: [
        `Based on everything you know about this business — its industry, services, products, and stage — suggest 5-8 highly relevant professional skills.`,
        `These should be specific, actionable skills that reflect what the business actually does, not generic buzzwords.`,
        `Return ONLY a JSON array of skill strings.`,
      ].join(' '),
    };

    const prompt = fieldPrompts[body.field];
    if (!prompt) throw new BadRequestException('Invalid field: must be tagline, description, or skills');

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'profile-field-generate',
      messages: [
        {
          role: 'system',
          content: [
            'You are a professional copywriter specializing in Caribbean small businesses.',
            'You write concise, compelling, authentic copy that avoids generic marketing language.',
            'You understand the Caribbean market — Trinidad & Tobago, Jamaica, Barbados, and the wider region.',
            'Use the business context provided to create personalized, data-informed content.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `BUSINESS CONTEXT:\n${contextBlock}\n\nTASK:\n${prompt}`,
        },
      ],
      maxTokens: 300,
      temperature: 0.8,
    });

    if (body.field === 'skills') {
      try {
        const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return { skills: JSON.parse(cleaned) };
      } catch {
        return { skills: [] };
      }
    }

    return { [body.field]: result.content.replace(/^["']|["']$/g, '').trim() };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai-context')
  async getBusinessContext(@Param('businessId') businessId: string) {
    const ctx = await this.bizContext.gatherContext(businessId);
    return { context: ctx };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/generate-profile')
  async generateProfile(
    @Param('businessId') businessId: string,
    @Body() body: GenerateProfileDto,
  ) {
    const ctx = await this.bizContext.gatherContext(businessId);
    const overrides: Record<string, string> = {};
    if (body.name) overrides.name = body.name;
    if (body.industry) overrides.industry = body.industry;
    if (body.businessStage) overrides.businessStage = body.businessStage;
    if (body.description) overrides.description = body.description;
    const contextBlock = this.bizContext.buildContextBlock(ctx, overrides);

    const prompt = [
      `BUSINESS CONTEXT:\n${contextBlock}`,
      '',
      `Generate a professional profile for this business/entrepreneur.`,
      'Return a JSON object with exactly two fields:',
      '1. "headline": A concise professional headline (max 120 chars) that captures what this business/person does',
      '2. "bio": A polished professional bio (2-3 sentences, max 300 chars) that presents them compellingly to a community of entrepreneurs',
      '',
      'Use the full business context to create personalized, data-informed content. Return ONLY the JSON object, no markdown formatting.',
    ].join('\n');

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'profile-generate',
      messages: [
        {
          role: 'system',
          content: 'You are a professional copywriter specializing in Caribbean small businesses. Use the business context to create personalized content. Return only valid JSON.',
        },
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

  /**
   * Public community profile lookup by business ID.
   * Returns community/social-oriented fields: headline, bio, skills, businessStage,
   * interests, profileCompleteness, and engagement counts (posts, cohorts).
   * Distinct from the public storefront endpoint — this is for the entrepreneur community directory.
   */
  @Get('businesses/community-profile/:businessId')
  async getCommunityProfile(@Param('businessId') businessId: string) {
    return this.identity.getBusinessCommunityProfile(businessId);
  }

  @Get('profile-completeness-fields')
  getProfileCompletenessFields() {
    return { fields: PROFILE_COMPLETENESS_FIELDS };
  }

  @Get('completeness-tiers')
  getCompletenessTiers() {
    return { tiers: COMPLETENESS_TIERS };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/tiered-completeness')
  async getTieredCompleteness(@Param('businessId') businessId: string) {
    return this.identity.getTieredCompleteness(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/progressive-prompts')
  async getProgressivePrompts(@Param('businessId') businessId: string) {
    return this.identity.getProgressivePrompts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/guidance/:subProfile')
  async getGuidanceSubProfile(
    @Param('businessId') businessId: string,
    @Param('subProfile') subProfile: string,
  ) {
    const data = await this.identity.getGuidanceSubProfile(businessId, subProfile);
    return { subProfile: subProfile, data };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/guidance/:subProfile')
  async upsertGuidanceSubProfile(
    @Param('businessId') businessId: string,
    @Param('subProfile') subProfile: string,
    @Body() body: Record<string, unknown>,
  ) {
    const data = await this.identity.upsertGuidanceSubProfile(businessId, subProfile, body);
    return { subProfile: subProfile, data };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('team', 'read')
  @Get('businesses/:businessId/team')
  listTeamMembers(@Param('businessId') businessId: string) {
    return this.identity.listTeamMembers(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('team', 'write')
  @Post('businesses/:businessId/team')
  inviteTeamMember(
    @Param('businessId') businessId: string,
    @Body() body: { email: string; role: string; scopes?: Record<string, string>; maxApprovalTier?: number },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    return this.identity.inviteTeamMember(businessId, body.email, body.role, user.id, body.scopes, body.maxApprovalTier);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('team', 'write')
  @Patch('businesses/:businessId/team/:membershipId')
  updateMemberRole(
    @Param('businessId') businessId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { role: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.identity.updateMemberRole(businessId, membershipId, body.role, user?.id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('team', 'admin')
  @Patch('businesses/:businessId/team/:membershipId/permissions')
  updateMemberPermissions(
    @Param('businessId') businessId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { scopes: Record<string, string>; maxApprovalTier: number },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    return this.identity.updateMemberPermissions(businessId, membershipId, body.scopes, body.maxApprovalTier, user.id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('team', 'write')
  @Delete('businesses/:businessId/team/:membershipId')
  removeTeamMember(
    @Param('businessId') businessId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    return this.identity.removeTeamMember(businessId, membershipId, user.id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('team', 'read')
  @Get('businesses/:businessId/team/dashboard')
  getTeamDashboard(@Param('businessId') businessId: string) {
    return this.identity.getTeamDashboard(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('team', 'read')
  @Get('businesses/:businessId/team/activity')
  getTeamActivity(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('module') module?: string,
    @Query('userId') userId?: string,
  ) {
    return this.identity.getTeamActivityFeed(businessId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      module,
      userId,
    });
  }

  @UseGuards(AuthGuard)
  @Post('bootstrap')
  async bootstrap(@Body() body: BootstrapDto, @CurrentUser() user: AuthenticatedUser) {
    if (!user?.id) {
      throw new UnauthorizedException('Missing authenticated user');
    }

    const email = body.email ?? user.email;
    if (!email) {
      throw new UnauthorizedException('Missing authenticated user email');
    }

    return this.identity.bootstrapUser({
      userId: user.id,
      email,
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
