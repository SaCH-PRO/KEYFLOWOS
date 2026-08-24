import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { IdentityService } from './identity.service';
import { IdentitySignupService, isEmailVerificationRequired } from './identity-signup.service';
import { AuthSecurityService } from './auth-security.service';
import { IdentityPasswordService } from './identity-password.service';
import { allowedCorsOrigins } from '../../core/config/runtime-urls';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SignupDto, ResendVerificationDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { BusinessContextService } from './business-context.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { GenerateFieldDto } from './dto/generate-field.dto';
import { GenerateProfileDto } from './dto/generate-profile.dto';
import { BootstrapDto } from './dto/bootstrap.dto';
import { AiUsageService } from '../ai/ai-usage.service';
import { CurrentUser, AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { OptionalAuthGuard } from '../../core/auth/optional-auth.guard';
import { generateDocumentRecommendations } from './document-guidance.util';
import { PROFILE_COMPLETENESS_FIELDS, COMPLETENESS_TIERS } from './profile-completeness.constants';

@Controller('identity')
export class IdentityController {
  private readonly logger = new Logger(IdentityController.name);

  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(BusinessContextService) private readonly bizContext: BusinessContextService,
    @Inject(IdentitySignupService) private readonly signupSvc: IdentitySignupService,
    @Inject(AuthSecurityService) private readonly authSec: AuthSecurityService,
    @Inject(IdentityPasswordService) private readonly passwordSvc: IdentityPasswordService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupabaseAdminService) private readonly supabaseAdmin: SupabaseAdminService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Admin-only paginated read of the auth audit log. Surfaces the
   * stream of signup / login / rate-limit events captured by
   * {@link AuthSecurityService.audit}. Used by the admin Security
   * Settings page to investigate suspicious activity.
   *
   * Filters: `event` (one of: signup, login_success, login_failure,
   * resend_verification, rate_limited), `email`, `ip`, optional
   * `since` ISO timestamp. Returns most recent first, capped at 200.
   */
  @UseGuards(AuthGuard)
  @Get('admin/auth-audit')
  async getAuthAudit(
    @CurrentUser() user: AuthenticatedUser,
    @Query('event') event?: string,
    @Query('email') email?: string,
    @Query('ip') ip?: string,
    @Query('since') since?: string,
    @Query('limit') limitStr?: string,
  ) {
    if (user?.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('Admin access required');
    }
    const limit = Math.min(200, Math.max(1, Number.parseInt(limitStr ?? '50', 10) || 50));
    const where: Record<string, unknown> = {};
    if (event) where.event = event;
    if (email) where.email = email.trim().toLowerCase();
    if (ip) where.ip = ip.trim();
    if (since) {
      const dt = new Date(since);
      if (!Number.isNaN(dt.getTime())) where.createdAt = { gte: dt };
    }
    const rows = await this.prisma.client.authAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { entries: rows, count: rows.length };
  }

  /**
   * Pull the client IP for rate-limiting + audit. We rely **exclusively**
   * on `req.ip` so the trust-proxy setting (configured once in
   * `app-bootstrap.ts` from the `TRUST_PROXY` env var) is the only
   * place that decides how many `x-forwarded-for` hops are honoured.
   * Manually parsing XFF here would let attackers spoof IPs to bypass
   * the per-IP rate limiter — see the architect review for context.
   */
  private clientIp(req: Request): string {
    return req.ip || (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress || 'unknown';
  }

  private clientUa(req: Request): string {
    return ((req.headers['user-agent'] as string | undefined) ?? '').slice(0, 512);
  }

  /**
   * Server-driven signup. Creates the user via Supabase Admin API and either
   * auto-confirms (dev / verification disabled) returning a session, or sends
   * the confirmation email through Resend and tells the client to show the
   * "check your email" screen.
   */
  @Post('signup')
  async signup(
    @Body() body: SignupDto,
    @Req() req: Request,
    @Headers('origin') originHeader?: string,
  ) {
    const ip = this.clientIp(req);
    const ua = this.clientUa(req);
    const email = body.email.trim().toLowerCase();
    try {
      await this.authSec.enforce(AuthSecurityService.RULES.SIGNUP_IP, ip);
      await this.authSec.enforce(AuthSecurityService.RULES.SIGNUP_EMAIL, email);
    } catch (rateErr) {
      await this.authSec.audit({ event: 'rate_limited', outcome: 'rate_limited', email, ip, userAgent: ua, reason: 'signup' });
      throw rateErr;
    }
    const origin = originHeader || this.deriveOriginFromRequest(req);
    try {
      const outcome = await this.signupSvc.signup({
        email,
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        username: body.username,
        company: body.company,
        phone: body.phone,
        requestOrigin: origin,
        referralCode: body.referralCode,
      });
      await this.authSec.audit({
        event: 'signup',
        outcome: 'success',
        email,
        userId: outcome.userId,
        ip,
        userAgent: ua,
        reason: outcome.mode,
      });
      if (outcome.mode === 'session') {
        return {
          status: 'authenticated',
          userId: outcome.userId,
          email: outcome.email,
          accessToken: outcome.accessToken,
          refreshToken: outcome.refreshToken,
          verificationRequired: false,
        };
      }
      return {
        status: 'verification_sent',
        userId: outcome.userId,
        email: outcome.email,
        verificationRequired: true,
      };
    } catch (err: any) {
      const reason = err instanceof BadRequestException
        ? (((err.getResponse() as { code?: string })?.code) ?? err.message)
        : err instanceof Error ? err.message : 'unknown';
      await this.authSec.audit({ event: 'signup', outcome: 'failure', email, ip, userAgent: ua, reason });
      throw err;
    }
  }

  /**
   * Server-driven login. Proxies email/password through the backend so
   * we can rate-limit (per IP and per email), audit every attempt, and
   * keep the Supabase project URL/key off the client. Frontend used to
   * call Supabase directly — that flow has been retired in favour of
   * this endpoint as part of Tier 2 auth hardening.
   */
  @Post('login')
  async login(@Body() body: LoginDto, @Req() req: Request) {
    const ip = this.clientIp(req);
    const ua = this.clientUa(req);
    const email = body.email.trim().toLowerCase();
    try {
      await this.authSec.enforce(AuthSecurityService.RULES.LOGIN_IP, ip);
      await this.authSec.enforce(AuthSecurityService.RULES.LOGIN_EMAIL, email);
    } catch (rateErr) {
      await this.authSec.audit({ event: 'rate_limited', outcome: 'rate_limited', email, ip, userAgent: ua, reason: 'login' });
      throw rateErr;
    }
    try {
      const session = await this.signupSvc.signInWithPassword(email, body.password);
      // A deliberate re-login supersedes a prior logout's revocation marker.
      // Without this, logging out sets auth:revoked:user:<id> for 24h and the
      // middleware rejects EVERY request — including ones bearing this fresh
      // token — so a logged-out user is locked out for a full day. Supabase
      // signOut('global') at logout already invalidated the old sessions, so
      // clearing the marker on a proven re-auth is safe.
      if (session.userId) {
        try {
          await this.redis.del(`auth:revoked:user:${session.userId}`);
        } catch (err: any) {
          this.logger.warn(`Redis revocation clear failed for ${session.userId}: ${err instanceof Error ? err.message : err}`);
        }
      }
      await this.authSec.audit({ event: 'login_success', outcome: 'success', email, ip, userAgent: ua });
      return {
        status: 'authenticated',
        email,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      };
    } catch (err: any) {
      const reason = err instanceof BadRequestException
        ? (((err.getResponse() as { code?: string })?.code) ?? err.message)
        : err instanceof Error ? err.message : 'unknown';
      await this.authSec.audit({ event: 'login_failure', outcome: 'failure', email, ip, userAgent: ua, reason });
      throw err;
    }
  }

  /**
   * Re-send the verification email for an unconfirmed account. Always
   * returns success (regardless of whether the email exists / is already
   * confirmed) to avoid leaking account existence; throttled per-email.
   */
  @Post('resend-verification')
  async resendVerification(
    @Body() body: ResendVerificationDto,
    @Req() req: Request,
    @Headers('origin') originHeader?: string,
  ) {
    const ip = this.clientIp(req);
    const ua = this.clientUa(req);
    const email = body.email.trim().toLowerCase();
    try {
      await this.authSec.enforce(AuthSecurityService.RULES.RESEND_IP, ip);
      await this.authSec.enforce(AuthSecurityService.RULES.RESEND_EMAIL, email);
    } catch (rateErr) {
      await this.authSec.audit({ event: 'rate_limited', outcome: 'rate_limited', email, ip, userAgent: ua, reason: 'resend' });
      throw rateErr;
    }
    const origin = originHeader || this.deriveOriginFromRequest(req);
    const result = await this.signupSvc.resendVerification({
      email,
      requestOrigin: origin,
    });
    await this.authSec.audit({ event: 'resend_verification', outcome: 'success', email, ip, userAgent: ua });
    return {
      status: 'ok',
      verificationRequired: isEmailVerificationRequired(),
      cooldownRemainingMs: result.cooldownRemainingMs,
    };
  }

  /**
   * Change the password of a signed-in user.
   *
   * AuthGuard establishes WHO. The current password in the body establishes
   * that the caller is not merely holding a token that leaked — see
   * IdentityPasswordService.changePassword for why that distinction is the
   * whole point of this endpoint.
   *
   * Rate limited per USER rather than per IP: the identity is already known
   * here, and an IP key would both punish a shared office and let an attacker
   * grind the current-password check from rotating addresses.
   */
  @UseGuards(AuthGuard)
  @Post('change-password')
  async changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    if (!user?.id || !user?.email) throw new UnauthorizedException('Missing authenticated user');
    const ip = this.clientIp(req);
    const ua = this.clientUa(req);

    try {
      await this.authSec.enforce(AuthSecurityService.RULES.CHANGE_PASSWORD_USER, user.id);
    } catch (rateErr) {
      await this.authSec.audit({
        event: 'rate_limited', outcome: 'rate_limited', email: user.email, userId: user.id,
        ip, userAgent: ua, reason: 'change_password',
      });
      throw rateErr;
    }

    try {
      await this.passwordSvc.changePassword({
        userId: user.id,
        email: user.email,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        // The signup service owns credential exchange; passing the function in
        // keeps the password service free of a dependency on it.
        verifyCurrent: (email, password) => this.signupSvc.signInWithPassword(email, password),
      });
      await this.authSec.audit({
        event: 'password_changed', outcome: 'success', email: user.email, userId: user.id, ip, userAgent: ua,
      });
      return { status: 'ok', message: 'Password updated. Other sessions have been signed out.' };
    } catch (err) {
      // Failures matter here: repeated ones mean something is guessing the
      // current password while holding a valid session token.
      await this.authSec.audit({
        event: 'password_changed', outcome: 'failure', email: user.email, userId: user.id,
        ip, userAgent: ua, reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
      throw err;
    }
  }

  /**
   * Exchange a refresh token for a new session.
   *
   * This was the last flow still going browser-to-Supabase directly. Moving it
   * here is worth less than moving recovery was — refresh trades a token rather
   * than changing a credential — but it buys two things: a failed refresh now
   * appears in the audit ledger, and the Supabase URL and anon key stop being
   * required on this path.
   *
   * NO AuthGuard, necessarily: the caller's access token is expired, which is
   * the entire reason they are here. The refresh token IS the credential.
   *
   * Only failures are audited. A success happens once an hour per session and
   * would drown the ledger; a failure is an expired, spent, or revoked token
   * being presented, which is what a replayed one looks like.
   */
  @Post('refresh')
  async refresh(@Body() body: RefreshTokenDto, @Req() req: Request) {
    const ip = this.clientIp(req);
    const ua = this.clientUa(req);

    try {
      await this.authSec.enforce(AuthSecurityService.RULES.REFRESH_IP, ip);
    } catch (rateErr) {
      await this.authSec.audit({
        event: 'rate_limited', outcome: 'rate_limited', ip, userAgent: ua, reason: 'refresh',
      });
      throw rateErr;
    }

    try {
      const session = await this.signupSvc.refreshSession(body.refreshToken);
      return {
        status: 'ok',
        accessToken: session.accessToken,
        // Supabase rotates on use. The client MUST store this one — keeping the
        // old value leaves it holding a token that has already been spent.
        refreshToken: session.refreshToken,
      };
    } catch (err) {
      await this.authSec.audit({
        event: 'token_refresh_failed',
        outcome: 'failure',
        ip,
        userAgent: ua,
        reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
      throw err;
    }
  }

  /**
   * Request a password-recovery email.
   *
   * ALWAYS returns the same body. Whether the address has an account, whether
   * Supabase accepted the send, whether the mail bounced — the response is
   * identical, because any difference turns this into a free membership oracle.
   * The audit row records what really happened; the caller learns nothing.
   *
   * Rate limited per IP and per email, which recovery previously was not: the
   * browser called Supabase directly, so this was the one unmetered door on an
   * otherwise metered surface.
   */
  @Post('forgot-password')
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
    @Req() req: Request,
    @Headers('origin') originHeader?: string,
  ) {
    const ip = this.clientIp(req);
    const ua = this.clientUa(req);
    const email = body.email.trim().toLowerCase();

    try {
      await this.authSec.enforce(AuthSecurityService.RULES.FORGOT_IP, ip);
      await this.authSec.enforce(AuthSecurityService.RULES.FORGOT_EMAIL, email);
    } catch (rateErr) {
      await this.authSec.audit({
        event: 'rate_limited', outcome: 'rate_limited', email, ip, userAgent: ua, reason: 'forgot_password',
      });
      throw rateErr;
    }

    const allowed = allowedCorsOrigins();
    if (allowed.length === 0) {
      throw new BadRequestException(
        'No allowed origin is configured; set APP_URL or NEXT_PUBLIC_SITE_URL before using password recovery',
      );
    }
    // The DEFAULT is built from configured origin, never from the request.
    // Deriving it from the Origin header or the Host looked convenient and was
    // wrong: both are supplied by the caller, and this URL decorates a link
    // that carries a recovery session in its fragment. Trusting the request to
    // name its own redirect is the open-redirect bug, just spelled politely.
    const requested = body.redirectTo ?? `${allowed[0].replace(/\/$/, '')}/auth/reset-password`;
    // Checked even when we built it, because the client may supply one.
    this.passwordSvc.assertSafeRedirect(requested, allowed);

    await this.passwordSvc.requestReset(email, requested);
    await this.authSec.audit({
      event: 'password_reset_requested', outcome: 'success', email, ip, userAgent: ua,
    });

    return {
      status: 'sent',
      message: 'If that email has an account, a reset link is on its way.',
    };
  }

  /**
   * Complete a password reset.
   *
   * The recovery token is the only credential, so no guard applies — but the
   * token is verified inside the service before anything else happens, and the
   * new password goes through the SAME PasswordPolicyService that signup uses.
   * That parity is the point of this endpoint existing: the browser path it
   * replaces enforced a length check and nothing else, so a password rejected
   * at signup as breached could be adopted by resetting to it.
   */
  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto, @Req() req: Request) {
    const ip = this.clientIp(req);
    const ua = this.clientUa(req);

    try {
      await this.authSec.enforce(AuthSecurityService.RULES.RESET_IP, ip);
    } catch (rateErr) {
      await this.authSec.audit({
        event: 'rate_limited', outcome: 'rate_limited', ip, userAgent: ua, reason: 'reset_password',
      });
      throw rateErr;
    }

    try {
      const { userId, email } = await this.passwordSvc.completeReset(body.accessToken, body.password);
      await this.authSec.audit({
        event: 'password_reset_completed', outcome: 'success', email, userId, ip, userAgent: ua,
      });
      return { status: 'ok', message: 'Password updated. Please sign in.' };
    } catch (err) {
      await this.authSec.audit({
        event: 'password_reset_completed',
        outcome: 'failure',
        ip,
        userAgent: ua,
        reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
      throw err;
    }
  }

  private deriveOriginFromRequest(req: Request): string | null {
    try {
      const proto = (req.headers['x-forwarded-proto'] as string) || (req.protocol ?? 'https');
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
      if (!host) return null;
      return `${proto}://${host}`;
    } catch {
      return null;
    }
  }

  /**
   * Server-driven logout. Revokes all Supabase sessions for the user and
   * sets a short-lived Redis revocation marker so that any in-flight access
   * tokens are rejected by AuthMiddleware until they naturally expire.
   * Audits the event and swallows external failures so the client can always
   * clear its own storage.
   */
  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const userId = user?.id;
    if (!userId) throw new UnauthorizedException('Missing authenticated user');

    try {
      await this.supabaseAdmin.signOut(userId, 'global');
    } catch (err: any) {
      this.logger.warn(`Supabase signOut failed for ${userId}: ${err instanceof Error ? err.message : err}`);
    }

    // Revoke in-flight tokens for up to 24 hours. Access tokens are typically
    // 1-hour JWTs; this window covers the maximum plausible clock skew plus
    // any long-lived cached token.
    try {
      await this.redis.setex(`auth:revoked:user:${userId}`, 86400, '1');
    } catch (err: any) {
      this.logger.warn(`Redis revocation set failed for ${userId}: ${err instanceof Error ? err.message : err}`);
    }

    const ip = this.clientIp(req);
    const ua = this.clientUa(req);
    await this.authSec.audit({ event: 'logout', outcome: 'success', email: user.email ?? '', userId, ip, userAgent: ua });

    return { status: 'logged_out' };
  }

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
   * Username availability check — public, no auth required.
   * Checks whether the given username is already taken in the local User table.
   */
  @Get('check-username')
  async checkUsernameAvailability(@Query('username') username?: string) {
    if (!username || username.trim().length === 0) {
      return { available: false, reason: 'Username is required' };
    }
    const trimmed = username.trim();
    if (trimmed.length < 2) {
      return { available: false, reason: 'Username must be at least 2 characters' };
    }
    const existing = await this.prisma.client.user.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      return { available: false, reason: 'Username is already taken' };
    }
    return { available: true };
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
    if (!user?.id || !user?.email) {
      throw new UnauthorizedException('Missing authenticated user');
    }

    return this.identity.bootstrapUser({
      userId: user.id,
      email: body.email ?? user.email,
      username: body.username,
      name: body.name,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      avatarUrl: body.avatarUrl,
      company: body.company,
      referralCode: body.referralCode,
    });
  }

  @UseGuards(AuthGuard)
  @Get('referral')
  async getReferral(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.id) throw new UnauthorizedException('Missing authenticated user');
    const me = await this.prisma.client.user.findUnique({
      where: { id: user.id },
      select: { referralCode: true, referredByUserId: true },
    });
    if (!me) throw new UnauthorizedException('User not found');
    const count = await this.prisma.client.user.count({ where: { referredByUserId: user.id } });
    return {
      code: me.referralCode,
      link: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://keyflowos.com'}/auth/signup?ref=${me.referralCode ?? ''}`,
      referrals: count,
      referredBy: me.referredByUserId,
    };
  }
}
