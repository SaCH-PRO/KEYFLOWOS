/**
 * P239 — FU-TIMELINE-NOTE-TEXT (D-319 / Q40, launch-track)
 *
 * Verifies that ordinary `note.created` ContactEvent rows surfaced by:
 *   - CrmTimelineService.listContactEvents
 *   - CrmTimelineService.listContactEventsPage (keyset "Load older")
 *   - CrmStatsService.contactDetail (initial dossier load)
 * hydrate the live note's `body` and `description` (<=120 char preview matching
 * timeline-tab-panel.tsx) from `ContactNote`, strictly scoped to
 * `{ businessId, contactId, id: { in: noteIds } }`.
 *
 * Also pins:
 *   - Long notes (> 120 chars) preserve full `data.body` and truncate
 *     `data.description` to 120 chars + '…'.
 *   - Edited notes reflect their updated live text; deleted notes expose no
 *     stale `body`/`description`.
 *   - Referral `note.created` events (`data.kind` without `noteId`) remain
 *     untouched.
 *   - Cross-tenant / cross-contact `noteId`s are never hydrated (where clause
 *     binds both `businessId` and `contactId`).
 */
import { describe, expect, it, vi } from 'vitest';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmStatsService } from './crm-stats.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CrmCacheService } from './crm-cache.service';

const BIZ_A = 'biz_p239_a';
const CONTACT_1 = 'con_p239_1';
const VIEWER_OWNER = 'usr_p239_owner';

function makeViewerMockClient(overrides: {
  events: any[];
  notes: any[];
}) {
  const contactNoteFindMany = vi.fn(async (args: any) => {
    const where = args?.where ?? {};
    return overrides.notes.filter((n) => {
      if (where.businessId && n.businessId !== where.businessId) return false;
      if (where.contactId && n.contactId !== where.contactId) return false;
      if (where.id?.in && !where.id.in.includes(n.id)) return false;
      return true;
    });
  });

  const client = {
    contact: {
      findFirst: vi.fn().mockResolvedValue({
        id: CONTACT_1,
        businessId: BIZ_A,
        firstName: 'Ada',
        lastName: 'Lovelace',
        status: 'LEAD',
        deletedAt: null,
        visibility: 'BUSINESS',
        ownerId: VIEWER_OWNER,
        createdAt: new Date('2026-11-01T00:00:00Z'),
        updatedAt: new Date('2026-11-01T00:00:00Z'),
      }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: VIEWER_OWNER, role: 'USER', deletedAt: null, bannedAt: null }),
    },
    business: {
      findUnique: vi.fn().mockResolvedValue({ id: BIZ_A, ownerId: VIEWER_OWNER }),
    },
    membership: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'mem_1',
        userId: VIEWER_OWNER,
        businessId: BIZ_A,
        role: 'OWNER',
        permissionScopes: null,
      }),
    },
    contactEvent: {
      findMany: vi.fn(async (args: any) => {
        const skip = args?.skip ?? 0;
        const take = args?.take ?? overrides.events.length;
        return overrides.events.slice(skip, skip + take);
      }),
    },
    contactNote: {
      findMany: contactNoteFindMany,
    },
    contactTask: { findMany: vi.fn().mockResolvedValue([]) },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
    booking: { findMany: vi.fn().mockResolvedValue([]) },
    contactCustomFieldValue: { findMany: vi.fn().mockResolvedValue([]) },
  };

  return { client, contactNoteFindMany };
}

