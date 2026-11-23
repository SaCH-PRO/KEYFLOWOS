/**
 * RR-MCP-TENANT-BOUND (owner rulings D-261, D-262): the MCP bridge is tenant-bound or off.
 *
 * Before this packet McpClientManagerService held one process-wide server table, listBridgedTools ignored its
 * businessId, callTool(bridgedName, args) took no business at all, and FlowOrchestratorService routed any
 * `mcp__*` tool name straight to callTool. So with MCP_REMOTE_SERVERS set, a plan step or a model-emitted
 * name for business B reached a server configured for business A, with that server's one shared token.
 *
 * Now every server config names the businesses it may serve (`businessIds`, required, non-empty); a config
 * without one is dropped with an error log; callTool(businessId, bridgedName, args) refuses a business the
 * server does not name before anything connects; listBridgedTools(businessId) lists only the servers bound to
 * that business; FlowOrchestratorService.executeToolAction passes the business. Whether production sets
 * MCP_REMOTE_SERVERS is owner question OQ-1: these cases make no assumption about it.
 *
 * Pure: no database, no network. The MCP SDK's Client and StreamableHTTPClientTransport are replaced with
 * fakes that record every construction, connect, listTools and callTool, so "no connect" is counted, not
 * assumed. The real FlowOrchestratorService.executeToolDirectly / executeTool / executeToolAction run over
 * stand-ins for the member scope check, the execution log, governance's tier and the business graph cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, Logger } from '@nestjs/common';

const fake = vi.hoisted(() => ({
  transports: [] as Array<{ url: string; headers: Record<string, string> | undefined }>,
  clients: 0,
  connects: 0,
  listTools: 0,
  calls: [] as Array<{ name: string; arguments: unknown }>,
  tools: [{ name: 'x', description: 'fake tool x', inputSchema: { type: 'object', properties: {} } }],
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, opts?: { requestInit?: { headers?: Record<string, string> } }) {
      fake.transports.push({ url: String(url), headers: opts?.requestInit?.headers });
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    constructor() {
      fake.clients += 1;
    }
    async connect() {
      fake.connects += 1;
    }
    async listTools() {
      fake.listTools += 1;
      return { tools: fake.tools };
    }
    async callTool(req: { name: string; arguments: unknown }) {
      fake.calls.push(req);
      return { content: [{ type: 'text', text: `fake result for ${req.name}` }] };
    }
    async close() {
      return undefined;
    }
  },
}));

import { McpClientManagerService } from './mcp-client-manager.service';
import { loadMcpServerConfigs } from './mcp.types';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';

const BIZ_A = 'v91a_biz_A';
const BIZ_B = 'v91a_biz_B';
const SERVER = { key: 's', name: 'Fake S', url: 'https://mcp.v91a.invalid/mcp' };
const REFUSAL = /MCP server not available to this business/;

let savedEnv: string | undefined;
let errorLog: ReturnType<typeof vi.spyOn>;

function setServers(value: unknown) {
  process.env.MCP_REMOTE_SERVERS = typeof value === 'string' ? value : JSON.stringify(value);
}

function noServerTouched() {
  expect(fake.transports).toEqual([]);
  expect(fake.clients).toBe(0);
  expect(fake.connects).toBe(0);
  expect(fake.listTools).toBe(0);
  expect(fake.calls).toEqual([]);
}

function errorLines(): string[] {
  return errorLog.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  savedEnv = process.env.MCP_REMOTE_SERVERS;
  fake.transports.length = 0;
  fake.clients = 0;
  fake.connects = 0;
  fake.listTools = 0;
  fake.calls.length = 0;
  errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.MCP_REMOTE_SERVERS;
  else process.env.MCP_REMOTE_SERVERS = savedEnv;
  vi.restoreAllMocks();
});

/** Calls callTool with the business first, as the bound bridge takes it. */
function callAs(mcp: McpClientManagerService, businessId: string, bridgedName: string, args: Record<string, unknown> = {}) {
  return (mcp.callTool as unknown as (b: string, n: string, a: Record<string, unknown>) => Promise<unknown>)(businessId, bridgedName, args);
}

