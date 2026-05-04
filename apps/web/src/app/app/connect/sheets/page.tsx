"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Table2,
  Plug,
  Loader2,
  RefreshCw,
  Link2,
  Unlink,
  Plus,
  Upload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiGet, apiPostSimple, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type SheetSource = {
  kind: "inventory";
  label: string;
  description: string;
  statusPath: string;
  createPath: string;
  linkPath: string;
  unlinkPath: string;
  pushPath: string;
};

const SOURCES: SheetSource[] = [
  {
    kind: "inventory",
    label: "Inventory ledger",
    description:
      "Mirror your inventory list to a live Google Sheet. Edits in the sheet sync back; nightly refresh keeps both sides in sync.",
    statusPath: "/drive/businesses/:id/inventory-sheet/status",
    createPath: "/drive/businesses/:id/inventory-sheet/create",
    linkPath: "/drive/businesses/:id/inventory-sheet/link",
    unlinkPath: "/drive/businesses/:id/inventory-sheet/unlink",
    pushPath: "/drive/businesses/:id/inventory-sheet/push",
  },
];

interface SheetStatus {
  linked: boolean;
  sheetId?: string;
  sheetName?: string;
  sheetUrl?: string;
  lastSyncAt?: string | null;
  rowCount?: number;
}

function StatusCard({ source, businessId }: { source: SheetSource; businessId: string }) {
  const [status, setStatus] = useState<SheetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | "link" | "unlink" | "push" | null>(null);
  const [linkInput, setLinkInput] = useState({ sheetId: "", sheetName: "" });
  const [showLink, setShowLink] = useState(false);
  const [confirm, setConfirm] = useState<{ open: boolean; action: () => void }>({ open: false, action: () => {} });

  const url = useCallback(
    (path: string) => path.replace(":id", businessId),
    [businessId],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await apiGet<SheetStatus>(url(source.statusPath));
    setStatus(res.data ?? { linked: false });
    setLoading(false);
  }, [url, source.statusPath]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates async/server data into local state
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    setBusy("create");
    const res = await apiPostSimple<SheetStatus>(url(source.createPath), { title: "KeyFlow Inventory" });
    setBusy(null);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Sheet created");
      await refresh();
    }
  };

  const handleLink = async () => {
    if (!linkInput.sheetId.trim()) return;
    setBusy("link");
    const res = await apiPostSimple<SheetStatus>(url(source.linkPath), {
      sheetId: linkInput.sheetId.trim(),
      sheetName: linkInput.sheetName.trim() || "Sheet1",
    });
    setBusy(null);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Sheet linked");
      setShowLink(false);
      setLinkInput({ sheetId: "", sheetName: "" });
      await refresh();
    }
  };

  const handleUnlink = () => {
    setConfirm({
      open: true,
      action: async () => {
        setBusy("unlink");
        const res = await apiDelete(url(source.unlinkPath));
        setBusy(null);
        if (res.error) toast.error(res.error);
        else {
          toast.success("Sheet unlinked");
          await refresh();
        }
      },
    });
  };

  const handlePush = async () => {
    setBusy("push");
    const res = await apiPostSimple<{ rowsPushed?: number }>(url(source.pushPath), {});
    setBusy(null);
    if (res.error) toast.error(res.error);
    else {
      toast.success(`Sync complete${res.data?.rowsPushed ? ` — ${res.data.rowsPushed} rows pushed` : ""}`);
      await refresh();
    }
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card/40 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Table2 className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{source.label}</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">{source.description}</p>
          </div>
        </div>
        <div className="shrink-0">
          {loading ? (
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking
            </span>
          ) : status?.linked ? (
            <span className="text-[11px] text-emerald-400 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <CheckCircle2 className="h-3 w-3" /> Linked
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/30 border border-border/40">
              <AlertCircle className="h-3 w-3" /> Not linked
            </span>
          )}
        </div>
      </div>

      {status?.linked && (
        <div className="text-xs text-muted-foreground space-y-1">
          {status.sheetName && <div>Sheet: {status.sheetName}</div>}
          {status.lastSyncAt && (
            <div>Last sync: {new Date(status.lastSyncAt).toLocaleString()}</div>
          )}
          {status.rowCount !== undefined && <div>Rows: {status.rowCount}</div>}
          {status.sheetUrl && (
            <a
              href={status.sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[hsl(var(--kf-accent1))] hover:underline"
            >
              Open in Google Sheets →
            </a>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
        {!status?.linked ? (
          <>
            <Button size="sm" onClick={handleCreate} disabled={busy === "create"}>
              {busy === "create" ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Plus className="h-3 w-3 mr-1" />
              )}
              Create new sheet
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowLink((s) => !s)}>
              <Link2 className="h-3 w-3 mr-1" /> Link existing
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={handlePush} disabled={busy === "push"}>
              {busy === "push" ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Upload className="h-3 w-3 mr-1" />
              )}
              Sync now
            </Button>
            <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleUnlink}
              disabled={busy === "unlink"}
              className="text-red-400 hover:text-red-300"
            >
              <Unlink className="h-3 w-3 mr-1" /> Unlink
            </Button>
          </>
        )}
      </div>

      {showLink && !status?.linked && (
        <div className="space-y-2 pt-3 border-t border-border/30">
          <input
            value={linkInput.sheetId}
            onChange={(e) => setLinkInput((s) => ({ ...s, sheetId: e.target.value }))}
            placeholder="Sheet ID (from the URL)"
            className="w-full text-xs bg-background border border-border/40 rounded-lg px-3 py-2"
          />
          <input
            value={linkInput.sheetName}
            onChange={(e) => setLinkInput((s) => ({ ...s, sheetName: e.target.value }))}
            placeholder="Tab name (default: Sheet1)"
            className="w-full text-xs bg-background border border-border/40 rounded-lg px-3 py-2"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleLink} disabled={busy === "link" || !linkInput.sheetId.trim()}>
              {busy === "link" ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Link2 className="h-3 w-3 mr-1" />
              )}
              Link sheet
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowLink(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm.open}
        title="Unlink sheet"
        message="Stop syncing with this sheet? Existing data on both sides will be preserved."
        confirmLabel="Unlink"
        variant="danger"
        onConfirm={() => {
          confirm.action();
          setConfirm((p) => ({ ...p, open: false }));
        }}
        onCancel={() => setConfirm((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}

export default function ConnectSheetsPage() {
  const businessId = getStoredBusinessId();

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4">
      <Link
        href="/app/connect"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Back to Connect
      </Link>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-border/40 flex items-center justify-center">
          <Table2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Sheets as data source</h1>
          <p className="text-xs text-muted-foreground">
            Back catalogs, inventory, and ledgers with a live Google Sheet — bidirectional sync.
          </p>
        </div>
      </div>

      {!businessId ? (
        <div className="text-sm text-muted-foreground">No active business — pick a workspace first.</div>
      ) : (
        <div className="space-y-4">
          {SOURCES.map((s) => (
            <StatusCard key={s.kind} source={s} businessId={businessId} />
          ))}
          <div className="rounded-2xl border border-dashed border-border/40 p-4 text-xs text-muted-foreground flex items-start gap-3">
            <Plug className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              Catalog and Expenses ledger sources are coming next. Need them sooner?{" "}
              <Link href="/app/connect" className="text-[hsl(var(--kf-accent1))] hover:underline">
                Open Connect
              </Link>{" "}
              and reach out via support.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
