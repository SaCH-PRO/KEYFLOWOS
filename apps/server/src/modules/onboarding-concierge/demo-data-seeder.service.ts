import { Injectable, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface DemoSeedResult {
  contactId: string;
  invoiceId: string;
  invoiceNumber: string;
}

/**
 * Seeds a single, clearly-labeled sample contact + invoice into a brand-new
 * workspace so the Command Center is not empty the first time the user arrives.
 *
 * The operation is idempotent: if a demo contact already exists for the
 * business, it returns the existing IDs without creating duplicates.
 */
@Injectable()
export class DemoDataSeederService {
  private readonly logger = new Logger(DemoDataSeederService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async seedDemoData(businessId: string): Promise<DemoSeedResult> {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const existing = await tx.contact.findFirst({
            where: { businessId, source: 'demo' },
            select: { id: true },
          });

          if (existing) {
            const invoice = await tx.invoice.findFirst({
              where: { businessId, contactId: existing.id },
              orderBy: { createdAt: 'desc' },
              select: { id: true, invoiceNumber: true },
            });

            return {
              contactId: existing.id,
              invoiceId: invoice?.id ?? '',
              invoiceNumber: invoice?.invoiceNumber ?? 'DEMO-000',
            };
          }

          const business = await tx.business.findUnique({
            where: { id: businessId },
            select: { currency: true },
          });
          const currency = business?.currency || 'TTD';

          const contact = await tx.contact.create({
            data: {
              businessId,
              firstName: 'Sample',
              lastName: 'Client',
              displayName: 'Sample Client (demo)',
              email: 'sample-client@example.com',
              emailNormalized: 'sample-client@example.com',
              status: 'LEAD',
              source: 'demo',
              lifecycleStage: 'lead',
              notesInternal: 'This is a sample contact created during onboarding. You can edit or delete it anytime.',
            },
          });

          const invoiceNumber = await this.generateInvoiceNumber(tx, businessId);
          const subtotal = 500;
          const taxRate = 0;
          const taxAmount = 0;
          const total = subtotal + taxAmount;

          const invoice = await tx.invoice.create({
            data: {
              businessId,
              contactId: contact.id,
              invoiceNumber,
              status: 'DRAFT',
              subtotal,
              taxRate,
              taxAmount,
              total,
              currency,
              issueDate: new Date(),
              notes: 'This is a sample invoice created during onboarding so you can see how invoicing looks. You can delete it anytime.',
              items: {
                create: [
                  {
                    description: 'Sample service / product',
                    quantity: 1,
                    unitPrice: subtotal,
                    total: subtotal,
                  },
                ],
              },
            },
          });

          this.logger.log(`Seeded demo data for business ${businessId}: contact=${contact.id}, invoice=${invoice.id}`);

          return {
            contactId: contact.id,
            invoiceId: invoice.id,
            invoiceNumber,
          };
        });
      } catch (err) {
        if (this.isUniqueViolation(err) && attempt < maxAttempts) {
          this.logger.warn(`Demo seed race detected for ${businessId}, retrying (${attempt}/${maxAttempts})`);
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Failed to seed demo data for business ${businessId} after ${maxAttempts} attempts`);
  }

  private isUniqueViolation(err: unknown): boolean {
    return err instanceof Error && err.message.includes('Unique constraint failed');
  }

  private async generateInvoiceNumber(
    tx: Parameters<Parameters<typeof this.prisma.client.$transaction>[0]>[0],
    businessId: string,
  ): Promise<string> {
    const prefix = 'DEMO';
    const latest = await tx.invoice.findFirst({
      where: { businessId, invoiceNumber: { startsWith: prefix } },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });

    let sequence = 1;
    if (latest?.invoiceNumber) {
      const match = latest.invoiceNumber.match(/-?(\d+)$/);
      if (match) {
        sequence = Number.parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(3, '0')}`;
  }
}
