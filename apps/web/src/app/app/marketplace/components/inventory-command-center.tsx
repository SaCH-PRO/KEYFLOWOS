"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Layers, ArrowLeftRight, Building2, ShoppingBag,
  AlertTriangle, DollarSign, TableProperties, Plus, Pencil, Trash2,
  RefreshCw, Download, Upload, FileSpreadsheet, Link, Unlink,
  CheckCircle2, XCircle, TrendingDown, Archive, ArrowUp, ArrowDown,
  ArrowRight, Search, Filter, ChevronDown, ChevronUp, Package,
  ExternalLink, BarChart3, Activity, Loader2, X, FileDown, FileUp,
  Warehouse, Clock, Tag,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, getAuthHeaders, API_BASE } from "@/lib/api";
import { saveAs } from "@/lib/download";
import { EmptyState, usePagination, PaginationBar, formatCurrency, formatDate } from "./marketplace-utils";

type ICCTab = "overview" | "stock" | "movements" | "warehouses" | "orders" | "alerts" | "valuation" | "spreadsheets";

const ICC_TABS: { key: ICCTab; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "stock", label: "Stock Grid", icon: Layers },
  { key: "movements", label: "Movements", icon: Activity },
  { key: "warehouses", label: "Warehouses", icon: Warehouse },
  { key: "orders", label: "Purchase Orders", icon: ShoppingBag },
  { key: "alerts", label: "Alerts", icon: AlertTriangle },
  { key: "valuation", label: "Valuation", icon: DollarSign },
  { key: "spreadsheets", label: "Spreadsheets", icon: TableProperties },
];

function StockBadge({ quantity, reorderLevel }: { quantity: number; reorderLevel?: number | null }) {
  if (quantity <= 0) return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
      <Archive className="w-3 h-3" /> Out of Stock
    </span>
  );
  if (reorderLevel && quantity <= reorderLevel) return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
      <TrendingDown className="w-3 h-3" /> Low Stock
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
      <CheckCircle2 className="w-3 h-3" /> In Stock
    </span>
  );
}

