import { test, expect, type Route } from "@playwright/test";

/**
 * Coverage for the three production upload surfaces that re-implement the
 * presigned-PUT handshake inline rather than going through the canonical
 * `useUpload` + `ObjectUploader` helpers (already covered by
 * `upload-presigned-put.spec.ts`):
 *
 *   1. Avatar upload  — `personal-info-section.tsx`
 *      POST /uploads/request-url  → PUT uploadURL → PATCH /identity/me
 *
 *   2. Expense receipt — `expense-form-modal.tsx`
 *      POST /businesses/:id/uploads/request-url → PUT uploadUrl
 *      (note: this surface uses a *different* presign route shape than
 *      the rest of the app — it returns `{uploadUrl, publicUrl}` rather
 *      than `{uploadURL, objectPath}`)
 *
 *   3. Social composer media — `post-composer.tsx`
 *      POST /uploads/request-url → PUT uploadURL → exposed via mediaUrls
 *      on the composer's submit payload.
 *
 * Each test mounts the real component via a dev-only `e2e-fixtures/*`
 * page so the actual production code path is exercised, then mocks the
 * presign endpoint + the cross-origin S3 PUT and asserts the upload
 * propagated into the component's surfaced state.
 */

const PRESIGN_HOST = "https://s3.test.local";

interface PresignMock {
  /** Glob the presign route should match. */
  routeGlob: string;
  /** Body to fulfill the presign request with. */
  buildResponse: (req: {
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }) => string;
}

