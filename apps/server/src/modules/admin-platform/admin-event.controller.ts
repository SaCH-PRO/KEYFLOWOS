import {
  Controller,
  Get,
  Query,
  UseGuards,
  Inject,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AdminGuard } from '../../core/auth/admin.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('api/admin/events')
@UseGuards(AuthGuard, AdminGuard)
export class AdminEventController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  async listEvents(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('eventType') eventType?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (eventType) where.eventType = eventType;

    const [items, total] = await Promise.all([
      this.prisma.client.businessEvent.findMany({
        where,
        select: {
          id: true,
          eventType: true,
          action: true,
          actorType: true,
          actorId: true,
          subjectType: true,
          subjectId: true,
          source: true,
          riskScore: true,
          createdAt: true,
          business: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.client.businessEvent.count({ where }),
    ]);

    return {
      items: items.map((e) => ({
        id: e.id,
        type: e.eventType,
        action: e.action,
        actorType: e.actorType,
        actorId: e.actorId,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        source: e.source,
        riskScore: e.riskScore,
        businessName: e.business?.name,
        createdAt: e.createdAt.toISOString(),
      })),
      total,
    };
  }
}
