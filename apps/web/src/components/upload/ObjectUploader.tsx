"use client";

import { useCallback, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Button } from "@keyflow/ui";

export interface UploadedFileInfo {
  name: string;
  size: number;
  type: string;
  uploadURL: string;
}

export interface ObjectUploadResult {
  successful: UploadedFileInfo[];
  failed: { name: string; error: string }[];
}

export interface UploadParameters {
  method: "PUT";
  url: string;
  headers?: Record<string, string>;
}

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  accept?: string;
  onGetUploadParameters: (file: File) => Promise<UploadParameters>;
  onComplete?: (result: ObjectUploadResult) => void;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * A file upload component that renders as a button and uploads files directly
 * to object storage using presigned PUT URLs.
 *
 * This is a lightweight, dependency-free replacement for the previous Uppy-based
 * implementation. The previous version transitively pulled in `lodash` 4.17.21
 * via `@uppy/utils`, which carries unpatched advisories
 * (GHSA-35jh-r3h4-6jhm `_.template` injection and `_.zipObjectDeep` prototype
 * pollution). The advisories declare patched versions as `>=4.18.0`, but no such
 * lodash exists on npm, so the only fix is to drop the Uppy dependency tree.
 *
 * The flow mirrors what the rest of the app already does (see
 * `apps/web/src/app/app/profile/components/personal-info-section.tsx` and
 * `apps/web/src/app/app/expenses/components/expense-form-modal.tsx`):
 *   1. Ask the caller for presigned upload parameters per file.
 *   2. PUT the file body directly to that URL.
 *   3. Report results via `onComplete`.
 */
export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760,
  accept,
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const uploadOne = useCallback(
    async (file: File): Promise<UploadedFileInfo> => {
      const params = await onGetUploadParameters(file);
      const response = await fetch(params.url, {
        method: params.method,
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          ...(params.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(
          `Upload failed (${response.status} ${response.statusText})`,
        );
      }
      return {
        name: file.name,
        size: file.size,
        type: file.type,
        uploadURL: params.url,
      };
    },
    [onGetUploadParameters],
  );

  const handleChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      const files = Array.from(fileList).slice(0, maxNumberOfFiles);
      const successful: UploadedFileInfo[] = [];
      const failed: { name: string; error: string }[] = [];

      setIsUploading(true);
      try {
        for (const file of files) {
          if (file.size > maxFileSize) {
            failed.push({
              name: file.name,
              error: `File exceeds maximum size of ${maxFileSize} bytes`,
            });
            continue;
          }
          try {
            const info = await uploadOne(file);
            successful.push(info);
          } catch (err) {
            failed.push({
              name: file.name,
              error: err instanceof Error ? err.message : "Upload failed",
            });
          }
        }
        onComplete?.({ successful, failed });
      } finally {
        setIsUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [maxFileSize, maxNumberOfFiles, onComplete, uploadOne],
  );

  return (
    <div>
      <Button
        onClick={() => inputRef.current?.click()}
        className={buttonClassName}
        disabled={isUploading}
      >
        {children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple={maxNumberOfFiles > 1}
        accept={accept}
        onChange={handleChange}
        style={{ display: "none" }}
      />
    </div>
  );
}
