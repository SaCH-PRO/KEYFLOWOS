import { Injectable } from '@nestjs/common';
import { ObjectStorageService } from '../../replit_integrations/object_storage';

@Injectable()
export class UploadsService {
  private objectStorage: ObjectStorageService;

  constructor() {
    this.objectStorage = new ObjectStorageService();
  }

  async getUploadUrl(): Promise<{ uploadURL: string; objectPath: string }> {
    const uploadURL = await this.objectStorage.getObjectEntityUploadURL();
    const objectPath = this.objectStorage.normalizeObjectEntityPath(uploadURL);
    return { uploadURL, objectPath };
  }
}
