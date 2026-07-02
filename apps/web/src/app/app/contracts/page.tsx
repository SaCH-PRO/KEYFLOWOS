"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  FileText,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Tag,
  Calendar,
  Users,
  Clock,
  CheckCircle2,
  X,
  Trash2,
  Edit3,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { StandardModuleLayout } from "@/components/ui/standard-module-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { SideSheet } from "@/components/ui/side-sheet";
import { Button } from "@keyflow/ui";
import { Input } from "@keyflow/ui";
import {
  fetchContracts,
  fetchContractStats,
  fetchContract,
  createContract,
  updateContract,
  deleteContract,
  extractContractTerms,
  acknowledgeContractAlert,
  fetchContractTags,
  type Contract,
  type ContractListItem,
  type ContractStats,
  type ContractTag,
} from "@/lib/api/contracts";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "ACTIVE", label: "Active" },
  { value: "RENEWAL_DUE", label: "Renewal due" },
  { value: "EXPIRED", label: "Expired" },
  { value: "TERMINATED", label: "Terminated" },
  { value: "ARCHIVED", label: "Archived" },
];

const TYPE_OPTIONS = [
  "SERVICE_AGREEMENT",
  "NDA",
  "EMPLOYMENT",
  "VENDOR",
  "LEASE",
  "LICENSE",
  "RENTAL",
  "SUBSCRIPTION",
  "PARTNERSHIP",
  "OTHER",
];

const RENEWAL_OPTIONS = [
  { value: "", label: "—" },
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
  { value: "none", label: "None" },
];

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function relativeDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  const days = Math.floor((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "Today";
  return `in ${days}d`;
}

function SelectNative({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg bg-[var(--kf-glass)] border border-[var(--kf-border)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--kf-electric)]"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function MetricPill({
  label,
  value,
  color = "neutral",
}: {
  label: string;
  value: number;
  color?: "neutral" | "success" | "warning" | "error" | "info";
}) {
  const colorVar =
    color === "success"
      ? "var(--kf-success)"
      : color === "warning"
      ? "var(--kf-warning)"
      : color === "error"
      ? "var(--kf-error)"
      : color === "info"
      ? "var(--kf-info)"
      : "var(--kf-neutral)";
  return (
    <div
      className="px-2.5 py-1 rounded-full text-xs font-medium border"
      style={{
        background: `hsl(${colorVar} / 0.1)`,
        color: `hsl(${colorVar})`,
        borderColor: `hsl(${colorVar} / 0.25)`,
      }}
    >
      {label}: {value}
    </div>
  );
}

