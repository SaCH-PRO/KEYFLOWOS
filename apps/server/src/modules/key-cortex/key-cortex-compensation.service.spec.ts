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
    // These assertions used to read `create_contact`, `create_invoice`,
    // `create_command_item` and `key_genome.dna_update`. Every one of those
    // passed, and NONE of them is a tool name — the tools are
    // `crm_create_contact`, `commerce_create_invoice`, and the genome adapter
    // registers `key_genome.update_dna_section`. The test certified a table
    // keyed on strings nothing would ever look up, which is why the table could
    // sit there fully populated and never return a single compensation.
    expect(service.getCompensatingAction('crm_create_contact')).toBe('crm.delete_contact');
    expect(service.getCompensatingAction('commerce_create_invoice')).toBe('commerce.void_invoice');
    expect(service.getCompensatingAction('bookings_create_booking')).toBe('bookings.cancel_booking');
    expect(service.getCompensatingAction('calendar_create_event')).toBe('calendar.delete_event');
    expect(service.getCompensatingAction('send_message_with_approval')).toBe('communications.recall_message');
    expect(service.getCompensatingAction('key_inbox.send_reply')).toBe('key_inbox.mark_draft');
  });

  it('does not map the genome update, because its rollback would destroy data', () => {
    // Deliberately absent, and worth stating. revertBlueprintField writes
    // `previousValue ?? null`, and the pre-image can only be captured by
    // reading the blueprint BEFORE the write — which the registry, where
    // compensations are now recorded, is not positioned to do. Mapping it
    // anyway would turn "undo my change" into "erase the field", which is
    // worse than the honest `compensation_unavailable` the saga records
    // instead.
    expect(service.getCompensatingAction('key_genome.update_dna_section')).toBeUndefined();
  });

  it('maps no tool name that does not exist', () => {
    // The durable form of the bug above: a key nobody can look up is dead
    // weight that reads as coverage.
    for (const dead of ['create_contact', 'create_lead', 'create_invoice', 'create_booking', 'send_message', 'create_command_item']) {
      expect(service.getCompensatingAction(dead), `"${dead}" is not a tool name`).toBeUndefined();
    }
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
