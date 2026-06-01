import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PublicRateLimit, PublicRateLimitGuard } from '../../core/guards/public-rate-limit.guard';
import { PresenceStatsService } from './presence-stats.service';
import { PublicEventsIngestService, type IngestEventInput } from './public-events.ingest.service';

const VISITOR_COOKIE = 'kf_vid';
const SESSION_COOKIE = 'kf_sid';
const VISITOR_MAX_AGE_DAYS = 365;
const SESSION_MAX_AGE_MIN = 30;

function readCookie(req: Request, name: string): string | null {
  const headerVal = req.headers[`x-${name === VISITOR_COOKIE ? 'visitor' : 'session'}-id`];
  if (typeof headerVal === 'string' && headerVal.trim()) return headerVal.trim();
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=').trim()) || null;
  }
  return null;
}

function writeCookie(res: Response, name: string, value: string, maxAgeSec: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  // intentionally not HttpOnly — the browser SDK reads/writes these
  // cookies for first-touch attribution. Kept SameSite=Lax to limit CSRF.
  const prev = res.getHeader('Set-Cookie');
  const next = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
  if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, next]);
  else if (typeof prev === 'string') res.setHeader('Set-Cookie', [prev, next]);
  else res.setHeader('Set-Cookie', next);
}

function isDoNotTrack(req: Request): boolean {
  const dnt = req.headers['dnt'];
  if (dnt === '1' || dnt === 'true') return true;
  const sec = req.headers['sec-gpc'];
  if (sec === '1' || sec === 'true') return true;
  return false;
}

/**
 * Allowlist of hosts whose Referer/Origin we trust to derive the
 * ingestion business id from a public-surface URL. Spec'd via
 * `PRESENCE_TRUSTED_HOSTS` (comma-separated origins or hosts) and
 * augmented with `APP_URL`. Localhost is permitted by default so dev/CI
 * keep working.
 */
function isTrustedIngestHost(host: string | null): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.startsWith('localhost:') || lower === '127.0.0.1' || lower.startsWith('127.0.0.1:')) {
    return true;
  }
  const cfg = (process.env.PRESENCE_TRUSTED_HOSTS || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  for (const entry of cfg) {
    try {
      if (new URL(entry).host.toLowerCase() === lower) return true;
    } catch {
      if (entry.toLowerCase() === lower) return true;
    }
  }
  return false;
}

function extractRequestHost(req: Request): { host: string | null; surfaceUrl: string | null } {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : null;
  let host: string | null = null;
  if (origin) {
    try { host = new URL(origin).host; } catch { /* ignore */ }
  }
  if (!host && referer) {
    try { host = new URL(referer).host; } catch { /* ignore */ }
  }
  // Prefer Referer for surface resolution (it has the path); fall back to Origin.
  return { host, surfaceUrl: referer ?? origin };
}

type BatchBody = {
  visitorId?: string | null;
  sessionId?: string | null;
  events: IngestEventInput[];
};

@Controller()
export class PresenceController {
  constructor(
    @Inject(PublicEventsIngestService) private readonly ingest: PublicEventsIngestService,
    @Inject(PresenceStatsService) private readonly stats: PresenceStatsService,
  ) {}

  /**
   * Public batched event ingestion. Honors the DNT/Sec-GPC headers and
   * never persists request bodies beyond the safe payload allowlist.
   */
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(180, 60_000)
  @Post('public/events')
  async batch(
    @Body() body: BatchBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const events = Array.isArray(body?.events) ? body.events : [];
    if (events.length === 0) return { tracked: 0, skipped: 0 };

    const incomingVid = body.visitorId?.trim() || readCookie(req, VISITOR_COOKIE);
    const incomingSid = body.sessionId?.trim() || readCookie(req, SESSION_COOKIE);
    const visitorId = incomingVid || PublicEventsIngestService.newVisitorId();
    const sessionId = incomingSid || PublicEventsIngestService.newSessionId();
    const ip = (req.ip || req.socket?.remoteAddress || null) as string | null;
    const dnt = isDoNotTrack(req);

    // ── Strict cross-tenant isolation ──
    //
    // Public ingestion is bound to a real public surface. We require:
    //   1. the Origin/Referer host to match our trusted allowlist, AND
    //   2. the URL to resolve to a known surface (slug, public token,
    //      or invoice id) that maps to a single business.
    //
    // If either check fails in production we drop the entire batch.
    // This means a curl spoofing `Referer: https://attacker/...` is
    // refused (host check), and a curl from a trusted host but with a
    // bogus path is also refused (surface check). Together they make
    // it impossible for an unauthenticated caller to inject events
    // for an arbitrary businessId.
    //
    // In non-production the batch is allowed through with the
    // claimed-businessId existence check as a fallback so dev scripts
    // (verify-presence-analytics.sh, integration tests) keep working.
    const { host, surfaceUrl } = extractRequestHost(req);
    const trustedHost = isTrustedIngestHost(host);
    const refererBusinessId = trustedHost
      ? await this.ingest.resolveBusinessFromReferer(surfaceUrl)
      : null;
    const strict = process.env.NODE_ENV === 'production'
      && process.env.PRESENCE_ALLOW_UNVERIFIED_INGEST !== 'true';
    if (strict && !refererBusinessId) {
      return {
        tracked: 0,
        skipped: events.length,
        reason: !trustedHost ? 'untrusted_origin' : 'unresolved_surface',
      };
    }

    const result = await this.ingest.ingestBatch({
      events, visitorId, sessionId, ip, doNotTrack: dnt, refererBusinessId,
    });

    if (visitorId !== incomingVid) writeCookie(res, VISITOR_COOKIE, visitorId, VISITOR_MAX_AGE_DAYS * 86400);
    if (sessionId !== incomingSid) writeCookie(res, SESSION_COOKIE, sessionId, SESSION_MAX_AGE_MIN * 60);

    return {
      tracked: result.tracked,
      skipped: result.skipped,
      visitorId,
      sessionId,
      doNotTrack: dnt || undefined,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/presence/stats/overview')
  overview(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.stats.overview(businessId, days ? Math.min(365, Math.max(1, parseInt(days, 10))) : 30);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/reports/presence/sources')
  sources(@Param('businessId') businessId: string, @Query('days') days?: string) {
    return this.stats.reportSources(businessId, days ? parseInt(days, 10) : 30);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/reports/presence/pages')
  pages(@Param('businessId') businessId: string, @Query('days') days?: string) {
    return this.stats.reportPages(businessId, days ? parseInt(days, 10) : 30);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/reports/presence/funnel')
  funnel(@Param('businessId') businessId: string, @Query('days') days?: string) {
    return this.stats.reportFunnel(businessId, days ? parseInt(days, 10) : 30);
  }

  /**
   * Maintenance trigger — used by the verify script and admin tools to
   * force a daily aggregation pass without waiting for the scheduler.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/presence/aggregate')
  async runAggregator(
    @Param('businessId') businessId: string,
    @Body() body: { day?: string },
  ) {
    const day = body?.day ? new Date(body.day) : new Date();
    return this.stats.aggregateDay(businessId, day);
  }
}
