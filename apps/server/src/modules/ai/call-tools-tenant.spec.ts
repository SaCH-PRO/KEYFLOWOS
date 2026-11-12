/**
 * V1-21b review 8 DD8-1 — the call tools stay in the business KEY acts in, with no tenant context.
 *
 * call_log_outcome, call_schedule_followup and call_generate_script are granted by crm:write.
 * The dispatcher handed CallLogService a bare call log id (completeCall(callLogId),
 * createFollowUpTask(callLogId)), and CallScriptService looked the call log and the contact up by
 * findUnique({ id }). Over HTTP the routes are no better bound in code: what keeps them inside the
 * tenant is the Prisma tenant extension, which TenantInterceptor arms for an authenticated
 * request. The WhatsApp/SMS staff bridge runs the dispatcher inside a provider webhook, with no
 * tenant context, so a holder of crm:write completed another business's call log, planted a task
 * in its CRM and read its contact into a script (confirmed on a real database by the review).
 *
 * The Prisma double here is that situation: findUnique answers by id alone, as Prisma does with
 * no tenant context; findFirst honours the where it is given. The services and the dispatcher are
 * the real ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { CallLogService } from '../call-tasks/call-log.service';
import { CallScriptService } from '../call-tasks/call-script.service';

const MINE = 'biz_mine';
const THEIRS = 'biz_theirs';
const SECRET = 'THEIR-CONTACT-NAME';

function makePrisma() {
  const callLogs = new Map<string, any>([
    ['cl_mine', { id: 'cl_mine', businessId: MINE, contactId: 'c_mine', callerId: 'u_mine', completedAt: null, notes: null, evidenceIds: [] }],
    ['cl_theirs', { id: 'cl_theirs', businessId: THEIRS, contactId: 'c_theirs', callerId: 'u_theirs', completedAt: null, notes: null, evidenceIds: [] }],
  ]);
  const contacts = new Map<string, any>([
    ['c_mine', { id: 'c_mine', businessId: MINE, firstName: 'Mine', status: 'LEAD' }],
    ['c_theirs', { id: 'c_theirs', businessId: THEIRS, firstName: SECRET, status: 'LEAD' }],
  ]);
  const contactTasks: any[] = [];
  const matches = (row: any, where: any) => !!row && Object.entries(where).every(([k, v]) => row[k] === v);
  const withRelations = (c: any) => (c ? { ...c, deals: [], invoices: [], bookings: [], tasks: [] } : null);
  const client = {
    callLog: {
      findUnique: vi.fn(async ({ where }: any) => callLogs.get(where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = callLogs.get(where.id);
        return matches(row, where) ? row : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = { ...callLogs.get(where.id), ...data };
        callLogs.set(where.id, row);
        return row;
      }),
      // completeCall writes with `completedAt: null` in its where (V1-54 review ST-1)
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = callLogs.get(where.id);
        if (!matches(row, where)) return { count: 0 };
        callLogs.set(where.id, { ...row, ...data });
        return { count: 1 };
      }),
    },
    contact: {
      findUnique: vi.fn(async ({ where }: any) => withRelations(contacts.get(where.id))),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = contacts.get(where.id);
        return matches(row, where) ? withRelations(row) : null;
      }),
    },
    contactTask: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `ct_${contactTasks.length + 1}`, ...data };
        contactTasks.push(row);
        return row;
      }),
    },
  };
  return { client, callLogs, contactTasks };
}

let prisma: ReturnType<typeof makePrisma>;
let gateway: { complete: ReturnType<typeof vi.fn> };
let emitter: { emit: ReturnType<typeof vi.fn> };
let svc: FlowOrchestratorService;

beforeEach(() => {
  prisma = makePrisma();
  gateway = {
    complete: vi.fn(async () => ({
      content: JSON.stringify({ greeting: 'Hi', talkingPoints: ['a'], ask: 'b', close: 'c', durationEstimate: 3 }),
    })),
  };
  emitter = { emit: vi.fn() };
  const callLogs = new CallLogService(prisma as any, emitter as any);
  const callScripts = new CallScriptService(prisma as any, gateway as any);
  svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    moduleRef: {
      get: (token: unknown) => (token === CallLogService ? callLogs : token === CallScriptService ? callScripts : undefined),
    },
  }) as FlowOrchestratorService;
});

function run(tool: string, args: Record<string, unknown>) {
  return (svc as unknown as {
    executeToolAction: (b: string, t: string, a: Record<string, unknown>) => Promise<any>;
  }).executeToolAction(MINE, tool, args);
}

describe("the call tools refuse another business's rows with no tenant context (V1-21b review 8 DD8-1)", () => {
  it("call_log_outcome: their call log is not found and stays open", async () => {
    await expect(run('call_log_outcome', { callLogId: 'cl_theirs', outcome: 'not_interested', notes: 'via KEY' })).rejects.toThrow('Call log not found');
    expect(prisma.callLogs.get('cl_theirs')).toMatchObject({ completedAt: null, notes: null });
    expect(prisma.client.callLog.update).not.toHaveBeenCalled();
    expect(prisma.client.callLog.updateMany).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('call_log_outcome: its own call log is completed', async () => {
    const out = await run('call_log_outcome', { callLogId: 'cl_mine', outcome: 'reached' });
    expect(out).toMatchObject({ callLogId: 'cl_mine', outcome: 'reached' });
    expect(prisma.callLogs.get('cl_mine').completedAt).toBeInstanceOf(Date);
  });

  it('call_schedule_followup: no task is planted in their CRM', async () => {
    await expect(run('call_schedule_followup', { callLogId: 'cl_theirs', title: 'planted' })).rejects.toThrow('Call log not found');
    expect(prisma.contactTasks).toEqual([]);
    expect(prisma.callLogs.get('cl_theirs').followUpTaskId).toBeUndefined();
  });

  it('call_schedule_followup: its own call log gets a task in its own business', async () => {
    const out = await run('call_schedule_followup', { callLogId: 'cl_mine', title: 'call back' });
    expect(out).toMatchObject({ title: 'call back' });
    expect(prisma.contactTasks).toHaveLength(1);
    expect(prisma.contactTasks[0]).toMatchObject({ businessId: MINE, contactId: 'c_mine', callLogId: 'cl_mine' });
  });

  it('call_generate_script: their call log is not found, and nothing is generated or written', async () => {
    await expect(run('call_generate_script', { callLogId: 'cl_theirs', contactId: 'c_mine' })).rejects.toThrow('Call log not found');
    expect(gateway.complete).not.toHaveBeenCalled();
    expect(prisma.client.callLog.update).not.toHaveBeenCalled();
  });

  it('call_generate_script: their contact never reaches the prompt', async () => {
    await expect(run('call_generate_script', { callLogId: 'cl_mine', contactId: 'c_theirs' })).rejects.toThrow('Contact not found');
    expect(gateway.complete).not.toHaveBeenCalled();
    expect(prisma.callLogs.get('cl_mine').script).toBeUndefined();
  });

  it('call_generate_script: its own rows make a script', async () => {
    const out = await run('call_generate_script', { callLogId: 'cl_mine', contactId: 'c_mine' });
    expect(out).toMatchObject({ callLogId: 'cl_mine', greeting: 'Hi' });
    expect(JSON.stringify(gateway.complete.mock.calls)).not.toContain(SECRET);
    expect(prisma.callLogs.get('cl_mine').script).toBeTruthy();
  });
});
