import { describe, expect, it, vi } from 'vitest';

vi.mock('../../core/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

vi.mock('../ai/model-gateway.service', () => ({
  ModelGatewayService: class {},
}));

import { CallScriptService } from './call-script.service';

describe('CallScriptService', () => {
  const inBusiness = (row: any, where: any) =>
    row && (where.businessId === undefined || row.businessId === where.businessId) ? row : null;
  const withRelations = (contact: any) =>
    contact
      ? { ...contact, deals: contact.deals ?? [], invoices: contact.invoices ?? [], bookings: contact.bookings ?? [], tasks: contact.tasks ?? [] }
      : null;

  function createMockPrisma() {
    const store = {
      callLogs: new Map<string, any>(),
      contacts: new Map<string, any>(),
    };

    return {
      client: {
        contact: {
          // findUnique answers by id alone, as Prisma does with no tenant context (the staff bridge)
          findUnique: vi.fn(async (args: any) => withRelations(store.contacts.get(args.where.id))),
          findFirst: vi.fn(async (args: any) => withRelations(inBusiness(store.contacts.get(args.where.id), args.where))),
        },
        callLog: {
          findUnique: vi.fn(async (args: any) =>
            store.callLogs.get(args.where.id) ?? null,
          ),
          findFirst: vi.fn(async (args: any) => inBusiness(store.callLogs.get(args.where.id), args.where)),
          update: vi.fn(async (args: any) => {
            const existing = store.callLogs.get(args.where.id);
            if (!existing) return null;
            const updated = { ...existing, ...args.data };
            store.callLogs.set(args.where.id, updated);
            return updated;
          }),
        },
      },
      store,
    };
  }

  function createMockGateway() {
    return {
      complete: vi.fn(async () => ({
        content: JSON.stringify({
          greeting: 'Hi John!',
          talkingPoints: ['How are you?', 'Wanted to follow up'],
          ask: 'Are you ready to move forward?',
          close: 'Thanks for your time!',
          durationEstimate: 5,
        }),
        provider: 'openai',
        model: 'gpt-4o',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCost: 0.001 },
        latencyMs: 500,
        fallbackUsed: false,
      })),
    };
  }

  it('generates a call script and saves it', async () => {
    const prisma = createMockPrisma();
    const gateway = createMockGateway();
    const svc = new CallScriptService(prisma as any, gateway as any);

    prisma.store.contacts.set('contact_1', {
      id: 'contact_1',
      businessId: 'biz_1',
      firstName: 'John',
      lastName: 'Doe',
      displayName: 'John Doe',
      companyName: 'Acme Inc',
      status: 'LEAD',
      lastInteractionAt: new Date('2026-05-01'),
      deals: [],
      invoices: [],
      bookings: [],
      tasks: [],
    });

    prisma.store.callLogs.set('cl_1', {
      id: 'cl_1',
      businessId: 'biz_1',
      contactId: 'contact_1',
      callerId: 'user_1',
    });

    const result = await svc.generateScript('biz_1', 'cl_1', 'contact_1');

    expect(result.greeting).toBe('Hi John!');
    expect(result.talkingPoints).toHaveLength(2);
    expect(result.ask).toBe('Are you ready to move forward?');
    expect(result.close).toBe('Thanks for your time!');
    expect(result.durationEstimate).toBe(5);
    expect(prisma.client.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cl_1' },
        data: expect.objectContaining({ script: expect.any(String) }),
      }),
    );
  });

  it('throws if contact not found', async () => {
    const prisma = createMockPrisma();
    const gateway = createMockGateway();
    const svc = new CallScriptService(prisma as any, gateway as any);

    await expect(svc.generateScript('biz_1', 'cl_1', 'missing')).rejects.toThrow('Contact not found');
  });

  it('throws if call log not found', async () => {
    const prisma = createMockPrisma();
    const gateway = createMockGateway();
    const svc = new CallScriptService(prisma as any, gateway as any);

    prisma.store.contacts.set('contact_1', {
      id: 'contact_1',
      businessId: 'biz_1',
      firstName: 'John',
      status: 'LEAD',
      deals: [],
      invoices: [],
      bookings: [],
      tasks: [],
    });

    await expect(svc.generateScript('biz_1', 'missing', 'contact_1')).rejects.toThrow('Call log not found');
  });

  it('infers goal from context', async () => {
    const prisma = createMockPrisma();
    const gateway = createMockGateway();
    const svc = new CallScriptService(prisma as any, gateway as any);

    prisma.store.contacts.set('contact_1', {
      id: 'contact_1',
      businessId: 'biz_1',
      firstName: 'John',
      status: 'LEAD',
      deals: [{ title: 'Big Deal', value: 5000, currency: 'TTD', status: 'OPEN', stage: { name: 'Proposal' } }],
      invoices: [],
      bookings: [],
      tasks: [],
    });

    prisma.store.callLogs.set('cl_1', {
      id: 'cl_1',
      businessId: 'biz_1',
      contactId: 'contact_1',
      callerId: 'user_1',
    });

    await svc.generateScript('biz_1', 'cl_1', 'contact_1');
    expect(gateway.complete).toHaveBeenCalled();
    const prompt = (gateway.complete.mock.calls as any)[0][0].messages[1].content;
    expect(prompt).toContain('Follow up on open deal');
  });

  /**
   * V1-21b review 8 DD8-1: call_generate_script hands generateScript a call log id and a contact
   * id the model chose. On the WhatsApp/SMS staff bridge no tenant context binds a bare-id lookup,
   * so another business's contact went into the script prompt and its call log took the script.
   */
  describe("another business's rows are not found (review 8 DD8-1)", () => {
    function seeded() {
      const prisma = createMockPrisma();
      const gateway = createMockGateway();
      const svc = new CallScriptService(prisma as any, gateway as any);
      prisma.store.contacts.set('contact_mine', { id: 'contact_mine', businessId: 'biz_1', firstName: 'Mine', status: 'LEAD' });
      prisma.store.contacts.set('contact_theirs', { id: 'contact_theirs', businessId: 'biz_theirs', firstName: 'THEIR-SECRET', status: 'LEAD' });
      prisma.store.callLogs.set('cl_mine', { id: 'cl_mine', businessId: 'biz_1', contactId: 'contact_mine', callerId: 'user_1' });
      prisma.store.callLogs.set('cl_theirs', { id: 'cl_theirs', businessId: 'biz_theirs', contactId: 'contact_theirs', callerId: 'user_t' });
      return { prisma, gateway, svc };
    }

    it("their call log: nothing generated, nothing written", async () => {
      const { prisma, gateway, svc } = seeded();
      await expect(svc.generateScript('biz_1', 'cl_theirs', 'contact_mine')).rejects.toThrow('Call log not found');
      expect(gateway.complete).not.toHaveBeenCalled();
      expect(prisma.client.callLog.update).not.toHaveBeenCalled();
    });

    it('their contact: it never reaches the prompt', async () => {
      const { prisma, gateway, svc } = seeded();
      await expect(svc.generateScript('biz_1', 'cl_mine', 'contact_theirs')).rejects.toThrow('Contact not found');
      expect(gateway.complete).not.toHaveBeenCalled();
      expect(prisma.client.callLog.update).not.toHaveBeenCalled();
    });

    it('its own rows still make a script', async () => {
      const { gateway, svc } = seeded();
      await svc.generateScript('biz_1', 'cl_mine', 'contact_mine');
      expect(gateway.complete).toHaveBeenCalledTimes(1);
      expect(JSON.stringify((gateway.complete.mock.calls as any)[0][0])).not.toContain('THEIR-SECRET');
    });
  });
});
