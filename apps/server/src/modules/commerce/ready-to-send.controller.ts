import { Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { ReadyToSendService } from './ready-to-send.service';

interface AuthenticatedReq {
  user?: { id?: string; role?: string };
}

@Controller('commerce')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class ReadyToSendController {
  constructor(@Inject(ReadyToSendService) private readonly readyToSend: ReadyToSendService) {}

  @Get('businesses/:businessId/ready-to-send')
  listDue(@Param('businessId') businessId: string, @Req() req: AuthenticatedReq) {
    const reader = req?.user?.id ? { id: req.user.id, role: req.user.role } : null;
    return this.readyToSend.listDue(businessId, reader);
  }

  @Post('businesses/:businessId/ready-to-send/invoice/:id/mark-sent')
  @RequireModuleScope('revenue', 'write')
  markInvoiceSent(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedReq,
  ) {
    return this.readyToSend.markInvoiceSent(businessId, id, req?.user?.id ?? null);
  }

  @Post('businesses/:businessId/ready-to-send/booking/:id/mark-sent')
  @RequireModuleScope('bookings', 'write')
  markBookingSent(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedReq,
  ) {
    return this.readyToSend.markBookingSent(businessId, id, req?.user?.id ?? null);
  }
}
