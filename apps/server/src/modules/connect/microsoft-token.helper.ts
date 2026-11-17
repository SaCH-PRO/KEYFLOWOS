import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { providerFailure } from '../../core/connectors/provider-failure';

/**
 * Helper for refreshing & retrieving valid access tokens for the Microsoft Graph
 * (Outlook) integration. Mirrors GoogleTokenHelper but talks to the Microsoft
 * identity platform v2 endpoints. Uses the "common" tenant so personal &
 * work/school accounts are both supported.
 *
 * W11-PROVIDER-OUTAGE-CONNECT (R-5 part 3; D-73): a refresh the identity
 * platform does not answer (5xx, 408, 429) is 503 provider_unavailable
 * (service microsoft); every other failure (invalid_grant, invalid_client:
 * reconnect) keeps its 400. The message is the existing one; no token is
 * written.
 *
 * FU-PROVIDER-ERROR-HYGIENE (D-221): that message is 'Failed to refresh
 * Outlook Contacts token', without the identity platform's body, which it
 * carried after a colon to the client in the 400 and the 503. The body is
 * still read, to classify the failure.
 */
export class MicrosoftTokenHelper {
  constructor(private readonly prisma: PrismaService) {}

  async getValidAccessToken(businessId: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        msContactsAccessToken: true,
        msContactsRefreshToken: true,
        msContactsTokenExpiry: true,
      },
    });
    if (!business) throw new BadRequestException('Business not found');
    const access = business.msContactsAccessToken;
    const refresh = business.msContactsRefreshToken;
    const expiry = business.msContactsTokenExpiry;
    if (!refresh) throw new BadRequestException('Outlook Contacts not connected');

    const isExpired = !expiry || Date.now() >= new Date(expiry).getTime() - 5 * 60 * 1000;
    if (!isExpired && access) return access;

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const tenant = process.env.MICROSOFT_TENANT || 'common';
    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'Microsoft OAuth not configured (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET missing)',
      );
    }

    const res = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refresh,
          grant_type: 'refresh_token',
          scope: 'Contacts.ReadWrite User.Read offline_access',
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw providerFailure('microsoft', res.status, body, 'Failed to refresh Outlook Contacts token');
    }
    const tokens = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const newExpiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        msContactsAccessToken: tokens.access_token,
        msContactsTokenExpiry: newExpiry,
        ...(tokens.refresh_token ? { msContactsRefreshToken: tokens.refresh_token } : {}),
      },
    });
    return tokens.access_token;
  }
}
