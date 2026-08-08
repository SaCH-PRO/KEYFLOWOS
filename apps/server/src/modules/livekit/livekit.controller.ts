import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { LivekitService } from './livekit.service';

@Controller('livekit')
export class LivekitController {
  constructor(private readonly livekit: LivekitService) {}

  /** Create a KEY voice room + agent dispatch + user join token. */
  @Post('businesses/:businessId/voice-session')
  @UseGuards(AuthGuard, BusinessGuard)
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
