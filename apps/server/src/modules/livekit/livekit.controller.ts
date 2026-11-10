import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { LivekitService } from './livekit.service';

/**
 * W9-LIVEKIT-VOICE review repair (SEC-W9LK-1, on SEC-PR196V-1): the per-member
 * bound on KEY voice-session creation.
 *
 * CrmRateLimitGuard keys its window on client address, business and handler,
 * with no member in it. One member who sends each request from a fresh address
 * (several IPv6 addresses in their /64, several networks) or through several
 * businesses got a fresh window every time, so the voice-session bound did not
 * bound the member. This window is keyed on the authenticated member alone
 * (AuthGuard has set req.user before it runs), across addresses and
 * businesses: at most 10 sessions a minute per member, the same 10 a minute
 * as the address window, each session being a LiveKit room plus a KEY voice
 * agent dispatch (an OpenAI Realtime session). Like CrmRateLimitGuard it is
 * held in process and counts only admitted requests; a refused request answers
 * 429 before any room or dispatch.
 */
export const VOICE_SESSIONS_PER_MEMBER = 10;
export const VOICE_SESSION_MEMBER_WINDOW_MS = 60_000;
const voiceSessionsByMember = new Map<string, number[]>();
const MEMBER_WINDOW_SWEEP_MS = 5 * 60_000;
let lastMemberWindowSweep = Date.now();

function sweepMemberWindows(now: number) {
  if (now - lastMemberWindowSweep < MEMBER_WINDOW_SWEEP_MS) return;
  lastMemberWindowSweep = now;
  for (const [member, times] of voiceSessionsByMember) {
    const recent = times.filter((t) => now - t < VOICE_SESSION_MEMBER_WINDOW_MS);
    if (recent.length === 0) voiceSessionsByMember.delete(member);
    else voiceSessionsByMember.set(member, recent);
  }
}

@Injectable()
export class VoiceSessionMemberRateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const memberId = context.switchToHttp().getRequest<{ user?: { id?: string } }>().user?.id;
    // AuthGuard runs first, and the service refuses a session without a member:
    // refuse here too rather than put every such request in one shared window.
    if (!memberId) throw new UnauthorizedException('A signed-in member is required to start a voice session');

    const now = Date.now();
    sweepMemberWindows(now);
    const recent = (voiceSessionsByMember.get(memberId) ?? []).filter((t) => now - t < VOICE_SESSION_MEMBER_WINDOW_MS);
    if (recent.length >= VOICE_SESSIONS_PER_MEMBER) {
      voiceSessionsByMember.set(memberId, recent);
      throw new HttpException('Rate limit exceeded. Please slow down and try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    voiceSessionsByMember.set(memberId, recent);
    return true;
  }
}

@Controller('livekit')
export class LivekitController {
  constructor(@Inject(LivekitService) private readonly livekit: LivekitService) {}

  /**
   * Create a KEY voice room + agent dispatch + user join token.
   *
   * W9-LIVEKIT-VOICE (SEC-PR196V-1): bounded with the existing CrmRateLimitGuard
   * (per client address, business and handler), checked after the member and
   * the business are verified: each call creates a LiveKit room and dispatches
   * the KEY voice agent (an OpenAI Realtime session), so it carries the bound
   * of the other provider-cost KEY routes (ai/plan, ai/simulate, ai/briefing:
   * 10 a minute). Past it the POST answers 429 before any room or dispatch.
   * The review repair (SEC-W9LK-1) adds the per-member window after it, so a
   * member changing address or business does not get a fresh bound.
   */
  @Post('businesses/:businessId/voice-session')
  @UseGuards(AuthGuard, BusinessGuard, CrmRateLimitGuard, VoiceSessionMemberRateLimitGuard)
  @CrmRateLimit(10, 60_000)
  createVoiceSession(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id?: string } },
    @Body() body: { identity?: string; roomName?: string },
  ) {
    return this.livekit.createVoiceSession(businessId, req.user?.id, body ?? {});
  }

  /** Active voice rooms for this business. */
  @Get('businesses/:businessId/rooms')
  @UseGuards(AuthGuard, BusinessGuard)
  listRooms(@Param('businessId') businessId: string) {
    return this.livekit.listRooms(businessId);
  }

  /** Participants in one of the business's rooms. */
  @Get('businesses/:businessId/rooms/:roomName/participants')
  @UseGuards(AuthGuard, BusinessGuard)
  listParticipants(@Param('businessId') businessId: string, @Param('roomName') roomName: string) {
    return this.livekit.listParticipants(businessId, roomName);
  }

  /** Client hangup — marks the VoiceSession ended (webhook also covers this). */
  @Post('businesses/:businessId/voice-session/:sessionId/end')
  @UseGuards(AuthGuard, BusinessGuard)
  endVoiceSession(@Param('businessId') businessId: string, @Param('sessionId') sessionId: string) {
    return this.livekit.endVoiceSession(businessId, sessionId);
  }

  /** LiveKit server webhooks — public, but every call is signature-verified. */
  @Post('webhook')
  async webhook(
    @Req() req: { rawBody?: Buffer | string; body?: unknown },
    @Headers('authorization') authHeader?: string,
  ) {
    const raw = req.rawBody
      ? (typeof req.rawBody === 'string' ? req.rawBody : req.rawBody.toString('utf8'))
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});
    if (!authHeader) throw new UnauthorizedException('Missing webhook authorization header');
    const event = await this.livekit.handleWebhook(raw, authHeader);
    return { received: true, event };
  }
}
