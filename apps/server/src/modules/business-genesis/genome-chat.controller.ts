import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { GenomeChatService } from './genome-chat.service';
import { SendMessageDto, ApplyUpdatesDto } from './dto';

@Controller('genome-chat/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class GenomeChatController {
  constructor(@Inject(GenomeChatService) private readonly chat: GenomeChatService) {}

  @Get('messages')
  async getMessages(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.chat.getMessages(businessId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Post('messages')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 60_000)
  async sendMessage(
    @Param('businessId') businessId: string,
    @Body() body: SendMessageDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const userId = req.user?.id ?? 'unknown';
    return this.chat.sendMessage(businessId, userId, body.message);
  }

  @Post('apply-updates')
  @UseGuards(GenomeGateGuard)
  async applyUpdates(
    @Param('businessId') businessId: string,
    @Body() body: ApplyUpdatesDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const userId = req.user?.id ?? 'unknown';
    return this.chat.applyUpdates(businessId, userId, body.section, body.data, {
      messageId: body.messageId,
      confidence: body.confidence,
      source: body.source,
    });
  }
}
