import {
  Body,
  Controller,
  Get,
  Inject,
  Optional,
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
import { PrismaService } from '../../core/prisma/prisma.service';
import { genomeIntegrityForReader, readsRevenueFor } from '../business-genome/key-genome/genome-composites-for-reader';
import { SendMessageDto, ApplyUpdatesDto } from './dto';

@Controller('genome-chat/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class GenomeChatController {
  constructor(
    @Inject(GenomeChatService) private readonly chat: GenomeChatService,
    // FU-GENOME-SURFACES-REVENUE round 2 (D-233): reads the member's revenue level; without it, fail closed.
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

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
    @Req() req: Request & { user?: { id?: string; role?: string } },
  ) {
    const userId = req.user?.id ?? 'unknown';
    const genome = await this.chat.applyUpdates(businessId, userId, body.section, body.data, {
      messageId: body.messageId,
      confidence: body.confidence,
      source: body.source,
    });
    // FU-GENOME-SURFACES-REVENUE round 2 (D-233): answered as GET blueprint/.../genome serves it to the member.
    const reader = req.user?.id ? { id: req.user.id, role: req.user.role } : null;
    return genomeIntegrityForReader(genome, await readsRevenueFor(this.prisma, businessId, reader));
  }
}