export default function ContractsPage() {
  const businessId = getStoredBusinessId();

  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [stats, setStats] = useState<ContractStats | null>(null);
  const [tags, setTags] = useState<ContractTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [sheetMode, setSheetMode] = useState<"create" | "edit" | "view" | null>(null);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [filters, setFilters] = useState({
    status: "",
    search: "",
    expiringWithinDays: "",
  });

  const loadStats = useCallback(async () => {
    if (!businessId) return;
    const { data } = await fetchContractStats(businessId);
    if (data) setStats(data);
  }, [businessId]);

  const loadTags = useCallback(async () => {
    if (!businessId) return;
    const { data } = await fetchContractTags(businessId);
    if (data) setTags(data);
  }, [businessId]);

  const loadContracts = useCallback(
    async (cursor?: string) => {
      if (!businessId) return;
      setLoading(true);
      const { data, error } = await fetchContracts(businessId, {
        status: filters.status || undefined,
        search: filters.search || undefined,
        expiringWithinDays: filters.expiringWithinDays ? Number(filters.expiringWithinDays) : undefined,
        cursor,
        limit: 25,
      });
      if (error) {
        toast.error(error);
      } else if (data) {
        setContracts((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
      }
      setLoading(false);
    },
    [businessId, filters],
  );

  useEffect(() => {
    loadContracts();
    loadStats();
    loadTags();
  }, [loadContracts, loadStats, loadTags]);

  useEffect(() => {
    const timer = setTimeout(() => loadContracts(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.status, filters.expiringWithinDays]);

  const openCreate = () => {
    setSelectedContract(null);
    setSheetMode("create");
  };

  const openContract = async (contract: ContractListItem) => {
    if (!businessId) return;
    setSheetMode("view");
    setDetailLoading(true);
    const { data, error } = await fetchContract(businessId, contract.id);
    if (error || !data) {
      toast.error(error ?? "Failed to load contract");
    } else {
      setSelectedContract(data);
    }
    setDetailLoading(false);
  };

  const closeSheet = () => {
    setSheetMode(null);
    setSelectedContract(null);
  };

  const handleSave = async (input: any) => {
    if (!businessId) return;
    setActionLoading("save");
    if (sheetMode === "create") {
      const { data, error } = await createContract(businessId, input);
      if (error || !data) toast.error(error ?? "Failed to create contract");
      else {
        toast.success("Contract created");
        closeSheet();
        loadContracts();
        loadStats();
      }
    } else if (selectedContract) {
      const { data, error } = await updateContract(businessId, selectedContract.id, input);
      if (error || !data) toast.error(error ?? "Failed to update contract");
      else {
        toast.success("Contract updated");
        setSelectedContract(data);
        setSheetMode("view");
        loadContracts();
        loadStats();
      }
    }
    setActionLoading(null);
  };

  const handleDelete = async () => {
    if (!businessId || !selectedContract) return;
    setActionLoading("delete");
    const { error } = await deleteContract(businessId, selectedContract.id);
    if (error) toast.error(error);
    else {
      toast.success("Contract deleted");
      closeSheet();
      loadContracts();
      loadStats();
    }
    setActionLoading(null);
  };

  const handleExtract = async (source: any) => {
    if (!businessId || !selectedContract) return;
    setActionLoading("extract");
    const { data, error } = await extractContractTerms(businessId, selectedContract.id, source);
    if (error || !data) toast.error(error ?? "Extraction failed");
    else {
      toast.success("Terms extracted");
      setSelectedContract(data);
      loadContracts();
      loadStats();
    }
    setActionLoading(null);
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    if (!businessId || !selectedContract) return;
    const { data, error } = await acknowledgeContractAlert(businessId, selectedContract.id, alertId);
    if (error || !data) toast.error(error ?? "Failed");
    else {
      toast.success("Alert acknowledged");
      setSelectedContract((prev) =>
        prev
          ? { ...prev, alerts: prev.alerts.map((a) => (a.id === alertId ? { ...a, acknowledgedAt: new Date().toISOString() } : a)) }
          : null,
      );
      loadStats();
    }
  };

  const metricStrip = useMemo(() => {
    if (!stats) return null;
    return (
      <div className="flex flex-wrap gap-3">
        <MetricPill label="Total" value={stats.total} color="info" />
        <MetricPill label="Active" value={stats.byStatus.ACTIVE ?? 0} color="success" />
        <MetricPill label="Renewal due" value={stats.renewalDue} color="warning" />
        <MetricPill label="Expiring soon" value={stats.expiringSoon} color="warning" />
        <MetricPill label="Expired" value={stats.expired} color="error" />
        <MetricPill label="Alerts" value={stats.alertCount} color="info" />
      </div>
    );
  }, [stats]);

  const headerRight = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search contracts..."
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          className="pl-8 w-40 sm:w-56"
        />
      </div>
      <SelectNative
        value={filters.status}
        onChange={(value) => setFilters((f) => ({ ...f, status: value }))}
        options={STATUS_OPTIONS}
      />
      <SelectNative
        value={filters.expiringWithinDays}
        onChange={(value) => setFilters((f) => ({ ...f, expiringWithinDays: value }))}
        options={[
          { value: "", label: "Any expiry" },
          { value: "30", label: "Expiring ≤30d" },
          { value: "7", label: "Expiring ≤7d" },
          { value: "1", label: "Expiring ≤1d" },
        ]}
      />
      <Button variant="outline" size="sm" onClick={() => loadContracts()} disabled={loading} className="gap-1">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        Refresh
      </Button>
      <Button size="sm" onClick={openCreate} className="gap-1">
        <Plus className="w-4 h-4" />
        New
      </Button>
    </div>
  );

  return (
    <StandardModuleLayout
      workspace="governance"
      icon={FileText}
      title="Contracts"
      subtitle="Classify, extract, and manage contract terms, renewals, and alerts."
      headerRight={headerRight}
      metricStrip={metricStrip}
    >
      <div className="space-y-3">
        {loading && contracts.length === 0 ? (
          <SkeletonList rows={6} cols={4} />
        ) : contracts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No contracts yet"
            description="Create a contract manually or extract terms from an uploaded document."
            variant="compact"
          />
        ) : (
          <>
            {contracts.map((contract) => (
              <ContractCard
                key={contract.id}
                contract={contract}
                onClick={() => openContract(contract)}
              />
            ))}
            {nextCursor && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" size="sm" onClick={() => loadContracts(nextCursor)} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <SideSheet
        open={sheetMode !== null}
        onClose={closeSheet}
        title={sheetMode === "create" ? "New contract" : selectedContract?.title ?? "Contract"}
        subtitle={sheetMode === "create" ? "Create a contract record manually." : undefined}
        width={sheetMode === "view" ? "lg" : "md"}
        footer={
          sheetMode === "view" && selectedContract ? (
            <div className="flex items-center justify-between w-full">
              <Button variant="outline" size="sm" onClick={() => setSheetMode("edit")}>
                <Edit3 className="w-4 h-4 mr-1" /> Edit
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={!!actionLoading}>
                {actionLoading === "delete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                Delete
              </Button>
            </div>
          ) : undefined
        }
      >
        {detailLoading ? (
          <SkeletonList rows={5} cols={2} />
        ) : sheetMode === "create" || sheetMode === "edit" ? (
          <ContractForm
            contract={selectedContract}
            tags={tags}
            onSubmit={handleSave}
            onCancel={closeSheet}
            loading={actionLoading === "save"}
          />
        ) : selectedContract ? (
          <ContractDetail
            contract={selectedContract}
            tags={tags}
            onExtract={handleExtract}
            onAcknowledgeAlert={handleAcknowledgeAlert}
            loading={actionLoading}
          />
        ) : null}
      </SideSheet>
    </StandardModuleLayout>
  );
}

function ContractCard({ contract, onClick }: { contract: ContractListItem; onClick: () => void }) {
  const hasAlerts = contract._count.alerts > 0;
  const expiryAlert =
    contract.status === "EXPIRED" ? "Expired" : hasAlerts ? `Expires ${relativeDate(contract.expiryDate)}` : undefined;

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-card/50 hover:bg-card/80 transition-colors cursor-pointer"
    >
      <div className="w-10 h-10 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center shrink-0">
        <FileText className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{contract.title}</span>
          <StatusBadge status={contract.status} size="sm" />
          {contract.contractType && <Badge variant="outline">{contract.contractType.replace(/_/g, " ")}</Badge>}
          {expiryAlert && (
            <Badge variant="secondary" className="gap-1">
              <Clock className="w-3 h-3" />
              {expiryAlert}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span>Expires {formatDate(contract.expiryDate)}</span>
          {contract.contractValue !== null && contract.contractValue !== undefined && (
            <span>
              {contract.currency} {contract.contractValue.toLocaleString()}
            </span>
          )}
          {contract.parties.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {contract.parties.length} party{contract.parties.length === 1 ? "" : "ies"}
            </span>
          )}
          {contract._count.terms > 0 && (
            <span className="flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {contract._count.terms} term{contract._count.terms === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
      {contract.tags.length > 0 && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {contract.tags.slice(0, 3).map((t) => (
            <Badge key={t.tag.id} style={{ backgroundColor: t.tag.color ?? undefined }}>
              {t.tag.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ContractForm({
  contract,
  tags,
  onSubmit,
  onCancel,
  loading,
}: {
  contract: Contract | null;
  tags: ContractTag[];
  onSubmit: (input: any) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState(() => initializeForm(contract));

  useEffect(() => {
    setForm(initializeForm(contract));
  }, [contract]);

  const update = (key: string, value: any) => setForm((f: any) => ({ ...f, [key]: value }));

  const updateParty = (idx: number, key: string, value: string) => {
    setForm((f: any) => ({
      ...f,
      parties: f.parties.map((p: any, i: number) => (i === idx ? { ...p, [key]: value } : p)),
    }));
  };

  const addParty = () => setForm((f: any) => ({ ...f, parties: [...f.parties, { role: "client", name: "" }] }));
  const removeParty = (idx: number) =>
    setForm((f: any) => ({ ...f, parties: f.parties.filter((_: any, i: number) => i !== idx) }));

  const toggleTag = (tagId: string) => {
    setForm((f: any) => ({
      ...f,
      tagIds: f.tagIds.includes(tagId) ? f.tagIds.filter((id: string) => id !== tagId) : [...f.tagIds, tagId],
    }));
  };

  const submit = () => {
    const input = {
      ...form,
      contractValue: form.contractValue ? Number(form.contractValue) : undefined,
      renewalNoticeDays: form.renewalNoticeDays ? Number(form.renewalNoticeDays) : undefined,
      parties: form.parties.filter((p: any) => p.name.trim()),
    };
    onSubmit(input);
  };

  return (
    <div className="space-y-4">
      <Field label="Title">
        <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Service Agreement — Acme Corp" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <SelectNative
            value={form.contractType}
            onChange={(value) => update("contractType", value)}
            options={[{ value: "", label: "—" }, ...TYPE_OPTIONS.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))]}
          />
        </Field>
        <Field label="Status">
          <SelectNative
            value={form.status}
            onChange={(value) => update("status", value)}
            options={STATUS_OPTIONS.filter((s) => s.value !== "")}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Effective date">
          <Input type="date" value={form.effectiveDate} onChange={(e) => update("effectiveDate", e.target.value)} />
        </Field>
        <Field label="Expiry date">
          <Input type="date" value={form.expiryDate} onChange={(e) => update("expiryDate", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Renewal date">
          <Input type="date" value={form.renewalDate} onChange={(e) => update("renewalDate", e.target.value)} />
        </Field>
        <Field label="Renewal type">
          <SelectNative value={form.renewalType} onChange={(value) => update("renewalType", value)} options={RENEWAL_OPTIONS} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Renewal notice (days)">
          <Input type="number" value={form.renewalNoticeDays} onChange={(e) => update("renewalNoticeDays", e.target.value)} />
        </Field>
        <Field label="Contract value">
          <Input type="number" value={form.contractValue} onChange={(e) => update("contractValue", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency">
          <Input value={form.currency} onChange={(e) => update("currency", e.target.value)} placeholder="TTD" />
        </Field>
        <Field label="Jurisdiction">
          <Input value={form.jurisdiction} onChange={(e) => update("jurisdiction", e.target.value)} />
        </Field>
      </div>
      <Field label="Retention policy">
        <Input value={form.retentionPolicy} onChange={(e) => update("retentionPolicy", e.target.value)} placeholder="e.g. 7 years" />
      </Field>
      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          className="w-full rounded-lg border border-[var(--kf-border)] bg-[var(--kf-glass)] px-3 py-2 text-sm min-h-[80px]"
        />
      </Field>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium">Parties</span>
          <Button type="button" variant="outline" size="sm" onClick={addParty}>
            <Plus className="w-3 h-3 mr-1" /> Add party
          </Button>
        </div>
        <div className="space-y-2">
          {form.parties.map((party: any, idx: number) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
              <Input
                className="col-span-3"
                value={party.role}
                onChange={(e) => updateParty(idx, "role", e.target.value)}
                placeholder="Role"
              />
              <Input
                className="col-span-4"
                value={party.name}
                onChange={(e) => updateParty(idx, "name", e.target.value)}
                placeholder="Name"
              />
              <Input
                className="col-span-4"
                value={party.email}
                onChange={(e) => updateParty(idx, "email", e.target.value)}
                placeholder="Email"
              />
              <button onClick={() => removeParty(idx)} className="col-span-1 flex justify-center text-muted-foreground hover:text-destructive">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {tags.length > 0 && (
        <div>
          <span className="text-xs font-medium block mb-2">Tags</span>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.tagIds.includes(tag.id)}
                  onChange={() => toggleTag(tag.id)}
                  className="rounded border-[var(--kf-border)]"
                />
                {tag.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={loading || !form.title.trim()}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save contract"}
        </Button>
      </div>
    </div>
  );
}

function initializeForm(contract: Contract | null) {
  return {
    title: contract?.title ?? "",
    contractType: contract?.contractType ?? "",
    status: contract?.status ?? "DRAFT",
    effectiveDate: contract?.effectiveDate ? contract.effectiveDate.slice(0, 10) : "",
    expiryDate: contract?.expiryDate ? contract.expiryDate.slice(0, 10) : "",
    renewalDate: contract?.renewalDate ? contract.renewalDate.slice(0, 10) : "",
    renewalType: contract?.renewalType ?? "",
    renewalNoticeDays: contract?.renewalNoticeDays ?? "",
    contractValue: contract?.contractValue ?? "",
    currency: contract?.currency ?? "",
    jurisdiction: contract?.jurisdiction ?? "",
    retentionPolicy: contract?.retentionPolicy ?? "",
    notes: contract?.notes ?? "",
    parties: contract?.parties?.map((p) => ({
      role: p.role,
      name: p.name,
      email: p.email ?? "",
      phone: p.phone ?? "",
      address: p.address ?? "",
      notes: p.notes ?? "",
      contactId: p.contactId ?? "",
    })) ?? [{ role: "client", name: "" }],
    tagIds: contract?.tags?.map((t) => t.tag.id) ?? [],
  };
}

function ContractDetail({
  contract,
  tags,
  onExtract,
  onAcknowledgeAlert,
  loading,
}: {
  contract: Contract;
  tags: ContractTag[];
  onExtract: (source: any) => void;
  onAcknowledgeAlert: (id: string) => void;
  loading: string | null;
}) {
  const [extractForm, setExtractForm] = useState({ url: "", filename: "", mimeType: "application/pdf" });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={contract.status} />
        {contract.contractType && <Badge variant="outline">{contract.contractType.replace(/_/g, " ")}</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <FieldValue label="Effective" value={formatDate(contract.effectiveDate)} />
        <FieldValue label="Expires" value={formatDate(contract.expiryDate)} />
        <FieldValue label="Renewal" value={formatDate(contract.renewalDate)} />
        <FieldValue label="Renewal type" value={contract.renewalType ?? "—"} />
        <FieldValue label="Notice" value={contract.renewalNoticeDays ? `${contract.renewalNoticeDays} days` : "—"} />
        <FieldValue
          label="Value"
          value={contract.contractValue !== null && contract.contractValue !== undefined ? `${contract.currency} ${contract.contractValue.toLocaleString()}` : "—"}
        />
        <FieldValue label="Jurisdiction" value={contract.jurisdiction ?? "—"} />
        <FieldValue label="Retention" value={contract.retentionPolicy ?? "—"} />
      </div>

      {contract.parties.length > 0 && (
        <div>
          <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
            <Users className="w-3 h-3" /> Parties
          </h4>
          <div className="space-y-1">
            {contract.parties.map((p) => (
              <div key={p.id} className="text-sm flex items-center gap-2">
                <Badge variant="secondary">{p.role}</Badge>
                <span>{p.name}</span>
                {p.email && <span className="text-muted-foreground text-xs">{p.email}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {contract.terms.length > 0 && (
        <div>
          <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
            <Tag className="w-3 h-3" /> Extracted terms
          </h4>
          <div className="space-y-2">
            {contract.terms.map((t) => (
              <div key={t.id} className="rounded-lg border border-border/40 p-2 text-sm">
                <div className="font-medium text-xs uppercase tracking-wide text-muted-foreground">{t.termKey.replace(/_/g, " ")}</div>
                <div className="mt-0.5 whitespace-pre-wrap">{t.termValue}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {contract.alerts.length > 0 && (
        <div>
          <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Alerts
          </h4>
          <div className="space-y-2">
            {contract.alerts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-border/40 p-2 text-sm">
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.alertType.startsWith("EXPIRY") ? "warning" : "error"} label={a.alertType.replace(/_/g, " ")} />
                  <span className="text-muted-foreground text-xs">{formatDate(a.dueDate)}</span>
                </div>
                {!a.acknowledgedAt && (
                  <Button variant="outline" size="sm" onClick={() => onAcknowledgeAlert(a.id)}>
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Ack
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {contract.versions.length > 0 && (
        <div>
          <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Version history
          </h4>
          <div className="space-y-1">
            {contract.versions.map((v) => (
              <div key={v.id} className="text-sm flex items-center gap-2">
                <span className="font-medium">v{v.versionNumber}</span>
                <span className="text-muted-foreground text-xs">{v.changeSummary ?? "Updated"}</span>
                <span className="text-muted-foreground text-xs">{formatDate(v.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border/40 p-3 space-y-2">
        <h4 className="text-xs font-medium flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> Extract terms
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Document URL"
            value={extractForm.url}
            onChange={(e) => setExtractForm((f) => ({ ...f, url: e.target.value }))}
          />
          <Input
            placeholder="Filename"
            value={extractForm.filename}
            onChange={(e) => setExtractForm((f) => ({ ...f, filename: e.target.value }))}
          />
        </div>
        <SelectNative
          value={extractForm.mimeType}
          onChange={(value) => setExtractForm((f) => ({ ...f, mimeType: value }))}
          options={[
            { value: "application/pdf", label: "PDF" },
            { value: "image/png", label: "PNG" },
            { value: "image/jpeg", label: "JPEG" },
          ]}
        />
        <Button
          size="sm"
          onClick={() => onExtract(extractForm)}
          disabled={loading === "extract" || !extractForm.url || !extractForm.filename}
        >
          {loading === "extract" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
          Extract with AI
        </Button>
      </div>

      {contract.notes && (
        <div>
          <h4 className="text-xs font-medium mb-1">Notes</h4>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{contract.notes}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-1 pt-2">
        {contract.tags.map((t) => (
          <Badge key={t.tag.id} style={{ backgroundColor: t.tag.color ?? undefined }}>
            {t.tag.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}

function FieldValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
