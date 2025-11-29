import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SocialService } from './social.service';

@Controller('social')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'social' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts')
  createPost(@Param('businessId') businessId: string, @Body() body: { content: string; mediaUrls?: string[] }) {
    return this.social.createDraft(businessId, body.content, body.mediaUrls ?? []);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts/:postId/publish')
  publish(@Param('businessId') businessId: string, @Param('postId') postId: string) {
    return this.social.publishPost(businessId, postId);
  }
}
