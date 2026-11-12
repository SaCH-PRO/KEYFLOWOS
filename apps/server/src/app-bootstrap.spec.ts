/**
 * W3-CORS-IDEMPOTENCY-HEADER (G6PUB-R3, recheck G6PUB-RC2-4; V1-33): a browser
 * may send Idempotency-Key cross-origin to the storefront checkout.
 *
 * The storefront (apps/web/src/app/book/[slug]) calls the API cross-origin, so
 * every JSON request it makes is preflighted. The public widget routes
 * (storefront, bookings, payments checkout, webhooks, widgets) are meant to be
 * reachable from any origin, a store on its own domain included: configureNestApp
 * keeps a permissive allowance for them. That allowance was registered after
 * the strict CORS middleware (app.enableCors), and the strict middleware ends
 * every preflight itself (204), so the allowance never answered one: in
 * production a site origin outside the allow-list got a preflight with no
 * Access-Control-Allow-Origin and the browser sent no checkout at all, with or
 * without its Idempotency-Key header. allowedHeaders itself already lists
 * Idempotency-Key (V1-45b, D-15).
 *
 *   CIH-01  production, a site origin outside the allow-list: the preflight of
 *           the storefront checkout (and of the storefront reads) admits the
 *           origin and allows Idempotency-Key and Content-Type
 *   CIH-02  production, the web app's own origin (in the allow-list): the same
 *           preflight is allowed with Idempotency-Key
 *   CIH-03  development (any origin allowed): the same preflight from a site
 *           origin is allowed with Idempotency-Key
 *   CIH-04  the checkout POST itself, carrying Idempotency-Key from a site
 *           origin in production, is answered with headers that let the
 *           browser read it
 *   CIH-05  pinned: authenticated routes keep the strict allow-list in
 *           production; the web app's origin is still admitted, with
 *           credentials and Idempotency-Key (V1-45b, D-15)
 *   CIH-06  review repair (SEC-CIH-1, CR-CIH-1): the '/webhooks' public prefix
 *           also covers the authenticated, tenant-scoped webhook management
 *           routes (AuthGuard + BusinessGuard). Read from the real controllers
 *           under that prefix, every AuthGuard route keeps the strict
 *           allow-list in production (a site origin's preflight and actual
 *           request get no Access-Control-Allow-Origin, any letter case),
 *           the web app's origin is still admitted with credentials, and
 *           every unguarded webhook receiver keeps the public allowance
 *
 * The app is a bare Nest app behind the production bootstrap (configureNestApp)
 * with a probe controller standing in for the routes; nothing reaches a database.
 */
import { Body, Controller, Get, Headers, Param, Post, RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureNestApp } from './app-bootstrap';
import { AuthGuard } from './core/auth/auth.guard';
import { FormWebhookController } from './core/connectors/form-webhook.controller';
import { RiscController } from './modules/risc/risc.controller';
import { WebhooksController } from './modules/webhooks/webhooks.controller';

const APP_ORIGIN = 'https://app.cih.test';
const SITE_ORIGIN = 'https://shop.cih-store.test';

@Controller()
class CorsProbeController {
  @Post('site/storefront/public/:slug/checkout')
  checkout(@Param('slug') slug: string, @Headers('idempotency-key') key: string | undefined, @Body() body: Record<string, unknown>) {
    return { slug, headerKey: key ?? null, bodyKey: body?.idempotencyKey ?? null };
  }

  @Get('site/storefront/public/:slug/gateways')
  gateways() {
    return { gateways: [] };
  }

  @Post('commerce/businesses/:businessId/invoices')
  createInvoice() {
    return { ok: true };
  }

  /** Stands in for WebhooksController.list (AuthGuard + BusinessGuard), whose rows carry each webhook's HMAC secret. */
  @Get('webhooks/businesses/:businessId/webhooks')
  listWebhooks() {
    return [{ id: 'wh_cih', secret: 'cih_probe_secret' }];
  }
}

/** One route of a real controller, read from its Nest metadata. */
type DeclaredRoute = { controller: string; handler: string; method: string; path: string; authenticated: boolean };

/**
 * CIH-06: every route the real controllers under the '/webhooks' prefix
 * declare, with ':params' filled in and whether AuthGuard guards it (on the
 * handler or on the class). Read from the controllers themselves, so a guarded
 * route added under the prefix later is covered without editing this list.
 */
