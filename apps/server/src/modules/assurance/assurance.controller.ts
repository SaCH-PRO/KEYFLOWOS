import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AdminGuard } from '../../core/auth/admin.guard';
import { ProofObligationService } from './proof-obligation.service';

@Controller('api/admin/assurance')
@UseGuards(AuthGuard, AdminGuard)
export class AssuranceController {
  constructor(
    @Inject(ProofObligationService)
    private readonly proofObligations: ProofObligationService,
  ) {}

  @Post('proof-obligations')
  compile(@Body() input: unknown) {
    return this.proofObligations.compile(input);
  }
}
