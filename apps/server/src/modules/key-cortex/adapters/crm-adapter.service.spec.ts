import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CrmAdapterService } from './crm-adapter.service';
import { CrmService } from '../../crm/crm.service';
import { ConnectorCommand } from '../key-cortex-connector.types';
import { isContactStatus, type ContactStatus } from '../../crm/crm.constants';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'crm',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('CrmAdapterService', () => {
  let service: CrmAdapterService;
  let crm: CrmService;

  beforeEach(() => {
    crm = {
      createContact: vi.fn(),
      contactDetail: vi.fn(),
      updateContact: vi.fn(),
      softDeleteContact: vi.fn(),
      listContacts: vi.fn(),
      addTask: vi.fn(),
      completeTask: vi.fn(),
      addNote: vi.fn(),
      mergeContacts: vi.fn(),
      listContactTasks: vi.fn(),
      logContactEvent: vi.fn(),
      listContactEvents: vi.fn(),
      listContactNotes: vi.fn(),
      getContactTimeline: vi.fn(),
      countContacts: vi.fn(),
      getContactStats: vi.fn(),
    } as unknown as CrmService;

    service = new CrmAdapterService(crm);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  it('create_contact delegates to CrmService.createContact', async () => {
    (crm.createContact as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
    const result = await service.execute(mkCmd('create_contact', { firstName: 'John' }));
    expect(result.success).toBe(true);
    expect(crm.createContact).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'John', source: 'key_cortex' }));
  });

  it('get_contact returns contact detail', async () => {
    (crm.contactDetail as ReturnType<typeof vi.fn>).mockResolvedValue({ contact: { id: 'c1' } });
    const result = await service.execute(mkCmd('get_contact', { contactId: 'c1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'c1' });
  });

  it('delete_contact delegates to softDeleteContact', async () => {
    (crm.softDeleteContact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const result = await service.execute(mkCmd('delete_contact', { contactId: 'c1' }));
    expect(result.success).toBe(true);
    expect(crm.softDeleteContact).toHaveBeenCalledWith({ businessId: 'biz_123', contactId: 'c1' });
  });

  it('add_tag merges tags and updates contact', async () => {
    (crm.contactDetail as ReturnType<typeof vi.fn>).mockResolvedValue({ contact: { id: 'c1', tags: ['existing'] } });
    (crm.updateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1', tags: ['existing', 'vip'] });
    const result = await service.execute(mkCmd('add_tag', { contactId: 'c1', tags: ['vip'] }));
    expect(result.success).toBe(true);
    expect(crm.updateContact).toHaveBeenCalledWith(expect.objectContaining({ tags: ['existing', 'vip'] }));
  });

  it('update_status delegates to updateContact', async () => {
    (crm.updateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1', status: 'CLIENT' });
    const result = await service.execute(mkCmd('update_status', { contactId: 'c1', status: 'customer' }));
    expect(result.success).toBe(true);
    // D-92 (review CR-D92-1): before D-92 this case pinned 'customer' handed
    // to updateContact verbatim; the legacy CUSTOMER in any case is CLIENT.
    expect(crm.updateContact).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'c1', status: 'CLIENT' }));
  });

  it('log_event delegates to logContactEvent', async () => {
    (crm.logContactEvent as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'e1' });
    const result = await service.execute(mkCmd('log_event', { contactId: 'c1', eventType: 'page_view' }));
    expect(result.success).toBe(true);
    expect(crm.logContactEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'page_view', actorType: 'SYSTEM', source: 'key_cortex' }));
  });

  // ── Queries (Phase 1.1) ───────────────────────────────────────────────────

  it('get_contact_timeline delegates to getContactTimeline', async () => {
    (crm.getContactTimeline as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 't1' }]);
    const result = await service.execute(mkCmd('get_contact_timeline', { contactId: 'c1', limit: 10 }));
    expect(result.success).toBe(true);
    expect(crm.getContactTimeline).toHaveBeenCalledWith('biz_123', 'c1', 10);
    expect(result.data).toEqual([{ id: 't1' }]);
  });

  it('count_contacts returns count', async () => {
    (crm.countContacts as ReturnType<typeof vi.fn>).mockResolvedValue(42);
    const result = await service.execute(mkCmd('count_contacts', { status: 'customer', tag: 'vip' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ count: 42 });
    expect(crm.countContacts).toHaveBeenCalledWith({ businessId: 'biz_123', status: 'customer', tag: 'vip' });
  });

  it('get_tasks delegates to listContactTasks with mapped status', async () => {
    (crm.listContactTasks as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'task1' }]);
    const result = await service.execute(mkCmd('get_tasks', { contactId: 'c1', status: 'open' }));
    expect(result.success).toBe(true);
    expect(crm.listContactTasks).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_123', contactId: 'c1', status: 'OPEN' }));
  });

  it('get_recent_contacts returns newest contacts after since', async () => {
    const since = new Date('2026-01-01').toISOString();
    (crm.listContacts as ReturnType<typeof vi.fn>).mockResolvedValue({
      contacts: [
        { id: 'c1', createdAt: '2026-06-01T00:00:00.000Z' },
        { id: 'c2', createdAt: '2025-12-01T00:00:00.000Z' },
      ],
    });
    const result = await service.execute(mkCmd('get_recent_contacts', { since, limit: 5 }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'c1', createdAt: '2026-06-01T00:00:00.000Z' }]);
    expect(crm.listContacts).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'newest', take: 5 }));
  });

  it('search_contacts delegates to listContacts with search query', async () => {
    (crm.listContacts as ReturnType<typeof vi.fn>).mockResolvedValue({ contacts: [{ id: 'c1' }] });
    const result = await service.execute(mkCmd('search_contacts', { query: 'Acme', limit: 10 }));
    expect(result.success).toBe(true);
    expect(crm.listContacts).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_123', search: 'Acme', take: 10 }));
    expect(result.data).toEqual([{ id: 'c1' }]);
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown CRM action');
  });

  // ── D-92 (owner ruling; W4-D92-DORMANT-AS-CLIENT review CR-D92-1) ─────────
  // KEY Cortex writes Contact.status outside the CRM DTOs (create_contact,
  // update_contact, update_status). Before D-92 it handed CrmService the status
  // verbatim ('DORMANT', 'dormant', 'customer', 'ACTIVE', the 'lead' default),
  // so a stored status could fall outside CONTACT_STATUSES, and the lowercase
  // spellings were read as CLIENT by no status reader (isClientStatus is exact).

  describe('D-92 (review CR-D92-1): KEY Cortex stores a contact status only through canonicalContactStatus', () => {
    const CANONICAL: Array<[string, ContactStatus]> = [
      ['DORMANT', 'CLIENT'],
      ['dormant', 'CLIENT'],
      [' Dormant ', 'CLIENT'],
      ['CUSTOMER', 'CLIENT'],
      ['customer', 'CLIENT'],
      ['lead', 'LEAD'],
      ['Prospect', 'PROSPECT'],
      ['CLIENT', 'CLIENT'],
      ['lost', 'LOST'],
    ];
    const REFUSED = ['ACTIVE', 'active', 'INACTIVE', 'churned', 'partner', 'VIP', '   '];

    it('D-92: update_status hands updateContact DORMANT and CUSTOMER in any case as CLIENT and a canonical status in any case as itself', async () => {
      (crm.updateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
      for (const [status, stored] of CANONICAL) {
        (crm.updateContact as ReturnType<typeof vi.fn>).mockClear();
        const result = await service.execute(mkCmd('update_status', { contactId: 'c1', status }));
        expect(result.success, status).toBe(true);
        expect(crm.updateContact, status).toHaveBeenCalledTimes(1);
        const written = (crm.updateContact as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(written.status, status).toBe(stored);
        expect(isContactStatus(written.status), status).toBe(true);
      }
    });

    it('D-92: update_status refuses ACTIVE, INACTIVE, a word with no ContactStatus, a blank or a missing status, and writes nothing', async () => {
      for (const status of [...REFUSED, '', undefined]) {
        await expect(service.execute(mkCmd('update_status', { contactId: 'c1', status })), String(status)).rejects.toThrow(/not a contact status/);
      }
      expect(crm.updateContact).not.toHaveBeenCalled();
    });

    it('D-92: update_contact stores a named status through canonicalContactStatus, leaves the status alone when it names none, and refuses a status with no ContactStatus without writing any field', async () => {
      (crm.updateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
      await service.execute(mkCmd('update_contact', { contactId: 'c1', status: 'dormant', firstName: 'Ada' }));
      expect(crm.updateContact).toHaveBeenLastCalledWith(expect.objectContaining({ contactId: 'c1', status: 'CLIENT', firstName: 'Ada' }));
      await service.execute(mkCmd('update_contact', { contactId: 'c1', firstName: 'Ada' }));
      expect((crm.updateContact as ReturnType<typeof vi.fn>).mock.lastCall![0].status).toBeUndefined();
      (crm.updateContact as ReturnType<typeof vi.fn>).mockClear();
      for (const status of REFUSED) {
        await expect(service.execute(mkCmd('update_contact', { contactId: 'c1', status, firstName: 'Ada' })), status).rejects.toThrow(/not a contact status/);
      }
      expect(crm.updateContact).not.toHaveBeenCalled();
    });

    it("D-92: create_contact stores LEAD (not 'lead') when it names no status, a named status through canonicalContactStatus, and refuses a status with no ContactStatus without creating the contact", async () => {
      (crm.createContact as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
      await service.execute(mkCmd('create_contact', { firstName: 'Ada' }));
      expect(crm.createContact).toHaveBeenLastCalledWith(expect.objectContaining({ firstName: 'Ada', status: 'LEAD' }));
      for (const [status, stored] of CANONICAL) {
        await service.execute(mkCmd('create_contact', { firstName: 'Ada', status }));
        expect((crm.createContact as ReturnType<typeof vi.fn>).mock.lastCall![0].status, status).toBe(stored);
      }
      (crm.createContact as ReturnType<typeof vi.fn>).mockClear();
      for (const status of REFUSED) {
        await expect(service.execute(mkCmd('create_contact', { firstName: 'Ada', status })), status).rejects.toThrow(/not a contact status/);
      }
      expect(crm.createContact).not.toHaveBeenCalled();
    });

    it('D-92: through KeyCortexConnectorService a refused status is the connector failure shape, not a thrown error', { timeout: 60_000 }, async () => {
      const { KeyCortexConnectorService } = await import('../key-cortex-connector.service');
      const connector = Object.create(KeyCortexConnectorService.prototype) as InstanceType<typeof KeyCortexConnectorService>;
      Object.assign(connector, {
        adapterMap: { crm: service },
        logger: { error: () => undefined, warn: () => undefined, log: () => undefined },
      });
      const result = await connector.execute(mkCmd('update_status', { contactId: 'c1', status: 'ACTIVE' }));
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not a contact status/);
      expect(crm.updateContact).not.toHaveBeenCalled();
    });
  });
});
