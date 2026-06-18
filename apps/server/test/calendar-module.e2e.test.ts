import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CalendarController } from '../src/modules/calendar/calendar.controller';
import { CalendarQueryService } from '../src/modules/calendar/calendar-query.service';
import { CalendarPermissionService } from '../src/modules/calendar/calendar-permission.service';
import { CalendarProjectionService } from '../src/modules/calendar/calendar-projection.service';
import { CalendarConflictService } from '../src/modules/calendar/calendar-conflict.service';
import { CalendarInsightService } from '../src/modules/calendar/calendar-insight.service';
import { GoogleCalendarTemporalSyncService } from '../src/modules/calendar/connectors/google-calendar-temporal-sync.service';
import { ModelGatewayService } from '../src/modules/ai/model-gateway.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { Reflector } from '@nestjs/core';

interface DbEvent {
  id: string;
  businessId: string;
  title: string;
  description: string | null;
  type: string;
  module: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timezone: string | null;
  status: string;
  priority: string;
  color: string | null;
  visibility: string;
  sourceType: string;
  sourceId: string;
  sourceUrl: string | null;
  contactId: string | null;
  staffId: string | null;
  assigneeId: string | null;
  amount: number | null;
  currency: string | null;
  meta: unknown;
  syncStatus: string;
  googleEventId: string | null;
  googleCalendarId: string | null;
  lastSyncedAt: Date | null;
  syncError: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  contact?: { ownerId: string | null; visibility: string } | null;
}

function makeEvent(over: Partial<DbEvent>): DbEvent {
  const now = new Date('2030-01-01T00:00:00.000Z');
  return {
    id: over.id ?? `evt_${Math.random().toString(36).slice(2, 8)}`,
    businessId: over.businessId ?? 'biz_1',
    title: over.title ?? 'Untitled',
    description: over.description ?? null,
    type: over.type ?? 'BOOKING',
    module: over.module ?? 'BOOKINGS',
    startAt: over.startAt ?? now,
    endAt: over.endAt ?? null,
    allDay: over.allDay ?? false,
    timezone: over.timezone ?? null,
    status: over.status ?? 'SCHEDULED',
    priority: over.priority ?? 'NORMAL',
    color: over.color ?? null,
    visibility: over.visibility ?? 'TEAM',
    sourceType: over.sourceType ?? 'booking',
    sourceId: over.sourceId ?? 'bk_1',
    sourceUrl: over.sourceUrl ?? null,
    contactId: over.contactId ?? null,
    staffId: over.staffId ?? null,
    assigneeId: over.assigneeId ?? null,
    amount: over.amount ?? null,
    currency: over.currency ?? null,
    meta: over.meta ?? null,
    syncStatus: over.syncStatus ?? 'LOCAL',
    googleEventId: over.googleEventId ?? null,
    googleCalendarId: over.googleCalendarId ?? null,
    lastSyncedAt: over.lastSyncedAt ?? null,
    syncError: over.syncError ?? null,
    createdAt: over.createdAt ?? now,
    updatedAt: over.updatedAt ?? now,
    deletedAt: over.deletedAt ?? null,
    contact: over.contact ?? null,
  };
}

class PrismaMock {
  events: DbEvent[] = [];
  client: any;

