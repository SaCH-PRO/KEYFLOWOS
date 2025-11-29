import { Controller, Get } from '@nestjs/common';

@Controller('site')
export class SiteController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'site' };
  }
}
