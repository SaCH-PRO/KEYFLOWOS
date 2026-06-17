"use client";

import { useState, useEffect, useRef } from "react";
import {
  FileSpreadsheet,
  CheckCircle2,
  Upload,
  Download,
  BarChart3,
  Plus,
  Link,
  Unlink,
  ExternalLink,
  ArrowRight,
  FileDown,
  FileUp,
  X,
  Loader2,
} from "lucide-react";
import { apiGet, apiPost, apiDelete, getAuthHeaders, API_BASE } from "@/lib/api";
import { saveAs } from "@/lib/download";
import type {
  InventorySheetStatusDto,
  InventorySheetDiffDto,
  InventorySheetDiffConflict,
  InventorySheetPullPreviewDto,
  InventoryImportResultDto,
  XlsxImportWizardState,
} from "@/lib/types/marketplace";

const EXPECTED_COLUMNS = ["SKU", "Product Name", "Warehouse", "Quantity On Hand", "Reserved", "Reorder Level", "Cost Per Unit", "Currency"];

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function cellValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("result" in obj && obj.result !== undefined) return cellValueToString(obj.result);
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((rt) => rt.text ?? "").join("");
    }
    if ("text" in obj && obj.text !== undefined) {
      const t = obj.text;
      return typeof t === "string" ? t : String(t);
    }
    if ("hyperlink" in obj && typeof obj.hyperlink === "string") return obj.hyperlink;
    if ("error" in obj) return "";
    return String(value);
  }
  return String(value);
}

async function readXlsxAsRows(file: File): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const lastRow = sheet.actualRowCount > 0 ? sheet.rowCount : 0;
  const lastCol = sheet.columnCount;
  const rows: string[][] = [];
  for (let r = 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const arr: string[] = [];
    let hasValue = false;
    for (let c = 1; c <= lastCol; c++) {
      const v = cellValueToString(row.getCell(c).value);
      arr.push(v);
      if (v !== "") hasValue = true;
    }
    if (hasValue || r === 1) rows.push(arr);
  }
  return rows;
}

