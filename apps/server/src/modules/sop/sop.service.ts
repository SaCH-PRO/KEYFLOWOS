import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface SopDto {
  id: string;
  title: string;
  department: string;
  body: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SopService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string): Promise<SopDto[]> {
    const sops = await (this.prisma.client as any).sopDocument.findMany({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    });
    return sops.map((s: any) => this.toDto(s));
  }

  async create(businessId: string, data: { title: string; department?: string; body: string }): Promise<SopDto> {
    const sop = await (this.prisma.client as any).sopDocument.create({
      data: {
        businessId,
        title: data.title,
        department: data.department || 'General',
        body: data.body,
        status: 'ACTIVE',
        version: 1,
      },
    });
    return this.toDto(sop);
  }

  async get(businessId: string, id: string): Promise<SopDto | null> {
    const sop = await (this.prisma.client as any).sopDocument.findUnique({ where: { id } });
    if (!sop || sop.businessId !== businessId) return null;
    return this.toDto(sop);
  }

  async update(businessId: string, id: string, data: Partial<{ title: string; department: string; body: string; status: string }>): Promise<SopDto> {
    const existing = await (this.prisma.client as any).sopDocument.findUnique({ where: { id } });
    if (!existing || existing.businessId !== businessId) throw new Error('Not found');
    const sop = await (this.prisma.client as any).sopDocument.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.department !== undefined && { department: data.department }),
        ...(data.body !== undefined && { body: data.body }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.body !== undefined && { version: { increment: 1 } }),
      },
    });
    return this.toDto(sop);
  }

  async delete(businessId: string, id: string): Promise<void> {
    const existing = await (this.prisma.client as any).sopDocument.findUnique({ where: { id } });
    if (!existing || existing.businessId !== businessId) throw new Error('Not found');
    await (this.prisma.client as any).sopDocument.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  private toDto(s: any): SopDto {
    return {
      id: s.id,
      title: s.title,
      department: s.department,
      body: s.body,
      status: s.status,
      version: s.version,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}
