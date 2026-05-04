"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import PersonalInfoSection from "@/app/app/profile/components/personal-info-section";

/**
 * Test-only fixture for the avatar-upload flow inside `PersonalInfoSection`.
 *
 * That component re-implements the presigned-PUT handshake inline (it does
 * NOT use the canonical `useUpload` + `ObjectUploader` pair covered by
 * `e2e-fixtures/upload`), so a refactor that breaks its bespoke
 * `fetch /uploads/request-url` → `PUT uploadURL` → `PATCH /identity/me`
 * sequence would slip through CI without coverage. This fixture mounts
 * the real component with stub callbacks so the Playwright spec can drive
 * the actual `<input type="file">` and observe the upload completing.
 *
 * Only available outside production builds.
 */
export default function E2EAvatarUploadFixturePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const [savedAvatar, setSavedAvatar] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );

  return (
    <main style={{ padding: 24 }}>
      <h1 data-testid="fixture-title">__e2e: avatar upload fixture</h1>
      <PersonalInfoSection
        initialData={{
          email: "e2e@example.com",
          name: "E2E User",
          firstName: "E2E",
          lastName: "User",
          phone: "",
        }}
        avatarUrl={savedAvatar}
        onSaved={(_form, newAvatar) => setSavedAvatar(newAvatar ?? null)}
        onStatus={(s) => setStatus(s)}
      />
      <pre data-testid="upload-status">
        {status ? JSON.stringify(status) : "(no status)"}
      </pre>
      <pre data-testid="saved-avatar">{savedAvatar ?? "(no avatar)"}</pre>
    </main>
  );
}
