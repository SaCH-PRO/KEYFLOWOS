import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { CustomFieldType } from './dto/custom-field-definition.dto';

export interface CustomFieldDefinitionInput {
  businessId: string;
  name: string;
  label: string;
  type: CustomFieldType;
  description?: string | null;
  placeholder?: string | null;
  options?: Record<string, unknown> | null;
  defaultValue?: unknown | null;
  required?: boolean;
  order?: number;
}

export interface CustomFieldDefinitionUpdateInput {
  label?: string;
  description?: string | null;
  placeholder?: string | null;
  options?: Record<string, unknown> | null;
  defaultValue?: unknown | null;
  required?: boolean;
  order?: number;
  archivedAt?: Date | null;
}

@Injectable()
export class CustomFieldDefinitionService {
  constructor(private readonly prisma: PrismaService) {}

  async listDefinitions(businessId: string, opts?: { includeArchived?: boolean }) {
    return this.prisma.client.customFieldDefinition.findMany({
      where: {
        businessId,
        ...(opts?.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getDefinition(businessId: string, id: string) {
    const def = await this.prisma.client.customFieldDefinition.findFirst({
      where: { id, businessId },
    });
    if (!def) throw new NotFoundException('Custom field definition not found');
    return def;
  }

  async createDefinition(input: CustomFieldDefinitionInput) {
    const normalizedName = input.name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    return this.prisma.client.customFieldDefinition.create({
      data: {
        businessId: input.businessId,
        name: normalizedName,
        label: input.label.trim(),
        type: input.type,
        description: input.description ?? null,
        placeholder: input.placeholder ?? null,
        options: (input.options ?? null) as any,
        defaultValue: (input.defaultValue ?? null) as any,
        required: input.required ?? false,
        order: input.order ?? 0,
      },
    });
  }

  async updateDefinition(businessId: string, id: string, input: CustomFieldDefinitionUpdateInput) {
    const existing = await this.getDefinition(businessId, id);
    return this.prisma.client.customFieldDefinition.update({
      where: { id: existing.id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.placeholder !== undefined ? { placeholder: input.placeholder } : {}),
        ...(input.options !== undefined ? { options: input.options as any } : {}),
        ...(input.defaultValue !== undefined ? { defaultValue: input.defaultValue as any } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt } : {}),
      },
    });
  }

  async archiveDefinition(businessId: string, id: string) {
    return this.updateDefinition(businessId, id, { archivedAt: new Date() });
  }

  async restoreDefinition(businessId: string, id: string) {
    return this.updateDefinition(businessId, id, { archivedAt: null });
  }

  async deleteDefinition(businessId: string, id: string) {
    const existing = await this.getDefinition(businessId, id);
    await this.prisma.client.customFieldDefinition.delete({ where: { id: existing.id } });
    return { deleted: true };
  }
}
