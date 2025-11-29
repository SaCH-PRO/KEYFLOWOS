import { Controller, Get } from '@nestjs/common';

@Controller('ai')
export class AiController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'ai' };
  }
}
