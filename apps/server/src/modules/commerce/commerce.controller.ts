import { Controller, Get } from '@nestjs/common';

@Controller('commerce')
export class CommerceController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'commerce' };
  }
}
