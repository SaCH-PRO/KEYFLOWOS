"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { PostComposer, type ComposerSubmitData } from "@/app/app/marketing/components/social/post-composer";

/**
 * Test-only fixture for the media-upload flow inside `PostComposer`.
 *
 * The composer re-implements the presigned-PUT handshake inline in its
 * `uploadFile` callback (POST `/uploads/request-url` → PUT `uploadURL` →
 * stash the resulting `objectPath` into `mediaFiles`). When the user
 * submits, the composed payload's `mediaUrls` reflects every successful
 * upload. This fixture mounts the real composer with a stub `onSubmit`
 * that surfaces the payload via `data-testid` so the spec can verify
 * the bespoke upload path produced a usable URL.
 *
 * Only available outside production builds.
 */
export default function E2ESocialComposerUploadFixturePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const [submitted, setSubmitted] = useState<ComposerSubmitData | null>(null);

  return (
    <main style={{ padding: 24 }}>
      <h1 data-testid="fixture-title">__e2e: social composer fixture</h1>
      <PostComposer
        onSubmit={async (data) => {
          setSubmitted(data);
        }}
        onClose={() => {}}
        connections={[]}
      />
      <pre data-testid="submitted-payload">
        {submitted ? JSON.stringify(submitted) : "(not submitted)"}
      </pre>
    </main>
  );
}
