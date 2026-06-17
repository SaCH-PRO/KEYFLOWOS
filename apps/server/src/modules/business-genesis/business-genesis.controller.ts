import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { BusinessGenesisService } from './business-genesis.service';
import { GenesisMarketStrategyService } from './genesis-market-strategy.service';

@Controller('business-genesis/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class BusinessGenesisController {
  constructor(
    @Inject(BusinessGenesisService) private readonly genesis: BusinessGenesisService,
    @Inject(GenesisMarketStrategyService) private readonly marketStrategy: GenesisMarketStrategyService,
  ) {}

  @Post('analyze-idea')
  async analyzeIdea(
    @Param('businessId') businessId: string,
    @Body() body: { ideaText: string },
  ) {
    return this.genesis.analyzeIdea(businessId, body.ideaText || '');
  }

  @Get('questions/next')
  async nextQuestions(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? parseInt(limit, 10) : 3;
    return this.genesis.getNextQuestions(
      businessId,
      Number.isNaN(parsed) ? 3 : parsed,
    );
  }

  @Post('answers')
  async submitAnswers(
    @Param('businessId') businessId: string,
    @Body() body: { answers: Record<string, unknown> },
  ) {
    return this.genesis.submitAnswers(businessId, body.answers || {});
  }

  @Get('readiness')
  async readiness(@Param('businessId') businessId: string) {
    return this.genesis.getReadinessScore(businessId);
  }

  @Post('generate-roadmap')
  async generateRoadmap(@Param('businessId') businessId: string) {
    return this.genesis.generateRoadmap(businessId);
  }

  @Post('generate-document-pack')
  async generateDocumentPack(@Param('businessId') businessId: string) {
    return this.genesis.generateDocumentPack(businessId);
  }

  @Get('document-pack')
  async getDocumentPack(@Param('businessId') businessId: string) {
    return this.genesis.getDocumentPack(businessId);
  }

  @Post('generate-risk-register')
  async generateRiskRegister(@Param('businessId') businessId: string) {
    return this.genesis.generateRiskRegister(businessId);
  }

  @Post('generate-market-strategy')
  async generateMarketStrategy(@Param('businessId') businessId: string) {
    return this.marketStrategy.generateMarketStrategy(businessId);
  }

  @Get('market-strategy')
  async getMarketStrategy(@Param('businessId') businessId: string) {
    return this.marketStrategy.getMarketStrategy(businessId);
  }
}
