import { Injectable, BadRequestException, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { createHmac } from 'crypto';
import * as mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import { GoogleDriveConnector } from '../../core/connectors/implementations/google-drive.connector';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GDOC_MIME = 'application/vnd.google-apps.document';

const RICH_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    '*': ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
};

interface OAuthState {
  businessId: string;
  nonce: string;
  exp: number;
  flow?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  shared?: boolean;
  starred?: boolean;
}

export interface DriveListResult {
  files: DriveFile[];
  nextPageToken?: string;
}

@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);
  private readonly clientId = process.env.GOOGLE_CLIENT_ID;
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private readonly stateSecret = process.env.GOOGLE_STATE_SECRET;

  private getRedirectUri(): string {
    const explicit = process.env.DRIVE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
    if (explicit) return explicit;

    const base = process.env.OAUTH_REDIRECT_BASE || process.env.APP_URL || process.env.PUBLIC_BASE_URL;
    if (base) {
      const clean = base.replace(/\/$/, '');
      return `${clean}/api/drive/callback`;
    }

    if (process.env.NODE_ENV === 'development') {
      return 'http://localhost:5000/api/drive/callback';
    }

    throw new BadRequestException(
      'Drive redirect URI is not configured. Set DRIVE_REDIRECT_URI, GOOGLE_REDIRECT_URI, OAUTH_REDIRECT_BASE, or APP_URL.',
    );
  }

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(GoogleDriveConnector) private readonly driveConnector?: GoogleDriveConnector,
  ) {
    if (!this.stateSecret) {
      this.logger.warn('GOOGLE_STATE_SECRET not configured - Drive OAuth will not be secure');
    }
  }

  private ensureStateSecret(): string {
    if (!this.stateSecret) {
      throw new BadRequestException('Drive OAuth state secret not configured');
    }
    return this.stateSecret;
  }

  private signState(state: OAuthState): string {
    const secret = this.ensureStateSecret();
    const payload = JSON.stringify(state);
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    return Buffer.from(`${payload}.${signature}`).toString('base64');
  }

  verifyState(signedState: string): OAuthState | null {
    try {
      if (!this.stateSecret) {
        this.logger.error('Cannot verify state: GOOGLE_STATE_SECRET not configured');
        return null;
      }

      const decoded = Buffer.from(signedState, 'base64').toString('utf-8');
      const lastDotIndex = decoded.lastIndexOf('.');
      if (lastDotIndex === -1) return null;

      const payload = decoded.substring(0, lastDotIndex);
      const signature = decoded.substring(lastDotIndex + 1);

      const expectedSignature = createHmac('sha256', this.stateSecret).update(payload).digest('hex');
      if (signature !== expectedSignature) {
        this.logger.warn('Invalid Drive OAuth state signature');
        return null;
      }

      const state: OAuthState = JSON.parse(payload);
      if (state.exp < Date.now()) {
        this.logger.warn('Drive OAuth state expired');
        return null;
      }

      return state;
    } catch {
      this.logger.warn('Failed to verify Drive OAuth state');
      return null;
    }
  }

  getAuthUrl(businessId: string): string {
    if (!this.clientId) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const state: OAuthState = {
      businessId,
      nonce: Math.random().toString(36).substring(2),
      exp: Date.now() + 10 * 60 * 1000,
      flow: 'drive',
    };

    const signedState = this.signState(state);

    const scopes = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.getRedirectUri(),
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: signedState,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async saveDriveCredentials(businessId: string, code: string): Promise<void> {
    const redirectUri = this.getRedirectUri();

    if (!this.clientId || !this.clientSecret) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      this.logger.error('Failed to exchange code for Drive tokens', err);
      throw new BadRequestException('Failed to connect Google Drive');
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in || 3600;

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        driveEmail: userInfo.email || null,
        driveAccessToken: accessToken,
        driveRefreshToken: refreshToken,
        driveTokenExpiry: new Date(Date.now() + expiresIn * 1000),
      },
    });

    this.logger.log(`Google Drive connected for business ${businessId} (${userInfo.email})`);
  }

  async getValidAccessToken(businessId: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        driveAccessToken: true,
        driveRefreshToken: true,
        driveTokenExpiry: true,
      },
    });

    if (!business?.driveAccessToken) {
      throw new BadRequestException('Google Drive not connected');
    }

    const tokenExpiry = business.driveTokenExpiry ? new Date(business.driveTokenExpiry) : null;
    const isExpired = !tokenExpiry || tokenExpiry.getTime() - Date.now() < 60000;

    if (isExpired && business.driveRefreshToken) {
      return this.refreshAccessToken(businessId, business.driveRefreshToken);
    }

    return business.driveAccessToken;
  }

  private async refreshAccessToken(businessId: string, refreshToken: string): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      this.logger.error('Failed to refresh Drive token');
      throw new BadRequestException('Failed to refresh Google Drive connection. Please reconnect.');
    }

    const tokens = await res.json();
    const accessToken = tokens.access_token;
    const expiresIn = tokens.expires_in || 3600;

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        driveAccessToken: accessToken,
        driveTokenExpiry: new Date(Date.now() + expiresIn * 1000),
      },
    });

    return accessToken;
  }

  async getConnectionStatus(businessId: string): Promise<{ connected: boolean; email?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { driveEmail: true, driveAccessToken: true },
    });

    return {
      connected: !!business?.driveAccessToken,
      email: business?.driveEmail || undefined,
    };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        driveEmail: null,
        driveAccessToken: null,
        driveRefreshToken: null,
        driveTokenExpiry: null,
      },
    });
    this.logger.log(`Google Drive disconnected for business ${businessId}`);
  }

  async listFiles(
    businessId: string,
    options?: {
      pageToken?: string;
      query?: string;
      mimeType?: string;
      pageSize?: number;
      orderBy?: string;
    },
  ): Promise<DriveListResult> {
    const accessToken = await this.getValidAccessToken(businessId);
    const pageSize = options?.pageSize || 25;

    const qParts: string[] = ['trashed = false'];
    if (options?.query) {
      qParts.push(`name contains '${options.query.replace(/'/g, "\\'")}'`);
    }
    if (options?.mimeType) {
      if (options.mimeType === 'folder') {
        qParts.push("mimeType = 'application/vnd.google-apps.folder'");
      } else if (options.mimeType === 'document') {
        qParts.push("mimeType = 'application/vnd.google-apps.document'");
      } else if (options.mimeType === 'spreadsheet') {
        qParts.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
      } else if (options.mimeType === 'presentation') {
        qParts.push("mimeType = 'application/vnd.google-apps.presentation'");
      } else {
        qParts.push(`mimeType = '${options.mimeType}'`);
      }
    }

    const params = new URLSearchParams({
      pageSize: String(pageSize),
      fields: 'nextPageToken,files(id,name,mimeType,iconLink,thumbnailLink,webViewLink,modifiedTime,createdTime,size,owners,shared,starred)',
      q: qParts.join(' and '),
      orderBy: options?.orderBy || 'modifiedTime desc',
    });

    if (options?.pageToken) {
      params.set('pageToken', options.pageToken);
    }

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error('Failed to list Drive files', err);
      throw new BadRequestException('Failed to list Google Drive files');
    }

    const data = await res.json();
    return {
      files: data.files || [],
      nextPageToken: data.nextPageToken,
    };
  }

  async getFile(businessId: string, fileId: string): Promise<DriveFile> {
    const accessToken = await this.getValidAccessToken(businessId);

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,iconLink,thumbnailLink,webViewLink,modifiedTime,createdTime,size,owners,shared,starred`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!res.ok) {
      throw new BadRequestException('Failed to get file details');
    }

    return res.json();
  }

  async renameFile(
    businessId: string,
    fileId: string,
    newName: string,
  ): Promise<DriveFile> {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,modifiedTime`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      },
    );
    if (!res.ok) throw new BadRequestException(`Drive rename failed: ${res.status}`);
    return res.json();
  }

  async moveFile(
    businessId: string,
    fileId: string,
    addParents: string[] = [],
    removeParents: string[] = [],
  ): Promise<DriveFile> {
    const accessToken = await this.getValidAccessToken(businessId);
    const params = new URLSearchParams({
      fields: 'id,name,parents,webViewLink',
    });
    if (addParents.length) params.set('addParents', addParents.join(','));
    if (removeParents.length) params.set('removeParents', removeParents.join(','));
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) throw new BadRequestException(`Drive move failed: ${res.status}`);
    return res.json();
  }

  async trashFile(businessId: string, fileId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) throw new BadRequestException(`Drive trash failed: ${res.status}`);
  }

  async untrashFile(businessId: string, fileId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: false }),
    });
    if (!res.ok) throw new BadRequestException(`Drive untrash failed: ${res.status}`);
  }

  async deleteFile(businessId: string, fileId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 204) {
      throw new BadRequestException(`Drive delete failed: ${res.status}`);
    }
  }

  async shareFile(
    businessId: string,
    fileId: string,
    opts: {
      type: 'user' | 'group' | 'domain' | 'anyone';
      role: 'reader' | 'commenter' | 'writer' | 'owner';
      emailAddress?: string;
      domain?: string;
      sendNotification?: boolean;
    },
  ) {
    const accessToken = await this.getValidAccessToken(businessId);
    const params = new URLSearchParams();
    if (opts.sendNotification === false) params.set('sendNotificationEmail', 'false');
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?${params.toString()}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: opts.type,
          role: opts.role,
          emailAddress: opts.emailAddress,
          domain: opts.domain,
        }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new BadRequestException(`Drive share failed: ${res.status} ${err}`);
    }
    return res.json();
  }

  async createDoc(businessId: string, title: string, parentId?: string) {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: title,
        mimeType: 'application/vnd.google-apps.document',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    if (!res.ok) throw new BadRequestException(`Drive createDoc failed: ${res.status}`);
    return res.json();
  }

  async createSheet(businessId: string, title: string, parentId?: string) {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    if (!res.ok) throw new BadRequestException(`Drive createSheet failed: ${res.status}`);
    return res.json();
  }

  async createFolder(businessId: string, name: string, parentId?: string) {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    if (!res.ok) throw new BadRequestException(`Drive createFolder failed: ${res.status}`);
    return res.json();
  }

  /**
   * Find a folder by name under a parent, or create it if it doesn't exist.
   */
  async findOrCreateFolder(
    businessId: string,
    name: string,
    parentId?: string,
  ): Promise<{ id: string; name: string }> {
    const accessToken = await this.getValidAccessToken(businessId);
    const queryParts = [
      `mimeType = 'application/vnd.google-apps.folder'`,
      `name = '${name.replace(/'/g, "\\'")}'`,
      'trashed = false',
    ];
    if (parentId) queryParts.push(`'${parentId}' in parents`);

    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(queryParts.join(' and '))}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!searchRes.ok) throw new BadRequestException(`Drive folder search failed: ${searchRes.status}`);
    const searchData = await searchRes.json();
    if (searchData.files?.length > 0) {
      return { id: searchData.files[0].id, name: searchData.files[0].name };
    }
    return this.createFolder(businessId, name, parentId);
  }

  /**
   * Ensure the full KeyflowOS document folder hierarchy exists for a business.
   * Returns the root folder ID.
   */
  async ensureBusinessDocumentFolders(businessId: string): Promise<{ rootId: string; revenueId: string; expensesId: string; booksId: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    const businessName = business?.name || 'Business';

    const root = await this.findOrCreateFolder(businessId, `KeyflowOS — ${businessName}`);
    const revenue = await this.findOrCreateFolder(businessId, 'Revenue', root.id);
    const expenses = await this.findOrCreateFolder(businessId, 'Expenses', root.id);
    const books = await this.findOrCreateFolder(businessId, 'Books', root.id);

    // Sub-folders
    await this.findOrCreateFolder(businessId, 'Invoices', revenue.id);
    await this.findOrCreateFolder(businessId, 'Quotes', revenue.id);
    await this.findOrCreateFolder(businessId, 'Receipts', revenue.id);
    await this.findOrCreateFolder(businessId, 'Receipts', expenses.id);
    await this.findOrCreateFolder(businessId, 'Journal', books.id);

    return { rootId: root.id, revenueId: revenue.id, expensesId: expenses.id, booksId: books.id };
  }

  /**
   * Upload a binary file (e.g. PDF, image) to Google Drive.
   */
  async uploadFileToDrive(
    businessId: string,
    filename: string,
    mimeType: string,
    buffer: Buffer,
    parentId?: string,
  ): Promise<{ fileId: string; webViewLink: string; webContentLink: string }> {
    const accessToken = await this.getValidAccessToken(businessId);

    const metadata = {
      name: filename,
      mimeType,
      ...(parentId ? { parents: [parentId] } : {}),
    };

    const boundary = '-----keyflowos_file_boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!res.ok) {
      const err = await res.text();
      this.logger.error('Failed to upload file to Drive', err);
      throw new BadRequestException('Failed to upload file to Google Drive');
    }

    const file = await res.json();
    this.logger.log(`File "${filename}" uploaded to Drive as ${file.id}`);

    this.driveConnector?.emitFileUploaded(businessId, {
      fileName: filename,
      mimeType,
      url: file.webViewLink,
      externalId: file.id,
    }).catch((e) => this.logger.warn(`Drive connector event emission failed: ${e.message}`));

    return { fileId: file.id, webViewLink: file.webViewLink, webContentLink: file.webContentLink };
  }

  /**
   * Save an arbitrary HTML document as a Google Doc in Drive.
   * Useful for invoices, quotes, and other rendered HTML documents.
   */
  async saveHtmlDocumentToDrive(
    businessId: string,
    filename: string,
    htmlContent: string,
    parentId?: string,
  ): Promise<{ fileId: string; webViewLink: string }> {
    const accessToken = await this.getValidAccessToken(businessId);

    const metadata = {
      name: filename,
      mimeType: 'application/vnd.google-apps.document',
      ...(parentId ? { parents: [parentId] } : {}),
    };

    const boundary = '-----keyflowos_multipart_boundary';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlContent,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!res.ok) {
      const err = await res.text();
      this.logger.error('Failed to save HTML document to Drive', err);
      throw new BadRequestException('Failed to save document to Google Drive');
    }

    const file = await res.json();
    this.logger.log(`HTML document "${filename}" saved to Drive as ${file.id}`);

    this.driveConnector?.emitFileUploaded(businessId, {
      fileName: filename,
      mimeType: 'application/vnd.google-apps.document',
      url: file.webViewLink,
      externalId: file.id,
    }).catch((e) => this.logger.warn(`Drive connector event emission failed: ${e.message}`));

    return { fileId: file.id, webViewLink: file.webViewLink };
  }

  async saveDocumentToDrive(
    businessId: string,
    document: {
      title: string;
      sections: Array<{ sectionName: string; content: string; contentFormat?: string }>;
      documentType: string;
      category: string;
      version: number;
    },
  ): Promise<{ fileId: string; webViewLink: string }> {
    const accessToken = await this.getValidAccessToken(businessId);

    const htmlContent = this.buildDocumentHtml(document);

    const metadata = {
      name: `${document.title} (v${document.version})`,
      mimeType: 'application/vnd.google-apps.document',
      description: `${document.category} — ${document.documentType} | Generated by KeyflowOS`,
    };

    const boundary = '-----keyflowos_multipart_boundary';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlContent,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!res.ok) {
      const err = await res.text();
      this.logger.error('Failed to save document to Drive', err);
      throw new BadRequestException('Failed to save document to Google Drive');
    }

    const file = await res.json();
    this.logger.log(`Document "${document.title}" saved to Drive as ${file.id}`);

    this.driveConnector?.emitFileUploaded(businessId, {
      fileName: `${document.title} (v${document.version})`,
      mimeType: 'application/vnd.google-apps.document',
      url: file.webViewLink,
      externalId: file.id,
    }).catch((e) => this.logger.warn(`Drive connector event emission failed: ${e.message}`));

    return { fileId: file.id, webViewLink: file.webViewLink };
  }

  buildDocumentHtml(document: {
    title: string;
    sections: Array<{ sectionName: string; content: string; contentFormat?: string }>;
    documentType: string;
    category: string;
    version: number;
  }): string {
    const sectionsHtml = document.sections
      .map((s) => {
        const isHtml = s.contentFormat === 'HTML';
        const body = isHtml
          ? `<div style="line-height:1.7;color:#444;">${this.sanitizeRichHtml(s.content)}</div>`
          : `<div style="white-space:pre-wrap;line-height:1.7;color:#444;">${this.escapeHtml(s.content)}</div>`;
        return `<h2 style="color:#333;border-bottom:1px solid #e5e5e5;padding-bottom:8px;margin-top:28px;">${this.escapeHtml(s.sectionName)}</h2>\n${body}`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${this.escapeHtml(document.title)}</title></head>
<body style="font-family:'Google Sans',Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px 24px;color:#333;">
  <div style="margin-bottom:32px;">
    <h1 style="margin:0 0 8px 0;font-size:28px;color:#111;">${this.escapeHtml(document.title)}</h1>
    <p style="margin:0;font-size:13px;color:#888;">${this.escapeHtml(document.category)} · ${this.escapeHtml(document.documentType)} · Version ${document.version}</p>
    <p style="margin:4px 0 0 0;font-size:12px;color:#aaa;">Generated by KeyflowOS · ${new Date().toLocaleDateString('en-TT', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
  </div>
  ${sectionsHtml}
  <div style="margin-top:40px;padding-top:16px;border-top:2px solid #e5e5e5;font-size:11px;color:#aaa;text-align:center;">
    This document was generated by KeyflowOS Business Documentation Engine
  </div>
</body>
</html>`;
  }

  private sanitizeRichHtml(html: string): string {
    return sanitizeHtml(html || '', RICH_HTML_SANITIZE_OPTIONS);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Fetch a Drive file's content as HTML (or text). For Google Docs, uses
   * the export API to get HTML. For text/html and text/plain files we
   * download via alt=media. For .docx (Word) files we download the binary
   * via alt=media and convert to HTML with `mammoth`.
   */
  /**
   * Download a binary file (PDF, image, etc.) from Drive and return as base64.
   */
  async downloadBinary(
    businessId: string,
    fileId: string,
  ): Promise<{ base64: string; mimeType: string; name: string }> {
    const accessToken = await this.getValidAccessToken(businessId);
    const meta = await this.getFile(businessId, fileId);

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const err = await res.text();
      this.logger.error('Failed to download Drive binary', err);
      throw new BadRequestException('Failed to download file from Drive');
    }
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const base64 = buffer.toString('base64');
    return { base64, mimeType: meta.mimeType, name: meta.name };
  }

  async getFileContent(
    businessId: string,
    fileId: string,
  ): Promise<{ html: string; mimeType: string; name: string }> {
    const accessToken = await this.getValidAccessToken(businessId);

    const meta = await this.getFile(businessId, fileId);
    const mimeType = meta.mimeType;

    if (mimeType === 'application/vnd.google-apps.document') {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/html`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        const err = await res.text();
        this.logger.error('Failed to export Google Doc', err);
        throw new BadRequestException('Failed to load Google Doc contents');
      }
      const html = await res.text();
      return { html, mimeType, name: meta.name };
    }

    if (mimeType === 'text/html' || mimeType === 'text/plain') {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        throw new BadRequestException('Failed to download Drive file');
      }
      const body = await res.text();
      const html =
        mimeType === 'text/plain'
          ? `<div style="white-space:pre-wrap;">${this.escapeHtml(body)}</div>`
          : body;
      return { html, mimeType, name: meta.name };
    }

    if (mimeType === DOCX_MIME) {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        const err = await res.text();
        this.logger.error('Failed to download .docx file', err);
        throw new BadRequestException('Failed to download Word document');
      }
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      try {
        const result = await mammoth.convertToHtml({ buffer });
        const body = result.value || '';
        const html = `<div class="docx-body">${body}</div>`;
        if (result.messages?.length) {
          this.logger.debug(
            `mammoth conversion notes for ${fileId}: ${result.messages
              .slice(0, 5)
              .map((m) => m.message)
              .join('; ')}`,
          );
        }
        return { html, mimeType, name: meta.name };
      } catch (err) {
        this.logger.error('Failed to convert .docx with mammoth', err as Error);
        throw new BadRequestException(
          'Could not read this Word document. It may be password-protected or corrupted.',
        );
      }
    }

    throw new BadRequestException(
      `Unsupported file type for editing: ${mimeType}. Only Google Docs, HTML, and text files can be opened in the editor.`,
    );
  }

  /**
   * Write a new HTML body back to an existing Drive file. For Google Docs we
   * upload as text/html and Drive performs the server-side conversion.
   */
  async updateFileContent(
    businessId: string,
    fileId: string,
    html: string,
  ): Promise<{ fileId: string; webViewLink?: string; modifiedTime?: string }> {
    const accessToken = await this.getValidAccessToken(businessId);

    const meta = await this.getFile(businessId, fileId);
    const targetMime = meta.mimeType;

    // .docx: re-upload as HTML and ask Drive to convert the file in place to
    // a native Google Doc. This "upgrades" the file so subsequent edits
    // round-trip cleanly through the Google Docs export pipeline.
    if (targetMime === DOCX_MIME) {
      const boundary = '-----keyflowos_docx_upgrade_boundary';
      const metadata = { mimeType: GDOC_MIME };
      const multipart = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        '',
        html,
        `--${boundary}--`,
      ].join('\r\n');

      const upgradeRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,webViewLink,modifiedTime,mimeType`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipart,
        },
      );

      if (!upgradeRes.ok) {
        const err = await upgradeRes.text();
        this.logger.error('Failed to upgrade .docx to Google Doc', err);
        throw new BadRequestException('Failed to save Word document changes back to Google Drive');
      }

      const data = await upgradeRes.json();
      return {
        fileId: data.id || fileId,
        webViewLink: data.webViewLink,
        modifiedTime: data.modifiedTime,
      };
    }

    // Google Docs: send as text/html and Drive will convert.
    // text/html and text/plain: send as-is.
    const uploadMime =
      targetMime === GDOC_MIME
        ? 'text/html'
        : targetMime === 'text/plain'
          ? 'text/plain'
          : 'text/html';

    const body =
      uploadMime === 'text/plain'
        ? this.htmlToPlainText(html)
        : html;

    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,webViewLink,modifiedTime`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': uploadMime,
        },
        body,
      },
    );

    if (!res.ok) {
      const err = await res.text();
      this.logger.error('Failed to update Drive file content', err);
      throw new BadRequestException('Failed to save changes back to Google Drive');
    }

    const data = await res.json();
    return {
      fileId: data.id || fileId,
      webViewLink: data.webViewLink,
      modifiedTime: data.modifiedTime,
    };
  }

  private htmlToPlainText(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<br\s*\/?>(?!\n)/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  getEmbedUrl(fileId: string, mimeType: string): string {
    if (mimeType === 'application/vnd.google-apps.document') {
      return `https://docs.google.com/document/d/${fileId}/preview`;
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      return `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
    } else if (mimeType === 'application/vnd.google-apps.presentation') {
      return `https://docs.google.com/presentation/d/${fileId}/preview`;
    } else {
      return `https://drive.google.com/file/d/${fileId}/preview`;
    }
  }

  async getInventorySheetSyncStatus(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { inventoryLinkedSheetId: true, inventoryLinkedSheetName: true, inventoryLastSyncAt: true, driveAccessToken: true },
    });

    return {
      connected: !!business?.driveAccessToken,
      linkedSheetId: business?.inventoryLinkedSheetId || null,
      linkedSheetName: business?.inventoryLinkedSheetName || null,
      lastSyncAt: business?.inventoryLastSyncAt || null,
    };
  }

  async linkInventorySheet(businessId: string, sheetId: string, sheetName: string) {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { inventoryLinkedSheetId: sheetId, inventoryLinkedSheetName: sheetName },
    });
    return { success: true, sheetId, sheetName };
  }

  async unlinkInventorySheet(businessId: string) {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { inventoryLinkedSheetId: null, inventoryLinkedSheetName: null, inventoryLastSyncAt: null },
    });
    return { success: true };
  }

  async createInventorySheet(businessId: string, title: string): Promise<{ fileId: string; webViewLink: string; name: string }> {
    const accessToken = await this.getValidAccessToken(businessId);

    const metadata = {
      name: title || 'Inventory Sync',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      description: 'Inventory sync sheet managed by KeyflowOS',
    };

    const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error('Failed to create inventory sheet', err);
      throw new BadRequestException('Failed to create Google Sheet — check Drive permissions');
    }

    const file = await res.json();

    const headers = [['SKU', 'Product Name', 'Warehouse', 'Quantity On Hand', 'Reserved', 'Available', 'Reorder Level', 'Cost Per Unit', 'Currency', 'Status', 'Last Updated']];
    await this.writeSheetValues(accessToken, file.id, 'Sheet1', 'A1', headers);

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { inventoryLinkedSheetId: file.id, inventoryLinkedSheetName: file.name },
    });

    this.logger.log(`Created inventory sheet ${file.id} for business ${businessId}`);
    return { fileId: file.id, webViewLink: file.webViewLink, name: file.name };
  }

  private async writeSheetValues(accessToken: string, spreadsheetId: string, sheetName: string, range: string, values: any[][]) {
    const fullRange = `${sheetName}!${range}`;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(fullRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      this.logger.error('Failed to write sheet values', err);
      throw new BadRequestException('Failed to write to Google Sheet — check permissions and sheet access');
    }
    return res.json();
  }

  private async clearSheetValues(accessToken: string, spreadsheetId: string, sheetName: string) {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    if (!res.ok) {
      const err = await res.text();
      this.logger.warn('Failed to clear sheet values before push', err);
    }
  }

  private async readSheetValues(accessToken: string, spreadsheetId: string, range: string): Promise<any[][]> {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const err = await res.text();
      this.logger.error('Failed to read sheet values', err);
      throw new BadRequestException('Failed to read from Google Sheet — check sheet ID and permissions');
    }
    const data = await res.json();
    return data.values || [];
  }

  async pushInventoryToSheet(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { inventoryLinkedSheetId: true },
    });
    if (!business?.inventoryLinkedSheetId) throw new BadRequestException('No linked inventory sheet. Please link a Google Sheet first.');

    const [inventory, products, warehouses] = await Promise.all([
      this.prisma.client.inventoryStock.findMany({
        where: { businessId },
        include: { product: true, warehouse: true },
      }),
      this.prisma.client.product.findMany({ where: { businessId, deletedAt: null } }),
      this.prisma.client.warehouse.findMany({ where: { businessId, isActive: true } }),
    ]);

    const accessToken = await this.getValidAccessToken(businessId);
    const sheetId = business.inventoryLinkedSheetId;

    const now = new Date().toISOString();
    const rows: any[][] = [
      ['SKU', 'Product Name', 'Warehouse', 'Quantity On Hand', 'Reserved', 'Available', 'Reorder Level', 'Cost Per Unit', 'Currency', 'Status', 'Last Updated'],
    ];

    type InvWithRelations = typeof inventory[0] & { product: { sku?: string | null; name: string } | null; warehouse: { name: string } | null };
    for (const inv of inventory as InvWithRelations[]) {
      const product = inv.product;
      const warehouse = inv.warehouse;
      const available = inv.quantity - inv.reserved;
      const status = inv.quantity <= 0 ? 'Out of Stock' : (inv.reorderAt && inv.quantity <= inv.reorderAt ? 'Low Stock' : 'In Stock');
      const invRow = inv as typeof inv & { costPerUnit?: number | null; currency?: string | null };
      rows.push([
        product?.sku || '',
        product?.name || '',
        warehouse?.name || '',
        inv.quantity,
        inv.reserved,
        available,
        inv.reorderAt ?? '',
        invRow.costPerUnit ?? '',
        invRow.currency || 'TTD',
        status,
        now,
      ]);
    }

    await this.clearSheetValues(accessToken, sheetId, 'Sheet1');
    await this.writeSheetValues(accessToken, sheetId, 'Sheet1', 'A1', rows);
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { inventoryLastSyncAt: new Date() },
    });

    this.logger.log(`Pushed ${inventory.length} inventory records to sheet ${sheetId}`);
    return { success: true, rowsPushed: inventory.length, syncedAt: now };
  }

  async pullInventoryFromSheet(businessId: string): Promise<{ rows: Record<string, string>[]; headers: string[] }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { inventoryLinkedSheetId: true },
    });
    if (!business?.inventoryLinkedSheetId) throw new BadRequestException('No linked inventory sheet. Please link a Google Sheet first.');

    const accessToken = await this.getValidAccessToken(businessId);
    const values = await this.readSheetValues(accessToken, business.inventoryLinkedSheetId, 'Sheet1');

    if (values.length < 2) return { rows: [], headers: [] };

    const headers = values[0].map((h: string) => String(h).trim());
    const rows = values.slice(1).map((row: any[]) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? String(row[i]) : ''; });
      return obj;
    });

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { inventoryLastSyncAt: new Date() },
    });

    return { rows, headers };
  }

  async generateInventorySheetDiff(businessId: string): Promise<{
    conflicts: Array<{
      sku: string; productName: string; warehouseName: string;
      systemQty: number | null; sheetQty: number;
      systemReorderAt: number | null; sheetReorderAt: number | null;
      hasConflict: boolean; isNew: boolean;
    }>;
    unchanged: number;
  }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { inventoryLinkedSheetId: true },
    });
    if (!business?.inventoryLinkedSheetId) throw new BadRequestException('No linked inventory sheet. Please link a Google Sheet first.');

    const accessToken = await this.getValidAccessToken(businessId);
    const values = await this.readSheetValues(accessToken, business.inventoryLinkedSheetId, 'Sheet1');
    if (values.length < 2) return { conflicts: [], unchanged: 0 };

    const headers = values[0].map((h: string) => String(h).trim());
    const sheetRows = values.slice(1).map((row: any[]) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? String(row[i]) : ''; });
      return obj;
    });

    const [systemInventory, products, warehouses] = await Promise.all([
      this.prisma.client.inventoryStock.findMany({ where: { businessId }, include: { product: true, warehouse: true } }),
      this.prisma.client.product.findMany({ where: { businessId, deletedAt: null }, select: { id: true, name: true, sku: true } }),
      this.prisma.client.warehouse.findMany({ where: { businessId, isActive: true } }),
    ]);

    const systemMap: Record<string, any> = {};
    for (const inv of systemInventory) {
      const key = `${inv.product?.sku || inv.product?.name}|${inv.warehouse?.name}`.toLowerCase();
      systemMap[key] = inv;
    }

    const conflicts: Array<any> = [];
    let unchanged = 0;

    for (const row of sheetRows) {
      const sku = String(row['SKU'] || '').trim();
      const productName = String(row['Product Name'] || '').trim();
      const warehouseName = String(row['Warehouse'] || '').trim();
      const sheetQty = parseInt(row['Quantity On Hand'] ?? '', 10);
      const sheetReorderAt = row['Reorder Level'] ? parseInt(row['Reorder Level'], 10) : null;

      if (isNaN(sheetQty)) continue;

      const lookupKey = `${sku || productName}|${warehouseName}`.toLowerCase();
      const systemRecord = systemMap[lookupKey];

      if (!systemRecord) {
        conflicts.push({ sku, productName, warehouseName, systemQty: null, sheetQty, systemReorderAt: null, sheetReorderAt, hasConflict: true, isNew: true });
      } else if (systemRecord.quantity !== sheetQty || systemRecord.reorderAt !== sheetReorderAt) {
        conflicts.push({
          sku: sku || systemRecord.product?.sku || '',
          productName: productName || systemRecord.product?.name || '',
          warehouseName: warehouseName || systemRecord.warehouse?.name || '',
          systemQty: systemRecord.quantity,
          sheetQty,
          systemReorderAt: systemRecord.reorderAt,
          sheetReorderAt,
          hasConflict: true,
          isNew: false,
        });
      } else {
        unchanged++;
      }
    }

    return { conflicts, unchanged };
  }

  async applyPulledInventory(businessId: string, rows: Record<string, string>[], userId?: string): Promise<{ applied: number; skipped: number; errors: string[] }> {
    const warehouses = await this.prisma.client.warehouse.findMany({ where: { businessId, isActive: true } });
    const products = await this.prisma.client.product.findMany({ where: { businessId, deletedAt: null }, select: { id: true, name: true, sku: true } });

    const whByName = Object.fromEntries(warehouses.map((w: any) => [w.name.toLowerCase(), w]));
    const prodBySku = Object.fromEntries(products.filter((p: any) => p.sku).map((p: any) => [p.sku!.toLowerCase(), p]));
    const prodByName = Object.fromEntries(products.map((p: any) => [p.name.toLowerCase(), p]));

    const results = { applied: 0, skipped: 0, errors: [] as string[] };

    for (const row of rows) {
      try {
        const sku = String(row['SKU'] || '').trim();
        const productName = String(row['Product Name'] || '').trim();
        const warehouseName = String(row['Warehouse'] || '').trim();
        const qty = parseInt(row['Quantity On Hand'] ?? '', 10);
        const reorderLevel = row['Reorder Level'] ? parseInt(row['Reorder Level'], 10) : undefined;
        const costPerUnit = row['Cost Per Unit'] ? parseFloat(row['Cost Per Unit']) : undefined;

        if (isNaN(qty) || qty < 0) { results.errors.push(`Row skipped: invalid quantity for ${sku || productName}`); results.skipped++; continue; }

        const product = (sku && prodBySku[sku.toLowerCase()]) || (productName && prodByName[productName.toLowerCase()]);
        if (!product) { results.errors.push(`Product not found: ${sku || productName}`); results.skipped++; continue; }

        const warehouse = warehouseName ? whByName[warehouseName.toLowerCase()] : warehouses[0];
        if (!warehouse) { results.errors.push(`Warehouse not found: ${warehouseName}`); results.skipped++; continue; }

        const productId = product.id;
        const existing = await this.prisma.client.inventoryStock.findUnique({
          where: { productId_warehouseId: { productId, warehouseId: warehouse.id } },
        });

        const previousQty = existing?.quantity ?? null;

        if (existing) {
          await this.prisma.client.inventoryStock.update({
            where: { id: existing.id },
            data: {
              quantity: qty,
              ...(reorderLevel !== undefined && !isNaN(reorderLevel) ? { reorderAt: reorderLevel } : {}),
              ...(costPerUnit !== undefined && !isNaN(costPerUnit) ? { costPerUnit } : {}),
            },
          });
        } else {
          await this.prisma.client.inventoryStock.create({
            data: {
              businessId,
              productId,
              warehouseId: warehouse.id,
              quantity: qty,
              reserved: 0,
              currency: 'TTD',
              ...(reorderLevel !== undefined && !isNaN(reorderLevel) ? { reorderAt: reorderLevel } : {}),
              ...(costPerUnit !== undefined && !isNaN(costPerUnit) ? { costPerUnit } : {}),
            },
          });
        }

        const qtyChange = previousQty !== null ? qty - previousQty : qty;
        if (qtyChange !== 0) {
          await this.prisma.client.stockMovement.create({
            data: {
              businessId,
              warehouseId: warehouse.id,
              productId,
              type: 'ADJUSTMENT',
              quantityChange: qtyChange,
              reasonCode: 'SHEET_SYNC',
              note: `Google Sheets sync: ${sku || productName}${previousQty !== null ? ` (was ${previousQty})` : ' (new)'}`,
              createdBy: userId,
            },
          });
        }

        results.applied++;
      } catch (err: any) {
        results.errors.push(err.message);
        results.skipped++;
      }
    }

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { inventoryLastSyncAt: new Date() },
    });

    return results;
  }
}
