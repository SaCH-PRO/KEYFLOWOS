import { Controller, Get } from '@nestjs/common';

@Controller('crm')
export class CrmController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'crm' };
  }
}
