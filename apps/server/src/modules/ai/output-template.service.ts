import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  OutputCategory,
  ResolvedTemplate,
  SYSTEM_DEFAULT_TEMPLATES,
  buildQualityDirectiveSuffix,
} from './ai-quality';

export interface CreateOutputTemplateDto {
  name: string;
  category: OutputCategory;
  tone?: string;
  formality?: string;
  targetLength?: string;
  requiredSections?: string[];
  customInstructions?: string;
  isDefault?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UpdateOutputTemplateDto extends Partial<CreateOutputTemplateDto> {}

const VALID_CATEGORIES: OutputCategory[] = ['documents', 'messages', 'reports', 'briefings', 'marketing', 'general'];
const VALID_TONES = ['formal', 'professional', 'friendly', 'caribbean-casual'];
const VALID_FORMALITIES = ['high', 'medium', 'low'];
const VALID_LENGTHS = ['brief', 'medium', 'comprehensive'];

@Injectable()
export class OutputTemplateService {
  private readonly logger = new Logger(OutputTemplateService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private validateTemplateFields(dto: Partial<CreateOutputTemplateDto>): void {
    if (dto.category !== undefined && !VALID_CATEGORIES.includes(dto.category as OutputCategory)) {
      throw new BadRequestException(`Invalid category: "${dto.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
    if (dto.tone !== undefined && !VALID_TONES.includes(dto.tone)) {
      throw new BadRequestException(`Invalid tone: "${dto.tone}". Must be one of: ${VALID_TONES.join(', ')}`);
    }
    if (dto.formality !== undefined && !VALID_FORMALITIES.includes(dto.formality)) {
      throw new BadRequestException(`Invalid formality: "${dto.formality}". Must be one of: ${VALID_FORMALITIES.join(', ')}`);
    }
    if (dto.targetLength !== undefined && !VALID_LENGTHS.includes(dto.targetLength)) {
      throw new BadRequestException(`Invalid targetLength: "${dto.targetLength}". Must be one of: ${VALID_LENGTHS.join(', ')}`);
    }
    if (dto.name !== undefined && (!dto.name.trim() || dto.name.length > 100)) {
      throw new BadRequestException('Template name must be 1-100 characters');
    }
    if (dto.requiredSections !== undefined) {
      if (!Array.isArray(dto.requiredSections)) {
        throw new BadRequestException('requiredSections must be an array');
      }
      if (dto.requiredSections.length > 20) {
        throw new BadRequestException('Maximum 20 required sections allowed');
      }
      for (const s of dto.requiredSections) {
        if (typeof s !== 'string' || !s.trim() || s.length > 100) {
          throw new BadRequestException('Each section name must be a non-empty string up to 100 characters');
        }
      }
    }
    if (dto.customInstructions !== undefined && dto.customInstructions !== null && dto.customInstructions.length > 2000) {
      throw new BadRequestException('customInstructions must not exceed 2000 characters');
    }
  }

  async listTemplates(businessId: string) {
    return this.db.outputTemplate.findMany({
      where: { businessId },
      orderBy: [{ category: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async getTemplate(businessId: string, id: string) {
    const template = await this.db.outputTemplate.findFirst({
      where: { id, businessId },
    });
    if (!template) throw new NotFoundException('Output template not found');
    return template;
  }

  async createTemplate(businessId: string, dto: CreateOutputTemplateDto) {
    this.validateTemplateFields(dto);
    const category = dto.category as OutputCategory;

    if (dto.isDefault) {
      await this.db.outputTemplate.updateMany({
        where: { businessId, category, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.db.outputTemplate.create({
      data: {
        businessId,
        name: dto.name,
        category: dto.category,
        tone: dto.tone || 'professional',
        formality: dto.formality || 'medium',
        targetLength: dto.targetLength || 'medium',
        requiredSections: dto.requiredSections || [],
        customInstructions: dto.customInstructions || null,
        isDefault: dto.isDefault || false,
      },
    });
  }

  async updateTemplate(businessId: string, id: string, dto: UpdateOutputTemplateDto) {
    this.validateTemplateFields(dto);
    const existing = await this.getTemplate(businessId, id);

    if (dto.isDefault && dto.category) {
      await this.db.outputTemplate.updateMany({
        where: { businessId, category: dto.category, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    } else if (dto.isDefault) {
      await this.db.outputTemplate.updateMany({
        where: { businessId, category: existing.category, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return this.db.outputTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.tone !== undefined && { tone: dto.tone }),
        ...(dto.formality !== undefined && { formality: dto.formality }),
        ...(dto.targetLength !== undefined && { targetLength: dto.targetLength }),
        ...(dto.requiredSections !== undefined && { requiredSections: dto.requiredSections }),
        ...(dto.customInstructions !== undefined && { customInstructions: dto.customInstructions }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      },
    });
  }

  async deleteTemplate(businessId: string, id: string) {
    await this.getTemplate(businessId, id);
    await this.db.outputTemplate.delete({ where: { id } });
    return { success: true };
  }

  async setDefault(businessId: string, id: string) {
    const template = await this.getTemplate(businessId, id);

    await this.db.outputTemplate.updateMany({
      where: { businessId, category: template.category, isDefault: true },
      data: { isDefault: false },
    });

    return this.db.outputTemplate.update({
      where: { id },
      data: { isDefault: true },
    });
  }

  async resetToDefault(businessId: string, category: OutputCategory) {
    await this.db.outputTemplate.updateMany({
      where: { businessId, category, isDefault: true },
      data: { isDefault: false },
    });
    return { success: true, message: `Default template for ${category} cleared — system defaults will be used.` };
  }

  async resolveTemplate(businessId: string, category: OutputCategory): Promise<ResolvedTemplate> {
    try {
      const userTemplate = await this.db.outputTemplate.findFirst({
        where: { businessId, category, isDefault: true },
      });

      if (userTemplate) {
        return {
          category,
          tone: userTemplate.tone,
          formality: userTemplate.formality,
          targetLength: userTemplate.targetLength,
          requiredSections: (userTemplate.requiredSections as string[]) || [],
          customInstructions: userTemplate.customInstructions,
        };
      }
    } catch (err) {
      this.logger.warn(`Template resolution failed for ${businessId}/${category}: ${(err as Error).message}`);
    }

    return SYSTEM_DEFAULT_TEMPLATES[category] || SYSTEM_DEFAULT_TEMPLATES.general;
  }

  async previewTemplate(template: {
    tone: string;
    formality: string;
    targetLength: string;
    requiredSections: string[];
    customInstructions?: string;
    category: OutputCategory;
  }): Promise<{ sampleDirective: string; explanation: string }> {
    const resolved: ResolvedTemplate = {
      category: template.category,
      tone: template.tone,
      formality: template.formality,
      targetLength: template.targetLength,
      requiredSections: template.requiredSections || [],
      customInstructions: template.customInstructions || null,
    };

    const sampleDirective = buildQualityDirectiveSuffix(resolved);
    const explanation = `This template will instruct the AI to use a ${template.tone} tone, ${template.formality} formality level, and ${template.targetLength} output length. ${template.requiredSections.length > 0 ? `Required sections: ${template.requiredSections.join(', ')}.` : ''}`;

    return { sampleDirective, explanation };
  }

  getValidOptions() {
    return {
      categories: VALID_CATEGORIES,
      tones: VALID_TONES,
      formalities: VALID_FORMALITIES,
      lengths: VALID_LENGTHS,
    };
  }
}
