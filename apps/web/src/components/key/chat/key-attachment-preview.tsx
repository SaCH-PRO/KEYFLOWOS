"use client";

import { FileText, Image as ImageIcon, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeyChatAttachment } from "./types";
import { isImage } from "./utils";

interface KeyAttachmentPreviewProps {
  attachment: KeyChatAttachment;
  isUploading?: boolean;
  onRemove?: () => void;
  className?: string;
}

export function KeyAttachmentPreview({
  attachment,
  isUploading,
  onRemove,
  className,
}: KeyAttachmentPreviewProps) {
  const image = isImage(attachment.contentType);

  return (
    <div
      className={cn(
        "group relative flex h-16 w-fit min-w-[140px] max-w-[200px] items-center gap-2 rounded-xl border border-border/50 bg-muted/40 px-2 py-2 pr-6",
        className
      )}
    >
      {image ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
          {attachment.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachment.url}
              alt={attachment.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="m-auto h-5 w-5 text-muted-foreground" />
          )}
        </div>
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
      )}

      <div className="flex min-w-0 flex-col justify-center">
        <span className="truncate text-xs font-medium">{attachment.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {isUploading ? "Uploading…" : attachment.contentType.split("/").pop()}
        </span>
      </div>

      {isUploading && (
        <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {onRemove && !isUploading && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          aria-label="Remove attachment"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
