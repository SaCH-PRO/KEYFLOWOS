import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleTokenHelper } from './google-token.helper';

@Injectable()
export class GoogleBusinessProfileService {
  private readonly logger = new Logger(GoogleBusinessProfileService.name);
  private readonly tokens: GoogleTokenHelper;

  constructor(private readonly prisma: PrismaService) {
    this.tokens = new GoogleTokenHelper(prisma);
  }

  private async accessToken(businessId: string): Promise<string> {
    return this.tokens.getValidAccessToken(
      businessId,
      { access: 'bpAccessToken', refresh: 'bpRefreshToken', expiry: 'bpTokenExpiry' },
      'Google Business Profile',
    );
  }

  async listAccounts(businessId: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async listLocations(businessId: string, accountId?: string) {
    const token = await this.accessToken(businessId);
    let account = accountId;
    if (!account) {
      const business = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { bpAccountId: true },
      });
      account = business?.bpAccountId ?? undefined;
    }
    if (!account) {
      // Pick first available account.
      const accounts = (await this.listAccounts(businessId)) as {
        accounts?: Array<{ name: string }>;
      };
      account = accounts.accounts?.[0]?.name?.replace('accounts/', '') ?? undefined;
    }
    if (!account) throw new BadRequestException('No Business Profile account found');

    const res = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(account)}/locations?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,categories`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async setActiveLocation(businessId: string, accountId: string, locationId: string) {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { bpAccountId: accountId, bpLocationId: locationId },
    });
    return { accountId, locationId };
  }

  async getLocation(businessId: string, locationName: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,categories,regularHours,profile`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async listPosts(businessId: string, locationName: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async createPost(
    businessId: string,
    locationName: string,
    post: { summary: string; callToAction?: { actionType: string; url: string } },
  ) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          languageCode: 'en',
          summary: post.summary,
          ...(post.callToAction ? { callToAction: post.callToAction } : {}),
          topicType: 'STANDARD',
        }),
      },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async listReviews(businessId: string, locationName: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/reviews`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async replyToReview(
    businessId: string,
    reviewName: string,
    comment: string,
  ) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }
}