async function mockPresignAndPut(opts: {
  page: import("@playwright/test").Page;
  presign: PresignMock;
  presignedUrl: string;
  onPresign?: (body: Record<string, unknown>) => void;
  onPut?: (info: { contentType: string | null; bytes: Buffer | null }) => void;
}) {
  await opts.page.route(opts.presign.routeGlob, async (route: Route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
    opts.onPresign?.(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: opts.presign.buildResponse({
        method: req.method(),
        headers: req.headers(),
        body,
      }),
    });
  });

  await opts.page.route(`${PRESIGN_HOST}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "PUT, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
        },
      });
      return;
    }
    const buf = req.postDataBuffer();
    opts.onPut?.({
      contentType: req.headers()["content-type"] ?? null,
      bytes: buf ?? null,
    });
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "",
    });
  });
}

test.describe("Real upload surfaces — bespoke presigned-PUT flows", () => {
  test("avatar upload (PersonalInfoSection) completes presign + PUT + PATCH", async ({
    page,
  }) => {
    const presignedUrl = `${PRESIGN_HOST}/avatars/avatar.png?sig=avatar`;
    const objectPath = "/objects/avatars/avatar.png";

    let presignBody: Record<string, unknown> | null = null;
    let putContentType: string | null = null;
    let putBytes: Buffer | null = null;
    let patchedAvatar: string | null = null;

    await mockPresignAndPut({
      page,
      presign: {
        routeGlob: "**/uploads/request-url",
        buildResponse: ({ body }) =>
          JSON.stringify({
            uploadURL: presignedUrl,
            objectPath,
            metadata: {
              name: body.name,
              size: body.size,
              contentType: body.contentType,
            },
          }),
      },
      presignedUrl,
      onPresign: (b) => {
        presignBody = b;
      },
      onPut: ({ contentType, bytes }) => {
        putContentType = contentType;
        putBytes = bytes;
      },
    });

    await page.route("**/identity/me", async (route: Route) => {
      const req = route.request();
      expect(req.method()).toBe("PATCH");
      const body = JSON.parse(req.postData() ?? "{}") as { avatarUrl?: string };
      patchedAvatar = body.avatarUrl ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "user_e2e",
          email: "e2e@example.com",
          name: "E2E User",
          firstName: "E2E",
          lastName: "User",
          avatarUrl: body.avatarUrl,
        }),
      });
    });

    await page.goto("/e2e-fixtures/avatar-upload");
    await expect(page.getByTestId("fixture-title")).toBeVisible();

    const fileBytes = Buffer.from("avatar-bytes", "utf8");
    await page.locator('input[type="file"]').setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: fileBytes,
    });

    await expect
      .poll(() => page.getByTestId("upload-status").innerText(), { timeout: 10_000 })
      .toContain("Avatar updated");

    expect(presignBody).toMatchObject({
      name: "avatar.png",
      size: fileBytes.byteLength,
      contentType: "image/png",
    });
    expect(putContentType).toBe("image/png");
    expect(putBytes).not.toBeNull();
    expect(putBytes!.equals(fileBytes)).toBe(true);
    expect(patchedAvatar).toBe(objectPath);
    await expect(page.getByTestId("saved-avatar")).toHaveText(objectPath);
  });

  test("expense receipt upload (ExpenseFormModal) presigns and PUTs the file", async ({
    page,
  }) => {
    const businessId = "biz_e2e_expense_fixture";
    const presignedUrl = `${PRESIGN_HOST}/receipts/receipt.pdf?sig=receipt`;
    const publicUrl = `${PRESIGN_HOST}/receipts/receipt.pdf`;

    let presignBody: Record<string, unknown> | null = null;
    let putContentType: string | null = null;
    let putBytes: Buffer | null = null;

    await mockPresignAndPut({
      page,
      presign: {
        routeGlob: `**/businesses/${businessId}/uploads/request-url`,
        buildResponse: () =>
          JSON.stringify({ uploadUrl: presignedUrl, publicUrl }),
      },
      presignedUrl,
      onPresign: (b) => {
        presignBody = b;
      },
      onPut: ({ contentType, bytes }) => {
        putContentType = contentType;
        putBytes = bytes;
      },
    });

    await page.goto("/e2e-fixtures/expense-receipt-upload");
    await expect(page.getByTestId("fixture-title")).toBeVisible();

    const fileBytes = Buffer.from("%PDF-1.4 fake receipt", "utf8");
    await page.locator('input[type="file"]').setInputFiles({
      name: "receipt.pdf",
      mimeType: "application/pdf",
      buffer: fileBytes,
    });

    // The "Receipt attached" badge appears once the bespoke upload finishes
    // and writes the publicUrl back into the modal's form state.
    await expect(page.getByText("Receipt attached")).toBeVisible({
      timeout: 10_000,
    });

    expect(presignBody).toMatchObject({
      fileName: "receipt.pdf",
      contentType: "application/pdf",
    });
    expect(putContentType).toBe("application/pdf");
    expect(putBytes).not.toBeNull();
    expect(putBytes!.equals(fileBytes)).toBe(true);
  });

  test("social composer media upload (PostComposer) attaches uploaded objectPath to submit payload", async ({
    page,
  }) => {
    const presignedUrl = `${PRESIGN_HOST}/media/photo.jpg?sig=media`;
    const objectPath = "/objects/media/photo.jpg";

    let presignBody: Record<string, unknown> | null = null;
    let putContentType: string | null = null;
    let putBytes: Buffer | null = null;

    await mockPresignAndPut({
      page,
      presign: {
        routeGlob: "**/uploads/request-url",
        buildResponse: ({ body }) =>
          JSON.stringify({
            uploadURL: presignedUrl,
            objectPath,
            metadata: {
              name: body.name,
              size: body.size,
              contentType: body.contentType,
            },
          }),
      },
      presignedUrl,
      onPresign: (b) => {
        presignBody = b;
      },
      onPut: ({ contentType, bytes }) => {
        putContentType = contentType;
        putBytes = bytes;
      },
    });

    await page.goto("/e2e-fixtures/social-composer-upload");
    await expect(page.getByTestId("fixture-title")).toBeVisible();

    const fileBytes = Buffer.from("\xff\xd8\xff fake-jpeg", "binary");
    await page.locator('input[type="file"]').setInputFiles({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: fileBytes,
    });

    // The composer marks the file `uploading: true` until the bespoke
    // PUT completes. Type content first so the "Save Draft" button is
    // gated only on `isUploading` flipping back to false, then wait for
    // the button to enable — that's the user-observable signal that the
    // bespoke upload helper resolved successfully.
    await page.locator("textarea").fill("Hello from e2e regression");
    const saveDraftBtn = page.getByRole("button", { name: "Save Draft" });
    await expect(saveDraftBtn).toBeEnabled({ timeout: 10_000 });

    expect(presignBody).toMatchObject({
      name: "photo.jpg",
      contentType: "image/jpeg",
      size: fileBytes.byteLength,
    });
    expect(putContentType).toBe("image/jpeg");
    expect(putBytes).not.toBeNull();
    expect(putBytes!.equals(fileBytes)).toBe(true);

    await saveDraftBtn.click();

    await expect
      .poll(() => page.getByTestId("submitted-payload").innerText(), {
        timeout: 5_000,
      })
      .toContain(objectPath);

    const payload = JSON.parse(
      await page.getByTestId("submitted-payload").innerText(),
    ) as { mediaUrls?: string[] };
    expect(payload.mediaUrls).toEqual([objectPath]);
  });
});
