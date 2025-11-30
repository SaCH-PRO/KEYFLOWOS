import { Controller, Get } from '@nestjs/common';
import { AutomationService } from './automation.service';

@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('health')
  health() {
    return this.automation.health();
  }
}
