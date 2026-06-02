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

@Controller('api/admin/users')
@UseGuards(AuthGuard, AdminGuard)
export class AdminUserController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  async listUsers(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('search') search?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          firstName: true,
          lastName: true,
          role: true,
          avatarUrl: true,
          _count: { select: { businesses: true } },
        },
        orderBy: { email: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.client.user.count({ where }),
    ]);

    return {
      items: items.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
        role: u.role,
        avatarUrl: u.avatarUrl,
        businessCount: u._count.businesses,
      })),
      total,
    };
  }
}
