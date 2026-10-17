import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The owner console's handoff viewer against the REAL protected endpoint
 * (KF-META-HANDOFF-MONITOR-001). Nothing is mocked: the page calls the
 * compiled server's handoff route, served on loopback by
 * apps/server/test/handoff-monitor-loopback.cjs over fixture data
 * (the real PR #177 chain plus a synthetic hostile set).
 *
 * It needs that loopback and a Next dev server pointed at it, so it runs only
 * when HANDOFF_LOOPBACK_TOKENS names the file the loopback wrote. See
 * docs/development/HANDOFF_MONITOR.md for the exact commands.
 */

const tokensFile = process.env.HANDOFF_LOOPBACK_TOKENS;
const screenshotDir = process.env.HANDOFF_SCREENSHOT_DIR ?? "test-results/handoffs";

test.skip(!tokensFile, "requires the handoff loopback (HANDOFF_LOOPBACK_TOKENS); see docs/development/HANDOFF_MONITOR.md");

const tokens = tokensFile ? (JSON.parse(fs.readFileSync(tokensFile, "utf8")) as { base: string; superAdmin: string; user: string }) : null;
const ROUTE = "/admin/mission-control/handoffs";
const SAFE_HREF = /^https:\/\/github\.com\/SaCH-PRO\/KEYFLOWOS\/(issues|pull)\/\d+(#(issuecomment|pullrequestreview)-\d+|#discussion_r\d+)?$/;

async function adminSession(page: Page, token: string, cachedRole = "SUPER_ADMIN") {
  await page.addInitScript(
    ([t, role]) => {
      window.localStorage.setItem("kf_admin_token", t);
      window.localStorage.setItem("kf_admin_user_cache", JSON.stringify({ id: "loopback", email: "owner@loopback.test", role }));
      window.localStorage.setItem("kf_auth_mode", "admin");
    },
    [token, cachedRole],
  );
}

function watchApi(page: Page) {
  const calls: Array<{ method: string; url: string; status?: number }> = [];
  page.on("request", (req) => {
    if (tokens && req.url().startsWith(tokens.base)) calls.push({ method: req.method(), url: req.url() });
  });
  page.on("response", (res) => {
    const hit = calls.find((c) => c.url === res.url() && c.status === undefined);
    if (hit) hit.status = res.status();
  });
  return calls;
}

test.describe("admin handoff viewer (loopback)", () => {
  test("SUPER_ADMIN sees the real #177 handoff: consumed, CHANGES_REQUIRED, six findings, no merge grant", async ({ page }) => {
    const calls = watchApi(page);
    await adminSession(page, tokens!.superAdmin);
    await page.goto(ROUTE);
    await page.getByTestId("handoff-task-6229439023").click();
    const detail = page.getByTestId("handoff-task-detail");
    await expect(detail.getByRole("heading", { name: "CG-DIR-IRP177-REVIEW-001" })).toBeVisible();

    for (const [stage, status] of [
      ["POSTED", "OBSERVED"],
      ["ACKNOWLEDGED", "OBSERVED"],
      ["WORKING_LAST_OBSERVED", "NOT_OBSERVED"],
      ["RETURNED", "OBSERVED"],
      ["RETURN_CONSUMED", "OBSERVED"],
      ["DECISION_RECORDED", "OBSERVED"],
    ]) {
      await expect(page.getByTestId(`handoff-stage-${stage}`)).toContainText(status);
    }
    await expect(page.getByTestId("handoff-stage-ACKNOWLEDGED")).toContainText("CC-ACK-IRP177-REVIEW-001");
    await expect(page.getByTestId("handoff-stage-RETURN_CONSUMED")).toContainText("CG-RECEIPT-IRP177-001");
    await expect(page.getByTestId("handoff-stage-DECISION_RECORDED")).toContainText("CHANGES_REQUIRED · EVIDENCE_ONLY");
    await expect(page.getByTestId("handoff-stage-WORKING_LAST_OBSERVED")).toContainText("Liveness: UNKNOWN");
    await expect(page.getByTestId("handoff-fact-review")).toContainText("CHANGES_REQUIRED");
    await expect(page.getByTestId("handoff-fact-review")).toContainText("Unresolved substantive findings: 6");
    await expect(page.getByTestId("handoff-fact-merge")).toContainText("NOT_GRANTED");
    await expect(page.getByTestId("handoff-fact-revision")).toContainText("Match: MATCH");
    await expect(page.getByTestId("handoff-fact-revision")).toContainText("SUPERSEDED");
    await expect(page.getByTestId("handoff-worker-status")).toHaveText("UNKNOWN");
    await expect(page.getByTestId("handoff-freshness")).toHaveText("FRESH");
    await expect(page.getByTestId("handoff-provenance")).toContainText("SaCH-PRO posts as");

    // The original evidence opens on GitHub.
    const ackLink = page.getByTestId("handoff-stage-ACKNOWLEDGED").getByRole("link");
    await expect(ackLink).toHaveAttribute("href", "https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6229470452");

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.method === "GET" || c.method === "OPTIONS")).toBe(true);
    expect(calls.some((c) => c.url.includes(tokens!.superAdmin))).toBe(false);
    expect(await page.content()).not.toContain(tokens!.superAdmin);

    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, "handoffs-irp177.png"), fullPage: true });
  });

  test("hostile published text stays text; unsafe links are not links; credential-shaped text is redacted", async ({ page }) => {
    await adminSession(page, tokens!.superAdmin);
    await page.goto(ROUTE);
    await page.getByTestId("handoff-task-9100000001").click();
    const detail = page.getByTestId("handoff-task-detail");
    await expect(detail.getByRole("heading", { name: "CG-REQ-HOSTILE-001" })).toBeVisible();
    for (const summary of await detail.locator("details > summary").all()) await summary.click();

    await expect(detail).toContainText("<script>window.__handoffXss = 'script';</script>");
    await expect(detail).toContainText("[REDACTED:bearer]");
    await expect(detail).not.toContainText("synthetic0credential0shaped0value0x9");
    await expect(detail).toContainText("unrecognised link (not opened)");
    expect(await detail.locator("script, img, iframe, object, embed").count()).toBe(0);
    for (const href of await detail.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href).toMatch(SAFE_HREF);
    }
    expect(await page.evaluate(() => (window as unknown as { __handoffXss?: string }).__handoffXss)).toBeUndefined();

    // Return without receipt: awaiting ChatGPT, never consumed by viewing it.
    await expect(page.getByTestId("handoff-stage-RETURNED")).toContainText("OBSERVED");
    await expect(page.getByTestId("handoff-stage-RETURN_CONSUMED")).toContainText("NOT_OBSERVED");
    await expect(page.getByTestId("handoff-fact-delivery")).toContainText("Pending: chatgpt");
    await expect(page.getByTestId("handoff-fact-merge")).toContainText("NOT_GRANTED");
    // The wrong-recipient ACK is shown as a mismatch, not as acknowledgement evidence.
    await expect(page.getByTestId("handoff-mismatched")).toContainText("WRONG_SENDER");
    await expect(page.getByTestId("handoff-stage-ACKNOWLEDGED")).toContainText("CC-ACK-HOSTILE-001");
    // An edited allowlisted comment makes the authority record unverifiable, and says so.
    await expect(page.getByTestId("handoff-source-bar")).toContainText("AUTHORITY_EDITED");
    await expect(page.getByTestId("handoff-unmatched")).toContainText("NOT_USABLE_EVIDENCE");

    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, "handoffs-hostile.png"), fullPage: true });
  });

  test("a browser that claims SUPER_ADMIN with a USER token gets no data", async ({ page }) => {
    const calls = watchApi(page);
    await adminSession(page, tokens!.user, "SUPER_ADMIN");
    await page.goto(ROUTE);
    await expect(page.getByTestId("handoff-error")).toBeVisible();
    await expect(page.getByTestId("handoff-task-list")).toHaveCount(0);
    expect(await page.content()).not.toContain("CG-DIR-IRP177-REVIEW-001");
    expect(calls.filter((c) => c.method === "GET").every((c) => c.status === 403)).toBe(true);
  });

  test("no session is sent to the admin login and receives no data", async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForURL("**/admin/login");
    expect(await page.content()).not.toContain("CG-DIR-IRP177-REVIEW-001");
    const direct = await page.request.get(`${tokens!.base}/api/admin/mission-control/handoffs`);
    expect(direct.status()).toBe(401);
  });

  test("refreshes about every 15 s while visible and pauses while hidden", async ({ page }) => {
    await page.clock.install();
    const calls = watchApi(page);
    await adminSession(page, tokens!.superAdmin);
    await page.goto(ROUTE);
    await expect(page.getByTestId("handoff-task-detail")).toBeVisible();
    const gets = () => calls.filter((c) => c.method === "GET").length;

    const before = gets();
    await page.clock.runFor(16_000);
    await expect.poll(gets).toBeGreaterThan(before);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hidden = gets();
    await page.clock.runFor(60_000);
    await page.waitForTimeout(500);
    expect(gets()).toBe(hidden);
  });
});
