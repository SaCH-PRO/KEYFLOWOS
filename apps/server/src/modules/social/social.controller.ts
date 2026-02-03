import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SocialService } from './social.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('social')
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'social' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/posts')
  listPosts(@Param('businessId') businessId: string) {
    return this.prisma.client.socialPost.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts')
  createPost(@Param('businessId') businessId: string, @Body() body: { content: string; mediaUrls?: string[]; scheduledFor?: string }) {
    return this.social.createDraft(businessId, body.content, body.mediaUrls ?? []);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts/:postId/publish')
  publish(@Param('businessId') businessId: string, @Param('postId') postId: string) {
    return this.social.publishPost(businessId, postId);
  }
}
