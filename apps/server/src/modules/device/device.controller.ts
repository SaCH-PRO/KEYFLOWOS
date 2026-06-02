import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { DeviceService } from './device.service';

@Controller('api/device/businesses/:businessId')
@UseGuards(BusinessGuard, ModuleScopeGuard)
export class DeviceController {
  constructor(private readonly device: DeviceService) {}

  // ─── Capture / Media Assets ───

  @Post('captures')
  async createCapture(
    @Param('businessId') businessId: string,
    @Request() req: { user?: { sub?: string } },
    @Body() body: {
      objectPath: string;
      publicUrl?: string;
      fileName?: string;
      contentType: string;
      sizeBytes?: number;
      mediaType: 'image' | 'video' | 'audio' | 'document';
      source?: string;
      captureMode?: string;
      extractedText?: string;
      linkedEntityType?: string;
      linkedEntityId?: string;
      contactId?: string;
    },
  ) {
    const userId = req.user?.sub ?? null;
    return this.device.createCapture(businessId, userId, body);
  }

  @Get('captures')
  async listCaptures(
    @Param('businessId') businessId: string,
    @Query('mediaType') mediaType?: string,
    @Query('status') status?: string,
    @Query('contactId') contactId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.device.listCaptures(businessId, {
      mediaType,
      status,
      contactId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('captures/:id')
  async getCapture(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.device.getCapture(businessId, id);
  }

  // ─── Visual Intakes ───

  @Get('intakes')
  async listIntakes(
    @Param('businessId') businessId: string,
    @Query('detectedType') detectedType?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.device.listVisualIntakes(businessId, {
      detectedType,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Patch('intakes/:id/approve')
  async approveIntake(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    const userId = req.user?.sub ?? 'system';
    return this.device.approveIntake(businessId, id, userId);
  }

  @Patch('intakes/:id/reject')
  async rejectIntake(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    const userId = req.user?.sub ?? 'system';
    return this.device.rejectIntake(businessId, id, userId);
  }

  // ─── Business Card → Contact ───

  @Post('contacts-from-card')
  async createContactFromCard(
    @Param('businessId') businessId: string,
    @Request() req: { user?: { sub?: string } },
    @Body() body: {
      visualIntakeId: string;
      name?: string;
      phone?: string;
      email?: string;
      company?: string;
      title?: string;
      website?: string;
    },
  ) {
    const userId = req.user?.sub ?? null;
    return this.device.createContactFromCard(businessId, userId, body);
  }

  // ─── Voice Sessions ───

  @Post('voice-sessions')
  async createVoiceSession(
    @Param('businessId') businessId: string,
    @Request() req: { user?: { sub?: string } },
    @Body('mode') mode?: string,
  ) {
    const userId = req.user?.sub ?? null;
    return this.device.createVoiceSession(businessId, userId, mode ?? 'push_to_talk');
  }

  @Patch('voice-sessions/:id/end')
  async endVoiceSession(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body('transcript') transcript?: string,
    @Body('summary') summary?: string,
  ) {
    return this.device.endVoiceSession(businessId, id, transcript, summary);
  }

  @Get('voice-sessions')
  async listVoiceSessions(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.device.listVoiceSessions(
      businessId,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  // ─── Voice Preferences ───

  @Get('voice-preferences')
  async getVoicePreferences(
    @Param('businessId') businessId: string,
    @Query('userId') userId?: string,
  ) {
    return this.device.getVoicePreferences(businessId, userId);
  }

  @Post('voice-preferences')
  async saveVoicePreference(
    @Param('businessId') businessId: string,
    @Request() req: { user?: { sub?: string } },
    @Body() body: {
      voiceKey: string;
      displayName: string;
      provider: string;
      language?: string;
      accent?: string;
      speakingRate?: number;
      pitch?: number;
      personality?: string;
      isDefault?: boolean;
    },
  ) {
    const userId = req.user?.sub ?? null;
    return this.device.saveVoicePreference(businessId, userId, body);
  }
}
