import { Injectable, BadRequestException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { createHmac } from 'crypto';

interface OAuthState {
  businessId: string;
  nonce: string;
  exp: number;
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
  private readonly redirectUri = process.env.DRIVE_REDIRECT_URI || (process.env.GOOGLE_REDIRECT_URI ? process.env.GOOGLE_REDIRECT_URI.replace(/\/api\/[^/]+\/[^/]+\/callback/, '/api/drive/callback') : undefined);
  private readonly stateSecret = process.env.GOOGLE_STATE_SECRET;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
    };

    const signedState = this.signState(state);

    const scopes = [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri || '',
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: signedState,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async saveDriveCredentials(businessId: string, code: string): Promise<void> {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
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

  private async getValidAccessToken(businessId: string): Promise<string> {
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
}
