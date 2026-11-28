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
import { CrmTimelineService, formatNoteEventPreview, hydrateNoteCreatedEvents } from './crm-timeline.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmJourneyService } from './crm-journey.service';
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
    const filtered = overrides.notes.filter((n) => {
      if (where.businessId && n.businessId !== where.businessId) return false;
      if (where.contactId && n.contactId !== where.contactId) return false;
      if (where.id?.in && !where.id.in.includes(n.id)) return false;
      return true;
    });
    const skip = args?.skip ?? 0;
    const take = args?.take ?? filtered.length;
    return filtered.slice(skip, skip + take);
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
      findUnique: vi.fn().mockResolvedValue({
        id: CONTACT_1,
        firstName: 'Ada',
        lastName: 'Lovelace',
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: null,
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: CONTACT_1,
          firstName: 'Ada',
          lastName: 'Lovelace',
          displayName: 'Ada Lovelace',
          email: 'ada@example.com',
          phone: null,
        },
      ]),
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
      count: vi.fn().mockResolvedValue(overrides.events.length),
    },
    contactNote: {
      findMany: contactNoteFindMany,
    },
    contactTask: { findMany: vi.fn().mockResolvedValue([]) },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
    quote: { findMany: vi.fn().mockResolvedValue([]) },
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

  it('never leaks deleted, cross-tenant, or same-tenant cross-contact notes, reflects live edits, and strips non-string stale data.body', async () => {
    const events = [
      {
        id: 'ev_deleted',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_deleted', body: 12345, description: 'stale secret' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:00:00Z'),
      },
      {
        id: 'ev_foreign_tenant',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_other_tenant' },
        source: 'crm',
        createdAt: new Date('2026-11-27T11:30:00Z'),
      },
      {
        id: 'ev_other_contact',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_other_contact' },
        source: 'crm',
        createdAt: new Date('2026-11-27T11:00:00Z'),
      },
      {
        id: 'ev_edited',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_edited', body: 999 },
        source: 'crm',
        createdAt: new Date('2026-11-27T10:00:00Z'),
      },
    ];
    const notes = [
      { id: 'note_other_tenant', businessId: 'biz_OTHER', contactId: CONTACT_1, body: 'TOP SECRET OTHER TENANT', createdAt: new Date() },
      { id: 'note_other_contact', businessId: BIZ_A, contactId: 'con_OTHER', body: 'PRIVATE OTHER CONTACT NOTE', createdAt: new Date() },
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

    // Deleted note strips stale non-string body and stale description
    expect((listed[0].data as Record<string, unknown>).body).toBeUndefined();
    expect((listed[0].data as Record<string, unknown>).description).toBeUndefined();

    // Cross-tenant noteId is never hydrated
    expect((listed[1].data as Record<string, unknown>).body).toBeUndefined();
    expect((listed[1].data as Record<string, unknown>).description).toBeUndefined();

    // Same-business cross-contact noteId is never hydrated
    expect((listed[2].data as Record<string, unknown>).body).toBeUndefined();
    expect((listed[2].data as Record<string, unknown>).description).toBeUndefined();

    // Edited note replaces stale non-string body with live text
    expect((listed[3].data as Record<string, unknown>).body).toBe('Updated final note');
    expect((listed[3].data as Record<string, unknown>).description).toBe('Updated final note');
  });

  it('hydrates note.created events in CrmStatsService.contactDetail including notes outside the prefetched 50 via scoped DB fallback', async () => {
    const notes = Array.from({ length: 51 }, (_, idx) => ({
      id: `note_${idx + 1}`,
      businessId: BIZ_A,
      contactId: CONTACT_1,
      body: idx === 0 ? 'Top prefetched note' : idx === 50 ? 'Older note #51 outside take:50' : `Note ${idx + 1}`,
      createdAt: new Date(Date.UTC(2026, 10, 27, 12, 0, 51 - idx)),
    }));
    const events = [
      {
        id: 'ev_in_top',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_1' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:00:51Z'),
      },
      {
        id: 'ev_outside_50',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'note_51' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:00:01Z'),
      },
    ];

    const { client, contactNoteFindMany } = makeViewerMockClient({ events, notes });
    const cache = { get: vi.fn(), set: vi.fn(), invalidate: vi.fn() } as unknown as CrmCacheService;
    const stats = new CrmStatsService(
      { client } as unknown as PrismaService,
      undefined as unknown as CrmTimelineService,
      cache,
    );

    const detail = await stats.contactDetail({
      businessId: BIZ_A,
      contactId: CONTACT_1,
      actorUserId: VIEWER_OWNER,
    });

    expect((detail.events[0].data as Record<string, unknown>).body).toBe('Top prefetched note');
    expect((detail.events[0].data as Record<string, unknown>).description).toBe('Top prefetched note');
    expect((detail.events[1].data as Record<string, unknown>).body).toBe('Older note #51 outside take:50');
    expect((detail.events[1].data as Record<string, unknown>).description).toBe('Older note #51 outside take:50');

    // Second call must fetch ONLY the missing note_51 with strict businessId + contactId binding
    expect(contactNoteFindMany).toHaveBeenCalledTimes(2);
    expect(contactNoteFindMany).toHaveBeenNthCalledWith(2, {
      where: { businessId: BIZ_A, contactId: CONTACT_1, id: { in: ['note_51'] } },
      select: { id: true, body: true },
    });
  });

  it('hydrates note.created events beyond take:20 in CrmJourneyService.getContactCrossJourney and skips referral events', async () => {
    const notes = Array.from({ length: 25 }, (_, idx) => ({
      id: `jnote_${idx + 1}`,
      businessId: BIZ_A,
      contactId: CONTACT_1,
      body: idx === 24 ? 'Journey note #25 outside take:20 prefetch' : `Journey note ${idx + 1}`,
      createdAt: new Date(Date.UTC(2026, 10, 27, 12, 0, 25 - idx)),
    }));
    const events = [
      {
        id: 'jev_older',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'jnote_25' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:00:01Z'),
      },
      {
        id: 'jev_deleted',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'jnote_deleted', description: 'stale' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:00:00Z'),
      },
      {
        id: 'jev_referral',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { kind: 'referral.sent', noteId: 'jnote_25' },
        source: 'crm-network',
        createdAt: new Date('2026-11-27T11:59:59Z'),
      },
    ];

    const { client, contactNoteFindMany } = makeViewerMockClient({ events, notes });
    const journey = new CrmJourneyService({ client } as unknown as PrismaService);

    const res = await journey.getContactCrossJourney(BIZ_A, CONTACT_1, VIEWER_OWNER);
    const olderItem = res.timeline.find((t) => t.id === 'jev_older');
    const deletedItem = res.timeline.find((t) => t.id === 'jev_deleted');
    const referralItem = res.timeline.find((t) => t.id === 'jev_referral');

    expect(olderItem?.description).toBe('Journey note #25 outside take:20 prefetch');
    expect(deletedItem?.description).toBeUndefined();
    expect(referralItem?.description).toBeUndefined();
    expect(contactNoteFindMany).toHaveBeenCalledWith({
      where: { businessId: BIZ_A, contactId: CONTACT_1, id: { in: ['jnote_25', 'jnote_deleted'] } },
      select: { id: true, body: true },
    });
  });

  it('hydrates getContactTimeline and buildTimeline (including DB fallback beyond prefetch cap, multi-contact isolation, options.contacts forwarding, and deleted fallbacks)', async () => {
    const notes = [
      ...Array.from({ length: 11 }, (_, idx) => ({
        id: `tl_${idx + 1}`,
        businessId: BIZ_A,
        contactId: CONTACT_1,
        body: idx === 10 ? 'Older note #11 outside prefetch cap' : `Recent note ${idx + 1}`,
        createdAt: new Date(Date.UTC(2026, 10, 27, 12, 0, 11 - idx)),
      })),
      {
        id: 'tl_other_contact_note',
        businessId: BIZ_A,
        contactId: 'con_OTHER',
        body: 'OTHER CONTACT SECRET',
        createdAt: new Date('2026-11-27T11:00:00Z'),
      },
    ];
    const events = [
      {
        id: 'tle_fallback',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'tl_11' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:05:00Z'),
      },
      {
        id: 'tle_cross_contact',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'tl_other_contact_note' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:04:30Z'),
      },
      {
        id: 'tle_deleted',
        businessId: BIZ_A,
        contactId: CONTACT_1,
        type: 'note.created',
        data: { noteId: 'tl_missing' },
        source: 'crm',
        createdAt: new Date('2026-11-27T12:04:00Z'),
      },
    ];

    const { client, contactNoteFindMany } = makeViewerMockClient({ events, notes });
    const service = new CrmTimelineService(
      { client } as unknown as PrismaService,
      { emit: vi.fn() } as unknown as EventEmitter2,
    );

    const timeline = await service.getContactTimeline(BIZ_A, CONTACT_1, 10);
    expect(timeline.find((e) => e.id === 'tle_fallback')?.description).toBe('Older note #11 outside prefetch cap');
    expect(timeline.find((e) => e.id === 'tle_cross_contact')?.description).toBe('Event recorded via crm');
    expect(timeline.find((e) => e.id === 'tle_deleted')?.description).toBe('Event recorded via crm');
    expect(contactNoteFindMany).toHaveBeenCalledWith({
      where: { businessId: BIZ_A, contactId: CONTACT_1, id: { in: ['tl_11', 'tl_other_contact_note', 'tl_missing'] } },
      select: { id: true, body: true },
    });

    contactNoteFindMany.mockClear();
    const visibilityFilter = { visibility: 'BUSINESS' as const };
    const highlights = await service.buildTimeline(BIZ_A, 10, { contacts: visibilityFilter });
    expect(highlights.find((e) => e.id === 'tle_fallback')?.description).toBe('Older note #11 outside prefetch cap');
    expect(highlights.find((e) => e.id === 'tle_cross_contact')?.description).toBe('Event recorded via crm');
    expect(highlights.find((e) => e.id === 'tle_deleted')?.description).toBe('Event recorded via crm');
    expect(contactNoteFindMany).toHaveBeenCalledWith({
      where: {
        businessId: BIZ_A,
        contact: visibilityFilter,
        id: { in: ['tl_11', 'tl_other_contact_note', 'tl_missing'] },
      },
      select: { id: true, contactId: true, body: true },
    });
  });

  it('fails closed on prefetchedNotes missing or mismatched businessId/contactId, handles duplicate noteIds, whitespace/multiline bodies, and emoji surrogate-pair boundaries', async () => {
    const emojiBoundary = `${'x'.repeat(119)}😀tail`;
    const events = [
      { id: 'e1', type: 'note.created', data: { noteId: 'n_dup' } },
      { id: 'e2', type: 'note.created', data: { noteId: 'n_dup' } },
      { id: 'e3', type: 'note.created', data: { noteId: 'n_ws' } },
      { id: 'e4', type: 'note.created', data: { noteId: 'n_emoji' } },
    ];
    const notes = [
      { id: 'n_dup', businessId: BIZ_A, contactId: CONTACT_1, body: 'Line 1\n\n  Line 2  ' },
      { id: 'n_ws', businessId: BIZ_A, contactId: CONTACT_1, body: '   \n\t  ' },
      { id: 'n_emoji', businessId: BIZ_A, contactId: CONTACT_1, body: emojiBoundary },
    ];

    const { client, contactNoteFindMany } = makeViewerMockClient({ events, notes });
    // Pass poisoned prefetched notes (missing businessId/contactId or mismatched) — must fail closed and hit scoped DB lookup!
    const poisonedPrefetch = [
      { id: 'n_dup', body: 'POISONED NO TENANT' },
      { id: 'n_dup', businessId: 'biz_OTHER', contactId: CONTACT_1, body: 'POISONED OTHER BIZ' },
      { id: 'n_dup', businessId: BIZ_A, contactId: 'con_OTHER', body: 'POISONED OTHER CONTACT' },
    ] as unknown as Array<{ id: string; businessId: string; contactId: string; body: string }>;

    const hydrated = await hydrateNoteCreatedEvents(
      { client } as unknown as PrismaService,
      BIZ_A,
      CONTACT_1,
      events,
      poisonedPrefetch,
    );

    expect(contactNoteFindMany).toHaveBeenCalledWith({
      where: { businessId: BIZ_A, contactId: CONTACT_1, id: { in: ['n_dup', 'n_ws', 'n_emoji'] } },
      select: { id: true, body: true },
    });

    // Duplicate noteIds both hydrate with normalized whitespace preview
    expect((hydrated[0].data as Record<string, unknown>).description).toBe('Line 1 Line 2');
    expect((hydrated[1].data as Record<string, unknown>).description).toBe('Line 1 Line 2');

    // Whitespace-only note preserves body but omits blank description
    expect((hydrated[2].data as Record<string, unknown>).body).toBe('   \n\t  ');
    expect((hydrated[2].data as Record<string, unknown>).description).toBeUndefined();

    // Emoji at code-point 120 is not split into a lone surrogate
    const emojiDesc = (hydrated[3].data as Record<string, unknown>).description as string;
    expect(emojiDesc).toBe(`${'x'.repeat(119)}😀…`);
    expect(formatNoteEventPreview('   \n  ')).toBe('');
  });
});
