import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import { GenomeSignalService } from './genome-signal.service';

@Controller('business-genome/businesses/:businessId/key-genome')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyGenomeController {
  constructor(
    @Inject(GenomeSignalService) private readonly signalService: GenomeSignalService,
  ) {}

  @Get('signals')
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('sourceModule') sourceModule?: string,
    @Query('section') section?: string,
    @Query('signalType') signalType?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.signalService.listSignals(businessId, {
      status,
      sourceModule,
      section,
      signalType,
      minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('signals/:signalId')
  async get(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.getSignal(businessId, signalId);
  }

  @Post('signals/:signalId/review')
  async review(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.reviewSignal(businessId, signalId);
  }

  @Post('signals/:signalId/accept')
  async accept(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.acceptSignal(businessId, signalId);
  }

  @Post('signals/:signalId/reject')
  async reject(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.rejectSignal(businessId, signalId);
  }

  @Post('signals/:signalId/merge')
  async merge(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.mergeSignal(businessId, signalId);
  }
}