export function SheetsManageDrawer({ businessId }: { businessId: string }) {
  const [sheetStatus, setSheetStatus] = useState<InventorySheetStatusDto | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetAction, setSheetAction] = useState<string | null>(null);
  const [pullPreview, setPullPreview] = useState<InventorySheetPullPreviewDto | null>(null);
  const [sheetDiff, setSheetDiff] = useState<InventorySheetDiffDto | null>(null);
  const [conflictResolutions, setConflictResolutions] = useState<Record<number, "system" | "sheet">>({});
  const [importResult, setImportResult] = useState<InventoryImportResultDto | null>(null);
  const [xlsxImporting, setXlsxImporting] = useState(false);
  const [xlsxWizard, setXlsxWizard] = useState<XlsxImportWizardState | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      const res = await apiGet<InventorySheetStatusDto>(`/drive/businesses/${businessId}/inventory-sheet/status`);
      if (!cancelled && res.data) setSheetStatus(res.data);
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const handleConnectDrive = async () => {
    try {
      const res = await apiGet<{ url: string }>(`/drive/businesses/${businessId}/auth-url`);
      if (res.data?.url) window.location.href = res.data.url;
    } catch {}
  };

  const handleCreateSheet = async () => {
    setSheetLoading(true);
    try {
      const res = await apiPost({ path: `/drive/businesses/${businessId}/inventory-sheet/create`, body: { title: "Inventory Sync" } });
      const sheetData = res.data as { fileId?: string; name?: string } | undefined;
      if (sheetData) {
        setSheetStatus((prev) => ({
          ...prev,
          linkedSheetId: sheetData.fileId ?? null,
          linkedSheetName: sheetData.name ?? null,
        }));
      }
    } catch {}
    setSheetLoading(false);
  };

  const handleLinkSheet = async (sheetId: string, sheetName: string) => {
    try {
      await apiPost({ path: `/drive/businesses/${businessId}/inventory-sheet/link`, body: { sheetId, sheetName } });
      const res = await apiGet<InventorySheetStatusDto>(`/drive/businesses/${businessId}/inventory-sheet/status`);
      if (res.data) setSheetStatus(res.data);
    } catch {}
  };

  const handleUnlinkSheet = async () => {
    setSheetLoading(true);
    try {
      await apiDelete(`/drive/businesses/${businessId}/inventory-sheet/unlink`);
      setSheetStatus((prev) => ({
        ...prev,
        linkedSheetId: null,
        linkedSheetName: null,
        lastSyncAt: null,
      }));
    } catch {}
    setSheetLoading(false);
  };

  const handlePushToSheet = async () => {
    setSheetLoading(true);
    setSheetAction("push");
    try {
      await apiPost({ path: `/drive/businesses/${businessId}/inventory-sheet/push`, body: {} });
      const res = await apiGet<InventorySheetStatusDto>(`/drive/businesses/${businessId}/inventory-sheet/status`);
      if (res.data) setSheetStatus(res.data);
    } catch {}
    setSheetLoading(false);
    setSheetAction(null);
  };

  const handlePullFromSheet = async () => {
    setSheetLoading(true);
    setSheetAction("pull");
    try {
      const res = await apiGet<InventorySheetPullPreviewDto>(`/drive/businesses/${businessId}/inventory-sheet/pull`);
      if (res.data) setPullPreview(res.data);
    } catch {}
    setSheetLoading(false);
    setSheetAction(null);
  };

  const handleApplyPulledInventory = async (rows: Record<string, string>[]) => {
    setSheetLoading(true);
    setSheetAction("apply");
    try {
      const res = await apiPost({ path: `/drive/businesses/${businessId}/inventory-sheet/apply`, body: { rows } });
      if (res.data) setImportResult(res.data as InventoryImportResultDto);
      setPullPreview(null);
      setSheetDiff(null);
      setConflictResolutions({});
    } catch {}
    setSheetLoading(false);
    setSheetAction(null);
  };

  const handleGenerateDiff = async () => {
    setSheetLoading(true);
    setSheetAction("diff");
    try {
      const res = await apiGet<InventorySheetDiffDto>(`/drive/businesses/${businessId}/inventory-sheet/diff`);
      if (res.data) {
        setSheetDiff(res.data);
        const defaultResolutions: Record<number, "system" | "sheet"> = {};
        (res.data.conflicts || []).forEach((_, i) => { defaultResolutions[i] = "sheet"; });
        setConflictResolutions(defaultResolutions);
      }
    } catch {}
    setSheetLoading(false);
    setSheetAction(null);
  };

  const handleApplyResolved = async () => {
    if (!sheetDiff?.conflicts) return;
    const rowsToApply = sheetDiff.conflicts
      .filter((_, i) => conflictResolutions[i] === "sheet")
      .map((c) => ({
        "SKU": c.sku ?? "",
        "Product Name": c.productName ?? "",
        "Warehouse": c.warehouseName ?? "",
        "Quantity On Hand": String(c.sheetQty ?? ""),
        "Reorder Level": c.sheetReorderAt !== null && c.sheetReorderAt !== undefined ? String(c.sheetReorderAt) : "",
      }));
    await handleApplyPulledInventory(rowsToApply);
  };

  const handleExportExcel = async () => {
    try {
      const res = await fetch(`${API_BASE}/marketplace/businesses/${businessId}/inventory/export-excel`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const blob = await res.blob();
      saveAs(blob, `inventory-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {}
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch(`${API_BASE}/marketplace/businesses/${businessId}/inventory/template-excel`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const blob = await res.blob();
      saveAs(blob, "inventory-template.xlsx");
    } catch {}
  };

  const handleXlsxImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    try {
      const data = await readXlsxAsRows(file);
      if (!data.length) return;
      const headers = (data[0] || []).map((h) => String(h ?? "").trim());
      const previewRows = data.slice(1, 6);
      const autoMap: Record<string, string> = {};
      for (const expected of EXPECTED_COLUMNS) {
        const match = headers.find((h: string) => h.toLowerCase() === expected.toLowerCase());
        autoMap[expected] = match || "";
      }
      setXlsxWizard({ file, headers, previewRows, columnMap: autoMap });
    } catch {
      setImportResult({ imported: 0, skipped: 0, errors: ["Failed to parse Excel file"] });
    }
  };

  const handleApplyXlsxMapping = async () => {
    if (!xlsxWizard) return;
    setXlsxImporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const rawRows = await readXlsxAsRows(xlsxWizard.file);
      const headers = rawRows[0] || [];
      const headerIdx: Record<string, number> = {};
      headers.forEach((h, i) => { headerIdx[String(h ?? "").trim()] = i; });

      const mappedRows = rawRows.slice(1).map((row) => {
        const obj: Record<string, string> = {};
        for (const [expected, sourceCol] of Object.entries(xlsxWizard.columnMap)) {
          if (sourceCol) obj[expected] = String(row[headerIdx[sourceCol]] ?? "");
        }
        return obj;
      }).filter((r) => r["Product Name"] || r["SKU"]);

      const newWorkbook = new ExcelJS.Workbook();
      const newSheet = newWorkbook.addWorksheet("Sheet1");
      newSheet.addRow(EXPECTED_COLUMNS);
      for (const r of mappedRows) {
        newSheet.addRow(EXPECTED_COLUMNS.map((c) => r[c] ?? ""));
      }
      const buffer = await newWorkbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const form = new FormData();
      form.append("file", blob, "inventory.xlsx");
      const res = await fetch(`${API_BASE}/marketplace/businesses/${businessId}/inventory/import-excel`, {
        method: "POST",
        body: form,
        headers: getAuthHeaders(),
      });
      const data = await res.json() as InventoryImportResultDto;
      setImportResult(data);
      setXlsxWizard(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Import failed";
      setImportResult({ imported: 0, skipped: 0, errors: [message] });
    }
    setXlsxImporting(false);
  };

  const handleLinkFromUrl = () => {
    const match = linkUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return;
    const sheetId = match[1];
    const sheetName = linkUrl.includes("docs.google.com") ? "Linked Sheet" : "Sheet";
    handleLinkSheet(sheetId, sheetName);
    setShowLinkInput(false);
    setLinkUrl("");
  };

  return (
    <div className="space-y-5">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Google Sheets Sync</h3>
            <p className="text-[11px] text-muted-foreground">Link a sheet to bidirectionally sync your inventory data</p>
          </div>
        </div>

        {!sheetStatus?.connected ? (
          <div className="space-y-3">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-400">
              Connect your Google Drive account to enable Sheets sync
            </div>
            <button
              onClick={handleConnectDrive}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white text-black hover:bg-white/90 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Connect Google Drive
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>Google Drive connected</span>
            </div>

            {sheetStatus?.linkedSheetId ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{sheetStatus.linkedSheetName || "Linked Sheet"}</p>
                    {sheetStatus.lastSyncAt && <p className="text-[10px] text-muted-foreground">Last synced {formatDate(sheetStatus.lastSyncAt)}</p>}
                  </div>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${sheetStatus.linkedSheetId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={handleUnlinkSheet}
                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handlePushToSheet}
                    disabled={sheetLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors disabled:opacity-50"
                  >
                    {sheetLoading && sheetAction === "push" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Push to Sheet
                  </button>
                  <button
                    onClick={handlePullFromSheet}
                    disabled={sheetLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
                  >
                    {sheetLoading && sheetAction === "pull" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Pull from Sheet
                  </button>
                  <button
                    onClick={handleGenerateDiff}
                    disabled={sheetLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
                  >
                    {sheetLoading && sheetAction === "diff" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
                    Compare Sheet
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleCreateSheet}
                    disabled={sheetLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
                  >
                    {sheetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Create New Sheet
                  </button>
                  <button
                    onClick={() => setShowLinkInput(!showLinkInput)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors"
                  >
                    <Link className="w-3.5 h-3.5" />
                    Link Existing Sheet
                  </button>
                </div>
                {showLinkInput && (
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-orange-500/40"
                      placeholder="Paste Google Sheets URL..."
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                    />
                    <button
                      onClick={handleLinkFromUrl}
                      className="px-3 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
                    >
                      Link
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {sheetDiff && (
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-400" />
                Sheet vs System Comparison
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {sheetDiff.conflicts?.length ?? 0} differences · {sheetDiff.unchanged ?? 0} unchanged · Select which values to keep
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const all: Record<number, "system" | "sheet"> = {};
                  (sheetDiff.conflicts || []).forEach((_, i) => { all[i] = "system"; });
                  setConflictResolutions(all);
                }}
                className="text-[10px] px-2 py-1 rounded-lg bg-white/5 text-muted-foreground hover:text-white transition-colors"
              >
                Keep All System
              </button>
              <button
                onClick={() => {
                  const all: Record<number, "system" | "sheet"> = {};
                  (sheetDiff.conflicts || []).forEach((_, i) => { all[i] = "sheet"; });
                  setConflictResolutions(all);
                }}
                className="text-[10px] px-2 py-1 rounded-lg bg-white/5 text-muted-foreground hover:text-white transition-colors"
              >
                Accept All Sheet
              </button>
              <button
                onClick={handleApplyResolved}
                disabled={sheetLoading || Object.values(conflictResolutions).every((v) => v === "system")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
              >
                {sheetLoading && sheetAction === "apply" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Apply Selected
              </button>
            </div>
          </div>

          {(sheetDiff.conflicts?.length ?? 0) === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              Sheet and system are in sync — no differences found
            </div>
          ) : (
            <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
              {(sheetDiff.conflicts || []).map((conflict: InventorySheetDiffConflict, i: number) => {
                const resolution = conflictResolutions[i] ?? "sheet";
                return (
                  <div key={i} className={`px-4 py-3 transition-colors ${resolution === "system" ? "bg-blue-500/5" : "bg-emerald-500/5"}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-medium">{conflict.productName}</p>
                          {conflict.sku && <span className="text-[10px] text-muted-foreground">{conflict.sku}</span>}
                          {conflict.isNew && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">New Row</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{conflict.warehouseName}</p>
                        <div className="flex items-center gap-3 mt-1 text-[11px]">
                          <span className={`${resolution === "system" ? "text-blue-400 font-medium" : "text-muted-foreground line-through"}`}>
                            System: {conflict.systemQty ?? "—"} units
                          </span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className={`${resolution === "sheet" ? "text-emerald-400 font-medium" : "text-muted-foreground line-through"}`}>
                            Sheet: {conflict.sheetQty} units
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setConflictResolutions((r) => ({ ...r, [i]: "system" }))}
                          className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${resolution === "system" ? "bg-blue-500/30 text-blue-400 border border-blue-500/40" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}
                        >
                          Keep System
                        </button>
                        <button
                          onClick={() => setConflictResolutions((r) => ({ ...r, [i]: "sheet" }))}
                          className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${resolution === "sheet" ? "bg-emerald-500/30 text-emerald-400 border border-emerald-500/40" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}
                        >
                          Accept Sheet
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {pullPreview && !sheetDiff && (
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Sheet Data Preview</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">{pullPreview.rows?.length ?? 0} rows from Google Sheet — review before applying</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{pullPreview.rows?.length ?? 0} rows</span>
              <button
                onClick={() => handleApplyPulledInventory(pullPreview.rows || [])}
                disabled={sheetLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
              >
                {sheetLoading && sheetAction === "apply" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Apply to Inventory
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-60">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-white/5">
                  {(pullPreview.headers || []).map((h: string, i: number) => (
                    <th key={i} className="px-3 py-2 text-left text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(pullPreview.rows || []).slice(0, 15).map((row, i) => (
                  <tr key={i} className="hover:bg-white/3">
                    {(pullPreview.headers || []).map((h: string, j: number) => (
                      <td key={j} className="px-3 py-2 text-muted-foreground whitespace-nowrap">{row[h] || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(pullPreview.rows?.length ?? 0) > 15 && (
            <div className="px-4 py-2 border-t border-white/5 text-[10px] text-muted-foreground">
              Showing 15 of {pullPreview.rows?.length ?? 0} rows — all rows will be applied
            </div>
          )}
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Download className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Excel Import / Export</h3>
            <p className="text-[11px] text-muted-foreground">Import inventory from Excel or export current stock data</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" />
            Export to Excel
          </button>
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download Template
          </button>
          <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors cursor-pointer">
            {xlsxImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
            Import Excel
            <input type="file" accept=".xlsx,.xls" className="hidden" ref={fileInputRef} onChange={handleXlsxImport} />
          </label>
        </div>

        {xlsxWizard && (
          <div className="mt-4 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold">Column Mapping</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Map your spreadsheet columns to the expected fields</p>
              </div>
              <button onClick={() => setXlsxWizard(null)} className="p-1 rounded hover:bg-white/10 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="p-4 space-y-2">
              {EXPECTED_COLUMNS.map((col: string) => (
                <div key={col} className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground w-36 shrink-0">{col}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <select
                    value={xlsxWizard.columnMap[col] || ""}
                    onChange={(e) => setXlsxWizard((w) => (w ? ({ ...w, columnMap: { ...w.columnMap, [col]: e.target.value } }) : w))}
                    className="flex-1 text-[11px] bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-orange-500/50"
                  >
                    <option value="">— not mapped —</option>
                    {xlsxWizard.headers.map((h: string) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  {xlsxWizard.columnMap[col] && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                </div>
              ))}
            </div>
            {xlsxWizard.previewRows.length > 0 && (
              <div className="border-t border-white/5 overflow-x-auto max-h-32">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-white/5">
                      {xlsxWizard.headers.map((h: string, i: number) => (
                        <th key={i} className="px-2 py-1.5 text-left text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {xlsxWizard.previewRows.map((row: string[], i: number) => (
                      <tr key={i}>
                        {xlsxWizard.headers.map((_: string, j: number) => (
                          <td key={j} className="px-2 py-1 text-muted-foreground whitespace-nowrap">{row[j] ?? "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between gap-3">
              <p className="text-[10px] text-muted-foreground">File: <strong>{xlsxWizard.file.name}</strong></p>
              <button
                onClick={handleApplyXlsxMapping}
                disabled={xlsxImporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
              >
                {xlsxImporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Import with Mapping
              </button>
            </div>
          </div>
        )}

        {importResult && (
          <div className={`mt-3 p-3 rounded-xl border text-xs ${(importResult.imported ?? 0) > 0 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
            <p className="font-medium">Import complete: {importResult.imported} imported, {importResult.skipped} skipped</p>
            {importResult.errors && importResult.errors.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {importResult.errors.slice(0, 5).map((err: string, i: number) => <li key={i} className="text-muted-foreground">• {err}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="mt-3 p-3 rounded-xl bg-white/3 border border-white/5">
          <p className="text-[10px] text-muted-foreground font-medium mb-1">Expected Columns</p>
          <p className="text-[10px] text-muted-foreground">SKU, Product Name, Warehouse, Quantity On Hand, Reserved, Reorder Level, Cost Per Unit, Currency</p>
        </div>
      </div>
    </div>
  );
}
