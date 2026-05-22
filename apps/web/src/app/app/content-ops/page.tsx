"use client";

import { AddonPackGate } from "@/components/addon-pack-gate";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  Plus,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Eye,
  Megaphone,
  Mail,
  Image,
  Video,
  PenTool,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Package,
  X,
  Receipt,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  ContentRequest,
  ContentRequestStatus,
  fetchContentRequests,
  fetchContentRequestPipeline,
  deleteContentRequest,
  createContentRequest,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const STATUS_LABELS: Record<ContentRequestStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  assigned: "Assigned",
  in_production: "In Production",
  internal_review: "Internal Review",
  user_review: "User Review",
  approved: "Approved",
  uploaded_to_drive: "Uploaded",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<ContentRequestStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-blue-100 text-blue-700",
  assigned: "bg-indigo-100 text-indigo-700",
  in_production: "bg-amber-100 text-amber-700",
  internal_review: "bg-purple-100 text-purple-700",
  user_review: "bg-pink-100 text-pink-700",
  approved: "bg-emerald-100 text-emerald-700",
  uploaded_to_drive: "bg-cyan-100 text-cyan-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

const CONTENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  blog_post: <FileText className="w-4 h-4" />,
  social_post: <Megaphone className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
  video_script: <Video className="w-4 h-4" />,
  flyer: <Image className="w-4 h-4" />,
  whitepaper: <PenTool className="w-4 h-4" />,
  landing_page: <FileText className="w-4 h-4" />,
  case_study: <FileText className="w-4 h-4" />,
  newsletter: <Mail className="w-4 h-4" />,
  ad_copy: <Megaphone className="w-4 h-4" />,
  press_release: <FileText className="w-4 h-4" />,
};

function ContentOpsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ContentRequest[]>([]);
  const [pipeline, setPipeline] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [listRes, pipeRes] = await Promise.all([
        fetchContentRequests(businessId, { status: filterStatus || undefined }),
        fetchContentRequestPipeline(businessId),
      ]);
      if (listRes.error) throw new Error(listRes.error);
      if (pipeRes.error) throw new Error(pipeRes.error);
      setRequests(listRes.data ?? []);
      setPipeline(pipeRes.data?.counts ?? {});
    } catch (err) {
      toast.error("Failed to load content requests");
    } finally {
      setLoading(false);
    }
  }, [businessId, filterStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return requests;
    const q = searchQuery.toLowerCase();
    return requests.filter(
      (r) =>
        r.businessGoal.toLowerCase().includes(q) ||
        r.targetAudience?.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }, [requests, searchQuery]);

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!confirm("Delete this content request?")) return;
    try {
      await deleteContentRequest(businessId, id);
      toast.success("Content request deleted");
      load();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!businessId) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const contentTypes = fd.getAll("contentTypes") as string[];
    if (!contentTypes.length) {
      toast.error("Select at least one content type");
      return;
    }
    setCreating(true);
    try {
      await createContentRequest(businessId, {
        source: "user_request",
        contentTypes,
        businessGoal: fd.get("businessGoal") as string,
        targetAudience: (fd.get("targetAudience") as string) || undefined,
        offer: (fd.get("offer") as string) || undefined,
        priority: (fd.get("priority") as string) || "normal",
        dueDate: (fd.get("dueDate") as string) || undefined,
        approvalRequired: true,
        invoiceOnDelivery: fd.get("invoiceOnDelivery") === "on",
      });
      toast.success("Content request created");
      setShowCreate(false);
      load();
    } catch {
      toast.error("Failed to create request");
    } finally {
      setCreating(false);
    }
  };

  const statuses = Object.keys(STATUS_LABELS) as ContentRequestStatus[];

  return (
    <WorkspaceShell icon={Package} title="Content Operations">
      <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Content Operations</h1>
            <p className="text-muted-foreground mt-1">
              Manage content requests from brief to delivery
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Request
          </button>
        </div>

        {/* Pipeline counts */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterStatus("")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !filterStatus ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
            }`}
          >
            All ({requests.length})
          </button>
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s === filterStatus ? "" : s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                s === filterStatus
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              {STATUS_LABELS[s]} ({pipeline[s] ?? 0})
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by goal, audience, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border rounded-xl bg-muted/20">
            <Package className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <h3 className="text-lg font-medium">No content requests</h3>
            <p className="text-muted-foreground mt-1">
              {searchQuery || filterStatus
                ? "Try adjusting your filters"
                : "Create your first content request to get started"}
            </p>
          </div>
        ) : (
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Goal</th>
                  <th className="px-4 py-3 text-left font-medium">Types</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Priority</th>
                  <th className="px-4 py-3 text-left font-medium">Due</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((req) => (
                  <tr
                    key={req.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/app/content-ops/${req.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium max-w-xs truncate">{req.businessGoal}</div>
                      <div className="text-muted-foreground text-xs mt-0.5">
                        {req.targetAudience || "No target audience"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {req.contentTypes.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs"
                          >
                            {CONTENT_TYPE_ICONS[t] || <FileText className="w-3 h-3" />}
                            {t.replace(/_/g, " ")}
                          </span>
                        ))}
                        {req.contentTypes.length > 3 && (
                          <span className="px-2 py-0.5 rounded bg-muted text-xs">
                            +{req.contentTypes.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                          STATUS_COLORS[req.status as ContentRequestStatus] || "bg-gray-100"
                        }`}
                      >
                        {STATUS_LABELS[req.status as ContentRequestStatus] || req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-medium ${
                          req.priority === "urgent"
                            ? "text-red-600"
                            : req.priority === "high"
                            ? "text-amber-600"
                            : "text-muted-foreground"
                        }`}
                      >
                        {req.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {req.dueDate
                        ? new Date(req.dueDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/app/content-ops/${req.id}`);
                          }}
                          className="p-1.5 rounded hover:bg-muted transition-colors"
                          title="View"
                        >
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(req.id);
                          }}
                          className="p-1.5 rounded hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">New Content Request</h2>
              <button
                onClick={() => setShowCreate(false)}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Business Goal *</label>
                <textarea
                  name="businessGoal"
                  required
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="What should this content achieve?"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Content Types *</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    "blog_post",
                    "social_post",
                    "email",
                    "video_script",
                    "flyer",
                    "whitepaper",
                    "landing_page",
                    "case_study",
                    "newsletter",
                    "ad_copy",
                    "press_release",
                  ].map((t) => (
                    <label key={t} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer hover:bg-muted transition-colors has-[:checked]:bg-primary/10 has-[:checked]:border-primary">
                      <input type="checkbox" name="contentTypes" value={t} className="sr-only" />
                      {CONTENT_TYPE_ICONS[t]}
                      <span className="text-sm capitalize">{t.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Target Audience</label>
                  <input
                    name="targetAudience"
                    className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g. Small business owners"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Offer</label>
                  <input
                    name="offer"
                    className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g. 20% off installation"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <select
                    name="priority"
                    className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Due Date</label>
                  <input
                    type="date"
                    name="dueDate"
                    className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="invoiceOnDelivery"
                  id="invoiceOnDelivery"
                  className="rounded border-gray-300"
                />
                <label htmlFor="invoiceOnDelivery" className="text-sm flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-muted-foreground" />
                  Auto-generate invoice on delivery
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

export default function Page() {
  return (
    <AddonPackGate
      pack="agencyPack"
      title="Agency Pack"
      description="Content request pipeline, deliverable tracking, and client approval workflows built for agencies managing creative production at scale."
      features={[
        "Content request intake with briefs, priorities, and due dates",
        "10-step production pipeline from draft to delivery",
        "Google Drive folder and document auto-generation",
        "Client review & approval workflow integration",
        "Auto-invoice generation on content delivery",
      ]}
    >
      <ContentOpsPage />
    </AddonPackGate>
  );
}
