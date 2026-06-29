import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CrmAdapterService } from './crm-adapter.service';
import { CrmService } from '../../crm/crm.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

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
    (crm.updateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1', status: 'customer' });
    const result = await service.execute(mkCmd('update_status', { contactId: 'c1', status: 'customer' }));
    expect(result.success).toBe(true);
    expect(crm.updateContact).toHaveBeenCalledWith(expect.objectContaining({ status: 'customer' }));
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
});
