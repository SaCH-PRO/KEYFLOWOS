import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  UseGuards,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { MessageIntakeOrchestrator } from './message-intake-orchestrator.service';
import { PrismaService } from '../../core/prisma/prisma.service';

interface AuthenticatedRequest {
  user?: { id: string };
}

@Controller('communications/businesses/:businessId/message-intake')
@UseGuards(AuthGuard, BusinessGuard)
export class MessageIntakeController {
  constructor(
    private readonly orchestrator: MessageIntakeOrchestrator,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('sourceChannel') sourceChannel?: string,
    @Query('limit') limit?: string,
  ) {
    const where: Record<string, unknown> = { businessId };
    if (status) where.status = status;
    if (sourceChannel) where.sourceChannel = sourceChannel;
    const take = limit ? parseInt(limit, 10) : 50;
    const items = await this.prisma.client.messageIntake.findMany({
      where,
      orderBy: { detectedAt: 'desc' },
      take,
      include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } },
    });
    return { items };
  }

  @Post(':intakeId/approve')
  async approve(
    @Param('businessId') businessId: string,
    @Param('intakeId') intakeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    return this.orchestrator.executePlan(businessId, intakeId, userId);
  }

  @Post(':intakeId/reject')
  async reject(
    @Param('businessId') businessId: string,
    @Param('intakeId') intakeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    await this.orchestrator.rejectIntake(businessId, intakeId, userId);
    return { success: true };
  }
}
