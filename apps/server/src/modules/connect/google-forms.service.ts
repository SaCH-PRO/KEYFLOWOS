import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleTokenHelper } from './google-token.helper';
import { providerFailure, readProviderFailureBody } from '../../core/connectors/provider-failure';

/**
 * W11-PROVIDER-OUTAGE-CONNECT (R-5 part 3; D-73): a Forms or Drive answer that
 * is an outage (5xx, 408, 429, a rate-limited 403, an ABORTED 409) is 503
 * provider_unavailable (service google_forms); a refusal keeps its 400. Every
 * message is the existing one.
 */
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
    if (!res.ok) {
      const body = await res.text();
      throw providerFailure('google_forms', res.status, body, `Forms API error ${res.status}: ${body}`);
    }
    return res.json();
  }

  async getForm(businessId: string, formId: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw providerFailure('google_forms', res.status, await readProviderFailureBody(res), `Forms API error ${res.status}`);
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
    if (!res.ok) throw providerFailure('google_forms', res.status, await readProviderFailureBody(res), `Forms API error ${res.status}`);
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
    if (!res.ok) throw providerFailure('google_forms', res.status, await readProviderFailureBody(res), `Drive API error ${res.status}`);
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
      throw providerFailure('google_forms', res.status, await readProviderFailureBody(res), `Drive delete failed: ${res.status}`);
    }
  }
}
