import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class GuidanceScoringService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async scoreProfile(_businessId: string) {
    return { message: 'Scoring not yet implemented' };
  }
}
