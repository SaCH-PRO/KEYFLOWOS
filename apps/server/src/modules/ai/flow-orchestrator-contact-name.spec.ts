import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { FlowOrchestratorService } from './flow-orchestrator.service';

/**
 * FU-KEY-CONTACT-NAME (P17(d)):
 * KEY booking and waitlist tools must format contact names via a null-safe
 * contactDisplayName helper instead of `${firstName} ${lastName}`, which
 * rendered "Alice null", "null Smith", or "null null" whenever either name
 * part was missing.
 */
function makeFlow(overrides: {
  contactFindFirst?: ReturnType<typeof vi.fn>;
  contactFindMany?: ReturnType<typeof vi.fn>;
  bookingFindFirst?: ReturnType<typeof vi.fn>;
  createBooking?: ReturnType<typeof vi.fn>;
  addToWaitlist?: ReturnType<typeof vi.fn>;
}) {
  const flow = Object.create(FlowOrchestratorService.prototype) as FlowOrchestratorService & Record<string, unknown>;
  flow.prisma = {
    client: {
      contact: {
        findFirst: overrides.contactFindFirst ?? vi.fn().mockResolvedValue(null),
        findMany: overrides.contactFindMany ?? vi.fn().mockResolvedValue([]),
      },
      booking: {
        findFirst: overrides.bookingFindFirst ?? vi.fn().mockResolvedValue(null),
      },
    },
  };
  flow.getBookings = () => ({
    createBooking: overrides.createBooking ?? vi.fn().mockResolvedValue({ id: 'bk_1' }),
  });
  flow.getWaitlist = () => ({
    addToWaitlist: overrides.addToWaitlist ?? vi.fn().mockResolvedValue({ id: 'wl_1', contact: null }),
  });
  return flow;
}

async function invokeTool(
  flow: FlowOrchestratorService & Record<string, unknown>,
  toolName: string,
  args: Record<string, unknown>,
) {
  return (flow as unknown as {
    executeToolAction: (businessId: string, tool: string, args: Record<string, unknown>, action?: unknown) => Promise<Record<string, unknown>>;
  }).executeToolAction('biz_1', toolName, args);
}

describe('FU-KEY-CONTACT-NAME (P17(d)): null-safe contact display names in KEY booking tools', () => {
  it('RED-BEFORE: bookings_create_booking disambiguation message never renders "null" when lastName/firstName are missing', async () => {
    const flow = makeFlow({
      contactFindFirst: vi.fn().mockResolvedValue({
        id: 'ct_1',
        firstName: 'Alice',
        lastName: null,
        displayName: null,
      }),
      contactFindMany: vi.fn().mockResolvedValue([
        { id: 'ct_2', firstName: 'Alice', lastName: null, displayName: null, email: 'alice2@test.local' },
        { id: 'ct_3', firstName: null, lastName: 'Smith', displayName: '   ', email: null },
        { id: 'ct_4', firstName: null, lastName: null, displayName: null, email: 'anon@test.local' },
      ]),
    });

    let err: unknown;
    try {
      await invokeTool(flow, 'bookings_create_booking', {
        contactId: 'ct_1',
        serviceId: 'svc_1',
        startTime: '2026-12-01T10:00:00.000Z',
        endTime: '2026-12-01T11:00:00.000Z',
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(BadRequestException);
    const msg = (err as Error).message;
    expect(msg).not.toMatch(/\bnull\b|\bundefined\b/);
    expect(msg).toContain('Alice, Smith, anon@test.local');
  });

  it('RED-BEFORE: bookings_create_booking returns clean contactName when lastName, firstName, or both are null', async () => {
    const cases: Array<{ contact: Record<string, unknown>; expected: string }> = [
      { contact: { id: 'ct_1', firstName: 'Alice', lastName: null, displayName: null }, expected: 'Alice' },
      { contact: { id: 'ct_2', firstName: null, lastName: 'Smith', displayName: null }, expected: 'Smith' },
      { contact: { id: 'ct_3', firstName: null, lastName: null, displayName: '   ' }, expected: 'Unknown' },
    ];

    for (const c of cases) {
      const flow = makeFlow({
        contactFindFirst: vi.fn().mockResolvedValue(c.contact),
        contactFindMany: vi.fn().mockResolvedValue([]),
        bookingFindFirst: vi.fn().mockResolvedValue(null),
        createBooking: vi.fn().mockResolvedValue({ id: `bk_${c.contact.id}` }),
      });

      const res = await invokeTool(flow, 'bookings_create_booking', {
        contactId: c.contact.id,
        serviceId: 'svc_1',
        startTime: '2026-12-01T10:00:00.000Z',
        endTime: '2026-12-01T11:00:00.000Z',
      });

      expect(res.contactName).toBe(c.expected);
      expect(String(res.contactName)).not.toMatch(/\bnull\b|\bundefined\b/);
    }
  });

  it('RED-BEFORE: bookings_add_to_waitlist returns clean contactName for partial/empty/null contact', async () => {
    const cases: Array<{ contact: Record<string, unknown> | null; expected: string }> = [
      { contact: { firstName: 'Bob', lastName: null, displayName: null }, expected: 'Bob' },
      { contact: { firstName: null, lastName: 'Jones', displayName: '' }, expected: 'Jones' },
      { contact: { firstName: null, lastName: null, displayName: null }, expected: 'Unknown' },
      { contact: null, expected: 'Unknown' },
    ];

    for (const c of cases) {
      const flow = makeFlow({
        addToWaitlist: vi.fn().mockResolvedValue({ id: 'wl_1', contact: c.contact }),
      });

      const res = await invokeTool(flow, 'bookings_add_to_waitlist', {
        contactId: 'ct_1',
        serviceId: 'svc_1',
      });

      expect(res.contactName).toBe(c.expected);
      expect(String(res.contactName)).not.toMatch(/\bnull\b|\bundefined\b/);
    }
  });

  it('CONTROL: explicit displayName and full first+last names still format as expected', async () => {
    const flowExplicit = makeFlow({
      contactFindFirst: vi.fn().mockResolvedValue({
        id: 'ct_1',
        firstName: 'Jane',
        lastName: 'Doe',
        displayName: 'Dr. Jane Doe',
      }),
      createBooking: vi.fn().mockResolvedValue({ id: 'bk_1' }),
    });
    const res1 = await invokeTool(flowExplicit, 'bookings_create_booking', {
      contactId: 'ct_1',
      serviceId: 'svc_1',
      startTime: '2026-12-01T10:00:00.000Z',
      endTime: '2026-12-01T11:00:00.000Z',
    });
    expect(res1.contactName).toBe('Dr. Jane Doe');

    const flowFull = makeFlow({
      addToWaitlist: vi.fn().mockResolvedValue({
        id: 'wl_1',
        contact: { firstName: 'Jane', lastName: 'Doe', displayName: null },
      }),
    });
    const res2 = await invokeTool(flowFull, 'bookings_add_to_waitlist', {
      contactId: 'ct_1',
      serviceId: 'svc_1',
    });
    expect(res2.contactName).toBe('Jane Doe');
  });
});
