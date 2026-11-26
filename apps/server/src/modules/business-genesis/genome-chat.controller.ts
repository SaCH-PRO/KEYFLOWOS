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
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  genomeIntegrityForReader,
  readsRevenueFor,
} from '../business-genome/key-genome/genome-composites-for-reader';
import { GenomeChatService } from './genome-chat.service';
import { SendMessageDto, ApplyUpdatesDto } from './dto';

type ChatRequest = { user?: { id?: string; role?: string } };

@Controller('genome-chat/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class GenomeChatController {
  constructor(
    @Inject(GenomeChatService) private readonly chat: GenomeChatService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  private readsRevenue(businessId: string, req?: ChatRequest): Promise<boolean> {
    return readsRevenueFor(this.prisma, businessId, req?.user?.id ? { id: req.user.id, role: req.user.role } : null);
  }

  @Get('messages')
  async getMessages(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Req() req?: ChatRequest,
  ) {
    const readsRevenue = await this.readsRevenue(businessId, req);
    return this.chat.getMessages(businessId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
      readsRevenue,
    });
  }

  @RequireModuleScope('settings', 'write')
  @Post('messages')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 60_000)
  async sendMessage(
    @Param('businessId') businessId: string,
    @Body() body: SendMessageDto,
    @Req() req: ChatRequest,
  ) {
    const userId = req.user?.id ?? 'unknown';
    const readsRevenue = await this.readsRevenue(businessId, req);
    return this.chat.sendMessage(businessId, userId, body.message, { readsRevenue });
  }

  @RequireModuleScope('settings', 'write')
  @Post('apply-updates')
  @UseGuards(GenomeGateGuard)
  async applyUpdates(
    @Param('businessId') businessId: string,
    @Body() body: ApplyUpdatesDto,
    @Req() req: ChatRequest,
  ) {
    const userId = req.user?.id ?? 'unknown';
    const [genome, readsRevenue] = await Promise.all([
      this.chat.applyUpdates(businessId, userId, body.section, body.data, {
        messageId: body.messageId,
        confidence: body.confidence,
        source: body.source,
      }),
      this.readsRevenue(businessId, req),
    ]);
    return genomeIntegrityForReader(genome, readsRevenue);
  }
}
