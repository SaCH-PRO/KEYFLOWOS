import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BookingStatus } from '@prisma/client';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { BookingsService } from '../bookings/bookings.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommandService } from '../command/command.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { AutopilotService } from '../autopilot/autopilot.service';
import { TimelineService } from '../timeline/timeline.service';

describe('KeyCortexCompensationService', () => {
  let service: KeyCortexCompensationService;
  let crm: Pick<CrmService, 'softDeleteContact'>;
  let commerce: Pick<CommerceService, 'updateInvoiceStatus'>;
  let bookings: Pick<BookingsService, 'updateBookingStatus'>;
  let prisma: {
    client: {
      keyInboxMessage: { deleteMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
      calendarEvent: { updateMany: ReturnType<typeof vi.fn> };
      message: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    };
  };
  let commandService: Pick<CommandService, 'delete'>;
  let blueprintService: Pick<BlueprintService, 'updateBlueprint'>;
  let autopilotService: Pick<AutopilotService, 'updateTaskStatus'>;
  let timeline: Pick<TimelineService, 'recordContactEvent'>;

  beforeEach(() => {
    crm = { softDeleteContact: vi.fn() };
    commerce = { updateInvoiceStatus: vi.fn() };
    bookings = { updateBookingStatus: vi.fn() };
    prisma = {
      client: {
        keyInboxMessage: {
          deleteMany: vi.fn(),
          updateMany: vi.fn(),
        },
        calendarEvent: {
          updateMany: vi.fn(),
        },
        message: {
          findUnique: vi.fn().mockResolvedValue(null),
          updateMany: vi.fn(),
        },
      },
    };
    commandService = { delete: vi.fn() };
    blueprintService = { updateBlueprint: vi.fn() };
    autopilotService = { updateTaskStatus: vi.fn() };
    timeline = { recordContactEvent: vi.fn().mockResolvedValue(undefined) };

    service = new KeyCortexCompensationService(
      crm as CrmService,
      commerce as CommerceService,
      bookings as BookingsService,
      prisma as unknown as PrismaService,
      commandService as CommandService,
      blueprintService as BlueprintService,
      autopilotService as AutopilotService,
      undefined,
      undefined,
      timeline as TimelineService,
    );
  });

  it('compensates crm.create_contact', async () => {
    await service.compensate('crm.create_contact', {
      businessId: 'b1',
      output: { id: 'c1' },
    });
    expect(crm.softDeleteContact).toHaveBeenCalledWith({ businessId: 'b1', contactId: 'c1' });
  });

  it('compensates crm.create_lead', async () => {
    await service.compensate('crm.create_lead', {
      businessId: 'b1',
      output: { id: 'l1' },
    });
    expect(crm.softDeleteContact).toHaveBeenCalledWith({ businessId: 'b1', contactId: 'l1' });
  });

  it('compensates commerce.create_invoice', async () => {
    await service.compensate('commerce.create_invoice', {
      businessId: 'b1',
      output: { id: 'i1' },
    });
    expect(commerce.updateInvoiceStatus).toHaveBeenCalledWith({ invoiceId: 'i1', status: 'VOID', businessId: 'b1' });
  });

  it('compensates bookings.create_booking', async () => {
    await service.compensate('bookings.create_booking', {
      businessId: 'b1',
      output: { id: 'bk1' },
    });
    expect(bookings.updateBookingStatus).toHaveBeenCalledWith('b1', 'bk1', BookingStatus.CANCELLED);
  });

  it('compensates key_inbox.send_reply by removing the sent reply row', async () => {
    await service.compensate('key_inbox.send_reply', {
      businessId: 'b1',
      output: { id: 'm1' },
    });
    expect(prisma.client.keyInboxMessage.deleteMany).toHaveBeenCalledWith({
      where: { id: 'm1', businessId: 'b1' },
    });
  });

  it('compensates command.create_command_item', async () => {
    await service.compensate('command.create_command_item', {
      businessId: 'b1',
      output: { id: 'ci1' },
    });
    expect(commandService.delete).toHaveBeenCalledWith('b1', 'ci1');
  });

  it('compensates autopilot.create_task', async () => {
    await service.compensate('autopilot.create_task', {
      businessId: 'b1',
      output: { id: 't1' },
    });
    expect(autopilotService.updateTaskStatus).toHaveBeenCalledWith('t1', 'b1', 'CANCELLED', 'key-cortex');
  });

  it('compensates calendar.create_event by cancelling the event', async () => {
    const result = await service.compensate('calendar.create_event', {
      businessId: 'b1',
      output: { id: 'e1' },
    });
    expect(result.compensated).toBe(true);
    expect(prisma.client.calendarEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', businessId: 'b1' },
      data: { status: 'CANCELLED' },
    });
  });

  it('compensates calendar.delete_event by cancelling the event', async () => {
    await service.compensate('calendar.delete_event', {
      businessId: 'b1',
      output: { id: 'e2' },
    });
    expect(prisma.client.calendarEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'e2', businessId: 'b1' },
      data: { status: 'CANCELLED' },
    });
  });

  it('compensates communications.send_message by recalling the local message row and recording a timeline event', async () => {
    prisma.client.message.findUnique.mockResolvedValue({
      id: 'msg1',
      recipientId: 'c1',
    });
    const result = await service.compensate('communications.send_message', {
      businessId: 'b1',
      output: { id: 'msg1' },
    });
    expect(result.compensated).toBe(true);
    expect(prisma.client.message.updateMany).toHaveBeenCalledWith({
      where: { id: 'msg1' },
      data: { status: 'recalled' },
    });
    expect(timeline.recordContactEvent).toHaveBeenCalledWith(
      'b1',
      'c1',
      'message.recalled',
      expect.objectContaining({ messageId: 'msg1' }),
    );
  });

  it('compensates communications.recall_message even when no local row exists', async () => {
    prisma.client.message.findUnique.mockResolvedValue(null);
    const result = await service.compensate('communications.recall_message', {
      businessId: 'b1',
      parameters: { messageId: 'msg2', contactId: 'c2' },
    });
    expect(result.compensated).toBe(true);
    expect(prisma.client.message.updateMany).not.toHaveBeenCalled();
    expect(timeline.recordContactEvent).toHaveBeenCalledWith(
      'b1',
      'c2',
      'message.recalled',
      expect.objectContaining({ messageId: 'msg2' }),
    );
  });

  it('reverts key_genome.dna_update via blueprint', async () => {
    await service.compensate('key_genome.dna_update', {
      businessId: 'b1',
      parameters: { section: 'identity', field: 'name', previousValue: 'Old Name' },
    });
    expect(blueprintService.updateBlueprint).toHaveBeenCalledWith('b1', { identity: { name: 'Old Name' } });
  });

  it('resolves compensating action refs for canonical tools', () => {
    expect(service.getCompensatingAction('create_contact')).toBe('crm.delete_contact');
    expect(service.getCompensatingAction('create_lead')).toBe('crm.delete_lead');
    expect(service.getCompensatingAction('create_invoice')).toBe('commerce.void_invoice');
    expect(service.getCompensatingAction('create_command_item')).toBe('command.delete_command_item');
    expect(service.getCompensatingAction('key_inbox.send_reply')).toBe('key_inbox.mark_draft');
    expect(service.getCompensatingAction('key_genome.dna_update')).toBe('key_genome.revert_blueprint_field');
  });

  it('returns not-compensated for unknown actions', async () => {
    const result = await service.compensate('unknown.action', { businessId: 'b1' });
    expect(result.compensated).toBe(false);
  });
});

describe('compensation cannot reach across tenants', () => {
  it('passes businessId to every handler that resolves a record by id', () => {
    // updateInvoiceStatus looks the invoice up by primary key alone. Without a
    // tenant, an id lifted out of a saga payload voids that invoice whoever
    // owns it. A guard establishes who is asking; it does not constrain what a
    // query touches.
    const src = readFileSync(join(__dirname, 'key-cortex-compensation.service.ts'), 'utf8');
    const calls = [...src.matchAll(/updateInvoiceStatus\(\{[^}]*\}/gs)];

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[0], 'invoice compensation must carry the tenant').toMatch(/businessId/);
    }
  });
});
