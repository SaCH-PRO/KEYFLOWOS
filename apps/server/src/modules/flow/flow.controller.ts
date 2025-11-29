import { Controller, Get } from '@nestjs/common';

@Controller('flow')
export class FlowController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'flow' };
  }
}
