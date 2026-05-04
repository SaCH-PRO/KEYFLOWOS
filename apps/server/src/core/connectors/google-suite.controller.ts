import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { BusinessGuard } from '../auth/business.guard';
import { GoogleSuiteService, ALL_SERVICES } from './google-suite.service';
import type { GoogleService } from './google-suite.service';

@Controller('connect/google-suite')
export class GoogleSuiteController {
  constructor(
    @Inject(GoogleSuiteService) private readonly suite: GoogleSuiteService,
  ) {}

  @Post('businesses/:businessId/auth-url')
  @UseGuards(AuthGuard, BusinessGuard)
  buildAuthUrl(
    @Param('businessId') businessId: string,
    @Body() body: { services?: GoogleService[] } = {},
  ): { authUrl: string; services: GoogleService[] } {
    const services = body.services && body.services.length ? body.services : ALL_SERVICES;
    return { authUrl: this.suite.buildAuthUrl(businessId, services), services };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
    const success = `${appUrl}/app/connect?google=connected`;
    const failure = `${appUrl}/app/connect?google=error`;

    if (error) {
      return res.redirect(`${failure}&reason=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      throw new BadRequestException('Missing code or state');
    }
    try {
      const result = await this.suite.handleCallback(code, state);
      const params = new URLSearchParams({
        google: 'connected',
        services: result.enabledServices.join(','),
        email: result.email,
      });
      return res.redirect(`${appUrl}/app/connect?${params.toString()}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error';
      return res.redirect(`${failure}&reason=${encodeURIComponent(reason)}`);
    }
  }
}
