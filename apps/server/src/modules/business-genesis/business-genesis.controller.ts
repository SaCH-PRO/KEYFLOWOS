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
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { CurrentUser, type AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { BusinessGenesisService } from './business-genesis.service';
import { GenesisMarketStrategyService } from './genesis-market-strategy.service';
import {
  AnalyzeIdeaDto,
  SubmitAnswersDto,
  NextQuestionsQueryDto,
} from './dto';

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
    @Body() body: AnalyzeIdeaDto,
  ) {
    return this.genesis.analyzeIdea(businessId, body.ideaText || '');
  }

  @Get('questions/next')
  async nextQuestions(
    @Param('businessId') businessId: string,
    @Query() query: NextQuestionsQueryDto,
  ) {
    return this.genesis.getNextQuestions(businessId, query.limit ?? 3);
  }

  /**
   * R0-09d (owner ruling D-11, R0-09b review SEC-1): answers that write the
   * Business row (businessName, businessIntent, country, currency) are the
   * owner's only; the check runs before anything is read or written. Other
   * answers (the blueprint, the legal disclaimer acceptance) stay open to any
   * member.
   */
  @Post('answers')
  async submitAnswers(
    @Param('businessId') businessId: string,
    @Body() body: SubmitAnswersDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const answers = body.answers || {};
    await this.genesis.assertProfileAnswersOwner(businessId, answers, user);
    return this.genesis.submitAnswers(businessId, answers);
  }

  @Get('readiness')
  async readiness(@Param('businessId') businessId: string) {
    return this.genesis.getReadinessScore(businessId);
  }

  @Post('generate-roadmap')
  @UseGuards(GenomeGateGuard)
  async generateRoadmap(@Param('businessId') businessId: string) {
    return this.genesis.generateRoadmap(businessId);
  }

  @Post('generate-document-pack')
  @UseGuards(GenomeGateGuard)
  async generateDocumentPack(@Param('businessId') businessId: string) {
    return this.genesis.generateDocumentPack(businessId);
  }

  @Get('document-pack')
  async getDocumentPack(@Param('businessId') businessId: string) {
    return this.genesis.getDocumentPack(businessId);
  }

  @Post('generate-risk-register')
  @UseGuards(GenomeGateGuard)
  async generateRiskRegister(@Param('businessId') businessId: string) {
    return this.genesis.generateRiskRegister(businessId);
  }

  @Post('generate-market-strategy')
  @UseGuards(GenomeGateGuard)
  async generateMarketStrategy(@Param('businessId') businessId: string) {
    return this.marketStrategy.generateMarketStrategy(businessId);
  }

  @Get('market-strategy')
  async getMarketStrategy(@Param('businessId') businessId: string) {
    return this.marketStrategy.getMarketStrategy(businessId);
  }
}
