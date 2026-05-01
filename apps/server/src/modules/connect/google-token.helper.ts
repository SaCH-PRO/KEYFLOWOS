import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

type TokenFields = {
  access: 'gmailAccessToken' | 'calendarAccessToken' | 'driveAccessToken' | 'formsAccessToken' | 'contactsAccessToken' | 'bpAccessToken';
  refresh: 'gmailRefreshToken' | 'calendarRefreshToken' | 'driveRefreshToken' | 'formsRefreshToken' | 'contactsRefreshToken' | 'bpRefreshToken';
  expiry: 'gmailTokenExpiry' | 'calendarTokenExpiry' | 'driveTokenExpiry' | 'formsTokenExpiry' | 'contactsTokenExpiry' | 'bpTokenExpiry';
};

/**
 * Helper for refreshing & retrieving valid access tokens for any per-service Google
 * connector that uses the standard {access,refresh,expiry} column triplet.
 */
export class GoogleTokenHelper {
  constructor(private readonly prisma: PrismaService) {}

  async getValidAccessToken(businessId: string, fields: TokenFields, label: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { [fields.access]: true, [fields.refresh]: true, [fields.expiry]: true } as never,
    });
    if (!business) throw new BadRequestException('Business not found');
    const access = (business as Record<string, unknown>)[fields.access] as string | null;
    const refresh = (business as Record<string, unknown>)[fields.refresh] as string | null;
    const expiry = (business as Record<string, unknown>)[fields.expiry] as Date | null;
    if (!refresh) throw new BadRequestException(`${label} not connected`);

    const isExpired = !expiry || Date.now() >= new Date(expiry).getTime() - 5 * 60 * 1000;
    if (!isExpired && access) return access;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new BadRequestException('Google OAuth not configured');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new BadRequestException(`Failed to refresh ${label} token: ${err}`);
    }
    const tokens = (await res.json()) as { access_token: string; expires_in?: number };
    const newExpiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { [fields.access]: tokens.access_token, [fields.expiry]: newExpiry } as never,
    });
    return tokens.access_token;
  }
}
