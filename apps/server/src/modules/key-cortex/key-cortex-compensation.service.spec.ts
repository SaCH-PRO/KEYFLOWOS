import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookingStatus } from '@prisma/client';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { BookingsService } from '../bookings/bookings.service';
import { PrismaService } from '../../core/prisma/prisma.service';

describe('KeyCortexCompensationService', () => {
  let service: KeyCortexCompensationService;
  let crm: Pick<CrmService, 'softDeleteContact'>;
  let commerce: Pick<CommerceService, 'updateInvoiceStatus'>;
  let bookings: Pick<BookingsService, 'updateBookingStatus'>;
  let prisma: { client: { message: { deleteMany: ReturnType<typeof vi.fn> } } };

  beforeEach(() => {
    crm = { softDeleteContact: vi.fn() };
    commerce = { updateInvoiceStatus: vi.fn() };
    bookings = { updateBookingStatus: vi.fn() };
    prisma = { client: { message: { deleteMany: vi.fn() } } };

    service = new KeyCortexCompensationService(
      crm as CrmService,
      commerce as CommerceService,
      bookings as BookingsService,
      prisma as unknown as PrismaService,
    );
  });

  it('compensates crm.create_contact', async () => {
    await service.compensate('crm.create_contact', {
      businessId: 'b1',
      output: { id: 'c1' },
    });
    expect(crm.softDeleteContact).toHaveBeenCalledWith({ businessId: 'b1', contactId: 'c1' });
  });

  it('compensates commerce.create_invoice', async () => {
    await service.compensate('commerce.create_invoice', {
      businessId: 'b1',
      output: { id: 'i1' },
    });
    expect(commerce.updateInvoiceStatus).toHaveBeenCalledWith({ invoiceId: 'i1', status: 'VOID' });
  });

  it('compensates bookings.create_booking', async () => {
    await service.compensate('bookings.create_booking', {
      businessId: 'b1',
      output: { id: 'bk1' },
    });
    expect(bookings.updateBookingStatus).toHaveBeenCalledWith('b1', 'bk1', BookingStatus.CANCELLED);
  });

  it('compensates key_inbox.send_reply', async () => {
    await service.compensate('key_inbox.send_reply', {
      businessId: 'b1',
      output: { id: 'm1' },
    });
    expect(prisma.client.message.deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', businessId: 'b1' } });
  });

  it('returns not-compensated for unknown actions', async () => {
    const result = await service.compensate('unknown.action', { businessId: 'b1' });
    expect(result.compensated).toBe(false);
  });
});
