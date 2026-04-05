import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

@Injectable()
export class GuidanceAiFeedbackService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async generateFeedback(_businessId: string) {
    return { message: 'AI feedback generation not yet implemented' };
  }
}
