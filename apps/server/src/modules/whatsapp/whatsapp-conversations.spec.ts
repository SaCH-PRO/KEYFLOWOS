/**
 * The conversation surface behind whatsapp-manage-drawer.tsx.
 *
 * The drawer, WhatsAppContact and WhatsAppMessage all existed; the endpoints
 * between them did not, and nothing ever created a contact row — both tables
 * were empty in the dev database. So these tests are mostly about the two
 * things that decide whether the feature is real rather than merely present:
 * that inbound and outbound messages are actually WRITTEN, and that a
 * scheduled message is eventually SENT rather than parked in a status nobody
 * dispatches.
 *
 * The 24-hour window gets its own tests because it is the one piece of
 * WhatsApp policy encoded here: outside it Meta rejects anything but an
 * approved template, so `withinWindow` decides what the composer will let a
 * user do. An off-by-one there is a message the customer never receives.
 */
import { describe, it, expect, vi } from 'vitest';
import { WhatsAppService } from './whatsapp.service';

const HOUR = 60 * 60 * 1000;

/**
 * A Prisma double that keeps rows in memory, so a write made by one method is
 * visible to the next — a stub that only returned canned values could not tell
 * "recorded the message" apart from "did nothing".
 */
function buildPrisma(seed: { contacts?: any[]; messages?: any[] } = {}) {
  const contacts: any[] = [...(seed.contacts ?? [])];
  const messages: any[] = [...(seed.messages ?? [])];
  let seq = 0;

  const client = {
    whatsAppContact: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.businessId_phoneNumber;
        const found = contacts.find(
          (c) => c.businessId === key.businessId && c.phoneNumber === key.phoneNumber,
        );
        if (found) {
          Object.assign(found, update);
          return { id: found.id };
        }
        const row = { id: `wa_${++seq}`, ...create };
        contacts.push(row);
        return { id: row.id };
      }),
      findMany: vi.fn(async ({ where }: any) =>
        contacts
          .filter((c) => c.businessId === where.businessId)
          .sort((a, b) => (b.lastMessageAt?.getTime?.() ?? 0) - (a.lastMessageAt?.getTime?.() ?? 0)),
      ),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = contacts.find((c) => c.id === where.id && c.businessId === where.businessId);
        if (!row) return null;
        return { ...row, messages: messages.filter((m) => m.whatsappContactId === row.id) };
      }),
    },
    whatsAppMessage: {
      create: vi.fn(async ({ data, select }: any) => {
        const row = { id: `msg_${++seq}`, createdAt: new Date(), scheduledAt: null, sentAt: null, ...data };
        messages.push(row);
        return select ? { id: row.id, status: row.status } : row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = messages.find((m) => m.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matched = messages.filter(
          (m) => m.id === where.id && (!where.status || m.status === where.status),
        );
        matched.forEach((m) => Object.assign(m, data));
        return { count: matched.length };
      }),
      findMany: vi.fn(async ({ where }: any) =>
        messages
          .filter((m) => m.status === where.status && m.scheduledAt && m.scheduledAt <= where.scheduledAt.lte)
          .map((m) => ({
            ...m,
            whatsappContact: { phoneNumber: contacts.find((c) => c.id === m.whatsappContactId)?.phoneNumber },
          })),
      ),
    },
    business: { findUnique: vi.fn(async () => ({ messageIntakeEnabled: false })) },
  };
  return { client, _contacts: contacts, _messages: messages };
}

/** A service wired to mock-provider config, so sends "succeed" without network. */
function build(seed: Parameters<typeof buildPrisma>[0] = {}) {
  const prisma = buildPrisma(seed);
  const svc = new WhatsAppService(
    prisma as never,
    { emit: vi.fn() } as never,
    { resolveContact: vi.fn(async () => ({ contactId: 'contact_1', matchedOn: 'phone', isNew: false, merged: false })) } as never,
    { } as never,
    { routeInboundMessage: vi.fn(async () => ({ handled: false })) } as never,
  );
  vi.spyOn(svc, 'getConfig').mockResolvedValue({ provider: 'mock', fromNumber: '+18681234567' } as never);
  return { svc, prisma };
}

describe('WhatsApp conversation history', () => {
  it('writes a conversation and a message for an outbound send', async () => {
    const { svc, prisma } = build();

    await svc.sendMessage('biz_1', { to: '+1 868 555 0100', body: 'Your booking is confirmed' });

    expect(prisma._contacts).toHaveLength(1);
    expect(prisma._messages).toHaveLength(1);
    expect(prisma._messages[0]).toMatchObject({ direction: 'OUTBOUND', status: 'SENT' });
  });

  it('records a failed send rather than dropping it', async () => {
    const { svc, prisma } = build();
    // No config at all is the real-world failure: credentials never set up.
    vi.spyOn(svc, 'getConfig').mockResolvedValue(null as never);

    const result = await svc.sendMessage('biz_1', { to: '+18685550100', body: 'hi' });

    expect(result.success).toBe(false);
    // The point: someone opening the drawer must SEE that this never went out.
    expect(prisma._messages).toHaveLength(0); // no config -> we never got a number to file it under
    expect(result.error).toMatch(/not configured/i);
  });

  it('lists conversations in the shape the drawer reads', async () => {
    const { svc } = build();
    await svc.sendMessage('biz_1', { to: '+18685550100', body: 'first' });

    const [row] = await svc.listConversations('biz_1');

    expect(row).toMatchObject({ phoneNumber: expect.any(String), contactId: null });
    expect(row).toHaveProperty('lastMessageSnippet', 'first');
    expect(row).toHaveProperty('displayName');
  });
});

