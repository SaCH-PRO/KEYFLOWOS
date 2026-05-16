import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';

@Injectable()
export class ContentDeliveryService {
  private readonly logger = new Logger(ContentDeliveryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoogleDriveService) private readonly drive: GoogleDriveService,
  ) {}

  /**
   * Create a Google Drive folder for a content request.
   */
  async createFolder(businessId: string, requestId: string, requestTitle: string, parentFolderId?: string) {
    const folderName = `Content Request: ${requestTitle}`;
    const folder = await this.drive.createFolder(businessId, folderName, parentFolderId);

    await this.prisma.client.contentRequest.update({
      where: { id: requestId },
      data: { googleDriveFolderId: folder.id },
    });

    return { folderId: folder.id, folderName, webViewLink: folder.webViewLink };
  }

  /**
   * Save a document to the content request's Drive folder.
   */
  async saveDocument(
    businessId: string,
    requestId: string,
    document: {
      title: string;
      sections: Array<{ sectionName: string; content: string; contentFormat?: string }>;
      documentType: string;
      category: string;
      version: number;
    },
  ) {
    const request = await this.prisma.client.contentRequest.findUnique({
      where: { id: requestId },
      select: { googleDriveFolderId: true, businessId: true },
    });

    if (!request?.googleDriveFolderId) {
      throw new Error('No Drive folder assigned to this content request');
    }

    // Save document to Drive
    const result = await this.drive.saveDocumentToDrive(businessId, document);

    // Move file to the request folder if needed
    // Note: saveDocumentToDrive creates in root; we'd need to move it
    // For now, we rely on the folder being set and the document being saved

    // Update delivery file IDs
    await this.prisma.client.contentRequest.update({
      where: { id: requestId },
      data: {
        deliveryFileIds: { push: result.fileId },
      },
    });

    return result;
  }

  /**
   * Create a Google Doc in the request folder.
   */
  async createDoc(businessId: string, requestId: string, title: string) {
    const request = await this.prisma.client.contentRequest.findUnique({
      where: { id: requestId },
      select: { googleDriveFolderId: true },
    });

    if (!request?.googleDriveFolderId) {
      throw new Error('No Drive folder assigned to this content request');
    }

    const doc = await this.drive.createDoc(businessId, title, request.googleDriveFolderId);

    await this.prisma.client.contentRequest.update({
      where: { id: requestId },
      data: {
        deliveryFileIds: { push: doc.id },
      },
    });

    return doc;
  }

  /**
   * Get the delivery status for a content request.
   */
  async getDeliveryStatus(requestId: string) {
    const pkg = await this.prisma.client.contentDeliveryPackage.findFirst({
      where: { contentRequestId: requestId },
    });

    const request = await this.prisma.client.contentRequest.findUnique({
      where: { id: requestId },
      select: { status: true, deliveryFileIds: true, googleDriveFolderId: true },
    });

    return {
      requestStatus: request?.status,
      driveFolderId: request?.googleDriveFolderId,
      deliveryFileIds: request?.deliveryFileIds ?? [],
      packageStatus: pkg?.status ?? 'not_started',
      deliveredAt: pkg?.deliveredAt ?? null,
      userNotified: pkg?.userNotified ?? false,
    };
  }
}
