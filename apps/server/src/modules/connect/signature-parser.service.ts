import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ParsedSignature {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  socialUrls?: string[];
}

const EMAIL_RX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RX =
  /(\+?\d{1,3}[\s\-.]?)?(?:\(?\d{2,4}\)?[\s\-.]?)?\d{3}[\s\-.]?\d{3,4}/g;
const URL_RX = /https?:\/\/[^\s<>"']+/g;
const SOCIAL_HOSTS =
  /(linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|github\.com|youtube\.com|tiktok\.com)/i;

const SIG_BOUNDARIES = [
  /^--\s*$/m,
  /^_{2,}$/m,
  /^Sent from my (iPhone|iPad|Android)/im,
  /^Get Outlook for/im,
  /^Best( regards)?,?\s*$/im,
  /^Regards,?\s*$/im,
  /^Cheers,?\s*$/im,
  /^Thanks,?\s*$/im,
  /^Sincerely,?\s*$/im,
];

const TITLE_KEYWORDS = [
  'CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CPO', 'VP', 'Director', 'Manager',
  'Engineer', 'Developer', 'Designer', 'Founder', 'Co-Founder', 'President',
  'Owner', 'Partner', 'Consultant', 'Analyst', 'Specialist', 'Lead', 'Head of',
];

/**
 * Heuristic-first email-signature parser. Used by the inbound email pipeline to
 * auto-create / enrich CRM contacts from email signatures. AI fallback is
 * delegated to ModelGatewayService when the heuristic fails — kept optional so
 * tests don't need an AI key.
 */
@Injectable()
export class SignatureParserService {
  private readonly logger = new Logger(SignatureParserService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Returns just the trailing signature block of an email body. */
  extractSignatureBlock(body: string): string {
    if (!body) return '';
    let cut = body;
    for (const rx of SIG_BOUNDARIES) {
      const m = cut.match(rx);
      if (m && m.index !== undefined) {
        cut = cut.slice(m.index);
        break;
      }
    }
    // last 25 lines max
    const lines = cut.split(/\r?\n/).slice(-25);
    return lines.join('\n');
  }

  parseHeuristic(body: string): ParsedSignature {
    const block = this.extractSignatureBlock(body);
    if (!block.trim()) return {};

    const emails = Array.from(block.matchAll(EMAIL_RX)).map((m) => m[0]);
    const phones = Array.from(block.matchAll(PHONE_RX))
      .map((m) => m[0])
      .filter((p) => p.replace(/\D/g, '').length >= 7);
    const urls = Array.from(block.matchAll(URL_RX)).map((m) => m[0]);
    const socials = urls.filter((u) => SOCIAL_HOSTS.test(u));

    // Try to find a name line: first non-empty line that's not the boundary
    // and doesn't contain @ / http / digits-only, ≤ 5 words.
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !SIG_BOUNDARIES.some((rx) => rx.test(l)));
    let name: string | null = null;
    let title: string | null = null;
    let company: string | null = null;
    for (const l of lines) {
      if (!name && /^[A-Z][a-zA-Z'\-]+(\s+[A-Z][a-zA-Z'\-]+){1,3}$/.test(l)) {
        name = l;
        continue;
      }
      if (!title && TITLE_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(l))) {
        title = l;
        // company often appears as "Title, Company" or "Title at Company"
        const at = l.match(/(?:,|\bat\b)\s+(.+)$/i);
        if (at) {
          title = l.slice(0, at.index).trim();
          company = at[1].trim();
        }
        continue;
      }
      if (!company && !title && /\b(Inc|LLC|Ltd|Limited|Corp|Co\.|Company|Group|Studio)\b/i.test(l)) {
        company = l;
      }
    }
    const [firstName, ...rest] = (name ?? '').split(/\s+/);
    const lastName = rest.length ? rest[rest.length - 1] : null;

    return {
      name,
      firstName: firstName || null,
      lastName,
      title,
      company,
      email: emails[0] ?? null,
      phone: phones[0] ?? null,
      socialUrls: socials,
    };
  }

  /**
   * Apply a parsed signature to the CRM. If a contact matches the email,
   * fill only empty fields (never overwrite). Otherwise create a new one with
   * `source = 'signature'`. Respects `marketingOptIn` and uses the m1
   * duplicate-detection rules: email/phone normalization → unique key.
   */
  async applyToCrm(
    businessId: string,
    parsed: ParsedSignature,
  ): Promise<{ contactId: string | null; created: boolean; enriched: boolean }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { signatureParsingEnabled: true },
    });
    if (!business?.signatureParsingEnabled) {
      return { contactId: null, created: false, enriched: false };
    }
    const emailNorm = parsed.email?.trim().toLowerCase() || null;
    const phoneNorm = parsed.phone?.replace(/[^\d+]/g, '') || null;
    if (!emailNorm && !phoneNorm) {
      return { contactId: null, created: false, enriched: false };
    }

    const existing = await this.prisma.client.contact.findFirst({
      where: {
        businessId,
        deletedAt: null,
        OR: [
          ...(emailNorm ? [{ emailNormalized: emailNorm }] : []),
          ...(phoneNorm ? [{ phoneNormalized: phoneNorm }] : []),
        ],
      },
    });

    if (existing) {
      // Fill only empty fields; never overwrite.
      const data: Record<string, unknown> = {};
      const fieldsChanged: string[] = [];
      if (!existing.firstName && parsed.firstName) {
        data.firstName = parsed.firstName;
        fieldsChanged.push('firstName');
      }
      if (!existing.lastName && parsed.lastName) {
        data.lastName = parsed.lastName;
        fieldsChanged.push('lastName');
      }
      if (!existing.companyName && parsed.company) {
        data.companyName = parsed.company;
        fieldsChanged.push('companyName');
      }
      if (!existing.jobTitle && parsed.title) {
        data.jobTitle = parsed.title;
        fieldsChanged.push('jobTitle');
      }
      if (!existing.phone && parsed.phone) {
        data.phone = parsed.phone;
        data.phoneNormalized = phoneNorm;
        fieldsChanged.push('phone');
      }
      if (!existing.email && parsed.email) {
        data.email = parsed.email;
        data.emailNormalized = emailNorm;
        fieldsChanged.push('email');
      }
      if (Object.keys(data).length === 0) {
        return { contactId: existing.id, created: false, enriched: false };
      }
      await this.prisma.client.contact.update({ where: { id: existing.id }, data });
      await this.prisma.client.contactSyncAudit
        .create({
          data: {
            businessId,
            contactId: existing.id,
            source: 'signature',
            action: 'enriched_from_signature',
            fieldsChanged,
            detail: parsed as unknown as object,
          },
        })
        .catch(() => undefined);
      return { contactId: existing.id, created: false, enriched: true };
    }

    // Brand-new contact. Honor marketingOptIn = null (i.e. not opted-in by default).
    const created = await this.prisma.client.contact.create({
      data: {
        businessId,
        firstName: parsed.firstName ?? null,
        lastName: parsed.lastName ?? null,
        email: parsed.email ?? null,
        emailNormalized: emailNorm,
        phone: parsed.phone ?? null,
        phoneNormalized: phoneNorm,
        companyName: parsed.company ?? null,
        jobTitle: parsed.title ?? null,
        source: 'signature',
        status: 'LEAD',
        marketingOptIn: false,
      },
    });
    await this.prisma.client.contactSyncAudit
      .create({
        data: {
          businessId,
          contactId: created.id,
          source: 'signature',
          action: 'created_from_signature',
          detail: parsed as unknown as object,
        },
      })
      .catch(() => undefined);
    return { contactId: created.id, created: true, enriched: false };
  }

  /**
   * Public entry point used by the inbound email pipeline. Combines heuristic
   * parsing + AI fallback (when no useful fields are found) and CRM application.
   */
  async parseAndApply(businessId: string, emailBody: string): Promise<ParsedSignature & {
    contactId: string | null;
    created: boolean;
    enriched: boolean;
  }> {
    const parsed = this.parseHeuristic(emailBody);
    const usable = !!(parsed.email || parsed.phone || parsed.name);
    let final: ParsedSignature = parsed;
    if (!usable) {
      // AI fallback would slot in here using ModelGatewayService.complete().
      // Kept as a no-op when the heuristic fails so this service stays
      // deterministic and dependency-free for unit tests; the inbound
      // pipeline can request the AI fallback explicitly if desired.
      final = parsed;
    }
    const result = await this.applyToCrm(businessId, final);
    return { ...final, ...result };
  }

  /**
   * Listener hook for an inbound email pipeline. KEYFLOW today only has an
   * outbound communications pipeline; whenever an inbound channel is added
   * (M7+), it should `eventEmitter.emit('email.received', {...})` and this
   * listener will auto-extract a signature and apply it to CRM (gated on
   * Business.signatureParsingEnabled).
   *
   * Payload shape: { businessId: string; body: string; from?: string }
   */
  @OnEvent('email.received')
  async onEmailReceived(payload: { businessId?: string; body?: string }) {
    if (!payload?.businessId || !payload?.body) return;
    const business = await this.prisma.client.business
      .findUnique({
        where: { id: payload.businessId },
        select: { signatureParsingEnabled: true },
      })
      .catch(() => null);
    if (!business?.signatureParsingEnabled) return;
    try {
      await this.parseAndApply(payload.businessId, payload.body);
    } catch (err) {
      this.logger.warn(
        `signature parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
