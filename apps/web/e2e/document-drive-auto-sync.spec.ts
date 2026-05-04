import { test, expect, type Route } from "@playwright/test";
import {
  mockBaseLayout,
  seedWorkspace,
  TEST_BUSINESS_ID,
} from "./helpers/workspace";

const INSTANCE_ID = "doc_e2e_1";
const DRIVE_FILE_ID = "drive_file_abc";

interface DocSection {
  id: string;
  sectionKey: string;
  sectionName: string;
  content: string;
  contentSource: string;
  editableMode: string;
  riskScore: string;
  reviewRequired: boolean;
  lastModifiedBy: string | null;
  approvedBy: string | null;
  sortOrder: number;
}

interface DocInstance {
  id: string;
  title: string;
  status: string;
  healthStatus: string;
  healthReason: string | null;
  currentVersionNum: number;
  contextInputs: Record<string, string> | null;
  toneSettings: Record<string, string> | null;
  generationMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  driveFileId: string | null;
  driveFileName: string | null;
  driveFileMimeType: string | null;
  driveLastSyncedAt: string | null;
  documentType: { name: string; slug: string; riskTier: string; category: { name: string } };
  sections: DocSection[];
  versions: unknown[];
  reviewTasks: unknown[];
  changeLogs: unknown[];
}

function buildDoc(overrides: Partial<DocInstance> = {}): DocInstance {
  return {
    id: INSTANCE_ID,
    title: "Service Agreement",
    status: "DRAFT",
    healthStatus: "HEALTHY",
    healthReason: null,
    currentVersionNum: 1,
    contextInputs: null,
    toneSettings: null,
    generationMeta: null,
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    driveFileId: DRIVE_FILE_ID,
    driveFileName: "Service Agreement.gdoc",
    driveFileMimeType: "application/vnd.google-apps.document",
    driveLastSyncedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    documentType: {
      name: "Service Agreement",
      slug: "service-agreement",
      riskTier: "GREEN",
      category: { name: "Legal" },
    },
    sections: [
      {
        id: "sec_1",
        sectionKey: "intro",
        sectionName: "Introduction",
        content: "Original intro content.",
        contentSource: "AI_GENERATED",
        editableMode: "EDITABLE",
        riskScore: "GREEN",
        reviewRequired: false,
        lastModifiedBy: null,
        approvedBy: null,
        sortOrder: 0,
      },
    ],
    versions: [],
    reviewTasks: [],
    changeLogs: [],
    ...overrides,
  };
}

