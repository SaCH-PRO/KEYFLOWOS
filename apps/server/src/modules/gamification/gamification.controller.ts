import { Controller, Get } from '@nestjs/common';

@Controller('gamification')
export class GamificationController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'gamification' };
  }
}
