"use client";

import { useCallback } from "react";
import { uploadGeneratedDocument } from "@/lib/client";
import { toast } from "sonner";

interface DriveUploadOptions {
  businessId: string;
  entityType: "invoice" | "quote" | "expense" | "payment" | "journal" | "report";
  entityId: string;
  fileName: string;
  mimeType: string;
  content: string | ArrayBuffer; // string for HTML, ArrayBuffer for binary
  contentFormat: "binary" | "html";
  silent?: boolean;
}

export function useDriveUpload() {
  const uploadToDrive = useCallback(async (opts: DriveUploadOptions): Promise<boolean> => {
    try {
      let contentBase64: string;
      if (opts.contentFormat === "binary" && opts.content instanceof ArrayBuffer) {
        const bytes = new Uint8Array(opts.content);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        contentBase64 = btoa(binary);
      } else {
        contentBase64 = btoa(unescape(encodeURIComponent(opts.content as string)));
      }

      const res = await uploadGeneratedDocument(opts.businessId, {
        entityType: opts.entityType,
        entityId: opts.entityId,
        fileName: opts.fileName,
        mimeType: opts.mimeType,
        contentBase64,
        contentFormat: opts.contentFormat,
      });

      if (res.error) {
        if (!opts.silent) toast.error(`Drive upload failed: ${res.error}`);
        return false;
      }

      if (!opts.silent) toast.success(`Saved to Drive: ${opts.fileName}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Drive upload failed";
      if (!opts.silent) toast.error(msg);
      return false;
    }
  }, []);

  return { uploadToDrive };
}
