"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Image,
  Plus,
  Loader2,
  Search,
  Trash2,
  Eye,
  Folder,
  Tag,
  X,
  FolderOpen,
  HardDrive,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  Asset,
  fetchAssets,
  fetchAssetFolders,
  deleteAsset,
  updateAsset,
  tagAsset,
  untagAsset,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <Image className="w-4 h-4" />,
  video: <HardDrive className="w-4 h-4" />,
  document: <Folder className="w-4 h-4" />,
  audio: <HardDrive className="w-4 h-4" />,
  other: <Folder className="w-4 h-4" />,
};

export default function AssetsPage() {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("");
  const [filterFolder, setFilterFolder] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [newTag, setNewTag] = useState("");

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [assetsRes, foldersRes] = await Promise.all([
        fetchAssets(businessId, {
          type: filterType || undefined,
          folder: filterFolder || undefined,
          search: searchQuery || undefined,
        }),
        fetchAssetFolders(businessId),
      ]);
      if (assetsRes.data) setAssets(assetsRes.data);
      if (foldersRes.data) setFolders(foldersRes.data);
    } catch (err) {
      toast.error("Failed to load assets");
    } finally {
      setLoading(false);
    }
  }, [businessId, filterType, filterFolder, searchQuery]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this asset?")) return;
    try {
      await deleteAsset(id);
      toast.success("Asset deleted");
      load();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAsset) return;
    try {
      await updateAsset(editingAsset.id, {
        name: editingAsset.name,
        folder: editingAsset.folder,
        permissions: editingAsset.permissions,
      });
      toast.success("Asset updated");
      setEditingAsset(null);
      load();
    } catch {
      toast.error("Update failed");
    }
  };

  const handleAddTag = async (assetId: string) => {
    if (!newTag.trim()) return;
    try {
      await tagAsset(assetId, newTag.trim());
      toast.success("Tag added");
      setNewTag("");
      load();
    } catch {
      toast.error("Failed to add tag");
    }
  };

  const types = ["image", "video", "document", "audio", "other"];

  return (
    <WorkspaceShell icon={Image} title="Assets">
      <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Asset Library</h1>
            <p className="text-muted-foreground mt-1">Manage images, videos, documents, and files</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterType("")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${!filterType ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
          >
            All
          </button>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t === filterType ? "" : t)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${t === filterType ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterFolder("")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${!filterFolder ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
          >
            All Folders
          </button>
          {folders.map((f) => (
            <button
              key={f}
              onClick={() => setFilterFolder(f === filterFolder ? "" : f)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${f === filterFolder ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : assets.length === 0 ? (
          <div className="text-center py-20 border rounded-xl bg-muted/20">
            <Image className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <h3 className="text-lg font-medium">No assets found</h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets.map((asset) => (
              <div key={asset.id} className="border rounded-xl p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {TYPE_ICONS[asset.type] || <Folder className="w-4 h-4" />}
                    <span className="font-medium text-sm truncate max-w-[180px]">{asset.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditingAsset(asset)} className="p-1 rounded hover:bg-muted">
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDelete(asset.id)} className="p-1 rounded hover:bg-red-50">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground flex items-center gap-2">
                  <span className="capitalize">{asset.type}</span>
                  <span>·</span>
                  <span>{asset.folder}</span>
                  <span>·</span>
                  <span>{asset.usageCount} uses</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {asset.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs">
                      <Tag className="w-3 h-3" />
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    placeholder="Add tag..."
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTag(asset.id)}
                    className="flex-1 px-2 py-1 rounded border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/20"
                  />
                  <button
                    onClick={() => handleAddTag(asset.id)}
                    className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
                  >
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Edit Asset</h2>
              <button onClick={() => setEditingAsset(null)} className="p-1 rounded hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpdate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input value={editingAsset.name} onChange={(e) => setEditingAsset({ ...editingAsset, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Folder</label>
                <input value={editingAsset.folder} onChange={(e) => setEditingAsset({ ...editingAsset, folder: e.target.value })} className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Permissions</label>
                <select value={editingAsset.permissions} onChange={(e) => setEditingAsset({ ...editingAsset, permissions: e.target.value })} className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="private">Private</option>
                  <option value="team">Team</option>
                  <option value="public">Public</option>
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setEditingAsset(null)} className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
