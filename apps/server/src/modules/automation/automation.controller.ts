import { Controller, Get } from '@nestjs/common';

@Controller('automation')
export class AutomationController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'automation' };
  }
}