/** The real orchestrator over the real MCP manager; everything else the tool path reads is a stand-in. */
function makeFlow(mcp: McpClientManagerService) {
  const logged: Array<{ businessId: string; toolName: string; output: unknown; success: boolean }> = [];
  const flow = Object.create(FlowOrchestratorService.prototype) as FlowOrchestratorService;
  Object.assign(flow, {
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    moduleRef: { get: (token: unknown) => (token === McpClientManagerService ? mcp : undefined) },
    governance: { getToolTier: () => 3 },
    executionLog: {
      logToolExecution: async (businessId: string, toolName: string, _args: unknown, output: unknown, success: boolean) => {
        logged.push({ businessId, toolName, output, success });
        return 'v91a_log';
      },
    },
    businessGraph: { invalidateCache: () => undefined },
    memberScopeRefusal: async () => null,
    attributeExecutionLog: async () => undefined,
  });
  return { flow, logged };
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection, got an answer');
}

describe('RR-MCP-TENANT-BOUND (D-261, D-262): the MCP bridge serves a business only through a server that names it', () => {
  it('MCP-01 a server bound to business A refuses business B before anything connects (on main callTool took no business and B reached the server)', async () => {
    setServers([{ ...SERVER, businessIds: [BIZ_A] }]);
    const mcp = new McpClientManagerService();
    expect(mcp.isConfigured()).toBe(true);

    const err = await rejection(callAs(mcp, BIZ_B, 'mcp__s__x', { q: 'v91a' }));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as Error).message).toMatch(REFUSAL);
    noServerTouched();
  });

  it('MCP-02 business A\'s call reaches the fake server, with the tool name and arguments it was given', async () => {
    setServers([{ ...SERVER, businessIds: [BIZ_A] }]);
    const mcp = new McpClientManagerService();

    const out = await callAs(mcp, BIZ_A, 'mcp__s__x', { q: 'v91a' });
    expect(out).toEqual({ content: [{ type: 'text', text: 'fake result for x' }] });
    expect(fake.connects).toBe(1);
    expect(fake.transports.map((t) => t.url)).toEqual([SERVER.url]);
    expect(fake.calls).toEqual([{ name: 'x', arguments: { q: 'v91a' } }]);

    // Having connected for A changes nothing for B: still refused, and B's call reaches nothing.
    const err = await rejection(callAs(mcp, BIZ_B, 'mcp__s__x', { q: 'v91a' }));
    expect((err as Error).message).toMatch(REFUSAL);
    expect(fake.calls).toHaveLength(1);
  });

  it('MCP-03 listBridgedTools lists a server\'s tools only to a business it names: empty for B, without connecting; A sees x', async () => {
    setServers([{ ...SERVER, businessIds: [BIZ_A] }]);
    const mcp = new McpClientManagerService();

    expect(await mcp.listBridgedTools(BIZ_B)).toEqual([]);
    noServerTouched();

    const forA = await mcp.listBridgedTools(BIZ_A);
    expect(forA.map((t) => t.bridgedName)).toEqual(['mcp__s__x']);

    // A's cached table is not served to B either.
    expect(await mcp.listBridgedTools(BIZ_B)).toEqual([]);
  });

  it('MCP-04 a config without a non-empty businessIds is dropped with an error log, and its tools are refused for every business', async () => {
    const unbound = [
      { ...SERVER, key: 'none' },
      { ...SERVER, key: 'empty', businessIds: [] },
      { ...SERVER, key: 'str', businessIds: BIZ_A },
      { ...SERVER, key: 'blank', businessIds: [''] },
      { ...SERVER, key: 'mixed', businessIds: [BIZ_A, 7] },
      { ...SERVER, key: 'nul', businessIds: null },
    ];
    setServers(unbound);
    const mcp = new McpClientManagerService();
    expect(mcp.isConfigured()).toBe(false);

    for (const { key } of unbound) {
      expect(errorLines().some((l) => l.includes(`"${key}"`) && /businessIds/.test(l)), `no error log for dropped server ${key}`).toBe(true);
      for (const biz of [BIZ_A, BIZ_B]) {
        const err = await rejection(callAs(mcp, biz, `mcp__${key}__x`));
        expect(err, `${key} for ${biz}`).toBeInstanceOf(ForbiddenException);
        expect((err as Error).message).toMatch(REFUSAL);
      }
    }
    for (const biz of [BIZ_A, BIZ_B]) expect(await mcp.listBridgedTools(biz)).toEqual([]);
    noServerTouched();

    // loadMcpServerConfigs itself keeps only a bound config.
    setServers([...unbound, { ...SERVER, key: 'ok', businessIds: [BIZ_A] }]);
    expect(loadMcpServerConfigs().map((c) => c.key)).toEqual(['ok']);
  });

  it('MCP-05 an unknown server and a server bound elsewhere give the same answer, so a refusal says nothing about another business\'s servers', async () => {
    setServers([{ ...SERVER, businessIds: [BIZ_A] }]);
    const mcp = new McpClientManagerService();
    const bound = (await rejection(callAs(mcp, BIZ_B, 'mcp__s__x'))) as Error;
    const unknown = (await rejection(callAs(mcp, BIZ_B, 'mcp__nosuch__x'))) as Error;
    expect(unknown).toBeInstanceOf(ForbiddenException);
    expect(unknown.message).toBe(bound.message);
    noServerTouched();
  });

  it('MCP-06 a business id is matched exactly: an empty, differently-cased or padded id is refused', async () => {
    setServers([{ ...SERVER, businessIds: [BIZ_A] }]);
    const mcp = new McpClientManagerService();
    for (const biz of ['', BIZ_A.toUpperCase(), ` ${BIZ_A}`, `${BIZ_A} `]) {
      const err = await rejection(callAs(mcp, biz, 'mcp__s__x'));
      expect((err as Error).message, JSON.stringify(biz)).toMatch(REFUSAL);
      expect(await mcp.listBridgedTools(biz)).toEqual([]);
    }
    noServerTouched();
  });

  it('MCP-07 through FlowOrchestratorService.executeToolDirectly, an mcp__s__x step for business B is refused, reaches nothing, and is logged as failed', async () => {
    setServers([{ ...SERVER, businessIds: [BIZ_A] }]);
    const mcp = new McpClientManagerService();
    const { flow, logged } = makeFlow(mcp);

    const err = await rejection(
      flow.executeToolDirectly(BIZ_B, 'mcp__s__x', { q: 'v91a' }, { planId: 'v91a_plan', planStepId: 'v91a_step' }, { surface: 'PLAN_QUEUE', planId: 'v91a_plan', planStepId: 'v91a_step' } as never),
    );
    expect((err as Error).message).toMatch(REFUSAL);
    // Final, not retried: the dispatcher answers a 4xx refusal once (isToolRefusal).
    expect(err).toBeInstanceOf(ForbiddenException);
    noServerTouched();
    await vi.waitFor(() => expect(logged).toHaveLength(1));
    expect(logged[0]).toMatchObject({ businessId: BIZ_B, toolName: 'mcp__s__x', success: false });
    expect(String(logged[0].output)).toMatch(REFUSAL);
  });

  it('MCP-08 through FlowOrchestratorService.executeToolDirectly, the same step for business A reaches the fake server and is logged as done', async () => {
    setServers([{ ...SERVER, businessIds: [BIZ_A] }]);
    const mcp = new McpClientManagerService();
    const { flow, logged } = makeFlow(mcp);

    await flow.executeToolDirectly(BIZ_A, 'mcp__s__x', { q: 'v91a' }, { planId: 'v91a_plan', planStepId: 'v91a_step' }, { surface: 'PLAN_QUEUE', planId: 'v91a_plan', planStepId: 'v91a_step' } as never);
    expect(fake.calls).toEqual([{ name: 'x', arguments: { q: 'v91a' } }]);
    await vi.waitFor(() => expect(logged).toHaveLength(1));
    expect(logged[0]).toMatchObject({ businessId: BIZ_A, toolName: 'mcp__s__x', success: true });
  });

  it('MCP-09 negative control: with MCP_REMOTE_SERVERS empty or unset, isConfigured() is false, nothing is listed, every call is refused, and no MCP client is ever built', async () => {
    for (const value of [undefined, '']) {
      if (value === undefined) delete process.env.MCP_REMOTE_SERVERS;
      else process.env.MCP_REMOTE_SERVERS = value;
      const mcp = new McpClientManagerService();
      expect(mcp.isConfigured()).toBe(false);
      expect(loadMcpServerConfigs()).toEqual([]);
      expect(await mcp.listBridgedTools(BIZ_A)).toEqual([]);
      const err = await rejection(callAs(mcp, BIZ_A, 'mcp__s__x'));
      expect((err as Error).message).toMatch(REFUSAL);
    }
    expect(errorLines()).toEqual([]);
    noServerTouched();
  });

  it('MCP-10 a value that is not a JSON array of configs serves nothing and says so in an error log', async () => {
    for (const value of ['{not json', '{"key":"s"}', '"s"']) {
      errorLog.mockClear();
      setServers(value);
      const mcp = new McpClientManagerService();
      expect(mcp.isConfigured(), value).toBe(false);
      expect(errorLines().some((l) => /MCP_REMOTE_SERVERS/.test(l)), `no error log for ${value}`).toBe(true);
    }
    noServerTouched();
  });

  it('MCP-11 the error log for a dropped config names the server but never echoes its url or token env var value', async () => {
    process.env.V91A_FAKE_MCP_TOKEN = 'v91a-secret-token-value';
    try {
      setServers([{ ...SERVER, key: 'leaky', url: 'https://user:pw@mcp.v91a.invalid/mcp', tokenEnvVar: 'V91A_FAKE_MCP_TOKEN' }]);
      new McpClientManagerService();
      const lines = errorLines().join('\n');
      expect(lines).toContain('"leaky"');
      expect(lines).not.toContain('v91a-secret-token-value');
      expect(lines).not.toContain('user:pw');
    } finally {
      delete process.env.V91A_FAKE_MCP_TOKEN;
    }
  });

  it('MCP-12 two configs with one key: the later one is dropped with an error log, so business B bound by it never reaches the first server\'s url', async () => {
    setServers([
      { ...SERVER, businessIds: [BIZ_A] },
      { ...SERVER, url: 'https://mcp-b.v91a.invalid/mcp', businessIds: [BIZ_B] },
    ]);
    const mcp = new McpClientManagerService();
    expect(errorLines().some((l) => l.includes('"s"') && /key/.test(l)), 'no error log for the duplicate key').toBe(true);
    await callAs(mcp, BIZ_A, 'mcp__s__x');
    const err = await rejection(callAs(mcp, BIZ_B, 'mcp__s__x'));
    expect((err as Error).message).toMatch(REFUSAL);
    expect(await mcp.listBridgedTools(BIZ_B)).toEqual([]);
    expect(fake.transports.map((t) => t.url)).toEqual([SERVER.url]);
    expect(fake.calls).toHaveLength(1);
  });

  it('MCP-13 a key that is empty or contains "__" (which bridged names cannot round-trip) is dropped with an error log', async () => {
    setServers([
      { ...SERVER, key: '', businessIds: [BIZ_A] },
      { ...SERVER, key: 'a__b', businessIds: [BIZ_A] },
    ]);
    const mcp = new McpClientManagerService();
    expect(mcp.isConfigured()).toBe(false);
    expect(errorLines().filter((l) => /key/.test(l))).toHaveLength(2);
    expect(await mcp.listBridgedTools(BIZ_A)).toEqual([]);
    noServerTouched();
  });
});
