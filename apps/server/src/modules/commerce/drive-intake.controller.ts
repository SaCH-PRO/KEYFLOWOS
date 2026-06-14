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
import { ConnectorIntelligenceService } from '../ai/connector-intelligence.service';
import { DriveIntakeOrchestrator } from './drive-intake-orchestrator.service';
import { PrismaService } from '../../core/prisma/prisma.service';

interface AuthenticatedRequest {
  user?: { id: string };
}

@Controller('drive/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class DriveIntakeController {
  constructor(
    private readonly connectorIntelligence: ConnectorIntelligenceService,
    private readonly orchestrator: DriveIntakeOrchestrator,
    private readonly prisma: PrismaService,
  ) {}

  @Post('sync')
  async sync(@Param('businessId') businessId: string) {
    const result = await this.connectorIntelligence.syncGoogleDrive(businessId);
    return { success: true, ...result };
  }

  @Get('intake')
  async listIntake(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const where: Record<string, unknown> = { businessId };
    if (status) where.status = status;
    const take = limit ? parseInt(limit, 10) : 50;
    const items = await this.prisma.client.driveIntakeFile.findMany({
      where,
      orderBy: { modifiedTime: 'desc' },
      take,
    });
    return { items };
  }

  @Post('intake/:intakeFileId/approve')
  async approve(
    @Param('businessId') businessId: string,
    @Param('intakeFileId') intakeFileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    return this.orchestrator.executePlan(businessId, intakeFileId, userId);
  }

  @Post('intake/:intakeFileId/reject')
  async reject(
    @Param('businessId') businessId: string,
    @Param('intakeFileId') intakeFileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    await this.orchestrator.rejectIntakeFile(businessId, intakeFileId, userId);
    return { success: true };
  }
}
