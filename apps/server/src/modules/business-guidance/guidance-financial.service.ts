import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class GuidanceFinancialService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async analyzeFinancials(_businessId: string) {
    return { message: 'Financial analysis not yet implemented' };
  }
}
