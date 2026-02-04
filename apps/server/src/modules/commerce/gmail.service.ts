import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';

interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface OAuthState {
  businessId: string;
  nonce: string;
  exp: number;
  purpose: 'gmail';
}

interface UserInfo {
  email: string;
  name?: string;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  private readonly clientId = process.env.GOOGLE_CLIENT_ID;
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private readonly redirectUri = process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI?.replace('/api/crm/google/callback', '/api/commerce/gmail/callback');
  private readonly stateSecret = process.env.GOOGLE_STATE_SECRET;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    if (!this.stateSecret) {
      this.logger.warn('GOOGLE_STATE_SECRET not configured - Gmail OAuth will not be secure');
    }
  }

  private ensureStateSecret(): string {
    if (!this.stateSecret) {
      throw new BadRequestException('Gmail OAuth state secret not configured');
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
        this.logger.warn('Invalid OAuth state signature');
        return null;
      }
      
      const state: OAuthState = JSON.parse(payload);
      if (state.exp < Date.now()) {
        this.logger.warn('OAuth state expired');
        return null;
      }
      
      return state;
    } catch {
      this.logger.warn('Failed to verify OAuth state');
      return null;
    }
  }

  getAuthUrl(businessId: string): string {
    if (!this.clientId) {
      throw new BadRequestException('Google OAuth not configured');
    }
    
    const state: OAuthState = {
      businessId,
      nonce: randomBytes(16).toString('hex'),
      exp: Date.now() + 10 * 60 * 1000,
      purpose: 'gmail',
    };
    
    const signedState = this.signState(state);
    
    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];
    
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri ?? '',
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: signedState,
    });
    
    return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<GoogleToken> {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Token exchange failed: ${error}`);
      throw new BadRequestException('Failed to exchange authorization code');
    }

    return response.json();
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleToken> {
    if (!this.clientId || !this.clientSecret) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new BadRequestException('Failed to refresh access token');
    }

    return response.json();
  }

  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new BadRequestException('Failed to get user info');
    }

    return response.json();
  }

  async saveGmailCredentials(businessId: string, code: string): Promise<{ email: string }> {
    const tokens = await this.exchangeCodeForTokens(code);
    const userInfo = await this.getUserInfo(tokens.access_token);

    const expiryDate = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        gmailEmail: userInfo.email,
        gmailAccessToken: tokens.access_token,
        gmailRefreshToken: tokens.refresh_token,
        gmailTokenExpiry: expiryDate,
      },
    });

    this.logger.log(`Gmail connected for business ${businessId}: ${userInfo.email}`);
    return { email: userInfo.email };
  }

  async disconnectGmail(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        gmailEmail: null,
        gmailAccessToken: null,
        gmailRefreshToken: null,
        gmailTokenExpiry: null,
      },
    });
    this.logger.log(`Gmail disconnected for business ${businessId}`);
  }

  async getGmailStatus(businessId: string): Promise<{ connected: boolean; email: string | null }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { gmailEmail: true, gmailRefreshToken: true },
    });

    return {
      connected: !!(business?.gmailEmail && business?.gmailRefreshToken),
      email: business?.gmailEmail ?? null,
    };
  }

  private async getValidAccessToken(businessId: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        gmailAccessToken: true,
        gmailRefreshToken: true,
        gmailTokenExpiry: true,
      },
    });

    if (!business?.gmailRefreshToken) {
      throw new BadRequestException('Gmail not connected');
    }

    const now = new Date();
    const expiry = business.gmailTokenExpiry ? new Date(business.gmailTokenExpiry) : null;
    const isExpired = !expiry || now >= new Date(expiry.getTime() - 5 * 60 * 1000);

    if (!isExpired && business.gmailAccessToken) {
      return business.gmailAccessToken;
    }

    const tokens = await this.refreshAccessToken(business.gmailRefreshToken);
    
    const newExpiry = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        gmailAccessToken: tokens.access_token,
        gmailTokenExpiry: newExpiry,
      },
    });

    return tokens.access_token;
  }

  private createMimeMessage(params: {
    from: string;
    to: string;
    subject: string;
    htmlBody: string;
  }): string {
    const boundary = 'boundary_' + Date.now();
    
    const message = [
      `From: ${params.from}`,
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(params.htmlBody).toString('base64'),
      '',
      `--${boundary}--`,
    ].join('\r\n');

    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async sendEmail(params: {
    businessId: string;
    to: string;
    subject: string;
    htmlBody: string;
  }): Promise<{ messageId: string }> {
    const accessToken = await this.getValidAccessToken(params.businessId);
    
    const business = await this.prisma.client.business.findUnique({
      where: { id: params.businessId },
      select: { gmailEmail: true, name: true },
    });

    if (!business?.gmailEmail) {
      throw new BadRequestException('Gmail not connected');
    }

    const from = business.name 
      ? `${business.name} <${business.gmailEmail}>`
      : business.gmailEmail;

    const raw = this.createMimeMessage({
      from,
      to: params.to,
      subject: params.subject,
      htmlBody: params.htmlBody,
    });

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to send email: ${error}`);
      throw new BadRequestException('Failed to send email');
    }

    const result = await response.json();
    this.logger.log(`Email sent: ${result.id}`);
    return { messageId: result.id };
  }
}