function KPICard({ label, value, sub, color, icon: Icon }: { label: string; value: string | number; sub?: string; color: string; icon: React.ElementType }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}20` }}>
        <Icon className="w-4.5 h-4.5" style={{ color }} />
      </div>
      <div>
        <p className="text-xl font-bold">{value}</p>
        <p className="text-xs font-medium text-white/80">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function MovementTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    ADJUSTMENT: { label: "Adjustment", color: "text-blue-400 bg-blue-500/10 border-blue-500/20", icon: Activity },
    TRANSFER_IN: { label: "Transfer In", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: ArrowDown },
    TRANSFER_OUT: { label: "Transfer Out", color: "text-orange-400 bg-orange-500/10 border-orange-500/20", icon: ArrowUp },
    RECEIPT: { label: "Receipt", color: "text-purple-400 bg-purple-500/10 border-purple-500/20", icon: Package },
    SALE: { label: "Sale", color: "text-red-400 bg-red-500/10 border-red-500/20", icon: Tag },
  };
  const cfg = config[type] || { label: type, color: "text-white/60 bg-white/5 border-white/10", icon: Activity };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export function InventoryCommandCenter({
  businessId,
  basePath,
  warehouses: initialWarehouses,
  inventory: initialInventory,
  products,
  purchaseOrders: initialPOs,
  onCreateWarehouse,
  onEditWarehouse,
  onDeleteWarehouse,
  onAddInventory,
  onCreatePO,
  onEditPO,
  onRefresh,
}: {
  businessId: string;
  basePath: string;
  warehouses: any[];
  inventory: any[];
  products: any[];
  purchaseOrders: any[];
  onCreateWarehouse: () => void;
  onEditWarehouse: (wh: any) => void;
  onDeleteWarehouse: (id: string) => void;
  onAddInventory: () => void;
  onCreatePO: () => void;
  onEditPO: (po: any) => void;
  onRefresh: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ICCTab>("overview");
  const [warehouses, setWarehouses] = useState(initialWarehouses);
  const [inventory, setInventory] = useState(initialInventory);
  const [purchaseOrders, setPurchaseOrders] = useState(initialPOs);

  const [summary, setSummary] = useState<any>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [stockSearch, setStockSearch] = useState("");
  const [stockWarehouseFilter, setStockWarehouseFilter] = useState("all");
  const [stockStatusFilter, setStockStatusFilter] = useState("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<any>(null);
  const [adjustData, setAdjustData] = useState({ quantityChange: 0, reasonCode: "COUNT_CORRECTION", note: "" });
  const [adjustSaving, setAdjustSaving] = useState(false);

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferData, setTransferData] = useState({ productId: "", fromWarehouseId: "", toWarehouseId: "", quantity: 1, note: "" });
  const [transferSaving, setTransferSaving] = useState(false);

  const [sheetStatus, setSheetStatus] = useState<any>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetAction, setSheetAction] = useState<string | null>(null);
  const [pullPreview, setPullPreview] = useState<any>(null);
  const [sheetDiff, setSheetDiff] = useState<any>(null);
  const [conflictResolutions, setConflictResolutions] = useState<Record<number, "system" | "sheet">>({});
  const [importResult, setImportResult] = useState<any>(null);
  const [xlsxImporting, setXlsxImporting] = useState(false);
  const [xlsxWizard, setXlsxWizard] = useState<{
    file: File;
    headers: string[];
    previewRows: any[][];
    columnMap: Record<string, string>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const EXPECTED_COLUMNS = ["SKU", "Product Name", "Warehouse", "Quantity On Hand", "Reserved", "Reorder Level", "Cost Per Unit", "Currency"];

  const productsById = Object.fromEntries(products.map((p: any) => [p.id, p]));
  const warehousesById = Object.fromEntries(warehouses.map((w: any) => [w.id, w]));

  useEffect(() => { setWarehouses(initialWarehouses); }, [initialWarehouses]);
  useEffect(() => { setInventory(initialInventory); }, [initialInventory]);
  useEffect(() => { setPurchaseOrders(initialPOs); }, [initialPOs]);

  const loadTabData = useCallback(async (tab: ICCTab) => {
    if (!businessId) return;
    setLoadingData(true);
    try {
      if (tab === "overview" || tab === "valuation") {
        const res = await apiGet<any>(`${basePath}/inventory/summary`);
        if (res.data) setSummary(res.data);
      }
      if (tab === "movements") {
        const res = await apiGet<any[]>(`${basePath}/inventory/movements`);
        if (res.data) setMovements(res.data);
      }
      if (tab === "alerts") {
        const res = await apiGet<any[]>(`${basePath}/inventory/alerts`);
        if (res.data) setAlerts(Array.isArray(res.data) ? res.data : []);
      }
      if (tab === "orders") {
        const res = await apiGet<any>(`${basePath}/purchase-orders`);
        if (res.data) setPurchaseOrders(Array.isArray(res.data) ? res.data : (res.data.data ?? []));
      }
      if (tab === "spreadsheets") {
        const res = await apiGet<any>(`/drive/businesses/${businessId}/inventory-sheet/status`);
        if (res.data) setSheetStatus(res.data);
      }
    } catch {}
    setLoadingData(false);
  }, [basePath, businessId]);

  useEffect(() => { loadTabData(activeTab); }, [activeTab, loadTabData]);

  const filteredInventory = inventory.filter(inv => {
    const product = productsById[inv.productId] || inv.product;
    const matchesSearch = !stockSearch || product?.name?.toLowerCase().includes(stockSearch.toLowerCase()) || product?.sku?.toLowerCase().includes(stockSearch.toLowerCase());
    const matchesWarehouse = stockWarehouseFilter === "all" || inv.warehouseId === stockWarehouseFilter;
    const matchesStatus = stockStatusFilter === "all" ||
      (stockStatusFilter === "out" && inv.quantity <= 0) ||
      (stockStatusFilter === "low" && inv.reorderAt && inv.quantity > 0 && inv.quantity <= inv.reorderAt) ||
      (stockStatusFilter === "ok" && inv.quantity > 0 && (!inv.reorderAt || inv.quantity > inv.reorderAt));
    return matchesSearch && matchesWarehouse && matchesStatus;
  });

  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(filteredInventory, 20);

  const handleAdjust = async () => {
    if (!adjustTarget) return;
    setAdjustSaving(true);
    try {
      await apiPost({ path: `${basePath}/inventory/adjust`, body: { stockId: adjustTarget.id, ...adjustData } });
      setShowAdjustModal(false);
      setAdjustTarget(null);
      const res = await apiGet<any[]>(`${basePath}/inventory`);
      if (res.data) setInventory(res.data);
      const movRes = await apiGet<any[]>(`${basePath}/inventory/movements`);
      if (movRes.data) setMovements(movRes.data);
    } catch {}
    setAdjustSaving(false);
  };

  const handleTransfer = async () => {
    setTransferSaving(true);
    try {
      await apiPost({ path: `${basePath}/inventory/transfer`, body: transferData });
      setShowTransferModal(false);
      const res = await apiGet<any[]>(`${basePath}/inventory`);
      if (res.data) setInventory(res.data);
      const movRes = await apiGet<any[]>(`${basePath}/inventory/movements`);
      if (movRes.data) setMovements(movRes.data);
    } catch {}
    setTransferSaving(false);
  };

  const handleExportExcel = async () => {
    try {
      const res = await fetch(`${API_BASE}${basePath}/inventory/export-excel`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const blob = await res.blob();
      saveAs(blob, `inventory-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {}
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch(`${API_BASE}${basePath}/inventory/template-excel`, { headers: getAuthHeaders() });
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
      const XLSX = await import("xlsx");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (!data.length) return;
      const headers = (data[0] || []).map((h: any) => String(h ?? "").trim());
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
      const XLSX = await import("xlsx");
      const arrayBuffer = await xlsxWizard.file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const headers = rawRows[0] || [];
      const headerIdx: Record<string, number> = {};
      (headers as any[]).forEach((h: any, i: number) => { headerIdx[String(h ?? "").trim()] = i; });

      const mappedRows = rawRows.slice(1).map((row: any[]) => {
        const obj: Record<string, string> = {};
        for (const [expected, sourceCol] of Object.entries(xlsxWizard.columnMap)) {
          if (sourceCol) obj[expected] = String(row[headerIdx[sourceCol]] ?? "");
        }
        return obj;
      }).filter(r => r["Product Name"] || r["SKU"]);

      const newWorkbook = XLSX.utils.book_new();
      const newSheet = XLSX.utils.aoa_to_sheet([
        EXPECTED_COLUMNS,
        ...mappedRows.map(r => EXPECTED_COLUMNS.map(c => r[c] ?? "")),
      ]);
      XLSX.utils.book_append_sheet(newWorkbook, newSheet, "Sheet1");
      const blob = new Blob(
        [XLSX.write(newWorkbook, { type: "array", bookType: "xlsx" })],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
      );
      const form = new FormData();
      form.append("file", blob, "inventory.xlsx");
      const res = await fetch(`${API_BASE}${basePath}/inventory/import-excel`, { method: "POST", body: form, headers: getAuthHeaders() });
      const data = await res.json();
      setImportResult(data);
      setXlsxWizard(null);
      const invRes = await apiGet<any[]>(`${basePath}/inventory`);
      if (invRes.data) setInventory(invRes.data);
    } catch (err: any) {
      setImportResult({ imported: 0, skipped: 0, errors: [err?.message || "Import failed"] });
    }
    setXlsxImporting(false);
  };

  const handlePushToSheet = async () => {
    setSheetLoading(true);
    setSheetAction("push");
    try {
      await apiPost({ path: `/drive/businesses/${businessId}/inventory-sheet/push`, body: {} });
      const res = await apiGet<any>(`/drive/businesses/${businessId}/inventory-sheet/status`);
      if (res.data) setSheetStatus(res.data);
    } catch {}
    setSheetLoading(false);
    setSheetAction(null);
  };

  const handlePullFromSheet = async () => {
    setSheetLoading(true);
    setSheetAction("pull");
    try {
      const res = await apiGet<any>(`/drive/businesses/${businessId}/inventory-sheet/pull`);
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
      if (res.data) setImportResult(res.data);
      const invRes = await apiGet<any[]>(`${basePath}/inventory`);
      if (invRes.data) setInventory(invRes.data);
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
      const res = await apiGet<any>(`/drive/businesses/${businessId}/inventory-sheet/diff`);
      if (res.data) {
        setSheetDiff(res.data);
        const defaultResolutions: Record<number, "system" | "sheet"> = {};
        (res.data.conflicts || []).forEach((_: any, i: number) => { defaultResolutions[i] = "sheet"; });
        setConflictResolutions(defaultResolutions);
      }
    } catch {}
    setSheetLoading(false);
    setSheetAction(null);
  };

  const handleApplyResolved = async () => {
    if (!sheetDiff?.conflicts) return;
    const rowsToApply = sheetDiff.conflicts
      .filter((_: any, i: number) => conflictResolutions[i] === "sheet")
      .map((c: any) => ({
        'SKU': c.sku,
        'Product Name': c.productName,
        'Warehouse': c.warehouseName,
        'Quantity On Hand': String(c.sheetQty),
        'Reorder Level': c.sheetReorderAt !== null ? String(c.sheetReorderAt) : '',
      }));
    await handleApplyPulledInventory(rowsToApply);
  };

  const handleCreateSheet = async () => {
    setSheetLoading(true);
    try {
      const res = await apiPost({ path: `/drive/businesses/${businessId}/inventory-sheet/create`, body: { title: "Inventory Sync" } });
      const sheetData = res.data as { fileId?: string; name?: string } | undefined;
      if (sheetData) setSheetStatus({ ...sheetStatus, linkedSheetId: sheetData.fileId ?? null, linkedSheetName: sheetData.name ?? null });
    } catch {}
    setSheetLoading(false);
  };

  const handleUnlinkSheet = async () => {
    setSheetLoading(true);
    try {
      await apiDelete(`/drive/businesses/${businessId}/inventory-sheet/unlink`);
      setSheetStatus({ ...sheetStatus, linkedSheetId: null, linkedSheetName: null, lastSyncAt: null });
    } catch {}
    setSheetLoading(false);
  };

  const handleAdvancePO = async (poId: string, status: string) => {
    try {
      await apiPost({ path: `${basePath}/purchase-orders/${poId}/advance`, body: { status } });
      const res = await apiGet<any>(`${basePath}/purchase-orders`);
      if (res.data) setPurchaseOrders(res.data.data ?? res.data);
      onRefresh();
    } catch {}
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {ICC_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl whitespace-nowrap transition-all ${isActive ? "text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`}
            >
              {isActive && (
                <motion.div
                  layoutId="icc-tab"
                  className="absolute inset-0 bg-orange-500/20 border border-orange-500/30 rounded-xl"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === "overview" && (
            <OverviewTab
              summary={summary}
              loading={loadingData}
              inventory={inventory}
              warehouses={warehouses}
              products={products}
              productsById={productsById}
              onAddInventory={onAddInventory}
              onCreateWarehouse={onCreateWarehouse}
            />
          )}

          {activeTab === "stock" && (
            <StockGridTab
              inventory={filteredInventory}
              paginated={paginated}
              page={page}
              pageSize={pageSize}
              totalPages={totalPages}
              setPage={setPage}
              setPageSize={setPageSize}
              warehouses={warehouses}
              productsById={productsById}
              warehousesById={warehousesById}
              stockSearch={stockSearch}
              setStockSearch={setStockSearch}
              stockWarehouseFilter={stockWarehouseFilter}
              setStockWarehouseFilter={setStockWarehouseFilter}
              stockStatusFilter={stockStatusFilter}
              setStockStatusFilter={setStockStatusFilter}
              expandedRows={expandedRows}
              setExpandedRows={setExpandedRows}
              onAdjust={(inv: Record<string, unknown>) => { setAdjustTarget(inv); setAdjustData({ quantityChange: 0, reasonCode: "COUNT_CORRECTION", note: "" }); setShowAdjustModal(true); }}
              onAddInventory={onAddInventory}
            />
          )}

          {activeTab === "movements" && (
            <MovementsTab
              movements={movements}
              loading={loadingData}
              inventory={inventory}
              warehouses={warehouses}
              productsById={productsById}
              warehousesById={warehousesById}
              basePath={basePath}
              onAdjust={(inv: Record<string, unknown>) => { setAdjustTarget(inv); setAdjustData({ quantityChange: 0, reasonCode: "COUNT_CORRECTION", note: "" }); setShowAdjustModal(true); }}
              onShowTransfer={() => setShowTransferModal(true)}
            />
          )}

          {activeTab === "warehouses" && (
            <WarehousesTab
              warehouses={warehouses}
              inventory={inventory}
              productsById={productsById}
              onCreateWarehouse={onCreateWarehouse}
              onEditWarehouse={onEditWarehouse}
              onDeleteWarehouse={onDeleteWarehouse}
              onShowTransfer={() => setShowTransferModal(true)}
            />
          )}

          {activeTab === "orders" && (
            <PurchaseOrdersTab
              purchaseOrders={purchaseOrders}
              products={products}
              onCreatePO={onCreatePO}
              onEditPO={onEditPO}
              onAdvancePO={handleAdvancePO}
            />
          )}

          {activeTab === "alerts" && (
            <AlertsTab
              alertItems={alerts}
              loading={loadingData}
              onCreatePO={onCreatePO}
            />
          )}

          {activeTab === "valuation" && (
            <ValuationTab
              summary={summary}
              inventory={inventory}
              productsById={productsById}
              loading={loadingData}
            />
          )}

          {activeTab === "spreadsheets" && (
            <SpreadsheetsTab
              sheetStatus={sheetStatus}
              sheetLoading={sheetLoading}
              sheetAction={sheetAction}
              pullPreview={pullPreview}
              sheetDiff={sheetDiff}
              conflictResolutions={conflictResolutions}
              setConflictResolutions={setConflictResolutions}
              importResult={importResult}
              xlsxImporting={xlsxImporting}
              xlsxWizard={xlsxWizard}
              setXlsxWizard={setXlsxWizard}
              expectedColumns={EXPECTED_COLUMNS}
              onApplyXlsxMapping={handleApplyXlsxMapping}
              fileInputRef={fileInputRef}
              inventory={inventory}
              businessId={businessId}
              onPush={handlePushToSheet}
              onPull={handlePullFromSheet}
              onApply={handleApplyPulledInventory}
              onGenerateDiff={handleGenerateDiff}
              onApplyResolved={handleApplyResolved}
              onCreateSheet={handleCreateSheet}
              onUnlink={handleUnlinkSheet}
              onExportExcel={handleExportExcel}
              onDownloadTemplate={handleDownloadTemplate}
              onXlsxImport={handleXlsxImport}
              onConnectDrive={async () => {
                try {
                  const res = await apiGet<{ url: string }>(`/drive/businesses/${businessId}/auth-url`);
                  if (res.data?.url) window.location.href = res.data.url;
                } catch {}
              }}
              onLinkSheet={(sheetId: string, sheetName: string) =>
                apiPost({ path: `/drive/businesses/${businessId}/inventory-sheet/link`, body: { sheetId, sheetName } })
                  .then(() => apiGet<any>(`/drive/businesses/${businessId}/inventory-sheet/status`))
                  .then(r => { if (r.data) setSheetStatus(r.data); })
              }
            />
          )}
        </motion.div>
      </AnimatePresence>

      {showAdjustModal && (
        <AdjustModal
          target={adjustTarget}
          data={adjustData}
          setData={setAdjustData}
          saving={adjustSaving}
          productsById={productsById}
          warehousesById={warehousesById}
          onSave={handleAdjust}
          onClose={() => setShowAdjustModal(false)}
        />
      )}

      {showTransferModal && (
        <TransferModal
          data={transferData}
          setData={setTransferData}
          saving={transferSaving}
          inventory={inventory}
          warehouses={warehouses}
          productsById={productsById}
          onSave={handleTransfer}
          onClose={() => setShowTransferModal(false)}
        />
      )}
    </div>
  );
}

function OverviewTab({ summary, loading, inventory, warehouses, products, productsById, onAddInventory, onCreateWarehouse }: any) {
  if (loading && !summary) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (!summary && inventory.length === 0) return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={onCreateWarehouse} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Warehouse
        </button>
        <button onClick={onAddInventory} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Stock
        </button>
      </div>
      <EmptyState icon={Warehouse} title="No Inventory Yet" description="Set up warehouses and add stock records to start tracking inventory." />
    </div>
  );

  const totalSKUs = summary?.totalSKUs ?? inventory.length;
  const totalStockValue = summary?.totalStockValue ?? 0;
  const belowReorderCount = summary?.belowReorderCount ?? inventory.filter((i: any) => i.reorderAt && i.quantity <= i.reorderAt).length;
  const outOfStockCount = summary?.outOfStockCount ?? inventory.filter((i: any) => i.quantity <= 0).length;
  const healthScore = summary?.healthScore ?? 100;
  const warehouseBreakdown = summary?.warehouseBreakdown ?? warehouses.map((wh: any) => {
    const whInv = inventory.filter((i: any) => i.warehouseId === wh.id);
    return { id: wh.id, name: wh.name, skuCount: whInv.length, totalUnits: whInv.reduce((s: number, i: any) => s + i.quantity, 0), capacity: wh.capacity };
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Total SKUs" value={totalSKUs} sub="Tracked inventory items" color="#f97316" icon={Layers} />
        <KPICard label="Stock Value" value={formatCurrency(totalStockValue)} sub="Based on landed cost" color="#8b5cf6" icon={DollarSign} />
        <KPICard label="Below Reorder" value={belowReorderCount} sub="Need restocking" color="#f59e0b" icon={TrendingDown} />
        <KPICard label="Out of Stock" value={outOfStockCount} sub="Zero inventory" color="#ef4444" icon={Archive} />
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Stock Health Score</h3>
          <span className={`text-2xl font-bold ${healthScore >= 80 ? "text-emerald-400" : healthScore >= 50 ? "text-amber-400" : "text-red-400"}`}>{healthScore}%</span>
        </div>
        <div className="w-full bg-white/10 rounded-full h-2">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${healthScore}%` }}
            transition={{ duration: 0.8 }}
            className={`h-2 rounded-full ${healthScore >= 80 ? "bg-emerald-400" : healthScore >= 50 ? "bg-amber-400" : "bg-red-400"}`}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Percentage of SKUs currently in healthy stock levels</p>
      </div>

      {warehouseBreakdown.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-orange-400" />
            Warehouse Distribution
          </h3>
          <div className="space-y-3">
            {warehouseBreakdown.map((wh: any) => (
              <div key={wh.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">{wh.name}</span>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{wh.skuCount} SKUs</span>
                    <span>{wh.totalUnits.toLocaleString()} units</span>
                    {wh.capacity && <span>{wh.capacityUtilization}% capacity</span>}
                  </div>
                </div>
                {wh.capacity && (
                  <div className="w-full bg-white/10 rounded-full h-1.5">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(wh.capacityUtilization ?? 0, 100)}%` }}
                      transition={{ duration: 0.6 }}
                      className={`h-1.5 rounded-full ${(wh.capacityUtilization ?? 0) > 90 ? "bg-red-400" : (wh.capacityUtilization ?? 0) > 70 ? "bg-amber-400" : "bg-orange-400"}`}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onAddInventory} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Stock Record
        </button>
        <button onClick={onCreateWarehouse} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors">
          <Building2 className="w-3.5 h-3.5" /> Add Warehouse
        </button>
      </div>
    </div>
  );
}