  constructor() {
    const self = this;
    self.client = {
      business: {
        findFirst: vi.fn(({ where }: any) =>
          where.id === 'biz_1' ? Promise.resolve({ id: 'biz_1' }) : Promise.resolve(null),
        ),
      },
      user: {
        findUnique: vi.fn(() => Promise.resolve({ id: 'user_owner', role: 'USER' })),
      },
      membership: {
        findUnique: vi.fn(({ where }: any) => {
          if (where.userId_businessId.userId === 'user_owner') {
            return Promise.resolve({ role: 'OWNER', permissionScopes: null });
          }
          return Promise.resolve({
            role: 'STAFF',
            permissionScopes: { bookings: 'write', crm: 'read' },
          });
        }),
      },
      contact: {
        findFirst: vi.fn(() =>
          Promise.resolve({ ownerId: 'user_owner', shares: [] }),
        ),
      },
      calendarEvent: {
        count: vi.fn(({ where }: any) =>
          Promise.resolve(self.filter(where).length),
        ),
        findMany: vi.fn(({ where, take, cursor, skip }: any) => {
          const filtered = self.filter(where);
          filtered.sort((a, b) => {
            const d = a.startAt.getTime() - b.startAt.getTime();
            return d !== 0 ? d : a.id.localeCompare(b.id);
          });
          let start = 0;
          if (cursor?.id) {
            const idx = filtered.findIndex((e) => e.id === cursor.id);
            if (idx >= 0) start = idx + (skip ?? 0);
          }
          const sliced = filtered.slice(start);
          return Promise.resolve(take ? sliced.slice(0, take) : sliced);
        }),
        findFirst: vi.fn(({ where }: any) => {
          const found = self.events.find(
            (e) =>
              e.id === where.id &&
              e.businessId === where.businessId &&
              e.deletedAt === null,
          );
          return Promise.resolve(found ?? null);
        }),
        upsert: vi.fn(({ where, create }: any) => {
          const key = where.businessId_sourceType_sourceId;
          const existing = self.events.find(
            (e) =>
              e.businessId === key.businessId &&
              e.sourceType === key.sourceType &&
              e.sourceId === key.sourceId,
          );
          const ev = makeEvent({ ...(existing ?? {}), ...create });
          if (existing) Object.assign(existing, ev);
          else self.events.push(ev);
          return Promise.resolve(existing ?? ev);
        }),
        update: vi.fn(({ where, data }: any) => {
          const ev = self.events.find((e) => e.id === where.id);
          if (!ev) return Promise.reject(new Error('not found'));
          Object.assign(ev, data);
          return Promise.resolve(ev);
        }),
        groupBy: vi.fn(({ where }: any) => {
          const filtered = self.filter(where);
          const m = new Map<string, { module: string; type: string; _count: { _all: number }; _sum: { amount: number | null } }>();
          for (const e of filtered) {
            const key = `${e.module}|${e.type}`;
            const cur = m.get(key) ?? {
              module: e.module,
              type: e.type,
              _count: { _all: 0 },
              _sum: { amount: 0 },
            };
            cur._count._all += 1;
            cur._sum.amount = (cur._sum.amount ?? 0) + (e.amount ?? 0);
            m.set(key, cur);
          }
          return Promise.resolve(Array.from(m.values()));
        }),
      },
      booking: {
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      contactTask: {
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      projectTask: {
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      socialPost: {
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      project: {
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
    };
  }

  filter(where: any): DbEvent[] {
    return this.events.filter((e) => {
      if (where.businessId && e.businessId !== where.businessId) return false;
      if (where.deletedAt === null && e.deletedAt !== null) return false;
      if (where.module && typeof where.module === 'object' && where.module.in) {
        if (!where.module.in.includes(e.module)) return false;
      }
      if (where.type && typeof where.type === 'object' && where.type.in) {
        if (!where.type.in.includes(e.type)) return false;
      }
      if (where.startAt) {
        if (where.startAt.gte && e.startAt.getTime() < where.startAt.gte.getTime()) return false;
        if (where.startAt.lt && e.startAt.getTime() >= where.startAt.lt.getTime()) return false;
      }
      if (where.endAt && where.endAt.not !== undefined && e.endAt === null) return false;
      return true;
    });
  }
}

describe('CalendarController (C2)', () => {
  let app: INestApplication;
  let prismaMock: PrismaMock;

  beforeAll(async () => {
    prismaMock = new PrismaMock();

    const moduleRef = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        Reflector,
        CalendarQueryService,
        CalendarPermissionService,
        CalendarProjectionService,
        CalendarConflictService,
        CalendarInsightService,
        {
          provide: GoogleCalendarTemporalSyncService,
          useValue: {
            syncBusiness: vi.fn().mockResolvedValue({ synced: 0, skipped: 0 }),
          },
        },
        {
          provide: (await import('../src/modules/calendar/calendar-sync.service')).CalendarSyncService,
          useValue: {
            getStatus: vi.fn(),
            getSettings: vi.fn(),
            patchSettings: vi.fn(),
            listAvailableCalendars: vi.fn(),
            getAuthUrl: vi.fn(),
            handleOAuthCallback: vi.fn(),
            disconnect: vi.fn(),
            triggerSync: vi.fn(),
          },
        },
        {
          provide: ModelGatewayService,
          useValue: {
            complete: vi.fn(async () => ({
              text: '{}',
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            })),
          },
        },
        {
          provide: (await import('../src/modules/ai/ai-usage.service')).AiUsageService,
          useValue: {
            trackAndComplete: vi.fn(async (_biz: string, _uid: string | undefined, _feature: string, request: any) => ({
              text: '{}',
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            })),
          },
        },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user_owner' };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // Seed events: a booking, a content post, an external event, and a
    // private event owned by another staff member.
    prismaMock.events.push(
      makeEvent({
        id: 'evt_booking',
        type: 'BOOKING',
        module: 'BOOKINGS',
        startAt: new Date('2030-06-01T10:00:00Z'),
        endAt: new Date('2030-06-01T11:00:00Z'),
        sourceType: 'booking',
        sourceId: 'bk_1',
        amount: 100,
        currency: 'TTD',
      }),
      makeEvent({
        id: 'evt_content',
        type: 'CONTENT_POST',
        module: 'MARKETING',
        startAt: new Date('2030-06-01T15:00:00Z'),
        sourceType: 'social_post',
        sourceId: 'sp_1',
      }),
      makeEvent({
        id: 'evt_google',
        type: 'EXTERNAL_GOOGLE_EVENT',
        module: 'EXTERNAL',
        startAt: new Date('2030-06-01T16:00:00Z'),
        sourceType: 'google_event',
        sourceId: 'g_1',
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /events', () => {
    it('returns events within a date range and reports the cap', async () => {
      const res = await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/events')
        .query({
          start: '2030-06-01T00:00:00Z',
          end: '2030-06-02T00:00:00Z',
        })
        .expect(200);

      expect(res.body.events).toHaveLength(3);
      expect(res.body.cap).toBe(1000);
      expect(res.body.truncated).toBe(false);
      expect(res.body.total).toBe(3);
      expect(res.body.limit).toBe(200);
      expect(res.body.nextCursor).toBeNull();
    });

    it('paginates with limit + cursor', async () => {
      const first = await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/events')
        .query({ limit: 2 })
        .expect(200);
      expect(first.body.events).toHaveLength(2);
      expect(first.body.limit).toBe(2);
      expect(first.body.nextCursor).toBe(first.body.events[1].id);

      const second = await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/events')
        .query({ limit: 2, cursor: first.body.nextCursor })
        .expect(200);
      const firstIds = first.body.events.map((e: any) => e.id);
      for (const ev of second.body.events) {
        expect(firstIds).not.toContain(ev.id);
      }
    });

    it('rejects invalid limit values', async () => {
      await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/events')
        .query({ limit: '-5' })
        .expect(400);
    });

    it('filters by module', async () => {
      const res = await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/events')
        .query({ modules: 'BOOKINGS' })
        .expect(200);

      expect(res.body.events.map((e: any) => e.id)).toEqual(['evt_booking']);
    });

    it('rejects unsupported filter values', async () => {
      await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/events')
        .query({ types: 'NOT_A_TYPE' })
        .expect(400);
    });
  });

  describe('GET /agenda', () => {
    it('returns events for a single day', async () => {
      const res = await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/agenda')
        .query({ day: '2030-06-01' })
        .expect(200);
      expect(res.body.events).toHaveLength(3);
    });

    it('rejects when day is missing or malformed', async () => {
      await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/agenda')
        .expect(400);
      await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/agenda')
        .query({ day: 'tomorrow' })
        .expect(400);
    });
  });

  describe('GET /conflicts', () => {
    it('flags overlapping events for the same staff member', async () => {
      prismaMock.events.push(
        makeEvent({
          id: 'evt_overlap_a',
          startAt: new Date('2030-07-01T10:00:00Z'),
          endAt: new Date('2030-07-01T11:00:00Z'),
          staffId: 'staff_1',
          sourceType: 'booking',
          sourceId: 'bk_overlap_a',
        }),
        makeEvent({
          id: 'evt_overlap_b',
          startAt: new Date('2030-07-01T10:30:00Z'),
          endAt: new Date('2030-07-01T11:30:00Z'),
          staffId: 'staff_1',
          sourceType: 'booking',
          sourceId: 'bk_overlap_b',
        }),
      );

      const res = await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/conflicts')
        .query({
          from: '2030-07-01T00:00:00Z',
          to: '2030-07-02T00:00:00Z',
        })
        .expect(200);

      expect(res.body.conflicts.length).toBeGreaterThanOrEqual(1);
      const staffConflict = res.body.conflicts.find(
        (c: any) => c.kind === 'staff_double_booking',
      );
      expect(staffConflict).toBeDefined();
      expect(staffConflict.severity).toBe('high');
      expect(staffConflict.message).toMatch(/staff/i);
      expect(staffConflict.eventIds).toEqual(
        expect.arrayContaining(['evt_overlap_a', 'evt_overlap_b']),
      );
    });
  });

  describe('GET /daily-plan', () => {
    it('returns a deterministic plan when the AI gateway returns empty', async () => {
      const res = await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/daily-plan')
        .query({ day: '2030-06-01' })
        .expect(200);

      expect(res.body.date).toBeDefined();
      expect(res.body.greeting).toBeDefined();
      expect(Array.isArray(res.body.topPriorities)).toBe(true);
      expect(Array.isArray(res.body.focusBlocks)).toBe(true);
      expect(Array.isArray(res.body.warnings)).toBe(true);
    });
  });

  describe('GET /weekly-capacity', () => {
    it('returns a 7-day capacity breakdown', async () => {
      const res = await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/weekly-capacity')
        .query({ weekStart: '2030-06-01' })
        .expect(200);

      expect(res.body.weekStart).toBeDefined();
      expect(Array.isArray(res.body.byDay)).toBe(true);
      expect(res.body.byDay.length).toBe(7);
      expect(typeof res.body.totalScheduledHours).toBe('number');
      expect(Array.isArray(res.body.recommendations)).toBe(true);
    });
  });

  describe('GET /insights', () => {
    it('summarizes events by module/type and reports revenue', async () => {
      const res = await request(app.getHttpServer())
        .get('/calendar/businesses/biz_1/insights')
        .query({
          from: '2030-06-01T00:00:00Z',
          to: '2030-06-02T00:00:00Z',
        })
        .expect(200);

      expect(res.body.totalEvents).toBe(3);
      expect(res.body.totalRevenue).toBe(100);
      expect(res.body.byModule).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'BOOKINGS' }),
          expect.objectContaining({ key: 'MARKETING' }),
          expect.objectContaining({ key: 'EXTERNAL' }),
        ]),
      );
      expect(Array.isArray(res.body.hints)).toBe(true);
      expect(Array.isArray(res.body.conflicts)).toBe(true);
    });
  });

  describe('POST /events (manual)', () => {
    it('creates a manual event and projects it', async () => {
      const res = await request(app.getHttpServer())
        .post('/calendar/businesses/biz_1/events')
        .send({
          title: 'Focus block',
          type: 'ACTIVITY_LOG',
          startAt: '2030-08-01T09:00:00Z',
          endAt: '2030-08-01T10:00:00Z',
        })
        .expect(201);

      expect(res.body.title).toBe('Focus block');
      expect(res.body.sourceType).toBe('manual');
      expect(res.body.staffId).toBe('user_owner');
      expect(prismaMock.events.find((e) => e.title === 'Focus block')).toBeDefined();
    });

    it('rejects when endAt is not after startAt', async () => {
      await request(app.getHttpServer())
        .post('/calendar/businesses/biz_1/events')
        .send({
          title: 'Bad block',
          type: 'ACTIVITY_LOG',
          startAt: '2030-08-01T09:00:00Z',
          endAt: '2030-08-01T08:00:00Z',
        })
        .expect(400);
    });
  });

  describe('PATCH /events/:id', () => {
    it('updates the projection and writes back to the booking row', async () => {
      const res = await request(app.getHttpServer())
        .patch('/calendar/businesses/biz_1/events/evt_booking')
        .send({
          startAt: '2030-06-01T12:00:00Z',
          endAt: '2030-06-01T13:00:00Z',
          status: 'CONFIRMED',
        })
        .expect(200);

      expect(new Date(res.body.startAt).toISOString()).toBe(
        '2030-06-01T12:00:00.000Z',
      );
      expect(res.body.status).toBe('CONFIRMED');
      expect(prismaMock.client.booking.updateMany).toHaveBeenCalled();
    });
  });

  describe('DELETE /events/:id', () => {
    it('soft-cancels the event and propagates to the source', async () => {
      const res = await request(app.getHttpServer())
        .delete('/calendar/businesses/biz_1/events/evt_content')
        .expect(200);

      expect(res.body).toEqual({ id: 'evt_content', cancelled: true });
      const ev = prismaMock.events.find((e) => e.id === 'evt_content');
      expect(ev?.deletedAt).toBeInstanceOf(Date);
      expect(ev?.status).toBe('CANCELLED');
      expect(prismaMock.client.socialPost.updateMany).toHaveBeenCalled();
    });
  });
});
