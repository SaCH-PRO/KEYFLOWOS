import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ConnectorCredentialsService } from '../../core/connectors/connector-credentials.service';

@Injectable()
export class GoogleMapsService {
  private readonly logger = new Logger(GoogleMapsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConnectorCredentialsService) private readonly credentials: ConnectorCredentialsService,
  ) {}

  private async apiKey(businessId: string): Promise<string> {
    // Prefer the unified encrypted credentials store; fall back to the legacy
    // Business.googleMapsApiKey column for businesses that haven't re-saved
    // through the new connect dialog yet.
    const creds = await this.credentials.getCredentials(businessId, 'google_maps');
    if (creds?.apiKey?.trim()) return creds.apiKey.trim();
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { googleMapsApiKey: true },
    });
    if (!business?.googleMapsApiKey) {
      throw new BadRequestException('Google Maps API key not configured');
    }
    return business.googleMapsApiKey;
  }

  async setApiKey(businessId: string, key: string) {
    const trimmed = key.trim();
    // Write to both stores so existing read paths and the new connector
    // dashboard stay in sync.
    await this.credentials.setCredentials(businessId, 'google_maps', { apiKey: trimmed }, {
      accountLabel: 'API key configured',
    });
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { googleMapsApiKey: trimmed },
    });
  }

  async clearApiKey(businessId: string) {
    await this.credentials.clearCredentials(businessId, 'google_maps');
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { googleMapsApiKey: null },
    });
  }

  async autocomplete(
    businessId: string,
    input: string,
    opts: { sessionToken?: string; types?: string; components?: string } = {},
  ) {
    if (!input.trim()) return { predictions: [], status: 'OK' };
    const key = await this.apiKey(businessId);
    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    url.searchParams.set('input', input);
    url.searchParams.set('key', key);
    if (opts.sessionToken) url.searchParams.set('sessiontoken', opts.sessionToken);
    if (opts.types) url.searchParams.set('types', opts.types);
    if (opts.components) url.searchParams.set('components', opts.components);
    const res = await fetch(url.toString());
    if (!res.ok) throw new BadRequestException(`Maps API error ${res.status}`);
    return res.json();
  }

  async placeDetails(businessId: string, placeId: string, sessionToken?: string) {
    const key = await this.apiKey(businessId);
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('key', key);
    url.searchParams.set(
      'fields',
      'place_id,name,formatted_address,geometry,address_components,formatted_phone_number,website,types',
    );
    if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);
    const res = await fetch(url.toString());
    if (!res.ok) throw new BadRequestException(`Maps API error ${res.status}`);
    return res.json();
  }
}