function declaredRoutes(controllers: Array<new (...args: never[]) => object>): DeclaredRoute[] {
  const routes: DeclaredRoute[] = [];
  for (const ctrl of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
    const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, ctrl) ?? [];
    for (const handler of Object.getOwnPropertyNames(ctrl.prototype)) {
      const fn = (ctrl.prototype as Record<string, unknown>)[handler];
      if (handler === 'constructor' || typeof fn !== 'function') continue;
      const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      if (sub === undefined) continue;
      const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
      const path =
        '/' +
        [base, sub]
          .map((p) => p.replace(/^\/+|\/+$/g, ''))
          .filter(Boolean)
          .join('/')
          .replace(/:(\w+)/g, 'cih_$1');
      routes.push({
        controller: ctrl.name,
        handler,
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod],
        path,
        authenticated: [...classGuards, ...methodGuards].includes(AuthGuard),
      });
    }
  }
  return routes;
}

const WEBHOOK_PREFIX_ROUTES = declaredRoutes([WebhooksController, RiscController, FormWebhookController]);

const ENV_KEYS = ['NODE_ENV', 'APP_URL', 'NEXT_PUBLIC_SITE_URL', 'PUBLIC_BASE_URL', 'CORS_ALLOWED_ORIGINS'] as const;

/** A bare app configured by the production bootstrap under `env` (configureNestApp reads the env when it runs). */
async function bootApp(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Promise<INestApplication> {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const moduleRef = await Test.createTestingModule({ controllers: [CorsProbeController] }).compile();
    const app = moduleRef.createNestApplication();
    configureNestApp(app);
    await app.init();
    return app;
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const list = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .split(/\s*,\s*/)
    .filter(Boolean);

/** The browser reads a cross-origin answer only when Access-Control-Allow-Origin is '*' or the page's origin. */
const admits = (res: request.Response, origin: string) => {
  const allowOrigin = res.headers['access-control-allow-origin'];
  return allowOrigin === '*' || allowOrigin === origin;
};

const preflight = (app: INestApplication, path: string, origin: string, method = 'POST', requestHeaders = 'content-type,idempotency-key') =>
  request(app.getHttpServer())
    .options(path)
    .set('Origin', origin)
    .set('Access-Control-Request-Method', method)
    .set('Access-Control-Request-Headers', requestHeaders);

const STOREFRONT_ROUTES: Array<[string, string]> = [
  ['/site/storefront/public/cih-store/checkout', 'POST'],
  ['/site/storefront/public/cih-store/gateways', 'GET'],
];

describe('W3-CORS-IDEMPOTENCY-HEADER: a browser may send Idempotency-Key cross-origin to the storefront checkout (G6PUB-RC2-4)', () => {
  let prodApp: INestApplication;
  let devApp: INestApplication;

  beforeAll(async () => {
    prodApp = await bootApp({ NODE_ENV: 'production', APP_URL: APP_ORIGIN });
    devApp = await bootApp({ NODE_ENV: 'development', APP_URL: APP_ORIGIN });
  });

  afterAll(async () => {
    await prodApp?.close();
    await devApp?.close();
  });

  it('CIH-01 RED-BEFORE: in production the preflight of the storefront checkout from a site origin outside the allow-list admits the origin and allows Idempotency-Key and Content-Type', async () => {
    for (const [path, method] of STOREFRONT_ROUTES) {
      const res = await preflight(prodApp, path, SITE_ORIGIN, method);
      expect(res.status, path).toBe(204);
      // At the base: no Access-Control-Allow-Origin (the strict middleware answered the preflight).
      expect(admits(res, SITE_ORIGIN), `${path} admits ${SITE_ORIGIN}: ${JSON.stringify(res.headers)}`).toBe(true);
      expect(list(res.headers['access-control-allow-headers']), path).toEqual(expect.arrayContaining(['idempotency-key', 'content-type']));
      expect(list(res.headers['access-control-allow-methods']), path).toContain(method.toLowerCase());
    }
  });

  it("CIH-02 in production the preflight of the storefront checkout from the web app's own origin is allowed with Idempotency-Key", async () => {
    for (const [path, method] of STOREFRONT_ROUTES) {
      const res = await preflight(prodApp, path, APP_ORIGIN, method);
      expect(res.status, path).toBe(204);
      expect(admits(res, APP_ORIGIN), path).toBe(true);
      expect(list(res.headers['access-control-allow-headers']), path).toEqual(expect.arrayContaining(['idempotency-key', 'content-type']));
    }
  });

  it('CIH-03 in development the preflight of the storefront checkout from a site origin is allowed with Idempotency-Key', async () => {
    for (const [path, method] of STOREFRONT_ROUTES) {
      const res = await preflight(devApp, path, SITE_ORIGIN, method);
      expect(res.status, path).toBe(204);
      expect(admits(res, SITE_ORIGIN), path).toBe(true);
      expect(list(res.headers['access-control-allow-headers']), path).toEqual(expect.arrayContaining(['idempotency-key', 'content-type']));
    }
  });

  it('CIH-04 the checkout POST carrying Idempotency-Key from a site origin in production reaches the route and is answered with headers that let the browser read it', async () => {
    const res = await request(prodApp.getHttpServer())
      .post('/site/storefront/public/cih-store/checkout')
      .set('Origin', SITE_ORIGIN)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'cih_key_04')
      .send({ idempotencyKey: 'cih_key_04' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ slug: 'cih-store', headerKey: 'cih_key_04', bodyKey: 'cih_key_04' });
    expect(admits(res, SITE_ORIGIN), JSON.stringify(res.headers)).toBe(true);
  });

  it("CIH-05 pinned: authenticated routes keep the strict allow-list in production (a site origin is not admitted); the web app's origin is admitted with credentials and Idempotency-Key (V1-45b, D-15)", async () => {
    const path = '/commerce/businesses/biz_cih/invoices';
    const foreign = await preflight(prodApp, path, SITE_ORIGIN);
    expect(foreign.headers['access-control-allow-origin'], 'no allowance for a site origin on an authenticated route').toBeUndefined();

    const own = await preflight(prodApp, path, APP_ORIGIN);
    expect(own.status).toBe(204);
    expect(own.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(own.headers['access-control-allow-credentials']).toBe('true');
    expect(list(own.headers['access-control-allow-headers'])).toEqual(
      expect.arrayContaining(['idempotency-key', 'content-type', 'authorization', 'x-business-id']),
    );
  });

  it("CIH-06 RED-BEFORE review repair (SEC-CIH-1, CR-CIH-1; G6PUB-RC2-4): in production the authenticated webhook management routes inside the public '/webhooks' prefix keep the strict allow-list (a site origin is not admitted, any letter case; the web app's origin is admitted with credentials) while the public webhook receivers keep the allowance", async () => {
    const authenticated = WEBHOOK_PREFIX_ROUTES.filter((r) => r.authenticated);
    const receivers = WEBHOOK_PREFIX_ROUTES.filter((r) => !r.authenticated);
    // The six tenant-scoped management routes (list, create, delete, test, deliveries, toggle) and the public receivers.
    expect(authenticated.map((r) => r.handler).sort()).toEqual(['create', 'deliveries', 'list', 'remove', 'testWebhook', 'toggleWebhook']);
    expect(receivers.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['POST /webhooks/stripe', 'POST /webhooks/risc', 'POST /webhooks/forms/cih_businessId/cih_type']),
    );

    const AUTH_HEADERS = 'authorization,x-business-id,content-type';
    for (const route of authenticated) {
      const label = `${route.method} ${route.path} (${route.controller}.${route.handler})`;
      for (const path of [route.path, route.path.replace('/businesses/', '/Businesses/'), route.path.toUpperCase()]) {
        const foreign = await preflight(prodApp, path, SITE_ORIGIN, route.method, AUTH_HEADERS);
        // At the packet head: 204 with Access-Control-Allow-Origin '*' and Authorization allowed.
        expect(foreign.headers['access-control-allow-origin'], `${label} via ${path}: ${JSON.stringify(foreign.headers)}`).toBeUndefined();
      }
      const own = await preflight(prodApp, route.path, APP_ORIGIN, route.method, AUTH_HEADERS);
      expect(own.status, label).toBe(204);
      expect(own.headers['access-control-allow-origin'], label).toBe(APP_ORIGIN);
      expect(own.headers['access-control-allow-credentials'], label).toBe('true');
      expect(list(own.headers['access-control-allow-headers']), label).toEqual(expect.arrayContaining(['authorization', 'x-business-id']));
    }

    // The actual request (the probe stands in for the guarded list, which returns each row's HMAC secret) is not readable
    // cross-origin either; Express routes '/webhooks/Businesses/...' to the same handler, so letter case is no way round.
    for (const path of ['/webhooks/businesses/cih_biz/webhooks', '/webhooks/Businesses/cih_biz/webhooks']) {
      const res = await request(prodApp.getHttpServer()).get(path).set('Origin', SITE_ORIGIN).set('Authorization', 'Bearer cih_token');
      expect(res.status, path).toBe(200);
      expect(res.headers['access-control-allow-origin'], `${path}: ${JSON.stringify(res.headers)}`).toBeUndefined();
    }

    for (const route of receivers) {
      const res = await preflight(prodApp, route.path, SITE_ORIGIN, route.method);
      expect(res.status, route.path).toBe(204);
      expect(admits(res, SITE_ORIGIN), `${route.method} ${route.path} keeps the public allowance`).toBe(true);
    }
  });
});
