import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { ContentRequestService } from './content-request.service';
import { ContentDeliveryService } from './content-delivery.service';
import { ContentInvoiceService } from './content-invoice.service';
import { CreateContentRequestDto } from './dto/create-content-request.dto';
import { UpdateContentRequestDto } from './dto/update-content-request.dto';
import { ContentReviewDto } from './dto/content-review.dto';
import { UploadDeliverablesDto } from './dto/upload-deliverables.dto';

@Controller()
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
export class ContentOpsController {
  constructor(
    private readonly contentRequests: ContentRequestService,
    private readonly delivery: ContentDeliveryService,
    private readonly contentInvoice: ContentInvoiceService,
  ) {}

  @Post('businesses/:businessId/content-requests')
  @RateLimit(20, 60_000)
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateContentRequestDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.contentRequests.createRequest({
      businessId,
      requestedBy: req.user?.id ?? 'system',
      source: body.source,
      contentTypes: body.contentTypes,
      businessGoal: body.businessGoal,
      targetAudience: body.targetAudience,
      offer: body.offer,
      productOrService: body.productOrService,
      branch: body.branch,
      tone: body.tone,
      dueDate: body.dueDate,
      priority: body.priority,
      requiredInputs: body.requiredInputs,
      attachedAssetIds: body.attachedAssetIds,
      approvalRequired: body.approvalRequired,
    });
  }

  @Get('businesses/:businessId/content-requests')
  @RateLimit(60, 60_000)
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.contentRequests.listForBusiness(businessId, {
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('businesses/:businessId/content-requests/pipeline')
  @RateLimit(60, 60_000)
  async pipeline(@Param('businessId') businessId: string) {
    return this.contentRequests.getPipeline(businessId);
  }

  @Get('businesses/:businessId/content-requests/:requestId')
  @RateLimit(60, 60_000)
  async getById(@Param('requestId') requestId: string) {
    return this.contentRequests.getById(requestId);
  }

  @Patch('businesses/:businessId/content-requests/:requestId')
  @RateLimit(20, 60_000)
  async update(
    @Param('requestId') requestId: string,
    @Body() body: UpdateContentRequestDto,
  ) {
    return this.contentRequests.updateRequest(requestId, body);
  }

  @Post('businesses/:businessId/content-requests/:requestId/submit')
  @RateLimit(20, 60_000)
  async submit(
    @Param('requestId') requestId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.contentRequests.submitRequest(requestId, req.user?.id ?? 'system');
  }

  @Post('businesses/:businessId/content-requests/:requestId/assign')
  @RateLimit(20, 60_000)
  async assign(
    @Param('requestId') requestId: string,
    @Body() body: { teamMemberIds: string[] },
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.contentRequests.assignRequest(requestId, body.teamMemberIds, req.user?.id ?? 'system');
  }

  @Post('businesses/:businessId/content-requests/:requestId/start-production')
  @RateLimit(20, 60_000)
  async startProduction(
    @Param('requestId') requestId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.contentRequests.startProduction(requestId, req.user?.id ?? 'system');
  }

  @Post('businesses/:businessId/content-requests/:requestId/submit-for-review')
  @RateLimit(20, 60_000)
  async submitForReview(
    @Param('requestId') requestId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
    @Body() body: { comment?: string },
  ) {
    return this.contentRequests.submitForReview(requestId, req.user?.id ?? 'system', body.comment);
  }

  @Post('businesses/:businessId/content-requests/:requestId/review')
  @RateLimit(20, 60_000)
  async review(
    @Param('requestId') requestId: string,
    @Body() body: ContentReviewDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.contentRequests.reviewContent(
      requestId,
      body.action,
      req.user?.id ?? 'system',
      body.comment,
    );
  }

  @Post('businesses/:businessId/content-requests/:requestId/upload-deliverables')
  @RateLimit(20, 60_000)
  async uploadDeliverables(
    @Param('requestId') requestId: string,
    @Body() body: UploadDeliverablesDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.contentRequests.uploadDeliverables(requestId, body.fileIds, body.folderId, req.user?.id ?? 'system');
  }

  @Post('businesses/:businessId/content-requests/:requestId/deliver')
  @RateLimit(20, 60_000)
  async deliver(
    @Param('requestId') requestId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.contentRequests.deliverRequest(requestId, req.user?.id ?? 'system');
  }

  @Post('businesses/:businessId/content-requests/:requestId/generate-invoice')
  @RateLimit(20, 60_000)
  async generateInvoice(
    @Param('businessId') businessId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.contentInvoice.generateInvoiceFromDelivery(requestId, businessId);
  }

  @Delete('businesses/:businessId/content-requests/:requestId')
  @RateLimit(20, 60_000)
  async cancel(
    @Param('requestId') requestId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.contentRequests.cancelRequest(requestId, req.user?.id ?? 'system');
  }

  // --- Drive integration ---

  @Post('businesses/:businessId/content-requests/:requestId/drive-folder')
  @RateLimit(10, 60_000)
  async createDriveFolder(
    @Param('businessId') businessId: string,
    @Param('requestId') requestId: string,
    @Body() body: { parentFolderId?: string },
  ) {
    const request = await this.contentRequests.getById(requestId);
    return this.delivery.createFolder(businessId, requestId, request.businessGoal, body.parentFolderId);
  }

  @Post('businesses/:businessId/content-requests/:requestId/drive-doc')
  @RateLimit(10, 60_000)
  async createDriveDoc(
    @Param('businessId') businessId: string,
    @Param('requestId') requestId: string,
    @Body() body: { title: string },
  ) {
    return this.delivery.createDoc(businessId, requestId, body.title);
  }

  @Get('businesses/:businessId/content-requests/:requestId/delivery-status')
  @RateLimit(60, 60_000)
  async deliveryStatus(@Param('requestId') requestId: string) {
    return this.delivery.getDeliveryStatus(requestId);
  }
}
