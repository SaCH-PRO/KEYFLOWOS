/**
 * W11-PROVIDER-OUTAGE-CONNECT (R-5 part 3; owner ruling D-73): the remaining
 * Google and Microsoft Graph clients tell an outage (503 provider_unavailable)
 * from a refusal (400), as GmailService and GoogleDriveService do since
 * W11-PROVIDER-OUTAGE-503. Pure: a stubbed fetch and a recording Prisma stub,
 * no database, no network. The real-database proof over HTTP is
 * test/provider-outage-connect.integration.test.ts.
 *
 * The defect: every non-OK upstream answer of these clients was
 * BadRequestException, so a caller could not tell "Google is down, try again"
 * from "your request is wrong". Two sites even said "please retry" with a 400:
 * the People API 410 (google-contacts-sync.service.ts, the sync token was just
 * cleared) and the Graph 410 (outlook-contacts-sync.service.ts, the delta link
 * was just cleared).
 *
 * The contract proven here, client by client (each keeps its existing message):
 *   - Google clients (People sync, Forms, Business Profile, CRM Google import,
 *     Calendar list): an upstream 503, a 429 or a rate-limited 403 rejects with
 *     ServiceUnavailableException { code: 'provider_unavailable', service:
 *     <its id>, message, upstreamStatus }; a 404 or a 400 stays
 *     BadRequestException.
 *   - The Graph client (Outlook Contacts sync): 5xx, 408 and 429 are outages;
 *     every other 4xx (a 409, a 403 whatever its body says) stays 400: Graph
 *     has no Google `reason` field.
 *   - People 410 and Graph 410 still clear the stored sync token / delta link
 *     (the update is recorded) and now reject with 503 provider_unavailable
 *     carrying the existing "please retry" message and upstreamStatus 410.
 *   - Token refreshes (GoogleTokenHelper for each service's columns,
 *     MicrosoftTokenHelper, CrmGoogleService.refreshAccessToken, the Calendar
 *     refresh): 400 / 401 (invalid_grant, invalid_client: reconnect) stay 400;
 *     a 503 or a 429 gives 503. A failed refresh writes no token.
 * Unchanged, and pinned: the connect-flow consent sites (CRM Google code
 * exchange, Calendar code exchange), the business-validation 400s, and a fetch
 * that throws (its error propagates). (The Business Profile insights answer
 * was pinned here too, outside that packet's sites; FU-PROVIDER-ERROR-HYGIENE
 * moves it into the table.)
 *
 * RED-BEFORE (pkt base c72069ac, int/v1-base + W11-PROVIDER-OUTAGE-503): every
 * outage case, both 410 cases and every refresh-outage case fail (each site
 * answered BadRequestException); the refusal and unchanged cases pass.
 *
 * FU-PROVIDER-ERROR-HYGIENE (D-221, review follow-up C8): the provider's body
 * never reaches a message. Four of these sites put it there: the Google token
 * refresh ('Failed to refresh <label> token: <body>'), the Microsoft one
 * ('Failed to refresh Outlook Contacts token: <body>'), Forms create
 * ('Forms API error <status>: <body>') and the Graph delta ('Graph API error
 * <status>: <first 200 characters of the body>'), and since the rows above
 * those messages reach the client in a 503 too. Each now keeps its message
 * without the body ('Failed to refresh <label> token', 'Failed to refresh
 * Outlook Contacts token', 'Forms API error <status>', 'Graph API error
 * <status>'), for an outage and a refusal alike. And the Business Profile
 * insights read (getInsights), which answered every Performance API failure
 * 400 'Performance API <status>: <body>', answers an outage 503
 * provider_unavailable (google_business_profile) through providerFailure and
 * a refusal 400, both 'Performance API <status>'. RED-BEFORE (chain head
 * b00e5f78): the message rows of those sites (the body is still in them), the
 * insights outage rows (400) and every PEH case fail; the rest pass.
 */
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GoogleTokenHelper } from './google-token.helper';
import { MicrosoftTokenHelper } from './microsoft-token.helper';
import { GoogleContactsSyncService, settingDefaultContactStatus } from './google-contacts-sync.service';
import { OutlookContactsSyncService } from './outlook-contacts-sync.service';
import { GoogleFormsService } from './google-forms.service';
import { GoogleBusinessProfileService } from './google-business-profile.service';
import { CrmGoogleService } from '../crm/crm-google.service';
import { CalendarService } from '../bookings/calendar.service';

const BIZ = 'biz_poc_unit';
const OWNER = 'user_poc_owner';
// Built at runtime: no secret-shaped literal in the fixture.
const ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: ['unit', 'poc', 'google', 'client'].join('-'),
  GOOGLE_CLIENT_SECRET: ['unit', 'poc', 'google', 'value'].join('-'),
  GOOGLE_STATE_SECRET: ['unit', 'poc', 'google', 'state'].join('-'),
  GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/crm/google/callback',
  MICROSOFT_CLIENT_ID: ['unit', 'poc', 'ms', 'client'].join('-'),
  MICROSOFT_CLIENT_SECRET: ['unit', 'poc', 'ms', 'value'].join('-'),
};
const saved: Record<string, string | undefined> = {};

