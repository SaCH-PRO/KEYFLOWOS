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

  /**
   * R0-CMF6c review SEC-CMF6c-1: for the business mailbox (the gmail columns)
   * a refreshed access token is written back only onto the connection it was
   * refreshed for, as GmailService.getValidAccessToken does (R0-CMF6c). The
   * refresh is a network round trip with no lock held, and the owner can
   * disconnect the mailbox, connect another or re-consent meanwhile; the old
   * unconditional write then put the old mailbox's token on the new mailbox's
   * row, and GmailService read and sent for the new mailbox with it until it
   * expired. The write is a compare-and-set: in one short transaction that
   * first takes the business row lock GmailService.disconnectGmail and
   * confirmPendingConnection take (SELECT ... FOR NO KEY UPDATE), the row is
   * re-read through the Prisma token-encryption extension and written
   * (business.update, so the extension encrypts it; never updateMany, which
   * would store it in plaintext) only while gmail_refresh_token and
   * gmail_email are still the ones the refresh used. A lost race writes
   * nothing and reads again, once: no mailbox fails ("<label> was disconnected
   * while its access token was refreshed"); another connection's still-valid
   * token is returned (an expired one is refreshed for that connection; a
   * caller bound to a mailbox, such as the gmail sync, checks its binding
   * after the token read); a second lost race fails too. The other services'
   * columns keep the plain write-back.
   */
  async getValidAccessToken(businessId: string, fields: TokenFields, label: string): Promise<string> {
    const mailboxColumns = fields.refresh === 'gmailRefreshToken';
    for (let attempt = 1; ; attempt += 1) {
      const business = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: {
          [fields.access]: true,
          [fields.refresh]: true,
          [fields.expiry]: true,
          ...(mailboxColumns ? { gmailEmail: true } : {}),
        } as never,
      });
      if (!business) throw new BadRequestException('Business not found');
      const access = (business as Record<string, unknown>)[fields.access] as string | null;
      const refresh = (business as Record<string, unknown>)[fields.refresh] as string | null;
      const expiry = (business as Record<string, unknown>)[fields.expiry] as Date | null;
      if (!refresh) {
        throw new BadRequestException(
          attempt === 1 ? `${label} not connected` : `${label} was disconnected while its access token was refreshed`,
        );
      }

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

      if (!mailboxColumns) {
        await this.prisma.client.business.update({
          where: { id: businessId },
          data: { [fields.access]: tokens.access_token, [fields.expiry]: newExpiry } as never,
        });
        return tokens.access_token;
      }

      const refreshedFor = ((business as Record<string, unknown>).gmailEmail as string | null) ?? null;
      const written = await this.prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR NO KEY UPDATE`;
        const current = await tx.business.findUnique({
          where: { id: businessId },
          select: { gmailEmail: true, gmailRefreshToken: true },
        });
        if (
          !current?.gmailRefreshToken ||
          current.gmailRefreshToken !== refresh ||
          (current.gmailEmail ?? null) !== refreshedFor
        ) {
          return false;
        }
        await tx.business.update({
          where: { id: businessId },
          data: { [fields.access]: tokens.access_token, [fields.expiry]: newExpiry } as never,
        });
        return true;
      });
      if (written) return tokens.access_token;
      if (attempt >= 2) {
        throw new BadRequestException(`${label} was disconnected or replaced while its access token was refreshed`);
      }
    }
  }
}
