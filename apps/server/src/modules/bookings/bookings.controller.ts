import { Controller, Get } from '@nestjs/common';

@Controller('bookings')
export class BookingsController {
  @Get('health')
  health() {
    return { status: 'ok', module: 'bookings' };
  }
}