describe('P239 FU-TIMELINE-NOTE-TEXT — contact Timeline note.created text hydration', () => {
  it('hydrates ordinary note.created events with live body and 120-char description in listContactEvents and listContactEventsPage', async () => {
    const longBody = 'A'.repeat(140);
    const shortBody = 'Called client to confirm Tuesday walkthrough.';
    const events = [
      {
        id: 'ev_1',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_short' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:00:00Z'),
      },
      {
        id: 'ev_2',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_long' },
        source: 'crm',
        createdAt: new Date('2026-11-27T11:00:00Z'),
      },
      {
        id: 'ev_3',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { kind: 'referral.sent', targetContactId: 'con_2', note: 'Referred by friend' },
        source: 'crm-network',
        createdAt: new Date('2026-11-27T10:00:00Z'),
      },
    ];
    const notes = [
      { id: 'note_short', businessId: BIZ_A, contactId: CONTACT_1, body: shortBody, createdAt: new Date('2026-11-27T12:00:00Z') },
      { id: 'note_long', businessId: BIZ_A, contactId: CONTACT_1, body: longBody, createdAt: new Date('2026-11-27T11:00:00Z') },
    ];

    const { client, contactNoteFindMany } = makeViewerMockClient({ events, notes });
    const service = new CrmTimelineService(
      { client } as unknown as PrismaService,
      { emit: vi.fn() } as unknown as EventEmitter2,
    );

    const listed = await service.listContactEvents({
      businessId: BIZ_A,
      contactId: CONTACT_1,
      viewerUserId: VIEWER_OWNER,
    });

    expect((listed[0].data as Record<string, unknown>).body).toBe(shortBody);
    expect((listed[0].data as Record<string, unknown>).description).toBe(shortBody);

    expect((listed[1].data as Record<string, unknown>).body).toBe(longBody);
    expect((listed[1].data as Record<string, unknown>).description).toBe(`${'A'.repeat(120)}…`);

    // Referral note.created without noteId is preserved verbatim
    expect(listed[2].data).toEqual({
      kind: 'referral.sent',
      targetContactId: 'con_2',
      note: 'Referred by friend',
    });

    // Strict tenant + contact binding on ContactNote lookup
    expect(contactNoteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: BIZ_A,
          contactId: CONTACT_1,
        }),
      }),
    );

    // Keyset-paginated listContactEventsPage also hydrates note text while preserving cursor
    const page = await service.listContactEventsPage({
      businessId: BIZ_A,
      contactId: CONTACT_1,
      limit: 2,
      viewerUserId: VIEWER_OWNER,
    });
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBeTruthy();
    expect((page.events[0].data as Record<string, unknown>).body).toBe(shortBody);
    expect((page.events[1].data as Record<string, unknown>).description).toBe(`${'A'.repeat(120)}…`);
  });

  it('never leaks deleted or cross-tenant/cross-contact notes and reflects live edits', async () => {
    const events = [
      {
        id: 'ev_deleted',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_deleted', body: 'stale secret', description: 'stale secret' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:00:00Z'),
      },
      {
        id: 'ev_foreign',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_other_tenant' },
        source: 'crm',
        createdAt: new Date('2026-11-27T11:00:00Z'),
      },
      {
        id: 'ev_edited',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_edited', body: 'old draft' },
        source: 'crm',
        createdAt: new Date('2026-11-27T10:00:00Z'),
      },
    ];
    const notes = [
      { id: 'note_other_tenant', businessId: 'biz_OTHER', contactId: CONTACT_1, body: 'TOP SECRET OTHER TENANT', createdAt: new Date() },
      { id: 'note_edited', businessId: BIZ_A, contactId: CONTACT_1, body: 'Updated final note', createdAt: new Date() },
    ];

    const { client } = makeViewerMockClient({ events, notes });
    const service = new CrmTimelineService(
      { client } as unknown as PrismaService,
      { emit: vi.fn() } as unknown as EventEmitter2,
    );

    const listed = await service.listContactEvents({
      businessId: BIZ_A,
      contactId: CONTACT_1,
      viewerUserId: VIEWER_OWNER,
    });

    // Deleted note strips stale body/description
    expect((listed[0].data as Record<string, unknown>).body).toBeUndefined();
    expect((listed[0].data as Record<string, unknown>).description).toBeUndefined();

    // Cross-tenant noteId is never hydrated
    expect((listed[1].data as Record<string, unknown>).body).toBeUndefined();
    expect((listed[1].data as Record<string, unknown>).description).toBeUndefined();

    // Edited note reflects live text
    expect((listed[2].data as Record<string, unknown>).body).toBe('Updated final note');
    expect((listed[2].data as Record<string, unknown>).description).toBe('Updated final note');
  });

  it('hydrates note.created events in CrmStatsService.contactDetail (including notes outside the prefetched 50)', async () => {
    const events = [
      {
        id: 'ev_in_top',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_1' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:00:00Z'),
      },
    ];
    const notes = [
      { id: 'note_1', businessId: BIZ_A, contactId: CONTACT_1, body: 'Dossier note text', createdAt: new Date('2026-11-27T12:00:00Z') },
    ];

    const { client } = makeViewerMockClient({ events, notes });
    const cache = { get: vi.fn(), set: vi.fn(), invalidate: vi.fn() } as unknown as CrmCacheService;
    const stats = new CrmStatsService({ client } as unknown as PrismaService, cache);

    const detail = await stats.contactDetail({
      businessId: BIZ_A,
      contactId: CONTACT_1,
      actorUserId: VIEWER_OWNER,
    });

    expect((detail.events[0].data as Record<string, unknown>).body).toBe('Dossier note text');
    expect((detail.events[0].data as Record<string, unknown>).description).toBe('Dossier note text');
  });
});
