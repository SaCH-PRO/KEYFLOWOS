import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { VisualClassifierService, VisualClassification } from './visual-classifier.service';
import { CommandService } from '../command/command.service';

export interface CreateCaptureInput {
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
}

export interface CreateContactFromCardInput {
  visualIntakeId: string;
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  title?: string;
  website?: string;
}

/**
 * Device capture service.
 *
 * - Creates MediaAsset records after upload
 * - Creates VisualIntake and runs deterministic classification
 * - Creates ExtractedEntity records
 * - Can create contacts from business cards
 * - Creates command items and timeline events
 */
@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisualClassifierService) private readonly classifier: VisualClassifierService,
    @Inject(CommandService) private readonly commands: CommandService,
  ) {}

  async createCapture(businessId: string, userId: string | null, input: CreateCaptureInput) {
    // 1. Create MediaAsset
    const asset = await this.prisma.client.mediaAsset.create({
      data: {
        businessId,
        userId,
        objectPath: input.objectPath,
        publicUrl: input.publicUrl ?? null,
        fileName: input.fileName ?? null,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes ?? null,
        mediaType: input.mediaType,
        source: input.source ?? 'capture',
        captureMode: input.captureMode ?? null,
        status: 'UPLOADED',
        linkedEntityType: input.linkedEntityType ?? null,
        linkedEntityId: input.linkedEntityId ?? null,
        contactId: input.contactId ?? null,
        metadata: {
          uploadedBy: userId,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // 2. Run classification (for images only for now)
    let classification: VisualClassification | null = null;
    if (input.mediaType === 'image') {
      classification = this.classifier.classify(
        input.fileName ?? 'unknown',
        input.contentType,
        input.sizeBytes ?? null,
        input.extractedText,
      );
    }

    // 3. Create VisualIntake
    const intake = await this.prisma.client.visualIntake.create({
      data: {
        businessId,
        mediaAssetId: asset.id,
        detectedType: classification?.detectedType ?? null,
        summary: classification?.summary ?? null,
        extractedText: input.extractedText ?? null,
        extractedData: classification?.extractedData ?? {},
        confidenceScore: classification?.confidenceScore ?? null,
        profitPotential: null,
        recommendedActions: classification?.recommendedActions ?? [],
        status: 'PENDING',
      },
    });

    // 4. Create ExtractedEntity records
    if (classification) {
      await this.prisma.client.extractedEntity.create({
        data: {
          businessId,
          visualIntakeId: intake.id,
          mediaAssetId: asset.id,
          entityType: classification.detectedType,
          proposedData: classification.extractedData,
          status: 'PROPOSED',
        },
      });
    }

    // 5. Create command item for high-value captures
    if (classification && classification.detectedType !== 'unknown') {
      const categoryMap: Record<string, string> = {
        business_card: 'PEOPLE',
        receipt: 'MONEY',
        document: 'WORK',
        product: 'SALES',
      };

      await this.commands.create(businessId, {
        sourceModule: 'DEVICE',
        sourceType: classification.detectedType,
        sourceId: intake.id,
        title: `Review captured ${classification.detectedType.replace(/_/g, ' ')}`,
        description: classification.summary,
        category: categoryMap[classification.detectedType] ?? 'WORK',
        actionType: 'review',
        status: 'OPEN',
        priority: 60,
        urgency: 50,
        impactScore: classification.confidenceScore,
        recommendedBy: 'SYSTEM',
      });
    }

    // 6. Create timeline event
    await this.prisma.client.businessEvent.create({
      data: {
        businessId,
        eventType: 'capture_created',
        subjectType: 'media_asset',
        subjectId: asset.id,
        actorType: 'system',
        actorId: userId ?? 'system',
        action: 'create',
        source: 'web',
        metadata: {
          visualIntakeId: intake.id,
          detectedType: classification?.detectedType,
          confidence: classification?.confidenceScore,
          mediaType: input.mediaType,
        },
      },
    });

    this.logger.log(`Capture ${asset.id} created for ${businessId}: ${classification?.detectedType ?? 'unknown'}`);

    return { asset, intake, classification };
  }

  async createContactFromCard(
    businessId: string,
    _userId: string | null,
    input: CreateContactFromCardInput,
  ) {
    const intake = await this.prisma.client.visualIntake.findFirst({
      where: { id: input.visualIntakeId, businessId },
    });
    if (!intake) throw new NotFoundException('Visual intake not found');

    // Create contact
    const contact = await this.prisma.client.contact.create({
      data: {
        businessId,
        firstName: input.name?.split(' ')[0] ?? 'Unknown',
        lastName: input.name?.split(' ').slice(1).join(' ') ?? null,
        displayName: input.name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        companyName: input.company ?? null,
        jobTitle: input.title ?? null,
        source: 'business_card_capture',
        status: 'LEAD',
      },
    });

    // Link media asset to contact
    await this.prisma.client.mediaAsset.update({
      where: { id: intake.mediaAssetId },
      data: { contactId: contact.id, linkedEntityType: 'contact', linkedEntityId: contact.id },
    });

    // Update extracted entity
    await this.prisma.client.extractedEntity.updateMany({
      where: { visualIntakeId: intake.id, businessId },
      data: {
        matchedEntityType: 'contact',
        matchedEntityId: contact.id,
        matchConfidence: 90,
        status: 'ACCEPTED',
      },
    });

    // Update visual intake
    await this.prisma.client.visualIntake.update({
      where: { id: intake.id },
      data: { status: 'ACCEPTED' },
    });

    // Create follow-up command
    await this.commands.create(businessId, {
      sourceModule: 'DEVICE',
      sourceType: 'business_card_follow_up',
      sourceId: intake.id,
      title: `Follow up with ${input.name ?? 'new contact'}`,
      description: `Contact created from business card. Company: ${input.company ?? 'unknown'}.`,
      category: 'SALES',
      actionType: 'follow_up',
      status: 'OPEN',
      priority: 70,
      urgency: 60,
      recommendedBy: 'SYSTEM',
    });

    // Timeline event
    await this.prisma.client.businessEvent.create({
      data: {
        businessId,
        eventType: 'contact_created_from_capture',
        subjectType: 'contact',
        subjectId: contact.id,
        actorType: 'human',
        actorId: _userId ?? 'system',
        action: 'create',
        source: 'web',
        metadata: { visualIntakeId: intake.id, name: input.name },
      },
    });

    return { contact, intake };
  }

  async listCaptures(
    businessId: string,
    filters?: { mediaType?: string; status?: string; contactId?: string; limit?: number; offset?: number },
  ) {
    const where: Record<string, unknown> = { businessId };
    if (filters?.mediaType) where.mediaType = filters.mediaType;
    if (filters?.status) where.status = filters.status;
    if (filters?.contactId) where.contactId = filters.contactId;

    const [items, total] = await Promise.all([
      this.prisma.client.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters?.limit ?? 50,
        skip: filters?.offset ?? 0,
      }),
      this.prisma.client.mediaAsset.count({ where }),
    ]);

    return { items, total };
  }

  async listVisualIntakes(
    businessId: string,
    filters?: { detectedType?: string; status?: string; limit?: number; offset?: number },
  ) {
    const where: Record<string, unknown> = { businessId };
    if (filters?.detectedType) where.detectedType = filters.detectedType;
    if (filters?.status) where.status = filters.status;

    const [items, total] = await Promise.all([
      this.prisma.client.visualIntake.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters?.limit ?? 50,
        skip: filters?.offset ?? 0,

      }),
      this.prisma.client.visualIntake.count({ where }),
    ]);

    return { items, total };
  }

  async getCapture(businessId: string, assetId: string) {
    const asset = await this.prisma.client.mediaAsset.findFirst({
      where: { id: assetId, businessId },
    });
    if (!asset) throw new NotFoundException('Capture not found');

    const intake = await this.prisma.client.visualIntake.findFirst({
      where: { mediaAssetId: assetId, businessId },
    });

    const entities = await this.prisma.client.extractedEntity.findMany({
      where: { mediaAssetId: assetId, businessId },
    });

    return { asset, intake, entities };
  }

  async approveIntake(businessId: string, intakeId: string, userId: string) {
    return this.prisma.client.visualIntake.update({
      where: { id: intakeId, businessId },
      data: { status: 'ACCEPTED', reviewedById: userId, reviewedAt: new Date() },
    });
  }

  async rejectIntake(businessId: string, intakeId: string, userId: string) {
    return this.prisma.client.visualIntake.update({
      where: { id: intakeId, businessId },
      data: { status: 'REJECTED', reviewedById: userId, reviewedAt: new Date() },
    });
  }

  // Voice session helpers
  async createVoiceSession(businessId: string, userId: string | null, mode = 'push_to_talk') {
    return this.prisma.client.voiceSession.create({
      data: {
        businessId,
        userId,
        mode,
        status: 'ACTIVE',
      },
    });
  }

  async endVoiceSession(businessId: string, sessionId: string, transcript?: string, summary?: string) {
    return this.prisma.client.voiceSession.update({
      where: { id: sessionId, businessId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        transcript: transcript ?? null,
        summary: summary ?? null,
      },
    });
  }

  async listVoiceSessions(businessId: string, limit = 50, offset = 0) {
    const [items, total] = await Promise.all([
      this.prisma.client.voiceSession.findMany({
        where: { businessId },
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.client.voiceSession.count({ where: { businessId } }),
    ]);
    return { items, total };
  }

  async getVoicePreferences(businessId: string, userId?: string) {
    const where: Record<string, unknown> = { businessId };
    if (userId) where.userId = userId;
    return this.prisma.client.keyVoicePreference.findMany({
      where,
      orderBy: { isDefault: 'desc' },
    });
  }

  async saveVoicePreference(
    businessId: string,
    userId: string | null,
    input: {
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
    if (input.isDefault) {
      await this.prisma.client.keyVoicePreference.updateMany({
        where: { businessId, userId },
        data: { isDefault: false },
      });
    }

    return this.prisma.client.keyVoicePreference.create({
      data: {
        businessId,
        userId,
        voiceKey: input.voiceKey,
        displayName: input.displayName,
        provider: input.provider,
        language: input.language ?? 'en',
        accent: input.accent ?? null,
        speakingRate: input.speakingRate ?? 1.0,
        pitch: input.pitch ?? 1.0,
        personality: input.personality ?? null,
        isDefault: input.isDefault ?? false,
      },
    });
  }
}
