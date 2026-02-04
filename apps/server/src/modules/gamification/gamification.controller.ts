import { Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('gamification')
export class GamificationController {
  constructor(@Inject(GamificationService) private readonly gamificationService: GamificationService) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'gamification' };
  }

  @Get('businesses/:businessId/stats')
  @UseGuards(AuthGuard, BusinessGuard)
  async getStats(@Param('businessId') businessId: string) {
    return this.gamificationService.getGamificationStats(businessId);
  }

  @Post('businesses/:businessId/streak')
  @UseGuards(AuthGuard, BusinessGuard)
  async updateStreak(@Param('businessId') businessId: string) {
    const newStreak = await this.gamificationService.updateStreak(businessId);
    return { streakDays: newStreak };
  }
}
