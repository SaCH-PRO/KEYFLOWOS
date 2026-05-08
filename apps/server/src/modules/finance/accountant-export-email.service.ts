import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SystemEmailService } from '../notifications/system-email.service';
import { AccountantExportService } from './accountant-export.service';

export interface SendAccountantExportInput {
  businessId: string;
  periodStart: Date;
  periodEnd: Date;
  basis?: 'CASH' | 'ACCRUAL';
  to?: string | null;
  message?: string | null;
  saveRecipient?: boolean;
  userId?: string | null;
}

export interface SendAccountantExportResult {
  to: string;
  filename: string;
  bytes: number;
  messageId: string;
  generatedAt: string;
  savedAsDefault: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * FIN7 — Email an Accountant Export ZIP directly to a recipient via Resend.
 *
 * Reuses {@link AccountantExportService.build} so the attached package is
 * byte-for-byte identical to the downloadable ZIP. The recipient defaults
 * to `Business.accountantEmail`; when the caller passes a `to` and
 * `saveRecipient: true`, that address is persisted as the new default.
 */
@Injectable()
export class AccountantExportEmailService {
  private readonly logger = new Logger(AccountantExportEmailService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AccountantExportService) private readonly exportSvc: AccountantExportService,
    @Inject(SystemEmailService) private readonly emailSvc: SystemEmailService,
  ) {}

  async send(input: SendAccountantExportInput): Promise<SendAccountantExportResult> {
    if (!this.emailSvc.isConfigured()) {
      throw new BadRequestException(
        'Email sender is not configured. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS to enable accountant emails.',
      );
    }

    const business = await this.prisma.client.business.findUnique({
      where: { id: input.businessId },
      select: { id: true, name: true, currency: true, accountantEmail: true },
    });
    if (!business) throw new BadRequestException('Business not found');

    const requested = (input.to ?? '').trim();
    const fallback = (business.accountantEmail ?? '').trim();
    const to = requested.length > 0 ? requested : fallback;
    if (!to) {
      throw new BadRequestException(
        'No recipient: pass `to` or set a default accountant email under Finance > Settings.',
      );
    }
    if (!EMAIL_RE.test(to)) {
      throw new BadRequestException('Recipient email is not a valid email address');
    }

    const pkg = await this.exportSvc.build({
      businessId: input.businessId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      basis: input.basis,
      userId: input.userId,
    });

    const periodStr = `${ymd(input.periodStart)} – ${ymd(input.periodEnd)}`;
    const subject = `Accountant export — ${business.name} (${periodStr})`;
    const note = (input.message ?? '').trim();
    const html = renderHtml({ businessName: business.name, period: periodStr, note, filename: pkg.filename });
    const text = renderText({ businessName: business.name, period: periodStr, note, filename: pkg.filename });

    const result = await this.emailSvc.sendTransactional({
      to,
      subject,
      html,
      text,
      attachments: [{ filename: pkg.filename, content: pkg.buffer }],
    });

    let savedAsDefault = false;
    if (input.saveRecipient && to !== fallback) {
      await this.prisma.client.business.update({
        where: { id: input.businessId },
        data: { accountantEmail: to },
      });
      savedAsDefault = true;
    }

    this.logger.log(
      `Sent accountant export to ${to} (business=${input.businessId}, bytes=${pkg.bytes}, period=${periodStr})`,
    );

    return {
      to,
      filename: pkg.filename,
      bytes: pkg.bytes,
      messageId: result.id,
      generatedAt: pkg.generatedAt,
      savedAsDefault,
    };
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(args: { businessName: string; period: string; note: string; filename: string }): string {
  const noteBlock = args.note
    ? `<p style="white-space:pre-wrap;color:#374151;font-size:14px;line-height:1.5;margin:16px 0;padding:12px 14px;background:#F9FAFB;border-left:3px solid #F97316;border-radius:4px;">${escapeHtml(args.note)}</p>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:12px;padding:24px;border:1px solid #E5E7EB;">
    <h1 style="margin:0 0 8px;font-size:18px;color:#111827;">Accountant export</h1>
    <p style="margin:0 0 16px;color:#6B7280;font-size:13px;">${escapeHtml(args.businessName)} · ${escapeHtml(args.period)}</p>
    <p style="color:#374151;font-size:14px;line-height:1.5;margin:0 0 12px;">
      Attached is the accountant export package (<strong>${escapeHtml(args.filename)}</strong>) covering the period above.
      It includes the P&amp;L, balance sheet, cash flow, AR/AP aging, tax summary, trial balance, general ledger, and audit log.
    </p>
    ${noteBlock}
    <p style="color:#9CA3AF;font-size:12px;margin:24px 0 0;">Sent automatically by Keyflow on behalf of ${escapeHtml(args.businessName)}.</p>
  </div>
</body></html>`;
}

function renderText(args: { businessName: string; period: string; note: string; filename: string }): string {
  const lines = [
    `Accountant export — ${args.businessName}`,
    `Period: ${args.period}`,
    '',
    `Attached: ${args.filename}`,
    'Includes P&L, balance sheet, cash flow, AR/AP aging, tax summary, trial balance, general ledger, and audit log.',
  ];
  if (args.note) {
    lines.push('', '---', args.note, '---');
  }
  lines.push('', `Sent automatically by Keyflow on behalf of ${args.businessName}.`);
  return lines.join('\n');
}
