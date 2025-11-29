import { Controller, Get } from '@nestjs/common';

@Controller('social')
export class SocialController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'social' };
  }
}
