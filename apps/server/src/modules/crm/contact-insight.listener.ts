import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ContactInsightService } from './contact-insight.service';

interface ContactScopedPayload {
  businessId: string;
  contactId: string;
}

interface RelationshipHealthChangedPayload {
  businessId: string;
  contactId: string;
  to?: string;
  from?: string;
}

interface SequencePayload {
  businessId: string;
  contactId?: string;
}

@Injectable()
export class ContactInsightListener {
  private readonly logger = new Logger(ContactInsightListener.name);

  constructor(@Inject(ContactInsightService) private readonly insight: ContactInsightService) {}

  private async safeMarkStale(businessId: string, contactId: string, source: string): Promise<void> {
    try {
      await this.insight.markStale(businessId, contactId);
    } catch (err) {
      this.logger.warn(
        `[${source}] mark-stale failed for contact=${contactId}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('crm.contact_event.logged', { async: true })
  async onContactEventLogged(payload: ContactScopedPayload & { type?: string }): Promise<void> {
    if (!payload?.businessId || !payload?.contactId) return;
    const t = payload.type ?? '';
    // Only invalidate on relationship-changing events to avoid recompute storms.
    const relationshipChanging =
      t === 'deal.won' ||
      t === 'deal.lost' ||
      t === 'deal.created' ||
      t === 'deal.stage_changed' ||
      t === 'invoice.paid' ||
      t === 'invoice.overdue' ||
      t === 'sequence.unenrolled' ||
      t.startsWith('communication.') ||
      t === 'relationship_health.changed';
    if (!relationshipChanging) return;
    await this.safeMarkStale(payload.businessId, payload.contactId, `event:${t}`);
  }

  @OnEvent('crm.deal.created', { async: true })
  async onDealCreated(payload: ContactScopedPayload & { dealId?: string }): Promise<void> {
    if (!payload?.businessId || !payload?.contactId) return;
    await this.safeMarkStale(payload.businessId, payload.contactId, 'deal.created');
  }

  @OnEvent('relationship_health.changed', { async: true })
  async onRelationshipHealthChanged(payload: RelationshipHealthChangedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.contactId) return;
    await this.safeMarkStale(payload.businessId, payload.contactId, 'relationship_health.changed');
  }

  @OnEvent('sequence.step_due', { async: true })
  async onSequenceStepDue(payload: SequencePayload): Promise<void> {
    if (!payload?.businessId || !payload?.contactId) return;
    await this.safeMarkStale(payload.businessId, payload.contactId, 'sequence.step_due');
  }

  @OnEvent('invoice.paid', { async: true })
  async onInvoicePaid(payload: { businessId?: string; invoice?: { contactId?: string | null } | null }): Promise<void> {
    const businessId = payload?.businessId;
    const contactId = payload?.invoice?.contactId;
    if (!businessId || !contactId) return;
    await this.safeMarkStale(businessId, contactId, 'invoice.paid');
  }
}
