import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleTokenHelper } from './google-token.helper';

@Injectable()
export class GoogleFormsService {
  private readonly logger = new Logger(GoogleFormsService.name);
  private readonly tokens: GoogleTokenHelper;

  constructor(private readonly prisma: PrismaService) {
    this.tokens = new GoogleTokenHelper(prisma);
  }

  private async accessToken(businessId: string): Promise<string> {
    return this.tokens.getValidAccessToken(
      businessId,
      { access: 'formsAccessToken', refresh: 'formsRefreshToken', expiry: 'formsTokenExpiry' },
      'Google Forms',
    );
  }

  async createForm(businessId: string, title: string, description?: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch('https://forms.googleapis.com/v1/forms', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ info: { title, documentTitle: title, description } }),
    });
    if (!res.ok) throw new BadRequestException(`Forms API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async getForm(businessId: string, formId: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new BadRequestException(`Forms API error ${res.status}`);
    return res.json();
  }

  async listResponses(businessId: string, formId: string, pageToken?: string) {
    const token = await this.accessToken(businessId);
    const params = new URLSearchParams();
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new BadRequestException(`Forms API error ${res.status}`);
    return res.json();
  }

  /**
   * Forms doesn't have a native list-forms endpoint; the canonical way is to query
   * Drive for files of the Forms mimeType. This requires Drive scope (granted via
   * the unified Google sign-in).
   */
  async listForms(businessId: string, pageToken?: string) {
    const token = await this.tokens.getValidAccessToken(
      businessId,
      { access: 'driveAccessToken', refresh: 'driveRefreshToken', expiry: 'driveTokenExpiry' },
      'Google Drive (required to list Forms)',
    );
    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.form' and trashed=false",
      fields: 'nextPageToken,files(id,name,createdTime,modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: '50',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new BadRequestException(`Drive API error ${res.status}`);
    return res.json();
  }

  async deleteForm(businessId: string, formId: string) {
    const token = await this.tokens.getValidAccessToken(
      businessId,
      { access: 'driveAccessToken', refresh: 'driveRefreshToken', expiry: 'driveTokenExpiry' },
      'Google Drive (required to delete Forms)',
    );
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(formId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) {
      throw new BadRequestException(`Drive delete failed: ${res.status}`);
    }
  }
}
