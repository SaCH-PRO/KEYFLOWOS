"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Cable, Check, Download, FolderSync, Loader2, Lock, Mail, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { getStoredBusinessId } from "@/lib/workspace";
import { formatCurrency } from "@/lib/currency";
import {
  fetchFinanceAccounts,
  fetchBankSplitView,
  importBankCsv,
  setStatementSources,
  sweepStatementSource,
  runBankAutoMatch,
  manualMatchBankRow,
  unmatchBankRow,
  ignoreBankRow,
  listReconciliations,
  createReconciliation,
  completeReconciliation,
  downloadReconciliationReportCsv,
  type FinancialAccountRow,
  type BankSplitView,
  type LedgerCandidateRow,
  type ReconciliationRow,
} from "@/lib/client";
import { SkeletonGrid } from "../_overview-client";

export default function FinanceReconciliationPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBusinessId(getStoredBusinessId()); }, []);
  if (!businessId) return <SkeletonGrid />;
  return <ReconciliationBody businessId={businessId} />;
}

function ReconciliationBody({ businessId }: { businessId: string }) {
  const [accounts, setAccounts] = useState<FinancialAccountRow[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [split, setSplit] = useState<BankSplitView | null>(null);
  const [recons, setRecons] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [showSession, setShowSession] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadAccounts = useCallback(async () => {
    const r = await fetchFinanceAccounts(businessId);
    if (r.error) { toast.error(r.error); return; }
    if (r.data) {
      const banky = r.data.items.filter((a) => ["BANK", "CASH", "PAYMENT_PROCESSOR", "CREDIT_CARD"].includes(a.type));
      setAccounts(banky);
      if (!accountId && banky.length) setAccountId(banky[0].id);
    }
  }, [businessId, accountId]);

  const loadSplit = useCallback(async (id: string) => {
    if (!id) return;
    const r = await fetchBankSplitView(businessId, id);
    if (r.error) { toast.error(r.error); return; }
    if (r.data) setSplit(r.data);
  }, [businessId]);

  const loadRecons = useCallback(async (id: string) => {
    if (!id) return;
    const r = await listReconciliations(businessId, id);
    if (r.data) setRecons(r.data.items);
  }, [businessId]);

  useEffect(() => {
    setLoading(true);
    loadAccounts().finally(() => setLoading(false));
  }, [loadAccounts]);

  useEffect(() => {
    if (accountId) {
      loadSplit(accountId);
      loadRecons(accountId);
    }
  }, [accountId, loadSplit, loadRecons]);

  const onFile = async (file: File | null) => {
    if (!file || !accountId) return;
    setWorking(true);
    try {
      const r = await importBankCsv(businessId, accountId, file);
      const am = r.autoMatched ? ` · auto-matched ${r.autoMatched.matched}` : "";
      const fmt = r.format ? ` · read as ${r.format.toUpperCase()}` : "";
      toast.success(`Imported ${r.inserted} rows (${r.duplicates} duplicates, ${r.invalid} invalid)${am}${fmt}`);
      // A file with no bank-assigned transaction id was deduped on a guess.
      // Say so — silence here is what lets a double-import go unnoticed.
      if (r.exactDedupe === false) {
        toast.message("Duplicates judged by date, amount and reference", {
          description: "This format carries no transaction id, so re-importing the same file may create duplicates. OFX and MT940 do not have this problem.",
        });
      }
      if (r.errors.length) toast.message(`${r.errors.length} row error(s)`, { description: r.errors.slice(0, 3).join("\n") });
      await loadSplit(accountId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWorking(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const runAuto = async () => {
    if (!accountId) return;
    setWorking(true);
    const r = await runBankAutoMatch(businessId, accountId);
    setWorking(false);
    if (r.error) { toast.error(r.error); return; }
    if (r.data) toast.success(`Auto-matched ${r.data.matched} of ${r.data.scanned} unmatched rows`);
    loadSplit(accountId);
  };

  const onMatchClicked = async (ledgerTxnId: string) => {
    if (!selectedBankId) { toast.error("Pick a bank row first"); return; }
    const r = await manualMatchBankRow(businessId, selectedBankId, ledgerTxnId);
    if (r.error) { toast.error(r.error); return; }
    toast.success("Matched");
    setSelectedBankId(null);
    loadSplit(accountId);
  };
  const onUnmatch = async (id: string) => {
    const r = await unmatchBankRow(businessId, id);
    if (r.error) { toast.error(r.error); return; }
    loadSplit(accountId);
  };
  const onIgnore = async (id: string) => {
    const r = await ignoreBankRow(businessId, id);
    if (r.error) { toast.error(r.error); return; }
    loadSplit(accountId);
  };

  const account = accounts.find((a) => a.id === accountId);
  const unmatched = useMemo(() => (split?.bankTransactions ?? []).filter((b) => b.status === "UNMATCHED"), [split]);
  const matched = useMemo(() => (split?.bankTransactions ?? []).filter((b) => b.status === "MATCHED"), [split]);
  const ignored = useMemo(() => (split?.bankTransactions ?? []).filter((b) => b.status === "IGNORED"), [split]);
  const claimedTxnIds = useMemo(() => new Set(matched.map((m) => m.matchedTransactionId).filter(Boolean) as string[]), [matched]);
  const ledgerOpen = useMemo(
    () => (split?.ledgerCandidates ?? []).filter((c) => !claimedTxnIds.has(c.transactionId)),
    [split, claimedTxnIds],
  );

  if (loading) return <SkeletonGrid />;

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No bank accounts yet"
        description="Add a Cash or Bank account in Finance → Accounts before importing a statement."
        variant="compact"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm"
          value={accountId}
          onChange={(e) => { setAccountId(e.target.value); setSelectedBankId(null); }}
        >
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
        <input
          ref={fileRef}
          type="file"
          /* The importer detects OFX, QFX, QIF, MT940 and CSV by reading the
             content. Restricting the picker to .csv hid four of them. */
          accept=".csv,.ofx,.qfx,.qif,.sta,.mt940,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={working || !accountId}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80 disabled:opacity-50"
          title="CSV, OFX, QFX, QIF or MT940 — the format is detected from the file"
        >
          {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Import statement
        </button>
        <button
          onClick={() => setShowSources((v) => !v)}
          disabled={!accountId}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80 disabled:opacity-50"
        >
          <Cable className="w-3.5 h-3.5" />
          {showSources ? "Hide automation" : "Automate this"}
        </button>
        <button
          onClick={runAuto}
          disabled={working || unmatched.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80 disabled:opacity-50"
        >
          Re-run auto-match
        </button>
        <button
          onClick={() => setShowSession((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-2.5 py-1.5 text-xs font-medium hover:opacity-90"
        >
          {showSession ? "Hide session form" : "New reconciliation"}
        </button>
        {account && (
          <span className="text-xs text-muted-foreground ml-auto">
            Current balance: <span className="font-mono">{formatCurrency(Number(account.currentBalance), account.currency)}</span>
          </span>
        )}
      </div>

      {showSources && accountId && account && (
        <StatementSourcesPanel
          businessId={businessId}
          accountId={accountId}
          accountName={account.name}
          initial={account.metadata?.statementSources ?? {}}
          onImported={() => { loadSplit(accountId); loadAccounts(); }}
        />
      )}

      {showSession && accountId && (
        <SessionForm
          businessId={businessId}
          accountId={accountId}
          onCreated={() => { setShowSession(false); loadRecons(accountId); }}
        />
      )}

      <div className="grid lg:grid-cols-2 gap-3">
        <Panel title={`Unmatched bank rows · ${unmatched.length}`}>
          {unmatched.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">All bank rows are matched or ignored.</p>
          ) : (
            <ul className="divide-y divide-border/30">
              {unmatched.map((b) => (
                <li
                  key={b.id}
                  className={`px-3 py-2 cursor-pointer text-sm flex items-center gap-2 ${selectedBankId === b.id ? "bg-primary/10" : "hover:bg-card/60"}`}
                  onClick={() => setSelectedBankId((cur) => (cur === b.id ? null : b.id))}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{b.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.date.slice(0, 10)}{b.reference ? ` · ${b.reference}` : ""}
                    </div>
                  </div>
                  <span className={`font-mono text-sm ${b.amount < 0 ? "text-rose-500" : "text-emerald-500"}`}>
                    {formatCurrency(b.amount, account?.currency ?? "TTD")}
                  </span>
                  <button
                    title="Ignore"
                    onClick={(e) => { e.stopPropagation(); onIgnore(b.id); }}
                    className="text-muted-foreground hover:text-rose-500 p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Unmatched ledger entries · ${ledgerOpen.length}${selectedBankId ? " (click to match)" : ""}`}>
          {ledgerOpen.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">No outstanding ledger entries on this account.</p>
          ) : (
            <ul className="divide-y divide-border/30">
              {ledgerOpen.map((c) => (
                <LedgerRow
                  key={c.transactionId}
                  row={c}
                  currency={account?.currency ?? "TTD"}
                  selectable={!!selectedBankId}
                  onClick={() => onMatchClicked(c.transactionId)}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Panel title={`Matched · ${matched.length}`}>
          {matched.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">No matches yet.</p>
          ) : (
            <ul className="divide-y divide-border/30">
              {matched.slice(0, 50).map((b) => (
                <li key={b.id} className="px-3 py-2 text-sm flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{b.description}</div>
                    <div className="text-xs text-muted-foreground">{b.date.slice(0, 10)}</div>
                  </div>
                  <span className="font-mono text-sm">{formatCurrency(b.amount, account?.currency ?? "TTD")}</span>
                  <button
                    onClick={() => onUnmatch(b.id)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Unmatch
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Ignored · ${ignored.length}`}>
          {ignored.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">Nothing ignored.</p>
          ) : (
            <ul className="divide-y divide-border/30">
              {ignored.slice(0, 50).map((b) => (
                <li key={b.id} className="px-3 py-2 text-sm flex items-center gap-2">
                  <span className="flex-1 truncate text-muted-foreground">{b.description}</span>
                  <span className="font-mono text-xs text-muted-foreground">{formatCurrency(b.amount, account?.currency ?? "TTD")}</span>
                  <button
                    onClick={() => onUnmatch(b.id)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={`Reconciliation sessions · ${recons.length}`}>
        {recons.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3">No sessions yet. Use “New reconciliation” to start one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full w-full text-sm">
            <thead className="bg-background/60 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Period</th>
                <th className="text-right px-3 py-2 font-medium">Statement</th>
                <th className="text-right px-3 py-2 font-medium">System</th>
                <th className="text-right px-3 py-2 font-medium">Diff</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {recons.map((r) => (
                <SessionRow
                  key={r.id}
                  businessId={businessId}
                  recon={r}
                  currency={account?.currency ?? "TTD"}
                  onChange={() => loadRecons(accountId)}
                />
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/30 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</div>
      <div className="max-h-96 overflow-y-auto">{children}</div>
    </div>
  );
}

function LedgerRow({ row, currency, selectable, onClick }: {
  row: LedgerCandidateRow;
  currency: string;
  selectable: boolean;
  onClick: () => void;
}) {
  return (
    <li
      onClick={selectable ? onClick : undefined}
      className={`px-3 py-2 text-sm flex items-center gap-2 ${selectable ? "cursor-pointer hover:bg-primary/10" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="truncate">{row.description ?? "(no description)"}</div>
        <div className="text-xs text-muted-foreground">
          {row.date.slice(0, 10)}{row.reference ? ` · ${row.reference}` : ""}
        </div>
      </div>
      <span className={`font-mono text-sm ${row.amount < 0 ? "text-rose-500" : "text-emerald-500"}`}>
        {formatCurrency(row.amount, currency)}
      </span>
    </li>
  );
}

/**
 * Turn the manual upload above into something that happens without anyone.
 *
 * Two sources, deliberately the two that need no bank's permission: a Drive
 * folder someone drops a file into, and the mail the bank already sends. Both
 * are swept nightly and both can be run now.
 *
 * Routing is per-account and explicit — a folder belongs to exactly one
 * account. That is a restriction worth keeping: inferring the account from an
 * account number inside the file would post a month of transactions to the
 * wrong ledger, and the reconciliation would then balance against the wrong
 * book, which is far harder to notice than an import that simply did not run.
 */
function StatementSourcesPanel({ businessId, accountId, accountName, initial, onImported }: {
  businessId: string;
  accountId: string;
  accountName: string;
  initial: { driveFolderId?: string; gmailQuery?: string; lastSweptAt?: string };
  onImported: () => void;
}) {
  const [driveFolderId, setDriveFolderId] = useState(initial.driveFolderId ?? "");
  const [gmailQuery, setGmailQuery] = useState(initial.gmailQuery ?? "");
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState<"drive" | "gmail" | null>(null);

  const save = async () => {
    setSaving(true);
    const r = await setStatementSources(businessId, accountId, {
      driveFolderId: driveFolderId.trim(),
      gmailQuery: gmailQuery.trim(),
    });
    setSaving(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success(`${accountName} will be swept nightly`);
  };

  const sweep = async (source: "drive" | "gmail") => {
    setSweeping(source);
    const r = await sweepStatementSource(businessId, accountId, source);
    setSweeping(null);
    if (r.error) { toast.error(r.error); return; }
    const d = r.data;
    if (!d) return;
    // A sweep that finds nothing is the common case and must not read as
    // failure — "checked, nothing new" is a different sentence from "broken".
    if (d.errors.length) {
      toast.message(`Swept with ${d.errors.length} problem(s)`, { description: d.errors.slice(0, 3).join("\n") });
    } else if (d.imported === 0) {
      toast.success(`Checked ${d.filesConsidered} file(s) — nothing new to import`);
    } else {
      toast.success(`Imported ${d.imported} transaction(s) from ${d.filesConsidered} file(s)`);
    }
    onImported();
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Cable className="w-4 h-4" /> Automatic statement sources
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Statements for <span className="font-medium">{accountName}</span> only. Swept every night at 5am, and
          re-importing the same file is harmless when the format carries a transaction id (OFX, QFX, MT940).
          {initial.lastSweptAt && (
            <> Last swept {new Date(initial.lastSweptAt).toLocaleString()}.</>
          )}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="kf-drive-folder" className="text-xs font-medium flex items-center gap-1.5">
            <FolderSync className="w-3.5 h-3.5" /> Google Drive folder
          </label>
          <input
            id="kf-drive-folder"
            value={driveFolderId}
            onChange={(e) => setDriveFolderId(e.target.value)}
            placeholder="Folder ID from the Drive URL"
            className="w-full rounded-lg border border-border/40 bg-background px-2.5 py-1.5 text-sm font-mono"
          />
          <p className="text-[11px] text-muted-foreground/70">
            Open the folder in Drive; the ID is the last part of the address. Anything statement-shaped dropped
            in it gets imported. Other files are left alone.
          </p>
          <button
            onClick={() => sweep("drive")}
            disabled={!driveFolderId.trim() || sweeping !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80 disabled:opacity-50"
          >
            {sweeping === "drive" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderSync className="w-3.5 h-3.5" />}
            Sweep now
          </button>
        </div>

        <div className="space-y-2">
          <label htmlFor="kf-gmail-query" className="text-xs font-medium flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5" /> Gmail search
          </label>
          <input
            id="kf-gmail-query"
            value={gmailQuery}
            onChange={(e) => setGmailQuery(e.target.value)}
            placeholder="from:republicbank.com subject:statement"
            className="w-full rounded-lg border border-border/40 bg-background px-2.5 py-1.5 text-sm font-mono"
          />
          <p className="text-[11px] text-muted-foreground/70">
            Anything you would type into Gmail&apos;s own search box. <code>has:attachment</code> and a date bound
            are added for you, so a sweep never re-reads the whole mailbox.
          </p>
          <button
            onClick={() => sweep("gmail")}
            disabled={!gmailQuery.trim() || sweeping !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80 disabled:opacity-50"
          >
            {sweeping === "gmail" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
            Sweep now
          </button>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-2.5 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        Save sources
      </button>
    </div>
  );
}

function SessionForm({ businessId, accountId, onCreated }: {
  businessId: string;
  accountId: string;
  onCreated: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [periodStart, setPeriodStart] = useState(monthStart);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [statementBalance, setStatementBalance] = useState("0");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await createReconciliation(businessId, {
      accountId,
      periodStart,
      periodEnd,
      statementBalance: Number(statementBalance) || 0,
      notes: notes || null,
    });
    setBusy(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success("Reconciliation started");
    onCreated();
  };
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3 grid sm:grid-cols-5 gap-2">
      <label className="text-xs flex flex-col gap-1">
        <span className="text-muted-foreground">Period start</span>
        <input type="date" className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
      </label>
      <label className="text-xs flex flex-col gap-1">
        <span className="text-muted-foreground">Period end</span>
        <input type="date" className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
      </label>
      <label className="text-xs flex flex-col gap-1">
        <span className="text-muted-foreground">Statement balance</span>
        <input type="number" step="0.01" className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} />
      </label>
      <label className="text-xs flex flex-col gap-1 sm:col-span-1">
        <span className="text-muted-foreground">Notes</span>
        <input className="rounded-lg border border-border/40 bg-background px-2 py-1.5 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button
        onClick={submit}
        disabled={busy}
        className="self-end rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Start session"}
      </button>
    </div>
  );
}

function SessionRow({ businessId, recon, currency, onChange }: {
  businessId: string;
  recon: ReconciliationRow;
  currency: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const diff = Number(recon.difference);
  const complete = async () => {
    setBusy(true);
    const r = await completeReconciliation(businessId, recon.id);
    setBusy(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success("Reconciled and locked");
    onChange();
  };
  const statusColor =
    recon.status === "RECONCILED" ? "text-emerald-500"
    : recon.status === "NEEDS_REVIEW" ? "text-amber-500"
    : "text-muted-foreground";
  return (
    <tr className="border-t border-border/30">
      <td className="px-3 py-2 text-xs">
        {recon.periodStart.slice(0, 10)} → {recon.periodEnd.slice(0, 10)}
      </td>
      <td className="px-3 py-2 text-right font-mono">{formatCurrency(Number(recon.statementBalance), currency)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatCurrency(Number(recon.systemBalance), currency)}</td>
      <td className={`px-3 py-2 text-right font-mono ${Math.abs(diff) > 0.01 ? "text-rose-500" : "text-emerald-500"}`}>
        {formatCurrency(diff, currency)}
      </td>
      <td className={`px-3 py-2 text-xs font-medium ${statusColor} flex items-center gap-1`}>
        {recon.status === "RECONCILED" && <Lock className="w-3 h-3" />}
        {recon.status}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex items-center gap-2">
          {recon.status !== "RECONCILED" && (
            <button
              onClick={complete}
              disabled={busy}
              className="text-xs rounded-md bg-primary text-primary-foreground px-2 py-1 hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "…" : "Complete"}
            </button>
          )}
          <button
            onClick={async () => {
              try { await downloadReconciliationReportCsv(businessId, recon.id); }
              catch (e) { toast.error((e as Error).message); }
            }}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
      </td>
    </tr>
  );
}