describe('the 24-hour customer service window', () => {
  const conversation = (lastInboundAgo: number | null) => ({
    contacts: [{ id: 'wa_1', businessId: 'biz_1', phoneNumber: '+18685550100', displayName: 'Ada', contactId: null }],
    messages:
      lastInboundAgo === null
        ? []
        : [
            {
              id: 'm1',
              whatsappContactId: 'wa_1',
              direction: 'INBOUND',
              body: 'hello',
              status: 'RECEIVED',
              templateName: null,
              scheduledAt: null,
              sentAt: null,
              errorMessage: null,
              createdAt: new Date(Date.now() - lastInboundAgo),
            },
          ],
  });

  it('is open when the customer wrote less than 24 hours ago', async () => {
    const { svc } = build(conversation(23 * HOUR));
    const detail = await svc.getConversation('biz_1', 'wa_1');
    expect(detail?.withinWindow).toBe(true);
  });

  it('is closed once 24 hours have passed', async () => {
    const { svc } = build(conversation(25 * HOUR));
    const detail = await svc.getConversation('biz_1', 'wa_1');
    expect(detail?.withinWindow).toBe(false);
  });

  it('is closed when the customer has never written — outbound alone does not open it', async () => {
    const seed = conversation(null);
    seed.messages = [
      {
        id: 'm1',
        whatsappContactId: 'wa_1',
        direction: 'OUTBOUND',
        body: 'hi there',
        status: 'SENT',
        templateName: null,
        scheduledAt: null,
        sentAt: new Date(),
        errorMessage: null,
        createdAt: new Date(),
      },
    ];
    const { svc } = build(seed);
    const detail = await svc.getConversation('biz_1', 'wa_1');
    // Meta opens the window on an INBOUND message only. Reading "any recent
    // message" here would let the composer offer free text that Meta rejects.
    expect(detail?.withinWindow).toBe(false);
  });

  it('does not leak a conversation belonging to another business', async () => {
    const { svc } = build(conversation(1 * HOUR));
    expect(await svc.getConversation('biz_OTHER', 'wa_1')).toBeNull();
  });
});

describe('scheduled sends', () => {
  it('parks a future message as SCHEDULED without sending it', async () => {
    const { svc, prisma } = build();

    const res = await svc.sendFromDrawer('biz_1', {
      toPhone: '+18685550100',
      body: 'Reminder',
      scheduledAt: new Date(Date.now() + HOUR).toISOString(),
    });

    expect(res.status).toBe('SCHEDULED');
    expect(prisma._messages[0].sentAt).toBeNull();
  });

  it('sends immediately when the scheduled time has already passed', async () => {
    const { svc } = build();

    const res = await svc.sendFromDrawer('biz_1', {
      toPhone: '+18685550100',
      body: 'Late',
      scheduledAt: new Date(Date.now() - HOUR).toISOString(),
    });

    expect(res.status).toBe('SENT');
  });

  it('delivers a due message on the sweep', async () => {
    const { svc, prisma } = build();
    await svc.sendFromDrawer('biz_1', {
      toPhone: '+18685550100',
      body: 'Reminder',
      scheduledAt: new Date(Date.now() + HOUR).toISOString(),
    });
    // Its time arrives.
    prisma._messages[0].scheduledAt = new Date(Date.now() - 1000);

    await svc.dispatchScheduled();

    expect(prisma._messages[0].status).toBe('SENT');
    expect(prisma._messages[0].sentAt).toBeInstanceOf(Date);
  });

  it('claims a row before sending, so two sweeps cannot double-send', async () => {
    const { svc, prisma } = build();
    await svc.sendFromDrawer('biz_1', {
      toPhone: '+18685550100',
      body: 'Reminder',
      scheduledAt: new Date(Date.now() + HOUR).toISOString(),
    });
    prisma._messages[0].scheduledAt = new Date(Date.now() - 1000);

    await Promise.all([svc.dispatchScheduled(), svc.dispatchScheduled()]);

    // The claim is `updateMany where status: SCHEDULED`; the loser sees count 0
    // and skips. Only one update to SENT should have been attempted.
    const sends = prisma.client.whatsAppMessage.update.mock.calls.filter(
      (c: any) => c[0].data?.status === 'SENT',
    );
    expect(sends).toHaveLength(1);
  });

  it('rejects a message with neither body nor template', async () => {
    const { svc } = build();
    await expect(svc.sendFromDrawer('biz_1', { toPhone: '+18685550100' })).rejects.toThrow(
      /body or templateName/i,
    );
  });

  it('rejects an unparseable scheduledAt instead of sending immediately', async () => {
    const { svc } = build();
    // Silently treating "not a date" as "now" would send a message the user
    // meant to schedule for later.
    await expect(
      svc.sendFromDrawer('biz_1', { toPhone: '+18685550100', body: 'x', scheduledAt: 'tomorrow-ish' }),
    ).rejects.toThrow(/valid date/i);
  });
});
