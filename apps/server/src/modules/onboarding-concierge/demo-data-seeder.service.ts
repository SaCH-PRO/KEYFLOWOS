import { Injectable, Inject, Logger, ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ContactAuditService } from '../crm/privacy/contact-audit.service';

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

export interface DemoSeedResult {
  contactId: string;
  invoiceId: string;
  invoiceNumber: string;
}

/** POST .../seed-demo's answer: the demo ids, and whether they were already there (nothing written). */
export interface OwnerDemoSeedResult extends DemoSeedResult {
  alreadySeeded: boolean;
}

/** The authenticated caller (req.user) a route seeds for. */
export interface DemoSeedActor {
  id?: string;
  role?: string;
}

/** 403 code: the demo seed is the business owner's (owner ruling D-84). */
export const DEMO_SEED_OWNER_ONLY = 'DEMO_SEED_OWNER_ONLY';
/** 409 code: the sample email is held by a live contact that is not the demo contact. */
export const DEMO_SEED_CONFLICT = 'DEMO_SEED_CONFLICT';

/** The sample contact's email; the live (business_id, email_normalized) unique reserves it. */
const SAMPLE_EMAIL = 'sample-client@example.com';

/**
 * Prisma's unique-constraint violation (P2002), matched on the code rather
 * than `instanceof` so it holds whichever `@prisma/client` copy raised it (as
 * chart-of-accounts-seeder.service.ts does).
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

function toDemoSeedResult(seeded: DemoSeedResult): DemoSeedResult {
  return { contactId: seeded.contactId, invoiceId: seeded.invoiceId, invoiceNumber: seeded.invoiceNumber };
}

/** 409 DEMO_SEED_CONFLICT: a live contact that is not the demo contact holds the sample email. */
class SampleEmailTakenException extends ConflictException {
  constructor() {
    super({
      code: DEMO_SEED_CONFLICT,
      message: `The demo data could not be added: another contact already uses ${SAMPLE_EMAIL}.`,
    });
  }
}

/**
 * Seeds a single, clearly-labeled sample contact + invoice into a brand-new
 * workspace so the Command Center is not empty the first time the user arrives.
 *
 * The operation is idempotent: if a demo contact already exists for the
 * business, it returns the existing IDs without creating duplicates.
 *
 * Two doors: onboarding completion seeds inside its own owner-only transaction
 * (seedDemoData with its tx; completion records the actor), and POST
 * .../seed-demo seeds through seedDemoDataAsOwner (owner only, audited; owner
 * ruling D-84). There is no other seeding route. Both doors run the same seed
 * (seedWithTx): it queues on the business row and checks the sample email
 * before writing, so neither door answers 500 on it (review SDO-SEC-1, CR-1).
 */
