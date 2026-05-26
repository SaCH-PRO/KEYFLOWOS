import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleDriveService } from './google-drive.service';

export interface UploadGeneratedDocInput {
  businessId: string;
  entityType: 'invoice' | 'quote' | 'expense' | 'payment' | 'journal' | 'report';
  entityId: string;
  fileName: string;
  mimeType: string;
  content: Buffer | string; // Buffer for binary, string for HTML
  contentFormat: 'binary' | 'html';
}

@Injectable()
export class GeneratedDocumentService {
  private readonly logger = new Logger(GeneratedDocumentService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoogleDriveService) private readonly drive: GoogleDriveService,
  ) {}

  /**
   * Upload a generated document to Google Drive and track it in the database.
   * Creates the folder hierarchy if it doesn't exist.
   */
  async uploadAndTrack(input: UploadGeneratedDocInput): Promise<{
    generatedDocumentId: string;
    driveFileId: string;
    webViewLink: string;
  }> {
    const { businessId, entityType, entityId, fileName, mimeType, content, contentFormat } = input;

    // 1. Ensure folder structure
    const folders = await this.drive.ensureBusinessDocumentFolders(businessId);
    const parentId = this.resolveParentFolder(folders, entityType);

    // 2. Upload to Drive
    let driveResult: { fileId: string; webViewLink: string };
    if (contentFormat === 'html') {
      driveResult = await this.drive.saveHtmlDocumentToDrive(
        businessId,
        fileName,
        content as string,
        parentId,
      );
    } else {
      const result = await this.drive.uploadFileToDrive(
        businessId,
        fileName,
        mimeType,
        content as Buffer,
        parentId,
      );
      driveResult = { fileId: result.fileId, webViewLink: result.webViewLink };
    }

    // 3. Track in database
    const folderPath = this.resolveFolderPath(entityType);
    const generatedDoc = await this.prisma.client.generatedDocument.create({
      data: {
        businessId,
        entityType,
        entityId,
        driveFileId: driveResult.fileId,
        fileName,
        mimeType: contentFormat === 'html' ? 'application/vnd.google-apps.document' : mimeType,
        folderPath,
      },
    });

    this.logger.log(
      `Generated document tracked: ${fileName} → Drive ${driveResult.fileId} (entity: ${entityType}/${entityId})`,
    );

    return {
      generatedDocumentId: generatedDoc.id,
      driveFileId: driveResult.fileId,
      webViewLink: driveResult.webViewLink,
    };
  }

  /**
   * Check if a document has already been uploaded for a given entity.
   */
  async exists(businessId: string, entityType: string, entityId: string): Promise<boolean> {
    const count = await this.prisma.client.generatedDocument.count({
      where: { businessId, entityType, entityId },
    });
    return count > 0;
  }

  /**
   * List generated documents for a business, optionally filtered by entity.
   */
  async list(
    businessId: string,
    filters?: { entityType?: string; entityId?: string; limit?: number; offset?: number },
  ) {
    return this.prisma.client.generatedDocument.findMany({
      where: {
        businessId,
        ...(filters?.entityType ? { entityType: filters.entityType } : {}),
        ...(filters?.entityId ? { entityId: filters.entityId } : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
  }

  private resolveParentFolder(
    folders: { rootId: string; revenueId: string; expensesId: string; booksId: string },
    entityType: string,
  ): string {
    switch (entityType) {
      case 'invoice':
      case 'quote':
        return folders.revenueId;
      case 'expense':
      case 'payment':
        return folders.expensesId;
      case 'journal':
        return folders.booksId;
      default:
        return folders.rootId;
    }
  }

  private resolveFolderPath(entityType: string): string {
    switch (entityType) {
      case 'invoice':
        return 'Revenue/Invoices';
      case 'quote':
        return 'Revenue/Quotes';
      case 'expense':
        return 'Expenses/Receipts';
      case 'payment':
        return 'Revenue/Receipts';
      case 'journal':
        return 'Books/Journal';
      default:
        return 'General';
    }
  }
}
