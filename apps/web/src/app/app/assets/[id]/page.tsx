"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Image,
  Trash2,
  AlertTriangle,
  Clock,
  HardDrive,
  Folder,
  Tag,
  Pencil,
  Plus,
  X,
  Link as LinkIcon,
  BarChart3,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  Asset,
  fetchAsset,
  updateAsset,
  tagAsset,
  untagAsset,
  trackAssetUsage,
  deleteAsset,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

export default function AssetDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const businessId = getStoredBusinessId();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{ name: string; folder: string } | null>(null);
  const [newTag, setNewTag] = useState("");
  const [trackType, setTrackType] = useState("");
  const [trackId, setTrackId] = useState("");
  const [showTrack, setShowTrack] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    if (!businessId) return;
    try {
      const res = await fetchAsset(businessId, id);
      if (res.error) throw new Error(res.error);
      setAsset(res.data ?? null);
    } catch (err) {
      toast.error("Failed to load asset");
    } finally {
      setLoading(false);
    }
  }, [id, businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    if (!asset || !businessId) return;
    if (!confirm("Delete this asset?")) return;
    setActionLoading("delete");
    try {
      await deleteAsset(businessId, asset.id);
      toast.success("Asset deleted");
      router.push("/app/assets");
    } catch {
      toast.error("Failed to delete");
      setActionLoading(null);
    }
  };

  const handleUpdate = async () => {
    if (!asset || !editForm || !businessId) return;
    setActionLoading("update");
    try {
      await updateAsset(businessId, asset.id, {
        name: editForm.name,
        folder: editForm.folder,
      });
      toast.success("Asset updated");
      setEditing(false);
      load();
    } catch {
      toast.error("Update failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddTag = async () => {
    if (!asset || !businessId || !newTag.trim()) return;
    setActionLoading("tag");
    try {
      await tagAsset(businessId, asset.id, newTag.trim());
      toast.success("Tag added");
      setNewTag("");
      load();
    } catch {
      toast.error("Failed to add tag");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!asset || !businessId) return;
    setActionLoading(`untag-${tag}`);
    try {
      await untagAsset(businessId, asset.id, tag);
      toast.success("Tag removed");
      load();
    } catch {
      toast.error("Failed to remove tag");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTrackUsage = async () => {
    if (!asset || !businessId || !trackType.trim() || !trackId.trim()) return;
    setActionLoading("track");
    try {
      await trackAssetUsage(businessId, asset.id, {
        usedInType: trackType.trim(),
        usedInId: trackId.trim(),
      });
      toast.success("Usage tracked");
      setShowTrack(false);
      setTrackType("");
      setTrackId("");
      load();
    } catch {
      toast.error("Failed to track usage");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <WorkspaceShell icon={Image} title="Asset">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </WorkspaceShell>
    );
  }

  if (!asset) {
    return (
      <WorkspaceShell icon={Image} title="Asset">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mb-3" />
          <h2 className="text-lg font-medium">Asset not found</h2>
          <button
            onClick={() => router.push("/app/assets")}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Assets
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell icon={Image} title="Asset">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/app/assets")}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{asset.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted capitalize">
                {asset.type}
              </span>
              <span className="text-muted-foreground text-sm">ID: {asset.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main info */}
          <div className="lg:col-span-2 space-y-6">
            <div className="border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-medium">Details</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Folder</span>
                  <p className="font-medium flex items-center gap-1">
                    <Folder className="w-3.5 h-3.5" />
                    {asset.folder}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Usage Count</span>
                  <p className="font-medium">{asset.usageCount}</p>
                </div>
                {asset.mimeType && (
                  <div>
                    <span className="text-muted-foreground">MIME Type</span>
                    <p className="font-medium">{asset.mimeType}</p>
                  </div>
                )}
                {asset.sizeBytes !== null && asset.sizeBytes !== undefined && (
                  <div>
                    <span className="text-muted-foreground">Size</span>
                    <p className="font-medium">{(asset.sizeBytes / 1024).toFixed(1)} KB</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Permissions</span>
                  <p className="font-medium capitalize">{asset.permissions}</p>
                </div>
              </div>
              {asset.url && (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground text-sm">URL</span>
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1 mt-1 break-all"
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    {asset.url}
                  </a>
                </div>
              )}
              <div className="pt-2 border-t">
                <span className="text-muted-foreground text-sm">Tags</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {asset.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs"
                    >
                      <Tag className="w-3 h-3" />
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        disabled={actionLoading === `untag-${tag}`}
                        className="ml-0.5 hover:text-red-500"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    placeholder="Add tag..."
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                    className="flex-1 px-2 py-1 rounded border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/20"
                  />
                  <button
                    onClick={handleAddTag}
                    disabled={actionLoading === "tag"}
                    className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-3">Actions</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setEditForm({ name: asset.name, folder: asset.folder });
                    setEditing(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={() => setShowTrack(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                >
                  <BarChart3 className="w-4 h-4" />
                  Track Usage
                </button>
                <button
                  onClick={handleDelete}
                  disabled={!!actionLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-red-50 text-red-600 transition-colors disabled:opacity-50"
                >
                  {actionLoading === "delete" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="border rounded-xl p-4 space-y-3 text-sm">
              <h3 className="font-medium">Meta</h3>
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Storage Key</span>
                <span className="ml-auto font-mono text-xs truncate max-w-[120px]">{asset.storageKey}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Created</span>
                <span className="ml-auto">{new Date(asset.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Updated</span>
                <span className="ml-auto">{new Date(asset.updatedAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Uploaded By</span>
                <span className="ml-auto font-mono">{asset.uploadedBy.slice(0, 8)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {editing && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Edit Asset</h2>
              <button onClick={() => setEditing(false)} className="p-1 rounded hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Folder</label>
                <input
                  value={editForm.folder}
                  onChange={(e) => setEditForm({ ...editForm, folder: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdate}
                  disabled={actionLoading === "update"}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {actionLoading === "update" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Track usage modal */}
      {showTrack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Track Usage</h2>
              <button onClick={() => setShowTrack(false)} className="p-1 rounded hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Used In Type</label>
                <input
                  value={trackType}
                  onChange={(e) => setTrackType(e.target.value)}
                  placeholder="e.g. campaign, email, page"
                  className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Used In ID</label>
                <input
                  value={trackId}
                  onChange={(e) => setTrackId(e.target.value)}
                  placeholder="entity-id"
                  className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowTrack(false)}
                  className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTrackUsage}
                  disabled={actionLoading === "track"}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {actionLoading === "track" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                  Track
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
