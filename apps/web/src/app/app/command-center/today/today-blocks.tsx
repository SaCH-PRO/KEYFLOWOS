"use client";

/**
 * TODAY-4BLOCK (v1 step 5; BUG-069, BUG-010, FCP-COR-1; D-150, D-151, D-157): Today is four blocks, each a region
 * headed by a level-2 heading, all read from GET .../today (TODAY-AGGREGATE, lib/api/today.ts):
 *
 *   Needs you   what waits on this member, each with its action inline: a bank-transfer claim (Confirm / Not yet),
 *               an accepted quote (Convert), a staff approval request (Approve / Reject), a KEY proposal
 *               (Approve / Reject, or Run). An action the server refuses says why on its own row.
 *   Today       today's bookings, invoices due, accepted quotes, tasks, orders and reminders ready to send, each one
 *               tap from its action; a customer named on a row links /app/crm/contacts/<id> (journey C4); a reminder
 *               is one tap from WhatsApp (the server's WA-HELPER link).
 *   Pulse       the five Money > Overview figures, for a member with revenue read only (pulseStatus OK). A business
 *               with no money in or out yet sees a sentence, not a row of zeros.
 *   Get set up  each step a link to the page TODAY-AGGREGATE names, the sample invoice as a preview (D-157: nothing
 *               is created), and the install step.
 *
 * Nothing here scores the business: no percentage, no risk count, no metaphor label (journey I5, A8). Under
 * KEY_DISABLED (keyDisabled on GET /identity/me) the KEY kinds of Needs you are not shown.
 */
import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { InstallAppStep } from "@/components/install-app-step";
import { formatCurrency } from "@/lib/currency";
import {
  decideApprovalRequest,
  postTodayAction,
  type TodayAggregate,
  type TodayNeedsYouAction,
  type TodayNeedsYouItem,
  type TodayPulse,
} from "@/lib/api/today";

const KEY_KINDS = new Set<TodayNeedsYouItem["kind"]>(["KEY_PROPOSAL", "PLAN_STEP"]);

const contactHref = (id: string) => `/app/crm/contacts/${encodeURIComponent(id)}`;

