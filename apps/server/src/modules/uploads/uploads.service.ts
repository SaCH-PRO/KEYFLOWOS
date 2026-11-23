import { Injectable } from '@nestjs/common';
import { ObjectStorageService } from '../../core/object-storage';

@Injectable()
export class UploadsService {
  private objectStorage: ObjectStorageService;

  constructor() {
    this.objectStorage = new ObjectStorageService();
  }

  /** FU-ATTACHMENT-OBJECT-TENANCY: the issued path is bound to `businessId`. */
  async getUploadUrl(businessId: string): Promise<{ uploadURL: string; objectPath: string }> {
    const uploadURL = await this.objectStorage.getObjectEntityUploadURL(businessId);
    const objectPath = this.objectStorage.normalizeObjectEntityPath(uploadURL);
    return { uploadURL, objectPath };
  }
}
