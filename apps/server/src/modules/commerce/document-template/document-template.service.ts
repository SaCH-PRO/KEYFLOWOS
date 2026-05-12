import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateDocumentTemplateDto } from './dto/create-document-template.dto';
import { UpdateDocumentTemplateDto } from './dto/update-document-template.dto';

@Injectable()
export class DocumentTemplateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string, type?: string) {
    const where: any = { businessId };
    if (type) where.type = type;
    return (this.prisma.client as any).commercialDocumentTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(businessId: string, dto: CreateDocumentTemplateDto) {
    if (dto.isDefault) {
      await (this.prisma.client as any).commercialDocumentTemplate.updateMany({
        where: { businessId, type: dto.type },
        data: { isDefault: false },
      });
    }
    return (this.prisma.client as any).commercialDocumentTemplate.create({
      data: {
        businessId,
        type: dto.type,
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        config: dto.config as any,
        previewData: dto.previewData as any,
      },
    });
  }

  async update(businessId: string, id: string, dto: UpdateDocumentTemplateDto) {
    const existing = await (this.prisma.client as any).commercialDocumentTemplate.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Template not found');

    if (dto.isDefault) {
      await (this.prisma.client as any).commercialDocumentTemplate.updateMany({
        where: { businessId, type: existing.type },
        data: { isDefault: false },
      });
    }

    return (this.prisma.client as any).commercialDocumentTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        isDefault: dto.isDefault,
        config: dto.config as any,
        previewData: dto.previewData as any,
      },
    });
  }

  async delete(businessId: string, id: string) {
    const existing = await (this.prisma.client as any).commercialDocumentTemplate.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Template not found');
    return (this.prisma.client as any).commercialDocumentTemplate.delete({ where: { id } });
  }

  async setDefault(businessId: string, id: string) {
    const existing = await (this.prisma.client as any).commercialDocumentTemplate.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Template not found');

    await (this.prisma.client as any).commercialDocumentTemplate.updateMany({
      where: { businessId, type: existing.type },
      data: { isDefault: false },
    });

    return (this.prisma.client as any).commercialDocumentTemplate.update({
      where: { id },
      data: { isDefault: true },
    });
  }
}
