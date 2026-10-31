/**
 * R0-34b-KEY-TENANT-BINDING — the KEY cortex controllers act only on the tenant
 * BusinessGuard checked (R0-07a security review ST-1; COST-LEDGER-001 section 7
 * items 7, 8 and 9). This file is the pure half of the proof (no database); the
 * real-database half is test/key-cortex-tenant-binding.integration.test.ts.
 *
 * KeyCortexController and KeyCortexGoalsController are mounted at
 * `/api/v1/cortex` (no `:businessId` segment) behind AuthGuard and
 * BusinessGuard. BusinessGuard checks the tenant resolveRequestBusinessId
 * resolves: path parameter, then body, then query
 * (core/auth/request-business-id.ts). At the base, 36 handlers in
 * key-cortex.controller.ts and 4 in key-cortex-goals.controller.ts read
 * `@Query('businessId')`, and `conscious/stream` read `dto.businessId` from a
 * whole-object `@Query()`. A request whose JSON body names tenant A (one the
 * caller belongs to) and whose query names tenant B passed the guard for A and
 * acted on B. The fix is the R0-34 pattern (key-cortex-audit.controller.ts):
 * every such handler takes `@GuardedBusinessId()`.
 *
 * What this file checks:
 *   - source scan of every BusinessGuard-guarded controller in
 *     modules/key-cortex: no handler reads `@Query('businessId')` or
 *     `@Body('businessId')`, none reads the tenant from a whole-object
 *     `@Query()`, and a multipart (FileInterceptor) handler does not read the
 *     tenant from the multipart body (multer fills `req.body` after the guards
 *     ran, so the guard never saw it);
 *   - the 41 handlers that read the query at the base now take
 *     `@GuardedBusinessId()`;
 *   - section 7 item 8: KeyCortexDocumentService builds no OpenAI client with
 *     the sentinel key `sk-no-key`; with no key it builds none and answers the
 *     structured 503 provider_not_configured before any write or provider call;
 *   - section 7 item 7: OpenAiVoiceProvider and KeyflowVoiceService rethrow a
 *     provider_not_configured / provider_unavailable 503 unchanged and keep
 *     rewrapping every other error.
 *
 * A handler that reads `dto.businessId` from a whole JSON `@Body()` is not an
 * offender only when the body is a class DTO that validates businessId as a
 * string: the body is the first field the guard resolves on these paths, so a
 * non-empty string there is the tenant the guard checked. Review ST-2 found
 * five handlers typed `Dto & { businessId }`: tsc emits an intersection as
 * `Object`, the global ValidationPipe skips `Object`, and a body businessId
 * that is not a string (which the guard skips) reached the service raw. They
 * take the class DTO and @GuardedBusinessId() now, and this file checks both.
 *
 * No real key is ever set: the document-service cases use a recording stand-in
 * for the OpenAI SDK and a value that is not a key.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';

const SERVER_SRC = resolve(__dirname, '../..');
const KEY_CORTEX_DIR = join(SERVER_SRC, 'modules/key-cortex');
const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Sse', 'All'];

/**
 * The handlers that read the tenant from the query string at the base
 * (36 + conscious/stream in key-cortex.controller.ts, 4 in
 * key-cortex-goals.controller.ts). Each must now take @GuardedBusinessId().
 */
const QUERY_TENANT_HANDLERS_AT_BASE: Record<string, string[]> = {
  'modules/key-cortex/key-cortex.controller.ts': [
    'listSessions', 'streamChat', 'getMessages', 'streamEvents', 'getAutonomyProfile', 'speak', 'listen',
    'listTools', 'getContext', 'getProfitOpportunities', 'analyzeRevenue', 'analyzeChurnRisk', 'analyzePipeline',
    'getMonitors', 'updateMonitor', 'toggleMonitor', 'getAlerts', 'getBusinessReport', 'getRecommendations',
    'flowList', 'flowGet', 'flowUpdate', 'flowDelete', 'flowExecute', 'flowToggle', 'phoneHistory', 'phoneStatus',
    'documentUpload', 'documentList', 'documentGet', 'documentDelete', 'evolutionProfile', 'evolutionPatterns',
    'evolutionReport', 'evolutionExplainDecision', 'consciousStream', 'getAwareness',
  ],
  'modules/key-cortex/key-cortex-goals.controller.ts': ['listGoals', 'getGoal', 'deleteGoal', 'listTriggerRules'],
};

