/**
 * A deferred payment chaser has to actually be sent later.
 *
 * Quiet hours were added to payment recovery earlier today, and the commit
 * claimed: "DEFERRED, not dropped. The task stays pending and the next sweep
 * reconsiders it." That was false as written, and the test shipped alongside it
 * asserted only that the task was left PENDING rather than cancelled — which is
 * true, and is exactly the symptom of the bug.
 *
 * The order of operations was: dedupe on milestone -> create the task -> check
 * the window -> send. So the first sweep inside quiet hours created a PENDING
 * task and sent nothing, and every subsequent sweep found that task with a
 * dedupe carrying no status predicate and `continue`d. The reminder was never
 * sent, for the life of the invoice. "Deferred" meant dropped.
 *
 * The interesting part is that both halves have to hold at once: a deferred task
 * must be resumed, and a task that was genuinely handled must still be skipped.
 * A fix that only satisfies the first re-emails the customer every five minutes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelegationLoopService } from './delegation-loop.service';

const BIZ = 'biz_1';

type Task = {
  id: string;
  businessId: string;
  status: string;
  requiresApproval: boolean;
  autoExecutable: boolean;
  executedAt: Date | null;
  relatedType: string | null;
  relatedId: string | null;
  category: string | null;
  aiContext: Record<string, unknown>;
};

/** An invoice `daysAgo` past due, with a contactable customer. */
function invoice(daysAgo: number) {
  const dueDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id: 'inv_1',
    invoiceNumber: 'INV-001',
    total: 500,
    dueDate,
    status: 'OVERDUE',
    contact: {
      id: 'con_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: null,
      doNotContact: false,
    },
  };
}

function makeService(invoices: ReturnType<typeof invoice>[]) {
  const tasks: Task[] = [];
  const emails: Array<Record<string, unknown>> = [];
  let seq = 0;

  const matches = (t: Task, where: any) =>
    t.businessId === where.businessId &&
    t.relatedType === where.relatedType &&
    t.relatedId === where.relatedId &&
    t.category === where.category &&
    t.aiContext[where.aiContext.path[0]] === where.aiContext.equals;

  // Built on the prototype so runPaymentRecovery is the REAL method.
  const service = Object.assign(Object.create(DelegationLoopService.prototype), {
    prisma: {
      client: {
        invoice: {
          findMany: vi.fn(async () => invoices),
          update: vi.fn(async () => ({})),
        },
        autopilotTask: {
          findFirst: vi.fn(async ({ where }: any) => tasks.find((t) => matches(t, where)) ?? null),
          create: vi.fn(async ({ data }: any) => {
            const t: Task = {
              id: `task_${++seq}`,
              businessId: data.businessId,
              status: 'PENDING',
              requiresApproval: !!data.requiresApproval,
              autoExecutable: !!data.autoExecutable,
              executedAt: null,
              relatedType: data.relatedType,
              relatedId: data.relatedId,
              category: data.category,
              aiContext: data.aiContext,
            };
            tasks.push(t);
            return t;
          }),
          update: vi.fn(async ({ where, data }: any) => {
            const t = tasks.find((x) => x.id === where.id)!;
            Object.assign(t, data);
            return t;
          }),
        },
      },
    },
    timeline: { logEvent: vi.fn(async () => undefined) },
    events: { emit: vi.fn() },
    emailService: {
      send: vi.fn(async (payload: Record<string, unknown>) => {
        emails.push(payload);
      }),
    },
    logger: { log: vi.fn(), warn: vi.fn() },
  });

  // The window is consulted with wall-clock time from inside the loop, so there
  // is no seam to inject a clock through. Stubbing it controls the ONE input
  // under test — "is it quiet right now" — rather than reimplementing the rule,
  // which contact-window.spec.ts already covers against the real method.
  let open = true;
  service.contactWindow = vi.fn(async () =>
    open ? { allowed: true } : { allowed: false, reason: 'quiet hours (22:00-07:00)' },
  );

  const sweep = (requiresConfirm = false) =>
    (service as any).runPaymentRecovery(
      BIZ,
      {},
      { itemsScanned: 0, itemsMatched: 0, actionsCreated: 0, results: [] },
      requiresConfirm,
    );

  return {
    sweep,
    tasks,
    emails,
    setWindow: (v: boolean) => {
      open = v;
    },
  };
}

describe('the deferral is honoured when the window opens', () => {
  let h: ReturnType<typeof makeService>;

  beforeEach(() => {
    // 10 days past due -> the 7-day milestone -> HIGH, auto-executable.
    h = makeService([invoice(10)]);
  });

  it('sends nothing during quiet hours', async () => {
    h.setWindow(false);
    await h.sweep();

    expect(h.emails).toEqual([]);
  });

  it('leaves the task pending rather than cancelling it', async () => {
    h.setWindow(false);
    await h.sweep();

    expect(h.tasks).toHaveLength(1);
    expect(h.tasks[0].status).toBe('PENDING');
  });

  it('SENDS IT on the next sweep once the window opens', async () => {
    // The whole point, and the assertion the original test was missing. Without
    // it, everything above is equally true of an email that never goes out.
    h.setWindow(false);
    await h.sweep();
    h.setWindow(true);
    await h.sweep();

    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].recipientEmail).toBe('ada@example.com');
  });

  it('resumes the same task instead of raising a second one', async () => {
    h.setWindow(false);
    await h.sweep();
    h.setWindow(true);
    await h.sweep();

    expect(h.tasks).toHaveLength(1);
    expect(h.tasks[0].status).toBe('AUTO_EXECUTED');
    expect(h.tasks[0].executedAt).toBeInstanceOf(Date);
  });

  it('survives several closed sweeps before opening', async () => {
    h.setWindow(false);
    await h.sweep();
    await h.sweep();
    await h.sweep();
    expect(h.tasks).toHaveLength(1);

    h.setWindow(true);
    await h.sweep();

    expect(h.emails).toHaveLength(1);
  });
});

describe('and a handled task is still left alone', () => {
  // The other half. A dedupe loose enough to resume a deferral must not be so
  // loose that it re-chases a customer every five minutes forever.

  it('does not send twice once it has been sent', async () => {
    const h = makeService([invoice(10)]);
    await h.sweep();
    await h.sweep();
    await h.sweep();

    expect(h.emails).toHaveLength(1);
    expect(h.tasks).toHaveLength(1);
  });

  it('does not resume a task a human was asked to approve', async () => {
    // 20 days past due clears the 14-day escalation -> URGENT -> approval.
    // It is pending because someone has to decide, not because it was deferred,
    // and reviving it would send the thing they were asked about.
    const h = makeService([invoice(20)]);
    await h.sweep();
    await h.sweep();

    expect(h.tasks).toHaveLength(1);
    expect(h.tasks[0].requiresApproval).toBe(true);
    expect(h.emails).toEqual([]);
  });

  it('does not send a deferred task if governance tightened meanwhile', async () => {
    // Deferred while auto-executable, resumed after the business turned on
    // confirm-before-send. The retry must hand it to a human, not fire on the
    // flags it was created with.
    const h = makeService([invoice(10)]);
    h.setWindow(false);
    await h.sweep(false);

    h.setWindow(true);
    await h.sweep(true);

    expect(h.emails).toEqual([]);
    expect(h.tasks[0].requiresApproval).toBe(true);
    expect(h.tasks[0].status).toBe('PENDING');
  });
});