test.describe("Document Drive auto-sync", () => {
  // Next dev (Turbopack) can be slow to compile dynamic routes the first
  // time they are hit, so give each test extra room.
  test.setTimeout(60_000);

  test.beforeEach(async ({ page, context, baseURL }) => {
    await seedWorkspace(context);
    // The /app/* routes are gated by the edge middleware (apps/web/src/proxy.ts)
    // on the presence of the kf_token cookie — set it so we don't get
    // bounced to /auth/login.
    const url = new URL(baseURL ?? "http://localhost:5000");
    await context.addCookies([
      {
        name: "kf_token",
        value: "test-token-e2e",
        domain: url.hostname,
        path: "/",
      },
    ]);
    await mockBaseLayout(page);

    await page.route(
      `**/drive/businesses/${TEST_BUSINESS_ID}/status`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ connected: true, email: "e2e@example.com" }),
        }),
    );
  });

  test("cycles status pill through pending → syncing → synced after a section save", async ({ page }) => {
    let currentDoc = buildDoc();
    let exportCalls = 0;
    let writeCalls = 0;
    let syncedCalls = 0;
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    await page.route(
      `**/documents/businesses/${TEST_BUSINESS_ID}/instances/${INSTANCE_ID}**`,
      async (route: Route) => {
        const url = route.request().url();
        const method = route.request().method();

        if (url.includes("/sections/") && method === "PATCH") {
          const body = JSON.parse(route.request().postData() ?? "{}") as { content?: string };
          currentDoc = buildDoc({
            sections: [
              { ...currentDoc.sections[0], content: body.content ?? "" },
            ],
          });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentDoc),
          });
          return;
        }

        if (url.includes("/drive-synced") && method === "PATCH") {
          syncedCalls += 1;
          currentDoc = buildDoc({
            sections: currentDoc.sections,
            driveLastSyncedAt: new Date().toISOString(),
          });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentDoc),
          });
          return;
        }

        if (method === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentDoc),
          });
          return;
        }

        await route.fallback();
      },
    );

    await page.route(
      `**/drive/businesses/${TEST_BUSINESS_ID}/export-html`,
      async (route: Route) => {
        exportCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ html: "<html><body>doc</body></html>" }),
        });
      },
    );

    await page.route(
      `**/drive/businesses/${TEST_BUSINESS_ID}/files/${DRIVE_FILE_ID}/content`,
      async (route: Route) => {
        writeCalls += 1;
        await writeGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ fileId: DRIVE_FILE_ID, webViewLink: "https://drive.example/abc" }),
        });
      },
    );

    await page.goto(`/app/documents/${INSTANCE_ID}`);

    await expect(page.getByRole("heading", { name: "Service Agreement" })).toBeVisible({ timeout: 30_000 });

    // Edit the intro section.
    await page.getByTitle("Edit section").first().click();
    const textarea = page.locator("textarea").first();
    await textarea.fill("Updated intro content for sync test.");

    // Save the section — this should schedule the auto-sync.
    await page.locator("button:has(svg.lucide-save)").first().click();

    // Status pill should appear in "pending" state (after debounce window).
    await expect(page.getByText("Saving soon…")).toBeVisible();

    // Once the debounce expires, syncing begins (we hold the write open).
    await expect(page.getByText("Saving to Drive…")).toBeVisible({ timeout: 5_000 });

    // Now release the Drive write to let the flow complete.
    releaseWrite();

    await expect(page.getByText("Saved to Drive")).toBeVisible();

    expect(exportCalls).toBe(1);
    expect(writeCalls).toBe(1);
    expect(syncedCalls).toBe(1);
  });

  test("shows the failure state when the Drive write fails", async ({ page }) => {
    let currentDoc = buildDoc();

    await page.route(
      `**/documents/businesses/${TEST_BUSINESS_ID}/instances/${INSTANCE_ID}**`,
      async (route: Route) => {
        const url = route.request().url();
        const method = route.request().method();

        if (url.includes("/sections/") && method === "PATCH") {
          const body = JSON.parse(route.request().postData() ?? "{}") as { content?: string };
          currentDoc = buildDoc({
            sections: [{ ...currentDoc.sections[0], content: body.content ?? "" }],
          });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentDoc),
          });
          return;
        }

        if (method === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentDoc),
          });
          return;
        }

        await route.fallback();
      },
    );

    await page.route(
      `**/drive/businesses/${TEST_BUSINESS_ID}/export-html`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ html: "<html><body>doc</body></html>" }),
        }),
    );

    // Simulate a Drive disconnection / write failure. We use 503 (not 401)
    // because a 401 would trigger the global `kf:unauthorized` handler in
    // `RequireAuth` and redirect us to the login page before the failure
    // pill ever rendered.
    await page.route(
      `**/drive/businesses/${TEST_BUSINESS_ID}/files/${DRIVE_FILE_ID}/content`,
      (route: Route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Drive disconnected" }),
        }),
    );

    await page.goto(`/app/documents/${INSTANCE_ID}`);
    await expect(page.getByRole("heading", { name: "Service Agreement" })).toBeVisible({ timeout: 30_000 });

    await page.getByTitle("Edit section").first().click();
    await page.locator("textarea").first().fill("Edit that will fail to sync.");
    await page.locator("button:has(svg.lucide-save)").first().click();

    await expect(page.getByText("Sync failed")).toBeVisible({ timeout: 8_000 });
  });

  test("coalesces rapid successive saves into a single sync", async ({ page }) => {
    let currentDoc = buildDoc();
    let exportCalls = 0;
    let writeCalls = 0;

    await page.route(
      `**/documents/businesses/${TEST_BUSINESS_ID}/instances/${INSTANCE_ID}**`,
      async (route: Route) => {
        const url = route.request().url();
        const method = route.request().method();

        if (url.includes("/sections/") && method === "PATCH") {
          const body = JSON.parse(route.request().postData() ?? "{}") as { content?: string };
          currentDoc = buildDoc({
            sections: [{ ...currentDoc.sections[0], content: body.content ?? "" }],
          });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentDoc),
          });
          return;
        }

        if (url.includes("/drive-synced") && method === "PATCH") {
          currentDoc = buildDoc({
            sections: currentDoc.sections,
            driveLastSyncedAt: new Date().toISOString(),
          });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentDoc),
          });
          return;
        }

        if (method === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentDoc),
          });
          return;
        }

        await route.fallback();
      },
    );

    await page.route(
      `**/drive/businesses/${TEST_BUSINESS_ID}/export-html`,
      async (route: Route) => {
        exportCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ html: "<html><body>doc</body></html>" }),
        });
      },
    );

    await page.route(
      `**/drive/businesses/${TEST_BUSINESS_ID}/files/${DRIVE_FILE_ID}/content`,
      async (route: Route) => {
        writeCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ fileId: DRIVE_FILE_ID }),
        });
      },
    );

    await page.goto(`/app/documents/${INSTANCE_ID}`);
    await expect(page.getByRole("heading", { name: "Service Agreement" })).toBeVisible({ timeout: 30_000 });

    // Three rapid edits within the debounce window (1.5s).
    for (let i = 0; i < 3; i += 1) {
      await page.getByTitle("Edit section").first().click();
      await page.locator("textarea").first().fill(`Rapid edit ${i + 1}`);
      await page.locator("button:has(svg.lucide-save)").first().click();
      // Brief pause < debounce so the timer keeps resetting.
      await page.waitForTimeout(200);
    }

    // After the debounce settles, exactly ONE sync should have run.
    await expect(page.getByText("Saved to Drive")).toBeVisible({ timeout: 8_000 });

    expect(exportCalls).toBe(1);
    expect(writeCalls).toBe(1);
  });
});
