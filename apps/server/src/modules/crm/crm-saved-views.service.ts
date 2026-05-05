import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const MAX_NAME_LENGTH = 80;
const MAX_VIEWS_PER_USER_PER_BUSINESS = 50;

export type SavedViewInput = {
  name: string;
  filterState: Record<string, unknown>;
  sort?: { sortBy?: string; sortOrder?: 'asc' | 'desc' } | null;
  visibleColumns?: string[];
};

@Injectable()
export class CrmSavedViewsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private normalizeName(name: string) {
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException('View name is required');
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new BadRequestException(`View name must be ${MAX_NAME_LENGTH} characters or fewer`);
    }
    return trimmed;
  }

  private normalizeFilterState(filterState: unknown) {
    if (!filterState || typeof filterState !== 'object' || Array.isArray(filterState)) {
      throw new BadRequestException('filterState must be an object');
    }
    return filterState as Record<string, unknown>;
  }

  async list(businessId: string, userId: string) {
    return this.prisma.client.contactSavedView.findMany({
      where: { businessId, userId },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });
  }

  async get(businessId: string, userId: string, viewId: string) {
    const view = await this.prisma.client.contactSavedView.findFirst({
      where: { id: viewId, businessId, userId },
    });
    if (!view) throw new NotFoundException('Saved view not found');
    return view;
  }

  async create(businessId: string, userId: string, input: SavedViewInput) {
    const name = this.normalizeName(input.name);
    const filterState = this.normalizeFilterState(input.filterState);

    const existingCount = await this.prisma.client.contactSavedView.count({
      where: { businessId, userId },
    });
    if (existingCount >= MAX_VIEWS_PER_USER_PER_BUSINESS) {
      throw new BadRequestException(
        `You can have at most ${MAX_VIEWS_PER_USER_PER_BUSINESS} saved views per workspace`,
      );
    }

    try {
      return await this.prisma.client.contactSavedView.create({
        data: {
          businessId,
          userId,
          name,
          filterState,
          sort: input.sort ?? undefined,
          visibleColumns: input.visibleColumns ?? [],
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('A saved view with that name already exists');
      }
      throw err;
    }
  }

  async update(
    businessId: string,
    userId: string,
    viewId: string,
    input: Partial<SavedViewInput>,
  ) {
    await this.get(businessId, userId, viewId);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = this.normalizeName(input.name);
    if (input.filterState !== undefined) data.filterState = this.normalizeFilterState(input.filterState);
    if (input.sort !== undefined) data.sort = input.sort ?? null;
    if (input.visibleColumns !== undefined) data.visibleColumns = input.visibleColumns ?? [];

    try {
      return await this.prisma.client.contactSavedView.update({
        where: { id: viewId },
        data,
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('A saved view with that name already exists');
      }
      throw err;
    }
  }

  async delete(businessId: string, userId: string, viewId: string) {
    await this.get(businessId, userId, viewId);
    await this.prisma.client.contactSavedView.delete({ where: { id: viewId } });
    return { ok: true };
  }
}
