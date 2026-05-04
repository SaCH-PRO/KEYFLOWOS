import { useState, useCallback } from "react";
import { API_BASE, getAuthHeaders } from "@/lib/api";

interface UploadMetadata {
  name: string;
  size: number;
  contentType: string;
}

interface UploadResponse {
  uploadURL: string;
  objectPath: string;
  metadata: UploadMetadata;
}

interface UseUploadOptions {
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Canonical endpoint for requesting a presigned upload URL.
 *
 * This is the auth-guarded Nest `UploadsController` route
 * (`apps/server/src/modules/uploads/uploads.controller.ts`). All upload
 * surfaces in the web app — `useUpload`, `ObjectUploader`, the avatar
 * picker, expense receipts, the social composer, business logo upload —
 * must funnel through this single path so future security/behavior
 * changes (auth headers, content-type allow-list, file-size cap, retries)
 * apply uniformly.
 */
const REQUEST_URL_PATH = "/uploads/request-url";

async function requestPresignedUrl(file: File): Promise<UploadResponse> {
  const response = await fetch(`${API_BASE}${REQUEST_URL_PATH}`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || "Failed to get upload URL");
  }

  return response.json();
}

/**
 * React hook for handling file uploads with presigned URLs.
 *
 * This hook implements the two-step presigned URL upload flow:
 * 1. Request a presigned URL from your backend (sends JSON metadata, NOT the file)
 * 2. Upload the file directly to the presigned URL
 *
 * Companion to the dependency-free `ObjectUploader` component. Neither this
 * hook nor that component pulls in Uppy / `@uppy/utils` / lodash anymore.
 */
export function useUpload(options: UseUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);

  const uploadToPresignedUrl = useCallback(
    async (file: File, uploadURL: string): Promise<void> => {
      const response = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to upload file to storage");
      }
    },
    [],
  );

  const uploadFile = useCallback(
    async (file: File): Promise<UploadResponse | null> => {
      setIsUploading(true);
      setError(null);
      setProgress(0);

      try {
        setProgress(10);
        const uploadResponse = await requestPresignedUrl(file);

        setProgress(30);
        await uploadToPresignedUrl(file, uploadResponse.uploadURL);

        setProgress(100);
        options.onSuccess?.(uploadResponse);
        return uploadResponse;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Upload failed");
        setError(error);
        options.onError?.(error);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [uploadToPresignedUrl, options],
  );

  /**
   * Get upload parameters for the `ObjectUploader` component.
   *
   * Receives a standard browser `File` and returns presigned PUT params.
   */
  const getUploadParameters = useCallback(
    async (
      file: File,
    ): Promise<{
      method: "PUT";
      url: string;
      headers?: Record<string, string>;
    }> => {
      const data = await requestPresignedUrl(file);
      return {
        method: "PUT",
        url: data.uploadURL,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      };
    },
    [],
  );

  return {
    uploadFile,
    getUploadParameters,
    isUploading,
    error,
    progress,
  };
}
