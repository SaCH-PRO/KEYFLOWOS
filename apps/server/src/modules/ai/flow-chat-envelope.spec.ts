/**
 * V1-21b review 7 ENV-FORGE / INP5-2 / DRV5-3: a member could mint their own position envelope.
 *
 * POST /ai/businesses/:businessId/flow/chat and /flow/chat/stream declared their @Body() as an
 * inline type. tsc emits such a parameter's design:paramtypes entry as `Object`, the global
 * ValidationPipe (whitelist: true, transform: true) skips `Object`, and so the body reached the
 * handler exactly as sent. FlowOrchestratorService.chat / streamChat then handed
 * body.pageContext.jobRoleEnvelope to selectToolsForRequest and to every
 * AiOversightService.evaluate call, where an envelope replaces the crew check and the crew's
 * tier clamp. Any member could send { approvedTools: ['*'], blockedTools: [], maxRiskTier: 4 }
 * and reach tools no key reaches (CRM_ROW_VISIBILITY_TOOLS, GOVERNED_UNGRANTED); the stream
 * route also took body.role from the client.
 *
 * Pinned here, each through the real pieces:
 *  - both routes take a class DTO, so the real ValidationPipe whitelists the body, and the DTOs
 *    declare neither pageContext.jobRoleEnvelope nor role;
 *  - the real pipe, the real AiFlowController, the real FlowOrchestratorService.chat /
 *    streamChat and the real AiOversightService.evaluate: a forged envelope changes nothing,
 *    not the tool menu and not one decision;
 *  - belt and braces: chat() and streamChat() ignore a jobRoleEnvelope inside pageContext even
 *    when no pipe ran, and take a position envelope only as a separate server-only argument,
 *    which StaffChatBridgeService passes and which must be one JobRolePolicyService issued (any
 *    other fails closed to the baseline).
 *
 * Also here (review 7 DRV5-2): the dispatcher refuses to email a VOID invoice, before any mail,
 * as the send-email route does. The policy side of DRV5-2 (commerce_send_invoice granted by no
 * key) is pinned in structure/job-role-tool-families.spec.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { ValidationPipe } from '@nestjs/common';
import { AiFlowController } from './flow.controller';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { AiOversightService } from './ai-oversight.service';
import { RoleEngineService } from './role-engine.service';
import { KeyActionBoundaryService } from '../key-autonomy/action-boundary/key-action-boundary.service';
import { JobRolePolicyService, type JobRoleEnvelope } from '../structure/job-role-policy.service';
import { StaffChatBridgeService } from '../structure/staff-chat-bridge.service';

const BIZ = 'biz_1';
const FORGED: JobRoleEnvelope = { jobRoleId: 'x', jobRoleName: 'Anything', approvedTools: ['*'], blockedTools: [], maxRiskTier: 4 };
/** Tools no key reaches (CRM_ROW_VISIBILITY_TOOLS, GOVERNED_UNGRANTED) and writes the general crew does not grant. */
const PROBES = ['crm_delete_contact', 'execute_custom_logic', 'commerce_create_invoice', 'payments_refund_charge', 'structure_create_delegation_rule'];

// ─── the @Body() metatype tsc emits ─────────────────────────────────────────

const CONTROLLER_FILE = join(__dirname, 'flow.controller.ts');

