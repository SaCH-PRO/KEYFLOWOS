import { Controller, Get } from '@nestjs/common';

@Controller('identity')
export class IdentityController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'identity' };
  }
}
