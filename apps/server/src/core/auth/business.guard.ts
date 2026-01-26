import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BusinessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest() as any;
    const user = req.user as { id?: string; role?: string } | undefined;
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    let businessId = req.params?.businessId || req.body?.businessId || req.query?.businessId;
    if (!businessId) {
      businessId = await this.resolveBusinessId(req);
    }
    if (!businessId) {
      return true;
    }

    const business = await this.prisma.client.business.findFirst({
      where: {
        id: businessId,
        OR: [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
        ],
      },
    });

    if (!business) {
      throw new ForbiddenException('No access to this business');
    }

    const membership = await this.prisma.client.membership.findFirst({
      where: { businessId, userId: user.id },
    });
    const role = membership?.role ?? (business.ownerId === user.id ? 'OWNER' : undefined);
    req.business = { id: businessId, role };

    return true;
  }

  private async resolveBusinessId(req: any): Promise<string | null> {
    const params = (req ?? {}).params ?? {};
    const body = (req ?? {}).body ?? {};
    const sources = [params, body];
    const lookups: Array<{ key: string; model: keyof PrismaService['client'] }> = [
      { key: 'invoiceId', model: 'invoice' },
      { key: 'quoteId', model: 'quote' },
      { key: 'bookingId', model: 'booking' },
      { key: 'projectId', model: 'project' },
      { key: 'taskId', model: 'projectTask' },
      { key: 'automationId', model: 'automation' },
      { key: 'postId', model: 'socialPost' },
      { key: 'connectionId', model: 'socialConnection' },
      { key: 'serviceId', model: 'service' },
      { key: 'staffId', model: 'staffMember' },
      { key: 'membershipId', model: 'membership' },
      { key: 'contactId', model: 'contact' },
      { key: 'siteId', model: 'site' },
    ];

    for (const source of sources) {
      for (const lookup of lookups) {
        const id = source?.[lookup.key];
        if (!id) continue;
        const record: any = await (this.prisma.client as any)[lookup.model].findUnique({
          where: { id },
          select: { businessId: true },
        });
        if (record?.businessId) return record.businessId;
      }

      if (source?.availabilityId) {
        const availability = await this.prisma.client.availability.findUnique({
          where: { id: source.availabilityId },
          select: { staff: { select: { businessId: true } } },
        });
        if (availability?.staff?.businessId) return availability.staff.businessId;
      }
    }

    return null;
  }
}