/**
 * Review ST-2: the body handlers whose @Body() was typed `Dto & { businessId }`
 * at the base (emitted as `Object`, so never validated). Each must now take
 * @GuardedBusinessId().
 */
const INTERSECTION_BODY_HANDLERS_AT_BASE: Record<string, string[]> = {
  'modules/key-cortex/key-cortex.controller.ts': ['updateAutonomyProfile'],
  'modules/key-cortex/key-cortex-goals.controller.ts': ['createGoal', 'createPlanFromGoal', 'createPlanFromCommand', 'updateTriggerRule'],
};

interface Decorator { name: string; args: readonly ts.Expression[] }
/**
 * `type` is the parameter's type annotation; `businessIdValidators` is, when
 * that type names a class declared in the same file, the decorator names on the
 * class's `businessId` property (undefined when the type is not such a class,
 * [] when the class declares no `businessId`).
 */
interface HandlerParam { name: string; decorators: Decorator[]; type: ts.TypeNode | undefined; businessIdValidators: string[] | undefined }
interface Handler {
  file: string;
  cls: string;
  line: number;
  name: string;
  route: string;
  params: HandlerParam[];
  interceptors: string;
  body: ts.Node | undefined;
}

function decoratorsOf(node: ts.Node): Decorator[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).flatMap((d) => {
    const e = d.expression;
    if (ts.isCallExpression(e)) return [{ name: e.expression.getText(), args: e.arguments }];
    if (ts.isIdentifier(e)) return [{ name: e.text, args: [] as readonly ts.Expression[] }];
    return [];
  });
}

function stringArg(d: Decorator | undefined): string | undefined {
  const a0 = d?.args[0];
  return a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) ? a0.text : undefined;
}

