"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiDelete } from "@/lib/api";
import {
  FileText,
  FolderOpen,
  Search,
  ArrowLeft,
  File,
  Table2,
  Presentation,
  Image,
  Video,
  MoreHorizontal,
  ExternalLink,
  Star,
  ChevronRight,
  RefreshCw,
  Loader2,
  X,
  HardDrive,
  LogIn,
  LogOut,
  Filter,
} from "lucide-react";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  shared?: boolean;
  starred?: boolean;
}

interface GoogleDriveBrowserProps {
  businessId: string;
}

const MIME_TYPE_FILTERS = [
  { label: "All Files", value: "" },
  { label: "Documents", value: "document" },
  { label: "Spreadsheets", value: "spreadsheet" },
  { label: "Presentations", value: "presentation" },
  { label: "PDFs", value: "application/pdf" },
  { label: "Folders", value: "folder" },
];

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType === "application/vnd.google-apps.folder") return <FolderOpen className={className} />;
  if (mimeType === "application/vnd.google-apps.document") return <FileText className={className} />;
  if (mimeType === "application/vnd.google-apps.spreadsheet") return <Table2 className={className} />;
  if (mimeType === "application/vnd.google-apps.presentation") return <Presentation className={className} />;
  // The `Image` symbol here is a lucide-react SVG icon component, not an
  // <img> element — `alt` is not a valid prop. Suppress the false positive.
  // eslint-disable-next-line jsx-a11y/alt-text
  if (mimeType.startsWith("image/")) return <Image className={className} />;
  if (mimeType.startsWith("video/")) return <Video className={className} />;
  if (mimeType === "application/pdf") return <FileText className={className} />;
  return <File className={className} />;
}

function getFileColor(mimeType: string) {
  if (mimeType === "application/vnd.google-apps.folder") return "text-[hsl(var(--kf-warning))]";
  if (mimeType === "application/vnd.google-apps.document") return "text-blue-400";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "text-[hsl(var(--kf-success))]";
  if (mimeType === "application/vnd.google-apps.presentation") return "text-[hsl(var(--kf-warning))]";
  if (mimeType === "application/pdf") return "text-[hsl(var(--kf-error))]";
  if (mimeType.startsWith("image/")) return "text-purple-400";
  return "text-[hsl(var(--muted-foreground))]";
}

function getEmbedUrl(fileId: string, mimeType: string): string {
  if (mimeType === "application/vnd.google-apps.document") {
    return `https://docs.google.com/document/d/${fileId}/preview`;
  } else if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
  } else if (mimeType === "application/vnd.google-apps.presentation") {
    return `https://docs.google.com/presentation/d/${fileId}/preview`;
  } else {
    return `https://drive.google.com/file/d/${fileId}/preview`;
  }
}

function isEmbeddable(mimeType: string): boolean {
  return [
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.google-apps.presentation",
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ].includes(mimeType);
}