/** The calendar day of `at` in `timeZone`, as YYYY-MM-DD. */
function dayIn(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function timeIn(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-TT", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

/** A customer's name, linked to their record when the server gave this member the contact id. */
function Customer({ name, contactId }: { name: string | null; contactId: string | null }) {
  if (!name) return null;
  if (!contactId) return <span className="text-muted-foreground">{name}</span>;
  return (
    <Link href={contactHref(contactId)} className="font-medium text-primary hover:underline focus-ring rounded">
      {name}
    </Link>
  );
}

function Block({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className="rounded-2xl border border-border/60 bg-card/60 p-4 space-y-3 min-w-0"
    >
      <h2 id={id} className="font-display text-base font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">{children}</h3>;
}

const buttonClass =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-ring disabled:opacity-50";
const primaryButton = `${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`;
const quietButton = `${buttonClass} border border-border/60 bg-background hover:bg-muted`;

type Act = { label: string; primary: boolean; run: () => Promise<{ error: string | null }> };

/** The inline actions of a Needs you item: the server's endpoint actions, and Approve / Reject for a staff request. */
function actionsOf(item: TodayNeedsYouItem, businessId: string): { acts: Act[]; links: TodayNeedsYouAction[] } {
  const acts: Act[] = [];
  const links: TodayNeedsYouAction[] = [];
  if (item.kind === "APPROVAL_REQUEST") {
    acts.push(
      { label: "Approve", primary: true, run: () => decideApprovalRequest(businessId, item.sourceId, "approve") },
      { label: "Reject", primary: false, run: () => decideApprovalRequest(businessId, item.sourceId, "reject") },
    );
  }
  for (const action of item.actions) {
    if (action.endpoint && action.method !== "GET") {
      const endpoint = action.endpoint;
      acts.push({
        label: action.label,
        primary: action.actionType !== "DISMISS" && action.actionType !== "REJECT",
        run: () => postTodayAction(endpoint),
      });
    } else if (action.href) {
      links.push(action);
    }
  }
  return { acts, links };
}

function NeedsYouRow({ item, businessId, onDone }: { item: TodayNeedsYouItem; businessId: string; onDone: () => void | Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const { acts, links } = actionsOf(item, businessId);

  const run = async (act: Act) => {
    if (busy) return;
    setBusy(act.label);
    setRefused(null);
    const { error } = await act.run();
    setBusy(null);
    if (error) {
      setRefused(error);
      return;
    }
    await onDone();
  };

  return (
    <li className="rounded-xl border border-border/50 bg-background/60 p-3 space-y-2">
      <div className="min-w-0">
        <Link href={item.href} className="text-sm font-medium text-foreground hover:underline focus-ring rounded break-words">
          {item.title}
        </Link>
        <p className="text-xs text-muted-foreground break-words">
          {item.summary}
          {item.customerName && item.contactId && (
            <>
              {" · "}
              <Customer name={item.customerName} contactId={item.contactId} />
            </>
          )}
        </p>
      </div>
      {(acts.length > 0 || links.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {acts.map((act) => (
            <button
              key={act.label}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(act)}
              className={act.primary ? primaryButton : quietButton}
            >
              {busy === act.label && <Loader2 className="h-3 w-3 animate-spin" />}
              {act.label}
            </button>
          ))}
          {links.map((action) => (
            <Link key={`${action.label}:${action.href}`} href={action.href!} className={quietButton}>
              {action.label}
            </Link>
          ))}
        </div>
      )}
      {refused && (
        <p role="alert" className="text-xs text-destructive">
          {refused}
        </p>
      )}
    </li>
  );
}

function NeedsYou({ data, businessId, keyDisabled, onRefresh }: { data: TodayAggregate; businessId: string; keyDisabled: boolean; onRefresh: () => void | Promise<void> }) {
  const items = data.needsYou.items.filter((i) => !(keyDisabled && KEY_KINDS.has(i.kind)));
  const hidden = data.needsYou.items.length - items.length;
  const more = Math.max(0, data.needsYou.totalCount - data.needsYou.items.length);
  if (items.length === 0 && more === 0) {
    return <p className="text-sm text-muted-foreground">Nothing needs you right now.</p>;
  }
  return (
    <>
      <ul className="space-y-2">
        {items.map((item) => (
          <NeedsYouRow key={item.id} item={item} businessId={businessId} onDone={onRefresh} />
        ))}
      </ul>
      {more > 0 && hidden === 0 && <p className="text-xs text-muted-foreground">And {more} more.</p>}
    </>
  );
}

const rowClass = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-sm";

function TodayList({ data }: { data: TodayAggregate }) {
  const { bookings, invoices, acceptedQuotes, tasks, orders, reminders } = data.today;
  const zone = data.timezone;
  const today = dayIn(new Date(data.generatedAt), zone);
  if (bookings.length + invoices.length + acceptedQuotes.length + tasks.length + orders.length + reminders.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing on for today.</p>;
  }
  return (
    <div className="space-y-3">
      {bookings.length > 0 && (
        <div className="space-y-1.5">
          <SubHeading>Bookings</SubHeading>
          <ul className="space-y-1.5">
            {bookings.map((b) => (
              <li key={b.id} className={rowClass}>
                <span className="min-w-0">
                  <span className="text-muted-foreground mr-2">{timeIn(b.startTime, zone)}</span>
                  <Link href="/app/bookings" className="font-medium hover:underline focus-ring rounded">
                    {b.serviceName ?? "Booking"}
                  </Link>
                </span>
                <Customer name={b.customerName} contactId={b.contactId} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {invoices.length > 0 && (
        <div className="space-y-1.5">
          <SubHeading>Invoices due</SubHeading>
          <ul className="space-y-1.5">
            {invoices.map((inv) => {
              // A date-only due date is stored at midnight UTC: its day is the UTC date, compared with the business's day.
              const dueDay = inv.dueDate ? inv.dueDate.slice(0, 10) : null;
              const overdue = inv.status === "OVERDUE" || (inv.isOverdue && dueDay !== null && dueDay < today);
              return (
                <li key={inv.id} className={rowClass}>
                  <span className="min-w-0">
                    <Link href={`/app/commerce/invoices/${encodeURIComponent(inv.id)}`} className="font-medium hover:underline focus-ring rounded">
                      {inv.invoiceNumber}
                    </Link>
                    <span className="ml-2 text-muted-foreground">{formatCurrency(inv.remaining, inv.currency)}</span>
                    <span className={`ml-2 text-xs ${overdue ? "text-amber-600" : "text-muted-foreground"}`}>
                      {overdue ? "Overdue" : "Due today"}
                    </span>
                  </span>
                  <Customer name={inv.customerName} contactId={inv.contactId} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {acceptedQuotes.length > 0 && (
        <div className="space-y-1.5">
          <SubHeading>Quotes accepted</SubHeading>
          <ul className="space-y-1.5">
            {acceptedQuotes.map((q) => (
              <li key={q.id} className={rowClass}>
                <span className="min-w-0">
                  {/* COR-3: the deep link commerce/page.tsx reads (recordType + recordId opens the quote's record drawer). */}
                  <Link href={`/app/commerce?recordType=quote&recordId=${encodeURIComponent(q.id)}`} className="font-medium hover:underline focus-ring rounded">
                    {q.quoteNumber}
                  </Link>
                  <span className="ml-2 text-muted-foreground">{formatCurrency(q.total, q.currency)}</span>
                </span>
                <Customer name={q.customerName} contactId={q.contactId} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {tasks.length > 0 && (
        <div className="space-y-1.5">
          <SubHeading>Tasks</SubHeading>
          <ul className="space-y-1.5">
            {tasks.map((t) => (
              <li key={t.id} className={rowClass}>
                <Link
                  href={t.contactId ? `${contactHref(t.contactId)}/tasks` : "/app/crm/contacts"}
                  className="min-w-0 font-medium hover:underline focus-ring rounded break-words"
                >
                  {t.title}
                </Link>
                <Customer name={t.customerName} contactId={t.contactId} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {orders.length > 0 && (
        <div className="space-y-1.5">
          <SubHeading>Orders to fulfil</SubHeading>
          <ul className="space-y-1.5">
            {orders.map((o) => (
              <li key={o.id} className={rowClass}>
                <span className="min-w-0">
                  <Link href="/app/marketplace?tab=orders" className="font-medium hover:underline focus-ring rounded">
                    {o.orderNumber}
                  </Link>
                  {o.total !== null && <span className="ml-2 text-muted-foreground">{formatCurrency(o.total, o.currency)}</span>}
                </span>
                {o.customerName && <span className="text-muted-foreground">{o.customerName}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {reminders.length > 0 && (
        <div className="space-y-1.5">
          <SubHeading>Ready to send</SubHeading>
          <ul className="space-y-1.5">
            {reminders.map((r) => (
              <li key={`${r.kind}:${r.id}`} className={rowClass}>
                <span className="min-w-0">
                  <Customer name={r.customerName} contactId={r.contactId} />
                  <span className="ml-2 text-muted-foreground">
                    {r.reference}
                    {r.kind === "invoice" && typeof r.amountDue === "number" ? ` · ${formatCurrency(r.amountDue, r.currency ?? "TTD")}` : ""}
                    {r.kind === "booking" && r.serviceName ? ` · ${r.serviceName}` : ""}
                  </span>
                </span>
                {r.whatsappUrl ? (
                  <a href={r.whatsappUrl} target="_blank" rel="noopener noreferrer" className={quietButton}>
                    <MessageCircle className="h-3 w-3" />
                    Send on WhatsApp
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">No WhatsApp number saved</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PulseFigures({ pulse }: { pulse: TodayPulse }) {
  const c = pulse.currency;
  const nothingYet =
    pulse.cash === 0 && pulse.owedToYou === 0 && pulse.youOwe === 0 && pulse.monthRevenue === 0 &&
    pulse.monthExpenses === 0 && pulse.monthProfit === 0 && pulse.safeToSpend === 0 && pulse.otherCurrencyCash.length === 0;
  if (nothingYet) {
    return (
      <p className="text-sm text-muted-foreground">
        No money in or out yet. Your figures show here once you record a sale, a payment or an expense.
      </p>
    );
  }
  const figures: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Cash", value: formatCurrency(pulse.cash, pulse.cashCurrency || c) },
    { label: "Owed to you", value: formatCurrency(pulse.owedToYou, c), sub: `${pulse.owedCount} invoice${pulse.owedCount === 1 ? "" : "s"}` },
    { label: "You owe", value: formatCurrency(pulse.youOwe, c), sub: `${pulse.youOweCount} bill${pulse.youOweCount === 1 ? "" : "s"}` },
    { label: "This month's profit", value: formatCurrency(pulse.monthProfit, c) },
    { label: "Safe to spend", value: formatCurrency(pulse.safeToSpend, c) },
  ];
  return (
    <>
      <dl className="grid grid-cols-2 gap-2">
        {figures.map((f) => (
          <div key={f.label} className="rounded-xl border border-border/50 bg-background/60 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="text-sm font-semibold text-foreground">{f.value}</dd>
            {f.sub && <dd className="text-[11px] text-muted-foreground">{f.sub}</dd>}
          </div>
        ))}
      </dl>
      <Link href="/app/finance" className="text-xs font-medium text-primary hover:underline focus-ring rounded">
        Open Money
      </Link>
    </>
  );
}

/**
 * D-157: a sample invoice shown as a picture of what customers receive. It creates nothing and links nowhere. A member
 * without revenue read sees it without amounts (journey I6: no money on their Today, a sample's included).
 */
function SamplePreview({ showAmounts, currency }: { showAmounts: boolean; currency: string }) {
  const amount = formatCurrency(250, currency);
  return (
    <figure aria-label="Sample invoice preview" className="rounded-xl border border-dashed border-border/70 bg-background/60 p-3 text-xs space-y-1.5">
      <figcaption className="font-medium text-foreground">Sample invoice (preview)</figcaption>
      <div className="flex justify-between text-muted-foreground">
        <span>Hair treatment × 1</span>
        {showAmounts && <span>{amount}</span>}
      </div>
      {showAmounts && (
        <div className="flex justify-between font-medium text-foreground border-t border-border/50 pt-1.5">
          <span>Total</span>
          <span>{amount}</span>
        </div>
      )}
      <p className="text-muted-foreground">
        This is what your customers get when you send an invoice. It is only a sample: nothing is added to your books.
      </p>
    </figure>
  );
}

function GetSetUp({ data, businessCurrency }: { data: TodayAggregate; businessCurrency: string | null }) {
  const { steps, complete } = data.getSetUp;
  return (
    <div className="space-y-3">
      {complete && <p className="text-sm text-muted-foreground">You are set up. Each step stays here if you want to change it.</p>}
      <ul className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              aria-label={`${s.label}, ${s.done ? "Done" : "To do"}`}
              data-state={s.done ? "done" : "todo"}
              className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-sm hover:bg-muted focus-ring"
            >
              {s.done ? (
                <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <Circle aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className={s.done ? "text-muted-foreground" : "text-foreground"}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {/* COR-7: in the business's own currency (Pulse's, else the business record's), never a hard-coded one. */}
      <SamplePreview showAmounts={data.pulseStatus === "OK"} currency={data.pulse?.currency || businessCurrency || "TTD"} />
      <InstallAppStep />
    </div>
  );
}

export interface TodayBlocksProps {
  businessId: string;
  data: TodayAggregate | null;
  loading: boolean;
  error: string | null;
  /**
   * True whenever KEY may not render: until GET /identity/me answered keyDisabled: false (useKeyEnabled, fail closed),
   * so while that read is in flight, after it failed, and under KEY_DISABLED. The KEY kinds of Needs you are then not shown.
   */
  keyDisabled: boolean;
  /** The business's currency from its cached record (the sample preview's, when Pulse is not there to say). */
  businessCurrency?: string | null;
  onRefresh: () => void | Promise<void>;
  /** Mounted at the end of Needs you (the approved actions panel, the command queue). */
  needsYouExtra?: ReactNode;
  /** Mounted at the end of the Today block (what is due this week). */
  todayExtra?: ReactNode;
}

export function TodayBlocks({ businessId, data, loading, error, keyDisabled, businessCurrency = null, onRefresh, needsYouExtra, todayExtra }: TodayBlocksProps) {
  const waiting = loading && !data;
  const pending = (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </p>
  );
  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" data-testid="today-unavailable" className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-wrap items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="flex-1 min-w-0 text-sm text-foreground">Today could not be loaded: {error}</p>
          <button type="button" onClick={() => void onRefresh()} className={quietButton}>
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <Block title="Needs you" testId="today-block-needs-you">
            {data ? <NeedsYou data={data} businessId={businessId} keyDisabled={keyDisabled} onRefresh={onRefresh} /> : waiting ? pending : null}
            {needsYouExtra}
          </Block>
          <Block title="Today" testId="today-block-today">
            {data ? <TodayList data={data} /> : waiting ? pending : null}
            {todayExtra}
          </Block>
        </div>
        <div className="space-y-4 min-w-0">
          {data && data.pulseStatus === "OK" && (
            <Block title="Pulse" testId="today-block-pulse">
              {data.pulse ? (
                <PulseFigures pulse={data.pulse} />
              ) : (
                // COR-6: a member who may see Pulse, and an answer without it, fails visibly (never an empty block or zeros).
                <p role="alert" data-testid="today-pulse-unavailable" className="text-sm text-amber-700">
                  Pulse could not be loaded: the server sent no figures. Refresh to try again.
                </p>
              )}
            </Block>
          )}
          {data && (
            <Block title="Get set up" testId="today-block-get-set-up">
              <GetSetUp data={data} businessCurrency={businessCurrency} />
            </Block>
          )}
        </div>
      </div>
    </div>
  );
}