const DELTA_LINK = 'https://graph.microsoft.com/v1.0/me/contacts/delta?$deltatoken=poc_delta_1';
const LOCATION = 'accounts/acct1/locations/loc1';

/** A Google API error body, as googleapis.com answers it. */
function googleError(code: number, status: string, reasons: string[] = []) {
  return JSON.stringify({ error: { code, message: `upstream ${status}`, status, errors: reasons.map((reason) => ({ reason })) } });
}
/** A Microsoft Graph error body (no Google status, no reasons). */
function graphError(code: string) {
  return JSON.stringify({ error: { code, message: `graph says ${code}` } });
}
const INVALID_GRANT = JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
const INVALID_CLIENT = JSON.stringify({ error: 'invalid_client', error_description: 'The OAuth client was not found.' });

// ---------------------------------------------------------------------------
// The recording Prisma stub: one business row holding every connection; reads
// answer from it (connector_status and membership rows: none); every write is
// recorded and answers {}.
// ---------------------------------------------------------------------------
interface Write { model: string; method: string; args: any }
const WRITE_METHODS = new Set(['update', 'updateMany', 'upsert', 'create', 'createMany', 'delete', 'deleteMany']);

function businessRow(expired: boolean) {
  const expiry = new Date(Date.now() + (expired ? -1 : 1) * 60 * 60 * 1000);
  return {
    id: BIZ,
    ownerId: OWNER,
    name: 'POC Unit Biz',
    contactsAccessToken: 'acc_contacts', contactsRefreshToken: 'ref_contacts', contactsTokenExpiry: expiry, contactsSyncToken: 'poc_sync_1',
    formsAccessToken: 'acc_forms', formsRefreshToken: 'ref_forms', formsTokenExpiry: expiry,
    driveAccessToken: 'acc_drive', driveRefreshToken: 'ref_drive', driveTokenExpiry: expiry,
    bpAccessToken: 'acc_bp', bpRefreshToken: 'ref_bp', bpTokenExpiry: expiry, bpAccountId: 'acct1', bpLocationId: 'loc1',
    calendarAccessToken: 'acc_cal', calendarRefreshToken: 'ref_cal', calendarTokenExpiry: expiry, calendarId: null, calendarEmail: 'cal@poc.test',
    gmailAccessToken: 'acc_gmail', gmailRefreshToken: 'ref_gmail', gmailTokenExpiry: expiry, gmailEmail: 'owner@poc.test',
    msContactsAccessToken: 'acc_ms', msContactsRefreshToken: 'ref_ms', msContactsTokenExpiry: expiry, msContactsDeltaLink: DELTA_LINK,
  };
}

function recordingPrisma(opts: { expired?: boolean } = {}) {
  const writes: Write[] = [];
  const row = businessRow(!!opts.expired);
  const reads: Record<string, Record<string, () => unknown>> = {
    business: { findUnique: () => ({ ...row }), findFirst: () => ({ ...row }) },
  };
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, method: string) => {
        if (WRITE_METHODS.has(method)) return async (args: any) => { writes.push({ model: name, method, args }); return {}; };
        const read = reads[name]?.[method];
        if (read) return async () => read();
        if (method === 'findMany') return async () => [];
        if (method === 'count') return async () => 0;
        return async () => null;
      },
    });
  const models = new Map<string, unknown>();
  const client: any = new Proxy({}, {
    get: (_t, key: string) => {
      if (key === '$transaction') return async (fn: (tx: any) => Promise<unknown>) => fn(client);
      if (key === '$queryRaw' || key === '$executeRaw') return async () => [];
      if (typeof key !== 'string' || key.startsWith('$') || key === 'then') return undefined;
      if (!models.has(key)) models.set(key, model(key));
      return models.get(key);
    },
  });
  return { prisma: { client } as any, writes };
}

// ---------------------------------------------------------------------------
// The stubbed fetch: a request `fail` matches answers `status` with `body`;
// the Google and Microsoft token endpoints otherwise grant a fresh token; any
// other request answers 200 with an empty page.
// ---------------------------------------------------------------------------
type Match = (url: string, method: string) => boolean;
let fetched: Array<{ url: string; method: string }> = [];

