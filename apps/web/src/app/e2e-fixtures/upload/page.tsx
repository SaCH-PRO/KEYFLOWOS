"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import {
  ObjectUploader,
  type ObjectUploadResult,
} from "@/components/upload/ObjectUploader";
import { useUpload } from "@/hooks/use-upload";

/**
 * Test-only fixture page for the file-upload helpers.
 *
 * This page exists exclusively so the Playwright suite can drive
 * `ObjectUploader` + `useUpload` end-to-end and verify the presigned-PUT
 * flow keeps working. The previous Uppy implementation was patched to drop
 * its lodash dependency (see task #327); this fixture is the regression
 * canary so a future bundler change (or accidental reintroduction of an
 * unpatched dependency) fails CI loudly instead of silently breaking
 * uploads in production.
 *
 * Only available outside production builds. The route segment uses a
 * `e2e-fixtures/` prefix (rather than a `_`-prefixed Next.js "private"
 * folder) because private folders are excluded from routing entirely and
 * we need this page reachable from a browser in dev/CI.
 */
export default function E2EUploadFixturePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const [result, setResult] = useState<ObjectUploadResult | null>(null);
  const { getUploadParameters } = useUpload();

  return (
    <main style={{ padding: 24 }}>
      <h1>__e2e: upload fixture</h1>
      <ObjectUploader
        maxNumberOfFiles={1}
        maxFileSize={1024 * 1024}
        onGetUploadParameters={getUploadParameters}
        onComplete={(r) => setResult(r)}
      >
        <span data-testid="upload-button-label">Upload file</span>
      </ObjectUploader>
      <pre data-testid="upload-result">
        {result ? JSON.stringify(result, null, 2) : "(no result yet)"}
      </pre>
    </main>
  );
}