function StockGridTab({ inventory, paginated, page, pageSize, totalPages, setPage, setPageSize, warehouses, productsById, warehousesById, stockSearch, setStockSearch, stockWarehouseFilter, setStockWarehouseFilter, stockStatusFilter, setStockStatusFilter, expandedRows, setExpandedRows, onAdjust, onAddInventory }: any) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-orange-500/40"
            placeholder="Search by product or SKU..."
            value={stockSearch}
            onChange={e => setStockSearch(e.target.value)}
          />
        </div>
        <select
          value={stockWarehouseFilter}
          onChange={e => setStockWarehouseFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/40"
        >
          <option value="all">All Warehouses</option>
          {warehouses.map((wh: any) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
        </select>
        <select
          value={stockStatusFilter}
          onChange={e => setStockStatusFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/40"
        >
          <option value="all">All Status</option>
          <option value="ok">In Stock</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
        </select>
        <button onClick={onAddInventory} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Stock
        </button>
      </div>

      {inventory.length === 0 ? (
        <EmptyState icon={Layers} title="No Stock Records" description="Add stock records to track inventory across your warehouses." />
      ) : (
        <>
          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-white/5">
              <span className="col-span-4">Product</span>
              <span className="col-span-2">Warehouse</span>
              <span className="col-span-1 text-right">On Hand</span>
              <span className="col-span-1 text-right">Reserved</span>
              <span className="col-span-1 text-right">Available</span>
              <span className="col-span-1 text-center">Reorder At</span>
              <span className="col-span-1 text-center">Status</span>
              <span className="col-span-1 text-right">Action</span>
            </div>
            <div className="divide-y divide-white/5">
              {paginated.map((inv: any) => {
                const product = productsById[inv.productId] || inv.product;
                const warehouse = warehousesById[inv.warehouseId] || inv.warehouse;
                const available = inv.quantity - inv.reserved;
                const isExpanded = expandedRows.has(inv.id);
                return (
                  <div key={inv.id}>
                    <div
                      className="grid grid-cols-12 px-4 py-3 items-center hover:bg-white/3 transition-colors cursor-pointer"
                      onClick={() => setExpandedRows((prev: Set<string>) => {
                        const n = new Set(prev);
                        n.has(inv.id) ? n.delete(inv.id) : n.add(inv.id);
                        return n;
                      })}
                    >
                      <div className="col-span-4">
                        <div className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />}
                          <div>
                            <p className="text-xs font-medium">{product?.name || "Product"}</p>
                            {product?.sku && <p className="text-[10px] text-muted-foreground">{product.sku}</p>}
                            {inv.lastMovement && (
                              <p className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                                <Clock className="w-2.5 h-2.5" />
                                {formatDate(inv.lastMovement.createdAt)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="col-span-2 text-xs text-muted-foreground truncate">{warehouse?.name || "—"}</p>
                      <p className={`col-span-1 text-sm font-semibold text-right ${inv.quantity <= 0 ? "text-red-400" : ""}`}>{inv.quantity.toLocaleString()}</p>
                      <p className="col-span-1 text-xs text-muted-foreground text-right">{inv.reserved}</p>
                      <p className={`col-span-1 text-xs font-medium text-right ${available <= 0 ? "text-red-400" : ""}`}>{available}</p>
                      <p className="col-span-1 text-xs text-muted-foreground text-center">{inv.reorderAt ?? "—"}</p>
                      <div className="col-span-1 flex justify-center">
                        <StockBadge quantity={inv.quantity} reorderLevel={inv.reorderAt} />
                      </div>
                      <div className="col-span-1 flex justify-end" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => onAdjust(inv)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                        >
                          <Pencil className="w-3 h-3" /> Adjust
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-6 pb-3 bg-white/3 border-t border-white/5">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 text-[11px]">
                          <div>
                            <p className="text-muted-foreground mb-0.5">Cost Per Unit</p>
                            <p className="font-medium">{inv.costPerUnit ? formatCurrency(inv.costPerUnit) : "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground mb-0.5">Total Stock Value</p>
                            <p className="font-medium">{inv.costPerUnit ? formatCurrency(inv.quantity * inv.costPerUnit) : "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground mb-0.5">Last Movement</p>
                            <p className="font-medium">
                              {inv.lastMovement
                                ? `${inv.lastMovement.type} (${inv.lastMovement.quantityChange > 0 ? "+" : ""}${inv.lastMovement.quantityChange}) · ${formatDate(inv.lastMovement.createdAt)}`
                                : "No movements recorded"}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground mb-0.5">Currency</p>
                            <p className="font-medium">{inv.currency || "TTD"}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
        </>
      )}
    </div>
  );
}

function MovementsTab({ movements, loading, inventory, warehouses, productsById, warehousesById, basePath, onAdjust, onShowTransfer }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80">Stock Movement Log</h3>
        <div className="flex gap-2">
          <button
            onClick={onShowTransfer}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" /> Transfer Stock
          </button>
          <button
            onClick={() => {
              if (inventory.length > 0) onAdjust(inventory[0]);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Adjust Stock
          </button>
        </div>
      </div>

      {loading && movements.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : movements.length === 0 ? (
        <EmptyState icon={Activity} title="No Movements Yet" description="Stock adjustments, transfers, and receipts will appear here." />
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="divide-y divide-white/5">
            {movements.map((m: any) => {
              const product = m.product || (m.productId ? productsById[m.productId] : null);
              const warehouse = m.warehouse || (m.warehouseId ? warehousesById[m.warehouseId] : null);
              return (
                <div key={m.id} className="px-4 py-3 flex items-center justify-between hover:bg-white/3 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.quantityChange >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                      {m.quantityChange >= 0 ? (
                        <ArrowUp className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <ArrowDown className="w-4 h-4 text-red-400" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium">{product?.name || "Unknown Product"}</p>
                        <MovementTypeBadge type={m.type} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {warehouse?.name || "—"} • {m.reasonCode || "—"} {m.note ? `• ${m.note}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${m.quantityChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {m.quantityChange >= 0 ? "+" : ""}{m.quantityChange}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(m.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function WarehousesTab({ warehouses, inventory, productsById, onCreateWarehouse, onEditWarehouse, onDeleteWarehouse, onShowTransfer }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80">Warehouse Manager</h3>
        <div className="flex gap-2">
          <button onClick={onShowTransfer} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors">
            <ArrowLeftRight className="w-3.5 h-3.5" /> Transfer
          </button>
          <button onClick={onCreateWarehouse} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add Warehouse
          </button>
        </div>
      </div>

      {warehouses.length === 0 ? (
        <EmptyState icon={Building2} title="No Warehouses" description="Add warehouse locations to manage your inventory." />
      ) : (
        <div className="space-y-3">
          {warehouses.map((wh: any) => {
            const whInv = inventory.filter((inv: any) => inv.warehouseId === wh.id);
            const totalUnits = whInv.reduce((s: number, i: any) => s + i.quantity, 0);
            const capacityPct = wh.capacity ? Math.min(Math.round((totalUnits / wh.capacity) * 100), 100) : null;

            return (
              <motion.div key={wh.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-orange-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{wh.name}</p>
                      <p className="text-xs text-muted-foreground">{[wh.type, wh.address, wh.city, wh.country].filter(Boolean).join(" • ")}</p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                        <span>{whInv.length} SKUs</span>
                        <span>{totalUnits.toLocaleString()} units</span>
                        {wh.capacity && <span>Capacity: {wh.capacity}</span>}
                        {capacityPct !== null && <span className={`font-medium ${capacityPct > 90 ? "text-red-400" : capacityPct > 70 ? "text-amber-400" : "text-emerald-400"}`}>{capacityPct}% full</span>}
                      </div>
                      {wh.capacity && (
                        <div className="mt-2 w-48 bg-white/10 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${capacityPct! > 90 ? "bg-red-400" : capacityPct! > 70 ? "bg-amber-400" : "bg-orange-400"}`}
                            style={{ width: `${capacityPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => onEditWarehouse(wh)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => onDeleteWarehouse(wh.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {whInv.length > 0 && (
                  <div className="border-t border-white/5">
                    <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Inventory</div>
                    <div className="divide-y divide-white/5">
                      {whInv.map((inv: any) => {
                        const product = productsById[inv.productId] || inv.product;
                        return (
                          <div key={inv.id} className="px-4 py-2.5 flex items-center justify-between">
                            <div>
                              <p className="text-xs">{product?.name || "Product"}</p>
                              {product?.sku && <p className="text-[10px] text-muted-foreground">{product.sku}</p>}
                            </div>
                            <div className="flex items-center gap-3">
                              {inv.reserved > 0 && <span className="text-[10px] text-muted-foreground">{inv.reserved} reserved</span>}
                              <span className="text-sm font-semibold">{inv.quantity.toLocaleString()}</span>
                              <StockBadge quantity={inv.quantity} reorderLevel={inv.reorderAt} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PO_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Draft", color: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
  SENT: { label: "Sent", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  CONFIRMED: { label: "Confirmed", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  PARTIAL: { label: "Partial", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  RECEIVED: { label: "Received", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  CANCELLED: { label: "Cancelled", color: "bg-red-500/10 text-red-400 border-red-500/20" },
  ACKNOWLEDGED: { label: "Acknowledged", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  SUBMITTED: { label: "Submitted", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
  SHIPPED: { label: "Shipped", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
};

function PurchaseOrdersTab({ purchaseOrders, products, onCreatePO, onEditPO, onAdvancePO }: any) {
  const NEXT_STATUS: Record<string, string> = {
    DRAFT: "SUBMITTED",
    SUBMITTED: "ACKNOWLEDGED",
    ACKNOWLEDGED: "SHIPPED",
    SHIPPED: "RECEIVED",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80">Purchase Orders</h3>
        <button onClick={onCreatePO} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New PO
        </button>
      </div>

      {purchaseOrders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No Purchase Orders" description="Create purchase orders to restock your inventory from suppliers." />
      ) : (
        <div className="space-y-3">
          {purchaseOrders.map((po: any) => {
            const statusCfg = PO_STATUS_CONFIG[po.status] || { label: po.status, color: "bg-white/5 text-white/60 border-white/10" };
            const nextStatus = NEXT_STATUS[po.status];
            return (
              <motion.div key={po.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{po.poNumber}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusCfg.color}`}>{statusCfg.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Supplier: {po.supplierName || "—"}</p>
                    {po.expectedDelivery && <p className="text-[10px] text-muted-foreground">Expected: {formatDate(po.expectedDelivery)}</p>}
                    {po.items && Array.isArray(po.items) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(po.items as any[]).slice(0, 3).map((item: any, idx: number) => (
                          <span key={idx} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground">
                            {item.productName || `Item ${idx + 1}`} × {item.quantity}
                          </span>
                        ))}
                        {(po.items as any[]).length > 3 && <span className="text-[10px] text-muted-foreground">+{(po.items as any[]).length - 3} more</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex flex-col items-end gap-2 shrink-0">
                    <p className="text-sm font-bold">{formatCurrency(po.total ?? 0)}</p>
                    <div className="flex gap-1">
                      <button onClick={() => onEditPO(po)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {nextStatus && (
                        <button
                          onClick={() => onAdvancePO(po.id, nextStatus)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors"
                        >
                          <ArrowRight className="w-3 h-3" />
                          {nextStatus === "RECEIVED" ? "Mark Received" : `→ ${PO_STATUS_CONFIG[nextStatus]?.label || nextStatus}`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AlertsTab({ alertItems, loading, onCreatePO }: { alertItems: any[]; loading: boolean; onCreatePO: () => void }) {
  if (loading && alertItems.length === 0) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  const outOfStockItems = alertItems.filter(a => a.type === "OUT_OF_STOCK");
  const lowStockItems = alertItems.filter(a => a.type === "LOW_STOCK");

  if (alertItems.length === 0) return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span className="font-medium">All inventory levels are healthy</span>
      </div>
      <EmptyState icon={AlertTriangle} title="No Alerts" description="You'll see low stock and out-of-stock alerts here when they occur. Alerts require reorder levels to be set on stock records." />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-red-400">{outOfStockItems.length}</p>
          <p className="text-xs text-muted-foreground">Out of Stock</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-amber-400">{lowStockItems.length}</p>
          <p className="text-xs text-muted-foreground">Low Stock</p>
        </div>
      </div>

      <div className="space-y-3">
        {alertItems.map((alert: any, i: number) => {
          const isOut = alert.type === "OUT_OF_STOCK";
          return (
            <motion.div key={`${alert.productId}-${alert.warehouseId}-${i}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isOut ? "bg-red-500/10" : "bg-amber-500/10"}`}>
                    {isOut ? <Archive className="w-4 h-4 text-red-400" /> : <TrendingDown className="w-4 h-4 text-amber-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{alert.productName}</p>
                      {alert.productSku && <span className="text-[10px] text-muted-foreground">{alert.productSku}</span>}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${isOut ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`}>
                        {isOut ? "Out of Stock" : "Low Stock"}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{alert.warehouseName}</p>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                      <span>On Hand: <span className="font-medium text-white">{alert.quantity}</span></span>
                      <span>Reserved: {alert.reserved}</span>
                      <span>Available: <span className={`font-medium ${alert.available <= 0 ? "text-red-400" : "text-amber-400"}`}>{alert.available}</span></span>
                      <span>Reorder At: {alert.reorderAt}</span>
                    </div>
                    {(alert.salesVelocity30d !== undefined || alert.suggestedReorderQty !== undefined) && (
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
                        {alert.avgDailySales > 0 && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                            <TrendingDown className="w-2.5 h-2.5" />
                            {alert.avgDailySales} units/day avg
                          </span>
                        )}
                        {alert.daysOfStockLeft !== undefined && alert.daysOfStockLeft !== null && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${alert.daysOfStockLeft <= 7 ? "bg-red-500/10 text-red-400" : alert.daysOfStockLeft <= 14 ? "bg-amber-500/10 text-amber-400" : "bg-white/5 text-muted-foreground"}`}>
                            ~{alert.daysOfStockLeft}d stock remaining
                          </span>
                        )}
                        {alert.suggestedReorderQty && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px]">
                            Suggested PO: <strong>{alert.suggestedReorderQty} units</strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={onCreatePO}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors shrink-0"
                >
                  <ShoppingBag className="w-3 h-3" /> Create PO
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function ValuationTab({ summary, inventory, productsById, loading }: any) {
  if (loading && !summary) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  const totalValue = summary?.totalStockValue ?? inventory.reduce((sum: number, inv: any) => {
    const product = productsById[inv.productId] || inv.product;
    const cost = inv.costPerUnit ?? product?.costProfile?.landedCostEstimate ?? 0;
    return sum + (inv.quantity * cost);
  }, 0);

  const valuedItems = inventory.map((inv: any) => {
    const product = productsById[inv.productId] || inv.product;
    const cost = inv.costPerUnit ?? product?.costProfile?.landedCostEstimate ?? 0;
    return { ...inv, product, cost, totalValue: inv.quantity * cost };
  }).sort((a: any, b: any) => b.totalValue - a.totalValue);

  const withCost = valuedItems.filter((i: any) => i.cost > 0);
  const withoutCost = valuedItems.filter((i: any) => i.cost <= 0);

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-br from-purple-500/10 to-orange-500/5 border border-purple-500/20 rounded-2xl p-5 text-center">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Total Inventory Value</p>
        <p className="text-3xl font-bold text-white">{formatCurrency(totalValue)}</p>
        <p className="text-xs text-muted-foreground mt-1">Based on landed cost profiles · {withCost.length} of {inventory.length} SKUs priced</p>
      </div>

      {withCost.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5">
            <h3 className="text-sm font-semibold">Top Value Items</h3>
          </div>
          <div className="divide-y divide-white/5">
            {withCost.slice(0, 10).map((item: any) => (
              <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">{item.product?.name || "Product"}</p>
                  <p className="text-[10px] text-muted-foreground">{item.quantity} units × {formatCurrency(item.cost)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-purple-400">{formatCurrency(item.totalValue)}</p>
                  {totalValue > 0 && (
                    <p className="text-[10px] text-muted-foreground">{Math.round((item.totalValue / totalValue) * 100)}% of total</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {withoutCost.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
          <p className="text-xs text-amber-400 font-medium">{withoutCost.length} SKUs missing cost data</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Add cost profiles or landed cost data to get accurate valuations for these items.</p>
        </div>
      )}
    </div>
  );
}

function SpreadsheetsTab({ sheetStatus, sheetLoading, sheetAction, pullPreview, sheetDiff, conflictResolutions, setConflictResolutions, importResult, xlsxImporting, xlsxWizard, setXlsxWizard, expectedColumns, onApplyXlsxMapping, fileInputRef, inventory, businessId, onPush, onPull, onApply, onGenerateDiff, onApplyResolved, onCreateSheet, onUnlink, onExportExcel, onDownloadTemplate, onXlsxImport, onConnectDrive, onLinkSheet }: any) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const handleLinkFromUrl = () => {
    const match = linkUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return;
    const sheetId = match[1];
    const sheetName = linkUrl.includes("docs.google.com") ? "Linked Sheet" : "Sheet";
    onLinkSheet(sheetId, sheetName);
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
            <button onClick={onConnectDrive} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white text-black hover:bg-white/90 transition-colors">
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
                  <button onClick={onUnlink} className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                    <Unlink className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={onPush}
                    disabled={sheetLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors disabled:opacity-50"
                  >
                    {sheetLoading && sheetAction === "push" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Push to Sheet
                  </button>
                  <button
                    onClick={onPull}
                    disabled={sheetLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
                  >
                    {sheetLoading && sheetAction === "pull" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Pull from Sheet
                  </button>
                  <button
                    onClick={onGenerateDiff}
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
                  <button onClick={onCreateSheet} disabled={sheetLoading} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors">
                    {sheetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Create New Sheet
                  </button>
                  <button onClick={() => setShowLinkInput(!showLinkInput)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors">
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
                      onChange={e => setLinkUrl(e.target.value)}
                    />
                    <button onClick={handleLinkFromUrl} className="px-3 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors">
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
                  (sheetDiff.conflicts || []).forEach((_: any, i: number) => { all[i] = "system"; });
                  setConflictResolutions(all);
                }}
                className="text-[10px] px-2 py-1 rounded-lg bg-white/5 text-muted-foreground hover:text-white transition-colors"
              >
                Keep All System
              </button>
              <button
                onClick={() => {
                  const all: Record<number, "system" | "sheet"> = {};
                  (sheetDiff.conflicts || []).forEach((_: any, i: number) => { all[i] = "sheet"; });
                  setConflictResolutions(all);
                }}
                className="text-[10px] px-2 py-1 rounded-lg bg-white/5 text-muted-foreground hover:text-white transition-colors"
              >
                Accept All Sheet
              </button>
              <button
                onClick={onApplyResolved}
                disabled={sheetLoading || Object.values(conflictResolutions).every(v => v === "system")}
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
              {(sheetDiff.conflicts || []).map((conflict: any, i: number) => {
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
                          onClick={() => setConflictResolutions((r: any) => ({ ...r, [i]: "system" }))}
                          className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${resolution === "system" ? "bg-blue-500/30 text-blue-400 border border-blue-500/40" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}
                        >
                          Keep System
                        </button>
                        <button
                          onClick={() => setConflictResolutions((r: any) => ({ ...r, [i]: "sheet" }))}
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
                onClick={() => onApply(pullPreview.rows || [])}
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
                {(pullPreview.rows || []).slice(0, 15).map((row: any, i: number) => (
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
              Showing 15 of {pullPreview.rows.length} rows — all rows will be applied
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
            onClick={onExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" />
            Export to Excel
          </button>
          <button
            onClick={onDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download Template
          </button>
          <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors cursor-pointer">
            {xlsxImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
            Import Excel
            <input type="file" accept=".xlsx,.xls" className="hidden" ref={fileInputRef} onChange={onXlsxImport} />
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
              {(expectedColumns || []).map((col: string) => (
                <div key={col} className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground w-36 shrink-0">{col}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <select
                    value={xlsxWizard.columnMap[col] || ""}
                    onChange={e => setXlsxWizard((w: any) => ({ ...w, columnMap: { ...w.columnMap, [col]: e.target.value } }))}
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
                    {xlsxWizard.previewRows.map((row: any[], i: number) => (
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
                onClick={onApplyXlsxMapping}
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
          <div className={`mt-3 p-3 rounded-xl border text-xs ${importResult.imported > 0 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
            <p className="font-medium">Import complete: {importResult.imported} imported, {importResult.skipped} skipped</p>
            {importResult.errors?.length > 0 && (
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

function AdjustModal({ target, data, setData, saving, productsById, warehousesById, onSave, onClose }: any) {
  const product = target ? (productsById[target.productId] || target.product) : null;
  const warehouse = target ? (warehousesById[target.warehouseId] || target.warehouse) : null;

  const REASON_CODES = [
    { value: "COUNT_CORRECTION", label: "Physical Count Correction" },
    { value: "DAMAGE", label: "Damaged/Expired" },
    { value: "RETURN", label: "Customer Return" },
    { value: "THEFT_LOSS", label: "Theft / Loss" },
    { value: "MANUAL", label: "Manual Adjustment" },
    { value: "INITIAL_COUNT", label: "Initial Stock Count" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="relative bg-card border border-border rounded-2xl p-5 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Stock Adjustment</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div className="bg-white/5 rounded-xl p-3 text-xs">
            <p className="font-medium">{product?.name || "Product"}</p>
            <p className="text-muted-foreground">{warehouse?.name || "Warehouse"} • Current: {target?.quantity ?? 0} units</p>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Quantity Change</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setData((d: any) => ({ ...d, quantityChange: Math.min(d.quantityChange - 1, -1) }))}
                className="w-8 h-8 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors flex items-center justify-center text-lg font-bold"
              >−</button>
              <input
                type="number"
                value={data.quantityChange}
                onChange={e => setData((d: any) => ({ ...d, quantityChange: parseInt(e.target.value) || 0 }))}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-center text-white focus:outline-none focus:border-orange-500/40"
              />
              <button
                onClick={() => setData((d: any) => ({ ...d, quantityChange: Math.max(d.quantityChange + 1, 1) }))}
                className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors flex items-center justify-center text-lg font-bold"
              >+</button>
            </div>
            {data.quantityChange !== 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                New quantity: {(target?.quantity ?? 0) + data.quantityChange}
                {data.quantityChange > 0 ? ` (+${data.quantityChange})` : ` (${data.quantityChange})`}
              </p>
            )}
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Reason</label>
            <select
              value={data.reasonCode}
              onChange={e => setData((d: any) => ({ ...d, reasonCode: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/40"
            >
              {REASON_CODES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Note (optional)</label>
            <textarea
              value={data.note}
              onChange={e => setData((d: any) => ({ ...d, note: e.target.value }))}
              placeholder="Additional context for this adjustment..."
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-orange-500/40 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl text-xs font-medium border border-white/10 text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving || data.quantityChange === 0}
            className="flex-1 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Apply Adjustment"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function TransferModal({ data, setData, saving, inventory, warehouses, productsById, onSave, onClose }: any) {
  const products = [...new Map(inventory.map((inv: any) => [inv.productId, productsById[inv.productId] || inv.product])).values()].filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="relative bg-card border border-border rounded-2xl p-5 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Inter-Warehouse Transfer</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Product</label>
            <select value={data.productId} onChange={e => setData((d: any) => ({ ...d, productId: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/40">
              <option value="">Select product...</option>
              {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">From Warehouse</label>
              <select value={data.fromWarehouseId} onChange={e => setData((d: any) => ({ ...d, fromWarehouseId: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/40">
                <option value="">Select...</option>
                {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">To Warehouse</label>
              <select value={data.toWarehouseId} onChange={e => setData((d: any) => ({ ...d, toWarehouseId: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/40">
                <option value="">Select...</option>
                {warehouses.filter((w: any) => w.id !== data.fromWarehouseId).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Quantity</label>
            <input
              type="number"
              min="1"
              value={data.quantity}
              onChange={e => setData((d: any) => ({ ...d, quantity: parseInt(e.target.value) || 1 }))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/40"
            />
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Note (optional)</label>
            <input
              value={data.note}
              onChange={e => setData((d: any) => ({ ...d, note: e.target.value }))}
              placeholder="Reason for transfer..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-orange-500/40"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl text-xs font-medium border border-white/10 text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving || !data.productId || !data.fromWarehouseId || !data.toWarehouseId}
            className="flex-1 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Transfer Stock"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