@Injectable()
export class DemoDataSeederService {
  private readonly logger = new Logger(DemoDataSeederService.name);
  /**
   * The contact audit's hash (sha256 of "<businessId>:<contactId>", which the
   * GDPR purge recomputes) from its owner, ContactAuditService. Constructed
   * here rather than injected: CrmModule, which provides it, is not imported by
   * OnboardingConciergeModule. Only hashContact is used; the entry itself is
   * written in the seed transaction.
   */
  private readonly contactAudit: ContactAuditService;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.contactAudit = new ContactAuditService(prisma);
  }

  /**
   * POST .../seed-demo (PR196-SEED-DEMO-OWNER, owner ruling D-84, review
   * OK-6-1, OK-6-2, OK-6-4). The demo seed writes a contact (crm) and a DRAFT
   * invoice (revenue) into a live business, so it is the owner's alone, as
   * completion is (R0-SEC-03): the OWNER membership or the distinguished owner
   * (Business.ownerId), regardless of granted scopes (D-11). A SUPER_ADMIN who
   * is not a member gets no platform bypass here: BusinessGuard admits them,
   * this refuses them, as tenant invoice writes do (D-46). The refusal (403
   * DEMO_SEED_OWNER_ONLY) comes before anything is written.
   *
   * The seed is audited in its own transaction, so none commits without its
   * record (D-25: every contact write records a ContactAuditEntry): a
   * ContactAuditEntry 'created' on the demo contact with a USER actor naming
   * the owner, and a team_activity_logs row 'demo_data_seeded' naming the
   * owner and the demo contact and invoice (the actor row completion writes).
   *
   * A repeated seed answers the existing demo data with alreadySeeded true and
   * writes nothing. Concurrent seeds (and a seed racing completion) queue on
   * the business row, so the later one answers the earlier one's rows. The
   * sample email held by a live contact that is not the demo contact answers
   * 409 DEMO_SEED_CONFLICT before anything is written, never 500.
   */
  async seedDemoDataAsOwner(businessId: string, actor: DemoSeedActor | undefined): Promise<OwnerDemoSeedResult> {
    const actorId = await this.resolveSeedOwner(businessId, actor);
    return this.seedInOwnTransaction(businessId, actorId);
  }

  /**
   * Onboarding completion's door (with its tx), or an actor-less seed in a
   * transaction of its own (without one, which answers 409 as seed-demo does).
   *
   * Review SDO-SEC-1 / CR-1: the demo data never blocks completion. When a
   * live contact that is not the demo contact holds the sample email (any
   * member with crm:write, or an import, can write one), the completion door
   * writes nothing and answers null, and completion completes without demo
   * data. Before, the contact create's P2002 aborted the completion
   * transaction and the owner's /complete answered 500 on every retry. The
   * refusal comes from a read, so the caller's transaction is intact.
   */
  seedDemoData(businessId: string): Promise<DemoSeedResult>;
  seedDemoData(businessId: string, tx: PrismaTx): Promise<DemoSeedResult | null>;
  async seedDemoData(businessId: string, tx?: PrismaTx): Promise<DemoSeedResult | null> {
    if (tx) {
      try {
        return toDemoSeedResult(await this.seedWithTx(tx, businessId));
      } catch (err) {
        if (!(err instanceof SampleEmailTakenException)) throw err;
        this.logger.warn(`Demo data not added for ${businessId}: a live contact already uses the sample email`);
        return null;
      }
    }
    return toDemoSeedResult(await this.seedInOwnTransaction(businessId));
  }

  /**
   * The seed in a transaction of its own. Seeds queue on the business row
   * (seedWithTx), so a P2002 here comes from a writer outside the seed (a
   * contact create of the sample email committing between the check and the
   * insert): it is retried, and the retry's check answers 409
   * DEMO_SEED_CONFLICT. A violation left after the last attempt is 409 too.
   */
  private async seedInOwnTransaction(businessId: string, actorId?: string): Promise<OwnerDemoSeedResult> {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (innerTx) => {
          return this.seedWithTx(innerTx, businessId, actorId);
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (attempt < maxAttempts) {
          this.logger.warn(`Demo seed race detected for ${businessId}, retrying (${attempt}/${maxAttempts})`);
          continue;
        }
        throw new SampleEmailTakenException();
      }
    }

    throw new Error(`Failed to seed demo data for business ${businessId} after ${maxAttempts} attempts`);
  }

  /**
   * The owner D-84 names, as BusinessGuard and completion admit an owner: the
   * distinguished owner (Business.ownerId) or the OWNER membership, both read
   * for this business. No platform bypass (D-46); no actor fails closed.
   */
  private async resolveSeedOwner(businessId: string, actor: DemoSeedActor | undefined): Promise<string> {
    const actorId = actor?.id;
    if (actorId) {
      const [owned, membership] = await Promise.all([
        // Owner ruling D-104 (W10-OWNER-MEMBERSHIP): the ownerId arm counts only with a Membership row.
        this.prisma.client.business.findFirst({ where: { id: businessId, ownerId: actorId, members: { some: { userId: actorId } } }, select: { id: true } }),
        this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: actorId, businessId } },
          select: { role: true },
        }),
      ]);
      if (owned || membership?.role === 'OWNER') return actorId;
    }
    throw new ForbiddenException({
      code: DEMO_SEED_OWNER_ONLY,
      message: 'Only the business owner can add demo data.',
    });
  }

  /**
   * The seed both doors run. It locks the business row first (FOR NO KEY
   * UPDATE, the lock completion's claim already holds in its transaction), so
   * seed-demo and completion, or two seed-demos, queue instead of racing on
   * the sample email's unique: the later one's reads below see the earlier
   * one's demo rows (review SDO-SEC-1 / CR-1: a seed-demo racing /complete
   * made /complete answer 500). Then, before any write, a live contact that is
   * not the demo contact holding the sample email refuses the seed
   * (SampleEmailTakenException): a read, where the create's P2002 would abort
   * the caller's transaction.
   */
  private async seedWithTx(tx: PrismaTx, businessId: string, actorId?: string): Promise<OwnerDemoSeedResult> {
    await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR NO KEY UPDATE`;

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
        alreadySeeded: true,
      };
    }

    // No demo contact exists (above), so a live holder of the sample email is
    // another contact; the live (business_id, email_normalized) unique would
    // refuse the create.
    const holder = await tx.contact.findFirst({
      where: { businessId, emailNormalized: SAMPLE_EMAIL, deletedAt: null },
      select: { id: true },
    });
    if (holder) throw new SampleEmailTakenException();

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
        email: SAMPLE_EMAIL,
        emailNormalized: SAMPLE_EMAIL,
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

    if (actorId) {
      await this.recordOwnerSeed(tx, businessId, actorId, { contactId: contact.id, invoiceId: invoice.id, invoiceNumber });
    }

    this.logger.log(`Seeded demo data for business ${businessId}: contact=${contact.id}, invoice=${invoice.id}`);

    return {
      contactId: contact.id,
      invoiceId: invoice.id,
      invoiceNumber,
      alreadySeeded: false,
    };
  }

  /**
   * The owner's seed record, written in the seed transaction (D-84): the
   * ContactAuditEntry for the contact write (D-25) and the actor row naming
   * who added which demo contact and invoice.
   */
  private async recordOwnerSeed(tx: PrismaTx, businessId: string, actorId: string, seeded: DemoSeedResult): Promise<void> {
    await tx.contactAuditEntry.create({
      data: {
        businessId,
        contactId: seeded.contactId,
        contactHash: this.contactAudit.hashContact(businessId, seeded.contactId),
        action: 'created',
        entityType: 'contact',
        entityId: seeded.contactId,
        actor: { type: 'USER', id: actorId },
        after: { source: 'demo', displayName: 'Sample Client (demo)', status: 'LEAD' },
        reason: 'Demo data added by the business owner',
      },
    });
    await tx.teamActivityLog.create({
      data: {
        businessId,
        userId: actorId,
        module: 'settings',
        action: 'demo_data_seeded',
        entityType: 'business',
        entityId: businessId,
        title: 'Added demo data',
        meta: {
          demoContactId: seeded.contactId,
          demoInvoiceId: seeded.invoiceId,
          demoInvoiceNumber: seeded.invoiceNumber,
        },
      },
    });
  }

  private async generateInvoiceNumber(
    _tx: PrismaTx,
    _businessId: string,
  ): Promise<string> {
    // Use a cryptographically random suffix instead of a sequential counter.
    // Sequential counters require read-modify-write inside a transaction and
    // can collide under concurrent onboarding completions. The random suffix
    // is effectively unique and makes the operation atomic.
    // UUID-based suffix is effectively collision-free and avoids the
    // read-modify-write race of a sequential counter.
    return `DEMO-${randomUUID().split('-')[0].slice(0, 6).toUpperCase()}`;
  }
}