/** Index of the @Body() parameter of AiFlowController.<method>. */
function bodyIndex(method: string): number {
  const sf = ts.createSourceFile('flow.controller.ts', readFileSync(CONTROLLER_FILE, 'utf8'), ts.ScriptTarget.Latest, true);
  let index = -1;
  const visit = (n: ts.Node) => {
    if (ts.isMethodDeclaration(n) && n.name.getText(sf) === method) {
      n.parameters.forEach((p, i) => {
        const decos = ts.canHaveDecorators(p) ? ts.getDecorators(p) ?? [] : [];
        if (decos.some((d) => ts.isCallExpression(d.expression) && d.expression.expression.getText(sf) === 'Body')) index = i;
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return index;
}

/** The design:paramtypes entry tsc emits (emitDecoratorMetadata, as the production build) for each @Body(), as source text. */
function emittedBodyType(method: string): string {
  const out = ts.transpileModule(readFileSync(CONTROLLER_FILE, 'utf8'), {
    compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sf = ts.createSourceFile('emitted.js', out, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let types: string[] | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === '__decorate' && node.arguments.length >= 3) {
      const [decorators, , name] = node.arguments;
      if (ts.isArrayLiteralExpression(decorators) && ts.isStringLiteral(name) && name.text === method) {
        for (const d of decorators.elements) {
          if (
            ts.isCallExpression(d) &&
            d.expression.getText(sf) === '__metadata' &&
            ts.isStringLiteral(d.arguments[0]) &&
            d.arguments[0].text === 'design:paramtypes' &&
            ts.isArrayLiteralExpression(d.arguments[1])
          ) {
            types = d.arguments[1].elements.map((e) => e.getText(sf));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!types) throw new Error(`no design:paramtypes for ${method}`);
  return types[bodyIndex(method)];
}

/** The class a type entry names, or null for `Object` (an inline or intersection type). */
function classNameOf(entry: string): string | null {
  const names = [...entry.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)].map((m) => m[1]).filter((n) => n !== 'Object');
  return names[0] ?? null;
}

/** The metatype Nest hands the global ValidationPipe for the route's @Body(): the DTO class, or Object. */
async function bodyMetatype(method: string): Promise<unknown> {
  const name = classNameOf(emittedBodyType(method));
  if (!name) return Object;
  const dtos = (await import('./dto/flow-chat.dto').catch(() => ({}))) as Record<string, unknown>;
  return dtos[name] ?? Object;
}

/** The app's global pipe (app-bootstrap.ts), over the route's real @Body() metatype. */
async function throughPipe(method: string, body: unknown): Promise<any> {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  return pipe.transform(body, { type: 'body', metatype: (await bodyMetatype(method)) as any, data: undefined });
}

// ─── the real orchestrator, with only what a turn needs before governance stubbed ───

function makeTurn(opts: { toolCall?: string } = {}) {
  const policy = new JobRolePolicyService();
  const roleEngine = new RoleEngineService({} as never, {} as never, {} as never);
  const settings = { autonomyLevel: 2, approvedTools: [], blockedTools: [], approvalTimeoutHours: 24 };
  const oversightPrisma = {
    client: {
      autopilotSettings: { findUnique: async () => settings },
      aiMemory: { findUnique: async () => null },
    },
  };
  const governance = new AiOversightService(oversightPrisma as any, {} as any, {} as any, roleEngine, {} as any, policy);
  const decisions: Array<{ tool: string; crew: unknown; envelope: JobRoleEnvelope | undefined; allowed: boolean; reason: string }> = [];
  const evaluate = governance.evaluate.bind(governance);
  vi.spyOn(governance, 'evaluate').mockImplementation(async (b, tool, mode, crew, envelope, reader) => {
    const d = await evaluate(b, tool, mode, crew, envelope, reader);
    decisions.push({ tool, crew, envelope, allowed: d.allowed, reason: d.reason });
    return d;
  });
  vi.spyOn(governance, 'createApprovalItem').mockResolvedValue({} as any);
  const executed: string[] = [];
  const boundary = { adopts: () => false };
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { log() {}, warn() {}, error() {}, debug() {} },
    governance,
    roleEngine,
    executionLog: { log: async () => undefined, logToolExecution: async () => undefined },
    moduleRef: { get: (token: unknown) => (token === JobRolePolicyService ? policy : token === KeyActionBoundaryService ? boundary : undefined) },
    businessGraph: { invalidateCache() {}, getSnapshot: async () => ({ business: { name: 'Biz' } }), buildContextString: () => '' },
    aiUsage: {
      checkRateLimit() {},
      checkCredits: async () => ({ allowed: true }),
      trackAndComplete: async () => ({
        content: '',
        toolCalls: opts.toolCall ? [{ id: 'tc_1', type: 'function', function: { name: opts.toolCall, arguments: '{}' } }] : [],
        usage,
      }),
      trackAndStream: async function* () {
        if (opts.toolCall) yield { type: 'tool_call_delta', toolCall: { index: 0, id: 'tc_1', name: opts.toolCall, argumentsDelta: '{}' } };
        yield { type: 'usage', usage };
      },
    },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    getTriage: () => null,
    saveConversationHistory: async () => undefined,
    enforceDoNotSay: async () => undefined,
    finalizeStreamSession: async function* () {},
    executeTool: async (_b: string, name: string) => {
      executed.push(name);
      return { toolCallId: 'tc_1', name, success: true, result: {} };
    },
  }) as FlowOrchestratorService;
  const menus: Array<JobRoleEnvelope | undefined> = [];
  const select = (FlowOrchestratorService.prototype as any).selectToolsForRequest;
  (orchestrator as any).selectToolsForRequest = async function (this: unknown, b: string, crew: unknown, text: string, envelope?: JobRoleEnvelope) {
    menus.push(envelope);
    return select.call(this, b, crew, text, envelope);
  };
  return { orchestrator, policy, decisions, executed, menus };
}

/** A body a member's client sends, with or without the forgery. */
const chatBody = (tool: string, forged: boolean) => ({
  message: 'Yes, proceed.',
  history: [],
  sessionId: 's_member',
  pageContext: { route: '/app', surface: 'page', ...(forged ? { jobRoleEnvelope: FORGED } : {}) },
  pendingConfirmation: { toolCallId: 'tc_1', confirmed: true, toolName: tool, toolArgs: { contactId: 'c_1' } },
});

const streamBody = (forged: boolean) => ({
  message: 'go ahead',
  history: [],
  sessionId: 's_member',
  pageContext: { route: '/app', surface: 'page', ...(forged ? { jobRoleEnvelope: FORGED } : {}) },
  ...(forged ? { role: 'operator' } : {}),
});

function fakeResponse() {
  const chunks: string[] = [];
  return { chunks, res: { destroyed: false, setHeader() {}, flushHeaders() {}, write: (c: string) => chunks.push(c), end() {} } };
}

describe('V1-21b review 7 ENV-FORGE — a member cannot supply a position envelope (or a role) to KEY chat', () => {
  it.each(['flowChat', 'flowChatStream'])('%s takes a class DTO as @Body(): tsc emits a class, never Object, so the global ValidationPipe whitelists it', async (method) => {
    const entry = emittedBodyType(method);
    expect(classNameOf(entry), `${method} @Body() is emitted as ${entry}`).not.toBeNull();
    expect(await bodyMetatype(method), `${method}: ${entry} is exported by ./dto/flow-chat.dto`).not.toBe(Object);
  });

  it('the real ValidationPipe strips pageContext.jobRoleEnvelope and role from a forged body, and keeps everything a client legitimately sends', async () => {
    const sent = {
      message: 'hi',
      history: [{ role: 'user', content: 'earlier', attachments: [] }],
      sessionId: 's_1',
      attachments: [{ type: 'document', url: 'https://x/y.pdf', name: 'y.pdf', mimeType: 'application/pdf' }],
      pageContext: {
        route: '/app/invoices',
        surface: 'page',
        focusedItem: { type: 'invoice', id: 'inv_1', label: 'INV-1', summary: 'Due', name: 'INV-1' },
        recent: [{ label: 'INV-1', href: '/app/invoices/inv_1' }],
        notes: [{ title: 'n', body: 'b' }],
        hints: ['h'],
        jobRoleEnvelope: FORGED,
      },
      pendingConfirmation: { toolCallId: 'tc_1', confirmed: true, toolName: 'crm_delete_contact', toolArgs: { contactId: 'c_1' }, confirmationId: 'act_1' },
      role: 'operator',
    };
    const chat = await throughPipe('flowChat', structuredClone(sent));
    expect(chat.pageContext.jobRoleEnvelope).toBeUndefined();
    expect(chat.role).toBeUndefined();
    expect(chat).toMatchObject({
      message: 'hi',
      history: sent.history,
      sessionId: 's_1',
      attachments: sent.attachments,
      pageContext: { route: '/app/invoices', surface: 'page', focusedItem: sent.pageContext.focusedItem, recent: sent.pageContext.recent, notes: sent.pageContext.notes, hints: ['h'] },
      pendingConfirmation: sent.pendingConfirmation,
    });
    const { pendingConfirmation: _p, ...streamSent } = sent;
    const stream = await throughPipe('flowChatStream', structuredClone(streamSent));
    expect(stream.pageContext.jobRoleEnvelope).toBeUndefined();
    expect(stream.role).toBeUndefined();
    expect(stream).toMatchObject({ message: 'hi', history: sent.history, sessionId: 's_1', attachments: sent.attachments, pageContext: { route: '/app/invoices', hints: ['h'] } });
  });

  it.each(PROBES)('the repro, end to end (pipe, AiFlowController.flowChat, chat, evaluate): a forged envelope changes nothing for %s', async (tool) => {
    const run = async (forged: boolean) => {
      const turn = makeTurn();
      const controller = new AiFlowController(turn.orchestrator);
      const body = await throughPipe('flowChat', chatBody(tool, forged));
      const reply = (await controller.flowChat(BIZ, body, { id: 'u_member' } as any)).reply;
      return { reply, decisions: turn.decisions, executed: turn.executed, menus: turn.menus };
    };
    const plain = await run(false);
    const forged = await run(true);
    expect(forged.decisions.map((d) => d.envelope), 'evaluate is given no client envelope').toEqual([undefined]);
    expect(forged.menus, 'the tool menu is built without it').toEqual([undefined]);
    expect(forged.decisions).toEqual(plain.decisions);
    expect(forged.reply).toBe(plain.reply);
    expect(forged.executed).toEqual(plain.executed);
    expect(forged.decisions[0]).toMatchObject({ tool, crew: ['general'], allowed: false });
    expect(forged.decisions[0].reason).toBe(`Tool "${tool}" is not available to the general role`);
    expect(forged.reply).toBe(`This action is blocked: Tool "${tool}" is not available to the general role`);
  });

  it('the stream route: neither a forged envelope nor body.role changes the crew, the tool menu or a decision', async () => {
    for (const tool of PROBES) {
      const run = async (forged: boolean) => {
        const turn = makeTurn({ toolCall: tool });
        const streamChat = vi.spyOn(turn.orchestrator, 'streamChat');
        const controller = new AiFlowController(turn.orchestrator);
        const body = await throughPipe('flowChatStream', streamBody(forged));
        const { chunks, res } = fakeResponse();
        await controller.flowChatStream(BIZ, { id: 'u_member' } as any, body, res as any);
        return { role: streamChat.mock.calls[0]?.[4], decisions: turn.decisions, menus: turn.menus, chunks, executed: turn.executed };
      };
      const plain = await run(false);
      const forged = await run(true);
      expect(forged.role, `${tool}: the client's role is not passed`).toBeUndefined();
      expect(forged.menus, tool).toEqual([undefined]);
      expect(forged.decisions.map((d) => d.envelope), tool).toEqual([undefined]);
      expect(forged.decisions, tool).toEqual(plain.decisions);
      expect(forged.chunks, tool).toEqual(plain.chunks);
      expect(forged.executed, tool).toEqual(plain.executed);
      expect(forged.decisions[0], tool).toMatchObject({ tool, allowed: false });
    }
  });

  it('belt and braces: chat() and streamChat() ignore a jobRoleEnvelope inside pageContext even when no pipe ran', async () => {
    const turn = makeTurn();
    await turn.orchestrator.chat(BIZ, 'Yes, proceed.', [], { toolCallId: 'tc_1', confirmed: true, toolName: 'crm_delete_contact', toolArgs: {} }, { route: '/app', jobRoleEnvelope: FORGED } as any);
    expect(turn.decisions).toMatchObject([{ tool: 'crm_delete_contact', envelope: undefined, allowed: false }]);
    expect(turn.menus).toEqual([undefined]);

    const streamed = makeTurn({ toolCall: 'execute_custom_logic' });
    for await (const _chunk of streamed.orchestrator.streamChat(BIZ, 'go ahead', [], { route: '/app', jobRoleEnvelope: FORGED } as any)) void _chunk;
    expect(streamed.decisions).toMatchObject([{ tool: 'execute_custom_logic', envelope: undefined, allowed: false }]);
    expect(streamed.menus).toEqual([undefined]);
    expect(streamed.executed).toEqual([]);
  });

  it('the staff bridge passes the envelope JobRolePolicyService issued as a server-only argument, never in pageContext, and chat() governs by it', async () => {
    const turn = makeTurn({ toolCall: 'commerce_create_invoice' });
    const chat = vi.spyOn(turn.orchestrator, 'chat');
    (turn.orchestrator as any).getConversationHistory = async () => [];
    const assignment = {
      id: 'as_1',
      businessId: BIZ,
      contactPhone: '+18685550100',
      contactName: 'Pat',
      contactEmail: null,
      isContactOnly: true,
      membershipId: null,
      userId: null,
      jobRole: { id: 'jr_1', name: 'Front desk', permissions: { bookings: 'read' } },
      phoneMembers: [],
      autoApprovalViaReply: false,
      activeFlowSessionId: null,
    };
    const structure = { resolveStaffByPhone: async () => assignment, setActiveFlowSession: async () => undefined };
    const moduleRef = { get: (token: unknown) => (token === FlowOrchestratorService ? turn.orchestrator : token === JobRolePolicyService ? turn.policy : undefined) };
    const bridge = new StaffChatBridgeService(structure as any, { client: {} } as any, moduleRef as any);
    expect(await bridge.routeInboundMessage(BIZ, '+18685550100', 'create an invoice for the client', 'whatsapp')).toMatchObject({ handled: true });

    const args = chat.mock.calls[0];
    expect((args[4] as Record<string, unknown>).jobRoleEnvelope, 'no envelope in the client-shaped pageContext').toBeUndefined();
    const server = args[9] as { jobRoleEnvelope?: JobRoleEnvelope } | undefined;
    expect(server?.jobRoleEnvelope?.jobRoleName).toBe('Front desk');
    expect(turn.menus).toEqual([server!.jobRoleEnvelope]);
    expect(turn.decisions).toMatchObject([{ tool: 'commerce_create_invoice', envelope: server!.jobRoleEnvelope, allowed: false }]);
    expect(turn.decisions[0].reason).toBe('Tool "commerce_create_invoice" is outside the Front desk position\'s scope');
  });

  it('an envelope in the server-only argument that JobRolePolicyService did not issue fails closed to the baseline', async () => {
    for (const envelope of [FORGED, { ...new JobRolePolicyService().envelopeForJobRole({ id: 'jr', name: 'Copied', permissions: { revenue: 'admin' } as any }) }]) {
      const turn = makeTurn({ toolCall: 'commerce_create_invoice' });
      await (turn.orchestrator.chat as any)(BIZ, 'create an invoice for the client', [], undefined, { route: '/app' }, undefined, undefined, undefined, undefined, { jobRoleEnvelope: envelope });
      expect(turn.decisions, envelope.jobRoleName).toHaveLength(1);
      expect(turn.decisions[0].envelope?.jobRoleName, envelope.jobRoleName).toBe('Unassigned');
      expect(turn.decisions[0]).toMatchObject({ tool: 'commerce_create_invoice', allowed: false });
      expect(turn.executed).toEqual([]);
    }
  });
});

describe('V1-21b review 7 DRV5-2 — KEY does not email a VOID invoice', () => {
  const run = (status: string) => {
    const send = vi.fn(async () => ({ status: 'SENT' }));
    const updateInvoiceStatus = vi.fn(async () => ({ id: 'inv_1', status: 'SENT' }));
    const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      prisma: {
        client: {
          invoice: {
            findFirst: vi.fn(async () => ({
              id: 'inv_1',
              status,
              invoiceNumber: 'INV-001',
              total: 500,
              currency: 'TTD',
              contactId: 'con_1',
              contact: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
            })),
          },
        },
      },
      getTransactionalEmail: () => ({ send }),
      getCommerce: () => ({ updateInvoiceStatus }),
      getActivityLog: () => ({ createActivity: vi.fn(async () => ({})) }),
    });
    return { send, updateInvoiceStatus, result: (orchestrator as any).executeToolAction(BIZ, 'commerce_send_invoice', { invoiceId: 'inv_1' }) };
  };

  it('refuses before any mail, as POST send-email does (Cannot email a voided invoice)', async () => {
    const { send, updateInvoiceStatus, result } = run('VOID');
    await expect(result).rejects.toThrow('Cannot email a voided invoice');
    expect(send).not.toHaveBeenCalled();
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
  });

  it('control: a DRAFT invoice is still emailed and marked SENT', async () => {
    const { send, updateInvoiceStatus, result } = run('DRAFT');
    await result;
    expect(send).toHaveBeenCalledTimes(1);
    expect(updateInvoiceStatus).toHaveBeenCalledTimes(1);
  });
});
