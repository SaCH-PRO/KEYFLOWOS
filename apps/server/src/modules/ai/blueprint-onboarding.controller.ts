import { Body, Controller, Get, Inject, Param, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CurrentUser, type AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { BlueprintOnboardingService } from './blueprint-onboarding.service';

/**
 * The body of POST onboarding-chat, as a class so the global ValidationPipe
 * (whitelist: true) checks it (PR196-GENOME review SEC-GEN-1, CR-1). It used
 * to be an inline-typed body, which the pipe skips, so `message` could be any
 * JSON value and `history` was copied into the transcript unchecked.
 *
 * Deliberately NOT here: `history`. The transcript is the server's own
 * (BlueprintOnboardingService.getState); a `history` an older client still
 * sends is stripped by the pipe and never read.
 */
export class BlueprintOnboardingChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}

@Controller('blueprint/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class BlueprintOnboardingController {
  constructor(
    @Inject(BlueprintOnboardingService) private readonly onboarding: BlueprintOnboardingService,
  ) {}

  /**
   * PR196-GENOME: the CALLER's own Business Genome interview transcript in THIS
   * business (the tenant BusinessGuard verified), as the server cache holds
   * it, with progress derived from the saved blueprint. Any member may call it
   * and gets their own conversation: the blueprint the interview fills is
   * business_blueprints data, any-member like every blueprint route, but the
   * raw text a member typed is theirs, so another member's words are never
   * returned (review SEC-GEN-3). A non-member gets BusinessGuard's 403.
   */
  @Get('onboarding-history')
  async onboardingHistory(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.onboarding.getHistory(businessId, actorId(user));
  }

  @Post('onboarding-chat')
  async onboardingChat(
    @Param('businessId') businessId: string,
    @Body() body: BlueprintOnboardingChatDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.onboarding.chat(businessId, actorId(user), body.message);
  }

  /** Starts the caller's own conversation over; other members' are untouched. */
  @Post('onboarding-reset')
  async onboardingReset(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    this.onboarding.reset(businessId, actorId(user));
    return { ok: true };
  }
}

/** AuthGuard admits only a request with a user; a transcript is never keyed by nobody. */
function actorId(user: AuthenticatedUser | undefined): string {
  if (!user?.id) throw new UnauthorizedException('Authentication required');
  return user.id;
}
