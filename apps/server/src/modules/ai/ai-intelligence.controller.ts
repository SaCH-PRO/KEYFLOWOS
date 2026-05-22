import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { CrossBusinessIntelligenceService } from './cross-business-intelligence.service';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}

@Controller('ai/intelligence')
@UseGuards(AuthGuard)
export class AiIntelligenceController {
  constructor(
    private readonly intelligence: CrossBusinessIntelligenceService,
  ) {}

  @Get('cross-business')
  async getCrossBusinessIntelligence(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) throw new Error('User ID required');
    return this.intelligence.aggregateForUser(userId);
  }
}
