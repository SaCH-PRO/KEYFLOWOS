/**
 * FU-VITEST-DECORATOR-METADATA — the vitest transform must emit decorator
 * metadata the way the production build (tsc, emitDecoratorMetadata) does.
 *
 * Nest's global ValidationPipe (app-bootstrap.ts: whitelist + transform) reads
 * the handler parameter's metatype from `design:paramtypes`. esbuild, vitest's
 * default transform, emits no such metadata, so under it the pipe gets an
 * undefined metatype and returns the body untouched: no DTO rule runs and no
 * stray field is stripped. Production validates. This spec pins the production
 * behaviour under vitest:
 *
 *   1. `design:paramtypes` on a DTO-typed handler of a real controller names
 *      the DTO class (and the controller's constructor names its services);
 *   2. through the real bootstrap (configureNestApp), a body that breaks a DTO
 *      rule is refused 400 before the handler runs;
 *   3. a valid body reaches the handler as a DTO instance with stray fields
 *      stripped.
 *
 * The controller and DTO are production code (CallTaskController.createFollowUp
 * and CreateFollowUpDto). Only the guards are stood in (they admit every
 * request) and the service is a stub that records what it was given: this spec
 * is about the pipe, not about who may call the route.
 *
 * Runs under the default config (vitest.config.ts), and is the proof for every
 * apps/server vitest config, since all of them share one transform (see
 * vitest.shared.ts).
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { configureNestApp } from '../src/app-bootstrap';
import { CallTaskController } from '../src/modules/call-tasks/call-task.controller';
import { CallLogService } from '../src/modules/call-tasks/call-log.service';
import { CallScriptService } from '../src/modules/call-tasks/call-script.service';
import { CreateFollowUpDto } from '../src/modules/call-tasks/dto/create-follow-up.dto';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { RateLimitGuard } from '../src/core/guards/rate-limit.guard';

const ROUTE = '/businesses/dvh_biz/calls/dvh_call/follow-up';

describe('vitest emits decorator metadata (FU-VITEST-DECORATOR-METADATA)', () => {
  it('names the DTO class in design:paramtypes of a DTO-typed handler', () => {
    const types = Reflect.getMetadata('design:paramtypes', CallTaskController.prototype, 'createFollowUp');
    expect(types).toBeDefined();
    // (businessId: string, callId: string, body: CreateFollowUpDto, req: SessionRequest)
    expect(types[0]).toBe(String);
    expect(types[1]).toBe(String);
    expect(types[2]).toBe(CreateFollowUpDto);
  });

  it('names the injected services in design:paramtypes of the controller constructor', () => {
    expect(Reflect.getMetadata('design:paramtypes', CallTaskController)).toEqual([CallLogService, CallScriptService]);
  });
});

describe('global ValidationPipe through configureNestApp (FU-VITEST-DECORATOR-METADATA)', () => {
  let app: INestApplication;
  const received: unknown[] = [];

  beforeAll(async () => {
    const callLogs = {
      getVisibleCallLog: async () => ({ id: 'dvh_call' }),
      createFollowUpTask: async (_businessId: string, _callId: string, body: unknown) => {
        received.push(body);
        return { ok: true };
      },
    };
    const admit = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [CallTaskController],
      providers: [
        { provide: CallLogService, useValue: callLogs },
        { provide: CallScriptService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard).useValue(admit)
      .overrideGuard(BusinessGuard).useValue(admit)
      .overrideGuard(RateLimitGuard).useValue(admit)
      .overrideGuard(ModuleScopeGuard).useValue(admit)
      .compile();
    // Without constructor metadata Nest injects nothing; wire the stubs by hand
    // then, so the HTTP cases below test the pipe and not DI (which the
    // constructor case above covers on its own).
    const controller = moduleRef.get(CallTaskController) as any;
    controller.callLogs ??= callLogs;
    controller.callScripts ??= {};
    app = moduleRef.createNestApplication();
    // The handler reads req.user (sessionViewer); stands in for AuthGuard's attachment.
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'dvh_user', role: 'USER' };
      next();
    });
    configureNestApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    received.length = 0;
  });

  it('refuses a body missing a required field with 400, before the handler runs', async () => {
    const res = await request(app.getHttpServer()).post(ROUTE).send({ notes: 'no title' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('title');
    expect(received).toHaveLength(0);
  });

  it('refuses a field of the wrong type or outside its allowed values with 400', async () => {
    const wrongType = await request(app.getHttpServer()).post(ROUTE).send({ title: 42 });
    expect(wrongType.status).toBe(400);
    const badEnum = await request(app.getHttpServer()).post(ROUTE).send({ title: 'Call back', priority: 'WHENEVER' });
    expect(badEnum.status).toBe(400);
    expect(JSON.stringify(badEnum.body)).toContain('priority');
    expect(received).toHaveLength(0);
  });

  it('strips a stray field and hands the handler a DTO instance', async () => {
    const res = await request(app.getHttpServer())
      .post(ROUTE)
      .send({ title: 'Call back', priority: 'HIGH', businessId: 'dvh_other', isAdmin: true });
    expect(res.status).toBe(201);
    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(CreateFollowUpDto);
    expect(received[0]).toEqual({ title: 'Call back', priority: 'HIGH' });
    expect(Object.keys(received[0] as object).sort()).toEqual(['priority', 'title']);
  });
});
