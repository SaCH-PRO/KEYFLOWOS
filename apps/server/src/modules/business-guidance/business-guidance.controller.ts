import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GuidanceProfileService } from './guidance-profile.service';
import { GuidanceAssessmentService } from './guidance-assessment.service';
import { GuidanceRecommendationService } from './guidance-recommendation.service';
import { GuidanceRoadmapService } from './guidance-roadmap.service';
import { BusinessIdentityDto } from './dto/business-identity.dto';
import { FounderContextDto } from './dto/founder-context.dto';
import { OfferDefinitionDto } from './dto/offer-definition.dto';
import { CustomerDefinitionDto } from './dto/customer-definition.dto';
import { RevenueModelDto } from './dto/revenue-model.dto';
import { FinanceDto } from './dto/finance.dto';
import { OperationsDto } from './dto/operations.dto';
import { ComplianceDto } from './dto/compliance.dto';
import { GrowthDto } from './dto/growth.dto';
import { GoalsDto } from './dto/goals.dto';

const STEP_DTO_MAP: Record<string, new () => object> = {
  identity: BusinessIdentityDto,
  founder: FounderContextDto,
  offer: OfferDefinitionDto,
  customer: CustomerDefinitionDto,
  revenue: RevenueModelDto,
  finance: FinanceDto,
  operations: OperationsDto,
  compliance: ComplianceDto,
  growth: GrowthDto,
  goals: GoalsDto,
};

@Controller('business-guidance')
export class BusinessGuidanceController {
  constructor(
    @Inject(GuidanceProfileService) private readonly profileService: GuidanceProfileService,
    @Inject(GuidanceAssessmentService) private readonly assessmentService: GuidanceAssessmentService,
    @Inject(GuidanceRecommendationService) private readonly recommendationService: GuidanceRecommendationService,
    @Inject(GuidanceRoadmapService) private readonly roadmapService: GuidanceRoadmapService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Post(':businessId/start')
  startProfile(@Param('businessId') businessId: string) {
    return this.profileService.startProfile(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get(':businessId')
  getProfile(@Param('businessId') businessId: string) {
    return this.profileService.getProfile(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get(':businessId/status')
  getCompletionStatus(@Param('businessId') businessId: string) {
    return this.profileService.getCompletionStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put(':businessId/step/:stepId')
  async saveStep(
    @Param('businessId') businessId: string,
    @Param('stepId') stepId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const DtoClass = STEP_DTO_MAP[stepId];
    if (!DtoClass) {
      throw new BadRequestException(`Invalid step: ${stepId}. Valid steps: ${Object.keys(STEP_DTO_MAP).join(', ')}`);
    }

    const dto = plainToInstance(DtoClass, body);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      const messages = errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ');
      throw new BadRequestException(`Validation failed: ${messages}`);
    }

    return this.profileService.saveStep(businessId, stepId, dto as Record<string, unknown>);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post(':businessId/submit')
  submitProfile(@Param('businessId') businessId: string) {
    return this.profileService.submitProfile(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get(':businessId/assessment')
  getAssessment(@Param('businessId') businessId: string) {
    return this.assessmentService.getAssessment(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get(':businessId/dashboard')
  getDashboard(@Param('businessId') businessId: string) {
    return this.assessmentService.getDashboard(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post(':businessId/reanalyze')
  reanalyze(@Param('businessId') businessId: string) {
    return this.profileService.resetForReanalysis(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get(':businessId/roadmap')
  getRoadmap(@Param('businessId') businessId: string) {
    return this.roadmapService.getRoadmap(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get(':businessId/recommendations')
  getRecommendations(@Param('businessId') businessId: string) {
    return this.recommendationService.getRecommendations(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get(':businessId/progress')
  getProgress(@Param('businessId') businessId: string) {
    return this.assessmentService.getProgress(businessId);
  }
}