/** Every route handler of every BusinessGuard-guarded controller class in modules/key-cortex. */
function guardedKeyCortexHandlers(): { controllers: string[]; handlers: Handler[] } {
  const controllers: string[] = [];
  const handlers: Handler[] = [];
  const files = readdirSync(KEY_CORTEX_DIR).filter((f) => f.endsWith('.controller.ts')).map((f) => join(KEY_CORTEX_DIR, f));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const classes = new Map<string, ts.ClassDeclaration>();
    sf.forEachChild((n) => { if (ts.isClassDeclaration(n) && n.name) classes.set(n.name.text, n); });
    const businessIdValidators = (type: ts.TypeNode | undefined): string[] | undefined => {
      if (!type || !ts.isTypeReferenceNode(type)) return undefined;
      const cls = classes.get(type.typeName.getText(sf));
      if (!cls) return undefined;
      const prop = cls.members.find((m) => ts.isPropertyDeclaration(m) && m.name.getText(sf) === 'businessId');
      return prop ? decoratorsOf(prop).map((d) => d.name) : [];
    };
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        const classDecs = decoratorsOf(node);
        const ctl = classDecs.find((d) => d.name === 'Controller');
        const classGuarded = classDecs.some((d) => d.name === 'UseGuards' && d.args.some((a) => a.getText() === 'BusinessGuard'));
        if (ctl) {
          if (classGuarded) controllers.push(`${relative(SERVER_SRC, file)} ${node.name?.text}`);
          for (const member of node.members) {
            if (!ts.isMethodDeclaration(member)) continue;
            const decs = decoratorsOf(member);
            const route = decs.find((d) => HTTP_DECORATORS.includes(d.name));
            if (!route) continue;
            const methodGuarded = decs.some((d) => d.name === 'UseGuards' && d.args.some((a) => a.getText() === 'BusinessGuard'));
            if (!classGuarded && !methodGuarded) continue;
            handlers.push({
              file: relative(SERVER_SRC, file),
              cls: node.name?.text ?? '',
              line: sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1,
              name: member.name.getText(sf),
              route: `${route.name.toUpperCase()} ${stringArg(ctl) ?? ''}/${stringArg(route) ?? ''}`.replace(/\/+/g, '/'),
              params: member.parameters.map((p) => ({
                name: p.name.getText(sf),
                decorators: decoratorsOf(p),
                type: p.type,
                businessIdValidators: businessIdValidators(p.type),
              })),
              interceptors: decs.filter((d) => d.name === 'UseInterceptors').map((d) => d.args.map((a) => a.getText()).join(',')).join(','),
              body: member.body,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { controllers: controllers.sort(), handlers };
}

/** True when `body` reads `<ident>.businessId` (or `<ident>['businessId']`). */
function readsBusinessIdOf(body: ts.Node | undefined, ident: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === ident && node.name.text === 'businessId') found = true;
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === ident
      && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'businessId') found = true;
    ts.forEachChild(node, visit);
  };
  if (body) visit(body);
  return found;
}

const label = (h: Handler) => `${h.file}:${h.line} ${h.route} (${h.name})`;

/**
 * The `design:paramtypes` tsc emits (emitDecoratorMetadata, as the production
 * build) for each method of `file`, as `Class.method -> [type, ...]` source
 * text. The ValidationPipe validates a @Body() only when its entry is a class;
 * an intersection or a type literal is emitted as `Object`, which it skips.
 */
function emittedParamTypes(file: string): Map<string, string[]> {
  const source = readFileSync(join(SERVER_SRC, file), 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sf = ts.createSourceFile('emitted.js', out, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const types = new Map<string, string[]>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === '__decorate' && node.arguments.length >= 3) {
      const [decorators, target, name] = node.arguments;
      if (ts.isArrayLiteralExpression(decorators) && ts.isStringLiteral(name)) {
        for (const d of decorators.elements) {
          if (ts.isCallExpression(d) && d.expression.getText(sf) === '__metadata'
            && ts.isStringLiteral(d.arguments[0]) && d.arguments[0].text === 'design:paramtypes' && ts.isArrayLiteralExpression(d.arguments[1])) {
            types.set(`${target.getText(sf).replace(/\.prototype$/, '')}.${name.text}`, d.arguments[1].elements.map((e) => e.getText(sf)));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return types;
}

describe('KEY cortex controllers bind the tenant BusinessGuard checked (R0-34b, R0-07a review ST-1)', () => {
  const { controllers, handlers } = guardedKeyCortexHandlers();

  it('finds the BusinessGuard-guarded KEY cortex controllers and their handlers', () => {
    expect(controllers).toEqual(expect.arrayContaining([
      'modules/key-cortex/key-cortex-audit.controller.ts KeyCortexAuditController',
      'modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController',
      'modules/key-cortex/key-cortex.controller.ts KeyCortexController',
    ]));
    for (const [file, names] of Object.entries(QUERY_TENANT_HANDLERS_AT_BASE)) {
      const found = handlers.filter((h) => h.file === file).map((h) => h.name);
      expect(found, file).toEqual(expect.arrayContaining(names));
    }
  });

  it("no handler reads the tenant with @Query('businessId') or @Body('businessId')", () => {
    const offenders = handlers
      .filter((h) => h.params.some((p) => p.decorators.some((d) => (d.name === 'Query' || d.name === 'Body') && stringArg(d) === 'businessId')))
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('no handler reads the tenant from a whole-object @Query() (dto.businessId)', () => {
    const offenders = handlers
      .filter((h) => h.params.some((p) => p.decorators.some((d) => d.name === 'Query' && d.args.length === 0) && readsBusinessIdOf(h.body, p.name)))
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('a multipart (FileInterceptor) handler does not read the tenant from the multipart body, which the guard never saw', () => {
    const offenders = handlers
      .filter((h) => h.interceptors.includes('FileInterceptor'))
      .filter((h) => h.params.some((p) => p.decorators.some((d) => d.name === 'Body') && readsBusinessIdOf(h.body, p.name)))
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('every handler that read the query for the tenant at the base takes @GuardedBusinessId()', () => {
    const missing: string[] = [];
    for (const [file, names] of Object.entries(QUERY_TENANT_HANDLERS_AT_BASE)) {
      for (const name of names) {
        const h = handlers.find((x) => x.file === file && x.name === name);
        if (!h || !h.params.some((p) => p.decorators.some((d) => d.name === 'GuardedBusinessId'))) missing.push(`${file} ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('a handler that reads businessId from a whole @Body() takes a class DTO that validates it as a string (review ST-2: an intersection or literal type is emitted as Object, which the ValidationPipe skips)', () => {
    const offenders = handlers
      .flatMap((h) => h.params
        .filter((p) => p.decorators.some((d) => d.name === 'Body' && d.args.length === 0) && readsBusinessIdOf(h.body, p.name))
        .filter((p) => !p.businessIdValidators?.includes('IsString'))
        .map((p) => `${label(h)} @Body() ${p.name}: ${p.type?.getText() ?? '(untyped)'}`));
    expect(offenders).toEqual([]);
  });

  it('every body handler whose @Body() was an intersection at the base takes @GuardedBusinessId() and a class-typed body (review ST-2)', () => {
    const missing: string[] = [];
    for (const [file, names] of Object.entries(INTERSECTION_BODY_HANDLERS_AT_BASE)) {
      for (const name of names) {
        const h = handlers.find((x) => x.file === file && x.name === name);
        const body = h?.params.find((p) => p.decorators.some((d) => d.name === 'Body'));
        if (!h || !h.params.some((p) => p.decorators.some((d) => d.name === 'GuardedBusinessId'))) missing.push(`${file} ${name}: no @GuardedBusinessId()`);
        if (!body?.type || !ts.isTypeReferenceNode(body.type) || body.businessIdValidators === undefined) {
          missing.push(`${file} ${name}: @Body() is not a class DTO (${body?.type?.getText() ?? 'none'})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('tsc emits a class, never Object, as the @Body() type of every guarded handler that reads businessId from its body, and the five emit exactly the types the real-database suite writes (review ST-2)', () => {
    const emitted = new Map<string, string[]>();
    for (const file of new Set(handlers.map((h) => h.file))) for (const [k, v] of emittedParamTypes(file)) emitted.set(`${file} ${k}`, v);

    const objectBodies = handlers.flatMap((h) => h.params
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.decorators.some((d) => d.name === 'Body' && d.args.length === 0) && readsBusinessIdOf(h.body, p.name))
      .filter(({ i }) => (emitted.get(`${h.file} ${h.cls}.${h.name}`)?.[i] ?? 'Object') === 'Object')
      .map(() => label(h)));
    expect(objectBodies).toEqual([]);

    // test/key-cortex-tenant-binding.integration.test.ts writes these (vitest emits no metadata).
    expect({
      updateAutonomyProfile: emitted.get('modules/key-cortex/key-cortex.controller.ts KeyCortexController.updateAutonomyProfile'),
      createGoal: emitted.get('modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController.createGoal'),
      createPlanFromGoal: emitted.get('modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController.createPlanFromGoal'),
      createPlanFromCommand: emitted.get('modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController.createPlanFromCommand'),
      updateTriggerRule: emitted.get('modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController.updateTriggerRule'),
    }).toEqual({
      updateAutonomyProfile: ['UpdateAutonomyProfileDto', 'String'],
      createGoal: ['CreateGoalDto', 'String'],
      createPlanFromGoal: ['String', 'CreatePlanFromGoalDto', 'String'],
      createPlanFromCommand: ['CreatePlanFromCommandDto', 'String'],
      updateTriggerRule: ['String', 'UpdateTriggerRuleDto', 'String'],
    });
  });

  it.todo(
    "key-connector/key-connector.controller.ts reads @Query('businessId') in 10 handlers behind BusinessGuard (the same split) - " +
      'outside the R0-34b write set (KEY cortex controllers only); a follow-up packet binds it with @GuardedBusinessId()',
  );
});

/* ------------------------------------------------------------------ */
/*  COST-LEDGER-001 section 7 item 8: no sentinel key                  */
/* ------------------------------------------------------------------ */

/** The OpenAI SDK, replaced by a recorder: no request can leave this file. */
const sdk = vi.hoisted(() => ({
  attempts: [] as Array<{ apiKey?: string }>,
  embeddings: [] as Array<Record<string, unknown>>,
}));

vi.mock('openai', () => {
  class RecordingOpenAI {
    embeddings = {
      create: async (args: Record<string, unknown>) => {
        sdk.embeddings.push(args);
        return { data: [{ embedding: [0.25, 0.5, 0.75] }] };
      },
    };
    constructor(options: { apiKey?: string } = {}) {
      sdk.attempts.push({ apiKey: options.apiKey });
    }
  }
  return { default: RecordingOpenAI, OpenAI: RecordingOpenAI };
});

const OPENAI_ENV = ['AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY'];
/** Not a key: the recorder above is the only thing that ever sees it. */
const NOT_A_KEY = 'k34b-test-not-a-real-key';

function expectNotConfigured(err: unknown) {
  expect(err).toBeInstanceOf(HttpException);
  const e = err as HttpException;
  expect(e.getStatus()).toBe(503);
  expect(e.getResponse()).toMatchObject({ code: 'provider_not_configured', service: 'ai' });
}

function documentServiceDeps() {
  const keyDocument = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'k34b_doc', ...data })),
    update: vi.fn(async () => ({})),
    findMany: vi.fn(async () => [{ id: 'k34b_doc', fileName: 'k34b.txt', status: 'indexed' }]),
    findFirst: vi.fn(async () => ({ id: 'k34b_doc', fileName: 'k34b.txt', status: 'indexed' })),
  };
  const prisma = { client: { keyDocument } };
  const redis = { setJson: vi.fn(async () => undefined), getJson: vi.fn(async () => null), keys: vi.fn(async () => []) };
  const gateway = { complete: vi.fn(async () => { throw new Error('k34b: the gateway is not under test'); }) };
  return { prisma, redis, gateway, keyDocument };
}

describe('KeyCortexDocumentService builds no OpenAI client with a sentinel key (COST-LEDGER-001 section 7 item 8)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of OPENAI_ENV) { saved[key] = process.env[key]; delete process.env[key]; }
    sdk.attempts.length = 0;
    sdk.embeddings.length = 0;
  });
  afterEach(() => {
    for (const key of OPENAI_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const build = async () => {
    const { KeyCortexDocumentService } = await import('../../modules/key-cortex/key-cortex-document.service');
    const deps = documentServiceDeps();
    const service = new KeyCortexDocumentService(deps.prisma as any, deps.redis as any, deps.gateway as any, {} as any, {} as any);
    return { service, ...deps };
  };
  const textFile = () => ({ buffer: Buffer.from('k34b document text', 'utf8'), originalname: 'k34b.txt', mimetype: 'text/plain', size: 18 });

  it('the service source names no sentinel key and takes its key from directOpenAiKey()/directOpenAiNotConfigured()', () => {
    const source = readFileSync(join(KEY_CORTEX_DIR, 'key-cortex-document.service.ts'), 'utf8');
    expect(source).not.toContain('sk-no-key');
    expect(source).toMatch(/import\s*\{[^}]*\bdirectOpenAiKey\b[^}]*\}\s*from\s*'\.\.\/ai\/ai-usage\.service'/);
    expect(source).toMatch(/import\s*\{[^}]*\bdirectOpenAiNotConfigured\b[^}]*\}\s*from\s*'\.\.\/ai\/ai-usage\.service'/);
  });

  it('with neither AI_INTEGRATIONS_OPENAI_API_KEY nor OPENAI_API_KEY set it builds no OpenAI client', async () => {
    await build();
    expect(sdk.attempts).toEqual([]);
  });

  it('with no key, uploadDocument answers 503 provider_not_configured before any KeyDocument row or provider call', async () => {
    const { service, keyDocument } = await build();
    const err = await service.uploadDocument(textFile(), {}, 'k34b_biz').then(() => null, (e: unknown) => e);
    expectNotConfigured(err);
    expect(keyDocument.create).not.toHaveBeenCalled();
    expect(keyDocument.update).not.toHaveBeenCalled();
    expect(sdk.embeddings).toEqual([]);
  });

  it('with no key, askAcrossDocuments answers 503 provider_not_configured instead of calling the provider', async () => {
    const { service } = await build();
    const err = await service.askAcrossDocuments('k34b question', 'k34b_biz').then(() => null, (e: unknown) => e);
    expectNotConfigured(err);
    expect(sdk.embeddings).toEqual([]);
  });

  it('with a key configured, it builds one client with that key and uploadDocument embeds and indexes as before', async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = NOT_A_KEY;
    const { service, keyDocument, redis } = await build();
    expect(sdk.attempts).toEqual([{ apiKey: NOT_A_KEY }]);
    const result = await service.uploadDocument(textFile(), {}, 'k34b_biz');
    expect(result).toMatchObject({ documentId: 'k34b_doc', status: 'indexed', chunksIndexed: 1 });
    expect(keyDocument.create).toHaveBeenCalledTimes(1);
    expect(sdk.embeddings).toHaveLength(1);
    expect(sdk.embeddings[0]).toMatchObject({ model: 'text-embedding-3-small', input: 'k34b document text' });
    expect(redis.setJson).toHaveBeenCalled();
  });

  it('OPENAI_API_KEY alone (the production container name) builds the client with that key', async () => {
    process.env.OPENAI_API_KEY = NOT_A_KEY;
    await build();
    expect(sdk.attempts).toEqual([{ apiKey: NOT_A_KEY }]);
  });
});

/* ------------------------------------------------------------------ */
/*  COST-LEDGER-001 section 7 item 7: the 503 code survives           */
/* ------------------------------------------------------------------ */

const notConfigured = () => new ServiceUnavailableException({
  code: 'provider_not_configured', service: 'ai', message: 'No AI providers available: k34b', error: 'Service Unavailable',
});
const unavailable = () => new ServiceUnavailableException({
  code: 'provider_unavailable', service: 'ai', message: 'No AI providers available: k34b circuit open', error: 'Service Unavailable',
});

describe('voice wrappers keep the provider_not_configured / provider_unavailable 503 (COST-LEDGER-001 section 7 item 7)', () => {
  const cases = async () => {
    const { OpenAiVoiceProvider } = await import('../../modules/voice/openai-voice.provider');
    const { KeyflowVoiceService } = await import('../../modules/keyflow-command/keyflow-voice.service');
    return [
      { label: 'OpenAiVoiceProvider.synthesize', run: (usage: any) => new OpenAiVoiceProvider(usage).synthesize('k34b_biz', 'Hello') },
      { label: 'KeyflowVoiceService.synthesize', run: (usage: any) => new KeyflowVoiceService(usage).synthesize('k34b_biz', { text: 'Hello' }) },
      { label: 'KeyflowVoiceService.transcribe', run: (usage: any) => new KeyflowVoiceService(usage).transcribe('k34b_biz', Buffer.from('k34b'), 'audio/webm') },
    ];
  };

  it('rethrow a provider_not_configured 503 unchanged (same exception, code intact)', async () => {
    for (const c of await cases()) {
      const thrown = notConfigured();
      const err = await c.run({ trackAudio: async () => { throw thrown; } }).then(() => null, (e: unknown) => e);
      expect(err, c.label).toBe(thrown);
    }
  });

  it('rethrow a provider_unavailable 503 unchanged', async () => {
    for (const c of await cases()) {
      const thrown = unavailable();
      const err = await c.run({ trackAudio: async () => { throw thrown; } }).then(() => null, (e: unknown) => e);
      expect(err, c.label).toBe(thrown);
    }
  });

  it('keep rewrapping every other error in their own 503', async () => {
    const expected: Record<string, string> = {
      'OpenAiVoiceProvider.synthesize': 'OpenAI TTS failed: k34b provider exploded',
      'KeyflowVoiceService.synthesize': 'Voice synthesis failed.',
      'KeyflowVoiceService.transcribe': 'Voice transcription failed.',
    };
    for (const c of await cases()) {
      for (const cause of [new Error('k34b provider exploded'), new HttpException('k34b provider exploded', 502)]) {
        const err = await c.run({ trackAudio: async () => { throw cause; } }).then(() => null, (e: unknown) => e);
        expect(err, c.label).toBeInstanceOf(ServiceUnavailableException);
        expect(err, c.label).not.toBe(cause);
        expect((err as HttpException).message, c.label).toBe(expected[c.label]);
        expect((err as HttpException).getResponse(), c.label).not.toMatchObject({ code: expect.anything() });
      }
    }
  });
});