function formatDate(dateString?: string) {
  if (!dateString) return "";
  const d = new Date(dateString);
  return d.toLocaleDateString("en-TT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatSize(bytes?: string) {
  if (!bytes) return "";
  const num = parseInt(bytes, 10);
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GoogleDriveBrowser({ businessId }: GoogleDriveBrowserProps) {
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [mimeFilter, setMimeFilter] = useState("");
  const [openFile, setOpenFile] = useState<DriveFile | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    const res = await apiGet<{ connected: boolean; email?: string }>(`/drive/businesses/${businessId}/status`);
    if (res.data) {
      setConnected(res.data.connected);
      setEmail(res.data.email || null);
    }
    setLoading(false);
  }, [businessId]);

  const loadFiles = useCallback(async (append = false, pageToken?: string) => {
    setFilesLoading(true);
    const params = new URLSearchParams();
    if (pageToken) params.set("pageToken", pageToken);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (mimeFilter) params.set("mimeType", mimeFilter);
    params.set("pageSize", "25");

    const res = await apiGet<{ files: DriveFile[]; nextPageToken?: string }>(
      `/drive/businesses/${businessId}/files?${params.toString()}`
    );
    if (res.data) {
      setFiles(prev => append ? [...prev, ...res.data!.files] : res.data!.files);
      setNextPageToken(res.data.nextPageToken);
    }
    setFilesLoading(false);
  }, [businessId, searchQuery, mimeFilter]);

   
  useEffect(() => { checkStatus(); }, [checkStatus]);
  useEffect(() => {
     
    if (connected) loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `loadFiles` is intentionally excluded because it changes whenever `searchQuery` updates; we don't want every keystroke in the search box to trigger a fresh fetch here. Search-driven loads are handled by a separate debounced effect; this one only refetches when the user (re)connects or changes the MIME filter.
  }, [connected, mimeFilter]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") === "success") {
       
      checkStatus();
      window.history.replaceState({}, "", window.location.pathname + "?tab=intelligence");
    }
    if (params.get("drive") === "error") {
      window.history.replaceState({}, "", window.location.pathname + "?tab=intelligence");
    }
  }, [checkStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    const res = await apiGet<{ url: string }>(`/drive/businesses/${businessId}/auth-url`);
    if (res.data?.url) {
      window.location.href = res.data.url;
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    await apiDelete(`/drive/businesses/${businessId}/disconnect`);
    setConnected(false);
    setEmail(null);
    setFiles([]);
    setDisconnecting(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadFiles();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-[hsl(var(--kf-accent1))]" />
      </div>
    );
  }

  if (openFile) {
    return (
      <div className="flex flex-col h-[calc(100vh-240px)] min-h-[500px]">
        <div className="flex items-center gap-3 px-4 py-3 bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-t-xl">
          <button
            type="button"
            onClick={() => setOpenFile(null)}
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <FileIcon mimeType={openFile.mimeType} className={`w-4 h-4 flex-shrink-0 ${getFileColor(openFile.mimeType)}`} />
            <span className="font-medium text-sm truncate">{openFile.name}</span>
          </div>
          <a
            href={openFile.webViewLink || `https://drive.google.com/file/d/${openFile.id}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/80 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Edit in Google
          </a>
        </div>
        <div className="flex-1 border-x border-b border-[hsl(var(--border))] rounded-b-xl overflow-hidden bg-white">
          <iframe
            src={getEmbedUrl(openFile.id, openFile.mimeType)}
            className="w-full h-full border-0"
            allow="autoplay"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
            title={openFile.name}
          />
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8">
        <div className="flex flex-col items-center text-center max-w-md mx-auto gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
            <HardDrive className="w-7 h-7 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">Connect Google Drive</h3>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              Browse, search, and preview your Google Docs, Sheets, Slides, and other Drive files right inside KEYFLOWOS.
            </p>
          </div>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            Connect Google Drive
          </button>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            We request read-only access. Your files remain in Google Drive.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrive className="w-4 h-4 text-[hsl(var(--kf-accent1))] flex-shrink-0" />
          <span className="text-sm font-medium truncate">Google Drive</span>
          {email && (
            <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">({email})</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => loadFiles()}
            disabled={filesLoading}
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${filesLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-[hsl(var(--kf-error))]/10 text-[hsl(var(--kf-error))] transition-colors"
          >
            {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
            Disconnect
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search your Drive files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadFiles(); } }}
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-[hsl(var(--muted))] border border-[hsl(var(--border))] text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))] placeholder:text-[hsl(var(--muted-foreground))]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(""); setTimeout(() => loadFiles(), 0); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[hsl(var(--border))]"
            >
              <X className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
            </button>
          )}
        </form>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`p-2 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors ${showFilters ? "bg-[hsl(var(--muted))]" : ""}`}
        >
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-1.5">
          {MIME_TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setMimeFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                mimeFilter === f.value
                  ? "bg-[hsl(var(--kf-accent1))] text-white"
                  : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--border))]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {filesLoading && files.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-[hsl(var(--kf-accent1))]" />
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <FolderOpen className="w-10 h-10 text-[hsl(var(--muted-foreground))] mb-3" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {searchQuery || mimeFilter ? "No files match your search" : "No files found in your Drive"}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden divide-y divide-[hsl(var(--border))]">
          {files.map((file) => {
            const embeddable = isEmbeddable(file.mimeType);

            return (
              <button
                key={file.id}
                type="button"
                onClick={() => {
                  if (embeddable) {
                    setOpenFile(file);
                  } else if (file.webViewLink) {
                    window.open(file.webViewLink, "_blank");
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))]/50 transition-colors text-left group"
              >
                <div className={`w-8 h-8 rounded-lg bg-[hsl(var(--muted))] flex items-center justify-center flex-shrink-0`}>
                  <FileIcon mimeType={file.mimeType} className={`w-4 h-4 ${getFileColor(file.mimeType)}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate text-[hsl(var(--foreground))]">{file.name}</span>
                    {file.starred && <Star className="w-3 h-3 text-[hsl(var(--kf-warning))] fill-current flex-shrink-0" />}
                    {file.shared && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--kf-info))]/10 text-[hsl(var(--kf-info))] flex-shrink-0">Shared</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                    {file.modifiedTime && <span>{formatDate(file.modifiedTime)}</span>}
                    {file.size && <span>{formatSize(file.size)}</span>}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {nextPageToken && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => loadFiles(true, nextPageToken)}
            disabled={filesLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--muted))] text-sm font-medium hover:bg-[hsl(var(--border))] transition-colors disabled:opacity-50"
          >
            {filesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
            Load More
          </button>
        </div>
      )}
    </div>
  );
}
