import { test, expect, type Route } from "@playwright/test";

/**
 * Regression coverage for the presigned-PUT upload flow.
 *
 * Background: task #327 dropped the lodash dependency that `@uppy/utils`,
 * `@uppy/core`, `@uppy/dashboard`, and `@uppy/provider-views` transitively
 * pulled in. The fix replaced the Uppy-based uploader with a small
 * dependency-free helper pair (`useUpload` + `ObjectUploader`). A future
 * Uppy bump, lodash advisory, or refactor that breaks the two-step
 * "request presigned URL → PUT to URL" handshake would silently regress
 * every upload surface (avatars, expense receipts, social composer, etc.).
 *
 * This spec drives the dedicated `/__e2e/upload` fixture page so the
 * helpers themselves are exercised — not just one consumer.
 */
test.describe("File upload — presigned PUT regression", () => {
  test("ObjectUploader + useUpload complete a presigned-PUT upload", async ({
    page,
  }) => {
    const presignedHost = "https://s3.test.local";
    const presignedPath = "/bucket/uploads/test-object";
    const presignedUrl = `${presignedHost}${presignedPath}?signature=abc123`;
    const objectPath = "/objects/uploads/test-object";

    let presignRequests = 0;
    let capturedPresignBody: Record<string, unknown> | null = null;

    await page.route("**/api/uploads/request-url", async (route: Route) => {
      const req = route.request();
      expect(req.method()).toBe("POST");
      expect(req.headers()["content-type"]).toContain("application/json");
      capturedPresignBody = JSON.parse(req.postData() ?? "{}");
      presignRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          uploadURL: presignedUrl,
          objectPath,
          metadata: {
            name: capturedPresignBody?.name,
            size: capturedPresignBody?.size,
            contentType: capturedPresignBody?.contentType,
          },
        }),
      });
    });

    let putRequests = 0;
    let capturedPutBytes: Buffer | null = null;
    let capturedPutContentType: string | null = null;

    await page.route(`${presignedHost}/**`, async (route: Route) => {
      const req = route.request();
      // Cross-origin PUTs may trigger a CORS preflight in some browser
      // configurations; answer it explicitly so the assertion below stays
      // focused on the real PUT.
      if (req.method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "PUT, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        });
        return;
      }
      expect(req.method()).toBe("PUT");
      capturedPutContentType = req.headers()["content-type"] ?? null;
      const body = req.postDataBuffer();
      capturedPutBytes = body ?? null;
      putRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "",
      });
    });

    await page.goto("/e2e-fixtures/upload");
    await expect(page.getByTestId("upload-button-label")).toBeVisible();
    await expect(page.getByTestId("upload-result")).toHaveText(
      "(no result yet)",
    );

    const fileBytes = Buffer.from("hello-uppy-regression", "utf8");
    await page.locator('input[type="file"]').setInputFiles({
      name: "tiny.txt",
      mimeType: "text/plain",
      buffer: fileBytes,
    });

    // The result <pre> updates only after both presign + PUT complete.
    await expect
      .poll(() => page.getByTestId("upload-result").innerText(), {
        timeout: 10_000,
      })
      .toContain("tiny.txt");

    // Step 1 — presign request was made with the correct JSON metadata.
    expect(presignRequests).toBe(1);
    expect(capturedPresignBody).toMatchObject({
      name: "tiny.txt",
      size: fileBytes.byteLength,
      contentType: "text/plain",
    });

    // Step 2 — PUT was made to the presigned URL with the raw file bytes
    // and the client-provided content type (the lodash-free shim must not
    // mangle either).
    expect(putRequests).toBe(1);
    expect(capturedPutContentType).toBe("text/plain");
    expect(capturedPutBytes).not.toBeNull();
    expect(capturedPutBytes!.equals(fileBytes)).toBe(true);

    // The component surfaced the success result with the presigned URL.
    const resultText = await page.getByTestId("upload-result").innerText();
    const parsed = JSON.parse(resultText);
    expect(parsed.failed).toEqual([]);
    expect(parsed.successful).toHaveLength(1);
    expect(parsed.successful[0]).toMatchObject({
      name: "tiny.txt",
      size: fileBytes.byteLength,
      type: "text/plain",
      uploadURL: presignedUrl,
    });
  });

  test("ObjectUploader reports failure when the presigned PUT 500s", async ({
    page,
  }) => {
    const presignedUrl = "https://s3.test.local/bucket/will-fail?sig=x";

    await page.route("**/api/uploads/request-url", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          uploadURL: presignedUrl,
          objectPath: "/objects/will-fail",
          metadata: { name: "x", size: 1, contentType: "text/plain" },
        }),
      });
    });

    await page.route("https://s3.test.local/**", async (route: Route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "PUT, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        });
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "boom",
      });
    });

    await page.goto("/e2e-fixtures/upload");
    await page.locator('input[type="file"]').setInputFiles({
      name: "x.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });

    await expect
      .poll(() => page.getByTestId("upload-result").innerText(), {
        timeout: 10_000,
      })
      .toContain("failed");

    const resultText = await page.getByTestId("upload-result").innerText();
    const parsed = JSON.parse(resultText);
    expect(parsed.successful).toEqual([]);
    expect(parsed.failed).toHaveLength(1);
    expect(parsed.failed[0].name).toBe("x.txt");
    expect(parsed.failed[0].error).toMatch(/500/);
  });
});