function stubFetch(fail: Match, status: number, body: string) {
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    fetched.push({ url, method });
    if (fail(url, method)) return new Response(body, { status, headers: { 'content-type': 'application/json' } });
    if (url === 'https://oauth2.googleapis.com/token' || url.startsWith('https://login.microsoftonline.com/')) {
      return new Response(JSON.stringify({ access_token: 'acc_refreshed', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

const isGoogleToken: Match = (u, m) => m === 'POST' && u === 'https://oauth2.googleapis.com/token';
const isMicrosoftToken: Match = (u, m) => m === 'POST' && u.startsWith('https://login.microsoftonline.com/') && u.endsWith('/oauth2/v2.0/token');
const isPeopleList: Match = (u, m) => m === 'GET' && u.startsWith('https://people.googleapis.com/v1/people/me/connections?');
const isGraphDelta: Match = (u, m) => m === 'GET' && u.startsWith('https://graph.microsoft.com/v1.0/me/contacts/delta');
const isPerformance: Match = (u, m) => m === 'GET' && u.startsWith(`https://businessprofileperformance.googleapis.com/v1/${LOCATION}:fetchMultiDailyMetricsTimeSeries?`);

async function failureOf(p: Promise<unknown>): Promise<any> {
  return p.then(() => {
    throw new Error('expected the call to fail');
  }, (e) => e);
}

function expectUnavailable(err: any, service: string, message: string, upstreamStatus: number) {
  expect(err, String(err?.stack ?? err)).toBeInstanceOf(ServiceUnavailableException);
  expect(err.getStatus()).toBe(503);
  expect(err.getResponse()).toEqual({
    code: 'provider_unavailable',
    service,
    message,
    upstreamStatus,
    error: 'Service Unavailable',
  });
  expect(err.message).toBe(message);
}

function expectRefused(err: any, message: string) {
  expect(err, String(err?.stack ?? err)).toBeInstanceOf(BadRequestException);
  expect(err).not.toBeInstanceOf(ServiceUnavailableException);
  expect(err.getStatus()).toBe(400);
  expect(err.message).toBe(message);
  // Exactly what `new BadRequestException(message)` answers today.
  expect(err.getResponse()).toEqual(new BadRequestException(message).getResponse());
}

// The CRM collaborators no failing path reaches: any call is a test failure.
const crmUnreached: any = new Proxy({}, { get: (_t, k) => () => { throw new Error(`unit: CrmService.${String(k)} reached`); } });
const auditUnreached: any = new Proxy({}, { get: (_t, k) => () => { throw new Error(`unit: ContactAuditService.${String(k)} reached`); } });
const eventsUnreached: any = { emit: () => { throw new Error('unit: contact.imported emitted'); } };

function clients(opts: { expired?: boolean } = {}) {
  const { prisma, writes } = recordingPrisma(opts);
  return {
    writes,
    prisma,
    contacts: new GoogleContactsSyncService(prisma, crmUnreached, auditUnreached),
    outlook: new OutlookContactsSyncService(prisma, crmUnreached, auditUnreached),
    forms: new GoogleFormsService(prisma),
    bp: new GoogleBusinessProfileService(prisma),
    crmGoogle: new CrmGoogleService(prisma, crmUnreached, eventsUnreached),
    calendar: new CalendarService(prisma),
  };
}
type Clients = ReturnType<typeof clients>;

/** Writes that store a token or clear a sync cursor on the business row (progress rows are connector_status). */
const businessWrites = (writes: Write[]) => writes.filter((w) => w.model === 'business');

beforeEach(() => {
  for (const key of Object.keys(ENV)) saved[key] = process.env[key];
  Object.assign(process.env, ENV);
  fetched = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(ENV)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

// ---------------------------------------------------------------------------
// Each Google API site: the call, the request it fails, its existing message.
// ---------------------------------------------------------------------------
interface Site {
  name: string;
  service: string;
  match: Match;
  call: (c: Clients) => Promise<unknown>;
  message: (status: number, body: string) => string;
}

const GOOGLE_SITES: Site[] = [
  {
    name: 'GoogleContactsSyncService.sync (People connections list)',
    service: 'google_contacts',
    match: isPeopleList,
    call: (c) => c.contacts.sync(BIZ),
    message: (s) => `People API error ${s}`,
  },
  {
    name: 'GoogleFormsService.createForm',
    service: 'google_forms',
    match: (u, m) => m === 'POST' && u === 'https://forms.googleapis.com/v1/forms',
    call: (c) => c.forms.createForm(BIZ, 'POC form'),
    message: (s) => `Forms API error ${s}`,
  },
  {
    name: 'GoogleFormsService.getForm',
    service: 'google_forms',
    match: (u, m) => m === 'GET' && u === 'https://forms.googleapis.com/v1/forms/form1',
    call: (c) => c.forms.getForm(BIZ, 'form1'),
    message: (s) => `Forms API error ${s}`,
  },
  {
    name: 'GoogleFormsService.listResponses',
    service: 'google_forms',
    match: (u, m) => m === 'GET' && u.startsWith('https://forms.googleapis.com/v1/forms/form1/responses?'),
    call: (c) => c.forms.listResponses(BIZ, 'form1'),
    message: (s) => `Forms API error ${s}`,
  },
  {
    name: 'GoogleFormsService.listForms (Drive files list)',
    service: 'google_forms',
    match: (u, m) => m === 'GET' && u.startsWith('https://www.googleapis.com/drive/v3/files?'),
    call: (c) => c.forms.listForms(BIZ),
    message: (s) => `Drive API error ${s}`,
  },
  {
    name: 'GoogleFormsService.deleteForm (Drive delete)',
    service: 'google_forms',
    match: (u, m) => m === 'DELETE' && u === 'https://www.googleapis.com/drive/v3/files/form1',
    call: (c) => c.forms.deleteForm(BIZ, 'form1'),
    message: (s) => `Drive delete failed: ${s}`,
  },
  {
    name: 'GoogleBusinessProfileService.listAccounts',
    service: 'google_business_profile',
    match: (u, m) => m === 'GET' && u === 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    call: (c) => c.bp.listAccounts(BIZ),
    message: (s) => `Business Profile API error ${s}`,
  },
  {
    name: 'GoogleBusinessProfileService.listLocations',
    service: 'google_business_profile',
    match: (u, m) => m === 'GET' && u.startsWith('https://mybusinessbusinessinformation.googleapis.com/v1/accounts/acct1/locations?'),
    call: (c) => c.bp.listLocations(BIZ, 'acct1'),
    message: (s) => `Business Profile API error ${s}`,
  },
  {
    name: 'GoogleBusinessProfileService.getLocation',
    service: 'google_business_profile',
    match: (u, m) => m === 'GET' && u.startsWith(`https://mybusinessbusinessinformation.googleapis.com/v1/${LOCATION}?`),
    call: (c) => c.bp.getLocation(BIZ, LOCATION),
    message: (s) => `Business Profile API error ${s}`,
  },
  {
    name: 'GoogleBusinessProfileService.listPosts',
    service: 'google_business_profile',
    match: (u, m) => m === 'GET' && u === `https://mybusiness.googleapis.com/v4/${LOCATION}/localPosts`,
    call: (c) => c.bp.listPosts(BIZ, LOCATION),
    message: (s) => `Business Profile API error ${s}`,
  },
  {
    name: 'GoogleBusinessProfileService.createPost',
    service: 'google_business_profile',
    match: (u, m) => m === 'POST' && u === `https://mybusiness.googleapis.com/v4/${LOCATION}/localPosts`,
    call: (c) => c.bp.createPost(BIZ, LOCATION, { summary: 'POC post' }),
    message: (s) => `Business Profile API error ${s}`,
  },
  {
    name: 'GoogleBusinessProfileService.listReviews',
    service: 'google_business_profile',
    match: (u, m) => m === 'GET' && u === `https://mybusiness.googleapis.com/v4/${LOCATION}/reviews`,
    call: (c) => c.bp.listReviews(BIZ, LOCATION),
    message: (s) => `Business Profile API error ${s}`,
  },
  {
    name: 'GoogleBusinessProfileService.replyToReview',
    service: 'google_business_profile',
    match: (u, m) => m === 'PUT' && u === `https://mybusiness.googleapis.com/v4/${LOCATION}/reviews/r1/reply`,
    call: (c) => c.bp.replyToReview(BIZ, `${LOCATION}/reviews/r1`, 'Thank you'),
    message: (s) => `Business Profile API error ${s}`,
  },
  {
    // FU-PROVIDER-ERROR-HYGIENE (D-221): the insights read joins the table (it answered every failure 400 with the body).
    name: 'GoogleBusinessProfileService.getInsights (Performance API)',
    service: 'google_business_profile',
    match: isPerformance,
    call: (c) => c.bp.getInsights(BIZ, LOCATION, 7),
    message: (s) => `Performance API ${s}`,
  },
  {
    name: 'CrmGoogleService.fetchContacts (the CRM Google import)',
    service: 'google_contacts',
    match: isPeopleList,
    call: (c) => c.crmGoogle.fetchContacts('acc_import'),
    message: () => 'Failed to fetch Google contacts',
  },
  {
    name: 'CalendarService.listAvailableCalendars',
    service: 'google_calendar',
    match: (u, m) => m === 'GET' && u.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList?'),
    call: (c) => c.calendar.listAvailableCalendars(BIZ),
    message: () => 'Could not load Google calendars',
  },
];

const OUTAGES: Array<[number, string]> = [
  [503, googleError(503, 'UNAVAILABLE', ['backendError'])],
  [429, googleError(429, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded'])],
  [403, googleError(403, 'PERMISSION_DENIED', ['userRateLimitExceeded'])],
];
const REFUSALS: Array<[number, string]> = [
  [404, googleError(404, 'NOT_FOUND', ['notFound'])],
  [400, googleError(400, 'INVALID_ARGUMENT', ['invalidArgument'])],
];

describe('W11-PROVIDER-OUTAGE-CONNECT: the Google clients answer an outage 503 provider_unavailable and a refusal 400', () => {
  for (const site of GOOGLE_SITES) {
    describe(site.name, () => {
      it.each(OUTAGES)(`[POC-G] an upstream %i (an outage) rejects with 503 {code: provider_unavailable, service: ${site.service}} and the existing message`, async (status, body) => {
        const c = clients();
        stubFetch(site.match, status, body);
        const err = await failureOf(site.call(c));
        expectUnavailable(err, site.service, site.message(status, body), status);
        expect(fetched.filter((f) => site.match(f.url, f.method))).toHaveLength(1);
        expect(businessWrites(c.writes)).toEqual([]);
      });

      it.each(REFUSALS)('[POC-G] an upstream %i (a refusal) stays BadRequestException with the existing message', async (status, body) => {
        const c = clients();
        stubFetch(site.match, status, body);
        expectRefused(await failureOf(site.call(c)), site.message(status, body));
        expect(businessWrites(c.writes)).toEqual([]);
      });
    });
  }
});

describe('W11-PROVIDER-OUTAGE-CONNECT: the Graph client (Outlook Contacts sync) maps by status alone', () => {
  // FU-PROVIDER-ERROR-HYGIENE (D-221): the status, never the body.
  const graphMessage = (status: number) => `Graph API error ${status}`;

  it.each([
    [503, graphError('serviceNotAvailable')],
    [500, graphError('generalException')],
    [429, graphError('TooManyRequests')],
    [408, graphError('requestTimeout')],
  ] as Array<[number, string]>)('[POC-M] a Graph %i rejects with 503 {code: provider_unavailable, service: outlook_contacts} and the existing message; the delta link is kept', async (status, body) => {
    const c = clients();
    stubFetch(isGraphDelta, status, body);
    const err = await failureOf(c.outlook.sync(BIZ));
    expectUnavailable(err, 'outlook_contacts', graphMessage(status), status);
    expect(fetched.filter((f) => isGraphDelta(f.url, f.method)).map((f) => f.url)).toEqual([DELTA_LINK]);
    expect(businessWrites(c.writes)).toEqual([]);
  });

  it.each([
    [404, graphError('ErrorItemNotFound')],
    [400, graphError('BadRequest')],
    [409, graphError('ErrorIrresolvableConflict')],
    // Graph has no Google `reason` / `status` field: a Google-shaped rate-limit or ABORTED body names nothing here.
    [403, googleError(403, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded'])],
    [409, googleError(409, 'ABORTED')],
  ] as Array<[number, string]>)('[POC-M] a Graph %i (a refusal, whatever its body says) stays BadRequestException with the existing message', async (status, body) => {
    const c = clients();
    stubFetch(isGraphDelta, status, body);
    expectRefused(await failureOf(c.outlook.sync(BIZ)), graphMessage(status));
    expect(businessWrites(c.writes)).toEqual([]);
  });
});

describe('W11-PROVIDER-OUTAGE-CONNECT: the two "please retry" 410s clear their cursor and answer 503 provider_unavailable', () => {
  it('[POC-410-1] People 410: contactsSyncToken is cleared (the update is recorded) and the sync rejects with 503 "Sync token expired; please retry", upstreamStatus 410', async () => {
    const c = clients();
    stubFetch(isPeopleList, 410, googleError(410, 'FAILED_PRECONDITION', ['expiredSyncToken']));
    const err = await failureOf(c.contacts.sync(BIZ));
    expectUnavailable(err, 'google_contacts', 'Sync token expired; please retry', 410);
    expect(businessWrites(c.writes)).toEqual([
      { model: 'business', method: 'update', args: { where: { id: BIZ }, data: { contactsSyncToken: null } } },
    ]);
    // The request that answered 410 carried the stored sync token: the next call does a full sync.
    expect(new URL(fetched.find((f) => isPeopleList(f.url, f.method))!.url).searchParams.get('syncToken')).toBe('poc_sync_1');
  });

  it('[POC-410-2] Graph 410: msContactsDeltaLink is cleared (the update is recorded) and the sync rejects with 503 "Outlook delta token expired; please retry", upstreamStatus 410', async () => {
    const c = clients();
    stubFetch(isGraphDelta, 410, graphError('SyncStateNotFound'));
    const err = await failureOf(c.outlook.sync(BIZ));
    expectUnavailable(err, 'outlook_contacts', 'Outlook delta token expired; please retry', 410);
    expect(businessWrites(c.writes)).toEqual([
      { model: 'business', method: 'update', args: { where: { id: BIZ }, data: { msContactsDeltaLink: null } } },
    ]);
  });
});

/** Each refresh site: the call (with every token expired), its service id, its existing message. */
const REFRESH_SITES: Array<{ name: string; service: string; match: Match; call: (c: Clients) => Promise<unknown>; message: (body: string) => string }> = [
  {
    name: 'GoogleTokenHelper, Google Contacts columns (GoogleContactsSyncService.sync)',
    service: 'google_contacts', match: isGoogleToken,
    call: (c) => c.contacts.sync(BIZ),
    message: () => 'Failed to refresh Google Contacts token',
  },
  {
    name: 'GoogleTokenHelper, Google Forms columns (GoogleFormsService.getForm)',
    service: 'google_forms', match: isGoogleToken,
    call: (c) => c.forms.getForm(BIZ, 'form1'),
    message: () => 'Failed to refresh Google Forms token',
  },
  {
    name: 'GoogleTokenHelper, Drive columns (GoogleFormsService.listForms)',
    service: 'drive', match: isGoogleToken,
    call: (c) => c.forms.listForms(BIZ),
    message: () => 'Failed to refresh Google Drive (required to list Forms) token',
  },
  {
    name: 'GoogleTokenHelper, Business Profile columns (GoogleBusinessProfileService.listAccounts)',
    service: 'google_business_profile', match: isGoogleToken,
    call: (c) => c.bp.listAccounts(BIZ),
    message: () => 'Failed to refresh Google Business Profile token',
  },
  {
    name: 'GoogleTokenHelper, Calendar columns',
    service: 'google_calendar', match: isGoogleToken,
    call: (c) => new GoogleTokenHelper(c.prisma).getValidAccessToken(BIZ, { access: 'calendarAccessToken', refresh: 'calendarRefreshToken', expiry: 'calendarTokenExpiry' }, 'Google Calendar'),
    message: () => 'Failed to refresh Google Calendar token',
  },
  {
    name: 'GoogleTokenHelper, Gmail columns (the gmail ingestion read)',
    service: 'gmail', match: isGoogleToken,
    call: (c) => new GoogleTokenHelper(c.prisma).getValidAccessToken(BIZ, { access: 'gmailAccessToken', refresh: 'gmailRefreshToken', expiry: 'gmailTokenExpiry' }, 'Gmail'),
    message: () => 'Failed to refresh Gmail token',
  },
  {
    name: 'MicrosoftTokenHelper (OutlookContactsSyncService.sync)',
    service: 'microsoft', match: isMicrosoftToken,
    call: (c) => c.outlook.sync(BIZ),
    message: () => 'Failed to refresh Outlook Contacts token',
  },
  {
    name: 'MicrosoftTokenHelper, direct',
    service: 'microsoft', match: isMicrosoftToken,
    call: (c) => new MicrosoftTokenHelper(c.prisma).getValidAccessToken(BIZ),
    message: () => 'Failed to refresh Outlook Contacts token',
  },
  {
    name: 'CrmGoogleService.refreshAccessToken',
    service: 'google_contacts', match: isGoogleToken,
    call: (c) => c.crmGoogle.refreshAccessToken('ref_import'),
    message: () => 'Failed to refresh access token',
  },
  {
    name: 'CalendarService refresh (listAvailableCalendars with an expired token)',
    service: 'google_calendar', match: isGoogleToken,
    call: (c) => c.calendar.listAvailableCalendars(BIZ),
    message: () => 'Failed to refresh Google Calendar token',
  },
];

describe('W11-PROVIDER-OUTAGE-CONNECT: token refreshes keep 400 for invalid_grant and give 503 for an outage', () => {
  for (const site of REFRESH_SITES) {
    describe(site.name, () => {
      it.each([
        [503, JSON.stringify({ error: 'temporarily_unavailable' })],
        [429, ''],
      ] as Array<[number, string]>)(`[POC-R] the token endpoint answering %i rejects with 503 {code: provider_unavailable, service: ${site.service}} and the existing message; no token is written`, async (status, body) => {
        const c = clients({ expired: true });
        stubFetch(site.match, status, body);
        const err = await failureOf(site.call(c));
        expectUnavailable(err, site.service, site.message(body), status);
        expect(fetched.filter((f) => site.match(f.url, f.method))).toHaveLength(1);
        expect(businessWrites(c.writes)).toEqual([]);
      });

      it.each([
        [400, INVALID_GRANT],
        [401, INVALID_CLIENT],
      ] as Array<[number, string]>)('[POC-R] the token endpoint answering %i (invalid_grant / invalid_client: reconnect) stays BadRequestException with the existing message; no token is written', async (status, body) => {
        const c = clients({ expired: true });
        stubFetch(site.match, status, body);
        expectRefused(await failureOf(site.call(c)), site.message(body));
        expect(businessWrites(c.writes)).toEqual([]);
      });
    });
  }
});

describe('W11-PROVIDER-OUTAGE-CONNECT: unchanged', () => {
  it('[POC-U1] the connect-flow consent sites keep their 400 whatever Google answers (CRM Google code exchange, Calendar code exchange)', async () => {
    const c = clients();
    stubFetch(isGoogleToken, 503, JSON.stringify({ error: 'temporarily_unavailable' }));
    expectRefused(await failureOf(c.crmGoogle.exchangeCodeForTokens('poc-code')), 'Failed to exchange authorization code');
    expectRefused(await failureOf(c.calendar.saveCalendarCredentials(BIZ, 'poc-code')), 'Failed to connect Google Calendar');
    expect(businessWrites(c.writes)).toEqual([]);
  });

  it('[POC-U2] business-validation 400s are untouched (a contact status setting, a scheduled post with no location, cancelling a published post)', async () => {
    expect(() => settingDefaultContactStatus('partner')).toThrow(BadRequestException);
    const c = clients();
    stubFetch(() => false, 200, '{}');
    expectRefused(await failureOf(c.bp.schedulePost(BIZ, { location: '', summary: 'x', scheduledFor: new Date().toISOString() })), 'location required');
    expectRefused(await failureOf(c.bp.schedulePost(BIZ, { location: LOCATION, summary: '  ', scheduledFor: new Date().toISOString() })), 'summary required');
    expectRefused(await failureOf(c.bp.schedulePost(BIZ, { location: LOCATION, summary: 'x', scheduledFor: 'not a date' })), 'Invalid scheduledFor date');
    expect(fetched).toEqual([]);
  });


  it('[POC-U4] a fetch that throws propagates its own error (no status to classify)', async () => {
    const c = clients();
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    const err = await failureOf(c.forms.getForm(BIZ, 'form1'));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe('fetch failed');
  });

  it('[POC-U5] a scheduled post whose publish meets an outage is marked failed with the same message text as before', async () => {
    const { prisma, writes } = recordingPrisma();
    const due = { id: 'sched_1', location: LOCATION, summary: 'due post', scheduledFor: new Date(Date.now() - 60_000).toISOString(), status: 'scheduled', createdAt: new Date().toISOString() };
    // The scheduled-post list is written through mergeConnectorMetadata (SWEEP-P0-FOLLOWUP CW3-2): an upsert that
    // only makes sure the row exists, then one `metadata || patch` UPDATE whose JSON patch is the first bound value.
    const merges: Array<Record<string, any>> = [];
    const bp = new GoogleBusinessProfileService({
      client: new Proxy(prisma.client, {
        get: (t, key: string) => {
          if (key === 'connectorStatus') {
            return { findUnique: async () => ({ metadata: { scheduledPosts: [due] } }), upsert: async (args: any) => { writes.push({ model: 'connectorStatus', method: 'upsert', args }); return {}; } };
          }
          if (key === '$executeRaw') {
            return async (_sql: TemplateStringsArray, ...values: unknown[]) => { merges.push(JSON.parse(String(values[0]))); return 1; };
          }
          return t[key];
        },
      }),
    } as any);
    stubFetch((u, m) => m === 'POST' && u.endsWith('/localPosts'), 503, googleError(503, 'UNAVAILABLE'));
    expect(await bp.publishDueScheduledPosts(BIZ)).toEqual({ published: 0, failed: 1 });
    expect(writes.find((w) => w.model === 'connectorStatus' && w.method === 'upsert')?.args.update).toEqual({});
    expect(merges).toHaveLength(1);
    expect(merges[0].scheduledPosts[0]).toMatchObject({ id: 'sched_1', status: 'failed', error: 'Business Profile API error 503' });
  });
});

// ---------------------------------------------------------------------------
// FU-PROVIDER-ERROR-HYGIENE (D-221): no provider body in any message or answer.
// ---------------------------------------------------------------------------
describe('FU-PROVIDER-ERROR-HYGIENE (D-221): the provider body never reaches the message, for an outage or a refusal', () => {
  /** A marker no message may carry: it appears only in what the provider answered. */
  const CANARY = ['peh', 'canary', 'upstream', 'body'].join('-');
  const googleBody = (code: number, status: string, reason: string) =>
    JSON.stringify({ error: { code, message: `${CANARY} ${status}`, status, errors: [{ reason, message: CANARY }] } });
  const graphBody = (code: string) => JSON.stringify({ error: { code, message: `${CANARY} ${code}` } });

  function expectNoBody(err: any) {
    expect(String(err?.message)).not.toContain(CANARY);
    expect(JSON.stringify(err?.getResponse?.() ?? null)).not.toContain(CANARY);
  }

  for (const site of GOOGLE_SITES) {
    it(`[PEH-01] RED-BEFORE where the body was echoed: ${site.name}: a 503 and a 404 whose body carries text answer the bare message, the body nowhere in the answer`, async () => {
      for (const [status, body, unavailable] of [
        [503, googleBody(503, 'UNAVAILABLE', 'backendError'), true],
        [404, googleBody(404, 'NOT_FOUND', 'notFound'), false],
      ] as Array<[number, string, boolean]>) {
        const c = clients();
        stubFetch(site.match, status, body);
        const err = await failureOf(site.call(c));
        if (unavailable) expectUnavailable(err, site.service, site.message(status, body), status);
        else expectRefused(err, site.message(status, body));
        expectNoBody(err);
      }
    });
  }

  it('[PEH-02] RED-BEFORE: the Graph delta (Outlook Contacts sync): a 503, a 404 and a 409 answer "Graph API error <status>", the body nowhere in the answer', async () => {
    for (const [status, body, unavailable] of [
      [503, graphBody('serviceNotAvailable'), true],
      [404, graphBody('ErrorItemNotFound'), false],
      [409, graphBody('ErrorIrresolvableConflict'), false],
    ] as Array<[number, string, boolean]>) {
      const c = clients();
      stubFetch(isGraphDelta, status, body);
      const err = await failureOf(c.outlook.sync(BIZ));
      if (unavailable) expectUnavailable(err, 'outlook_contacts', `Graph API error ${status}`, status);
      else expectRefused(err, `Graph API error ${status}`);
      expectNoBody(err);
      expect(businessWrites(c.writes)).toEqual([]);
    }
  });

  for (const site of REFRESH_SITES) {
    it(`[PEH-03] RED-BEFORE where the body was echoed: ${site.name}: a token endpoint 503 (temporarily_unavailable) and 400 (invalid_grant) whose description carries text answer the bare message, the body nowhere in the answer; no token is written`, async () => {
      for (const [status, body, unavailable] of [
        [503, JSON.stringify({ error: 'temporarily_unavailable', error_description: CANARY }), true],
        [400, JSON.stringify({ error: 'invalid_grant', error_description: CANARY }), false],
      ] as Array<[number, string, boolean]>) {
        const c = clients({ expired: true });
        stubFetch(site.match, status, body);
        const err = await failureOf(site.call(c));
        if (unavailable) expectUnavailable(err, site.service, site.message(body), status);
        else expectRefused(err, site.message(body));
        expectNoBody(err);
        expect(businessWrites(c.writes)).toEqual([]);
      }
    });
  }

  it('[PEH-04] RED-BEFORE: the Business Profile insights read answers a Performance API outage (503, 500, 429, a rate-limited 403) 503 provider_unavailable {service: google_business_profile, message: "Performance API <status>"}; a refusal (400, 404, a 403 insufficientPermissions) stays 400 with that message', async () => {
    for (const [status, body] of [
      [503, googleError(503, 'UNAVAILABLE', ['backendError'])],
      [500, googleError(500, 'INTERNAL', ['backendError'])],
      [429, googleError(429, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded'])],
      [403, googleError(403, 'PERMISSION_DENIED', ['userRateLimitExceeded'])],
    ] as Array<[number, string]>) {
      const c = clients();
      stubFetch(isPerformance, status, body);
      expectUnavailable(await failureOf(c.bp.getInsights(BIZ, LOCATION, 7)), 'google_business_profile', `Performance API ${status}`, status);
    }
    for (const [status, body] of [
      [400, googleError(400, 'INVALID_ARGUMENT', ['invalidArgument'])],
      [404, googleError(404, 'NOT_FOUND', ['notFound'])],
      [403, googleError(403, 'PERMISSION_DENIED', ['insufficientPermissions'])],
    ] as Array<[number, string]>) {
      const c = clients();
      stubFetch(isPerformance, status, body);
      expectRefused(await failureOf(c.bp.getInsights(BIZ, LOCATION, 7)), `Performance API ${status}`);
    }
  });

  it('[PEH-05] control: the insights read answered 200 still totals each metric', async () => {
    const c = clients();
    vi.stubGlobal('fetch', async (input: any) => {
      const url = String(input);
      fetched.push({ url, method: 'GET' });
      if (!isPerformance(url, 'GET')) throw new Error(`unit: unexpected ${url}`);
      return new Response(JSON.stringify({
        multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{
          dailyMetric: 'CALL_CLICKS',
          timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: '3' }, { date: { year: 2026, month: 11, day: 2 }, value: '4' }] },
        }] }],
      }), { status: 200 });
    });
    const out = await c.bp.getInsights(BIZ, LOCATION, 7);
    expect(out).toMatchObject({ locationName: LOCATION, rangeDays: 7, metrics: [{ metric: 'CALL_CLICKS', total: 7, daily: [{ date: '2026-11-01', value: 3 }, { date: '2026-11-02', value: 4 }] }] });
  });

  it('[PEH-06] RED-BEFORE: a scheduled post whose publish meets a token refusal is marked failed with the bare refresh message, the body nowhere in what is stored', async () => {
    const { prisma } = recordingPrisma({ expired: true });
    const due = { id: 'sched_peh', location: LOCATION, summary: 'due post', scheduledFor: new Date(Date.now() - 60_000).toISOString(), status: 'scheduled', createdAt: new Date().toISOString() };
    const merges: Array<Record<string, any>> = [];
    const bp = new GoogleBusinessProfileService({
      client: new Proxy(prisma.client, {
        get: (t, key: string) => {
          if (key === 'connectorStatus') return { findUnique: async () => ({ metadata: { scheduledPosts: [due] } }), upsert: async () => ({}) };
          if (key === '$executeRaw') return async (_sql: TemplateStringsArray, ...values: unknown[]) => { merges.push(JSON.parse(String(values[0]))); return 1; };
          return t[key];
        },
      }),
    } as any);
    stubFetch(isGoogleToken, 400, JSON.stringify({ error: 'invalid_grant', error_description: CANARY }));
    expect(await bp.publishDueScheduledPosts(BIZ)).toEqual({ published: 0, failed: 1 });
    expect(merges).toHaveLength(1);
    expect(merges[0].scheduledPosts[0]).toMatchObject({ id: 'sched_peh', status: 'failed', error: 'Failed to refresh Google Business Profile token' });
    expect(JSON.stringify(merges)).not.toContain(CANARY);
  });
});
