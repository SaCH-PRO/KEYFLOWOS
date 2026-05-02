import { test, expect, type Route } from "@playwright/test";
import ExcelJS from "exceljs";
import {
  mockBaseLayout,
  mockCatchAll,
  seedWorkspace,
  TEST_BUSINESS_ID,
} from "./helpers/workspace";

const PRODUCTS = [
  { id: "prod_widget", name: "Acme, Inc Widget", sku: "WID-001" },
  { id: "prod_gadget", name: "Gadget Plus", sku: "00042" },
  { id: "prod_unused", name: "Unused Item", sku: "UNUSED" },
];

const WAREHOUSES = [
  { id: "wh_main", name: "Main Warehouse", isActive: true },
];

async function buildSourceWorkbook(): Promise<Buffer> {
  // Build an .xlsx that exercises a few tricky cell shapes:
  //  - a value that contains a comma (must survive normalization to xlsx, not be split)
  //  - a numeric-as-string SKU with a leading zero (must not be coerced to a number/lose the zero)
  //  - a fully blank trailing row that must not generate a phantom import
  // Also use a non-canonical column order + extra unrelated column to force the user
  // to walk through the column-mapping wizard.
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Stock");

  sheet.addRow([
    "Product Name",
    "Item Code", // -> SKU
    "Location", //  -> Warehouse
    "On Hand", //   -> Quantity On Hand
    "Reorder Level",
    "Notes", //     unmapped
  ]);

  sheet.addRow([
    "Acme, Inc Widget",
    "WID-001",
    "Main Warehouse",
    25,
    5,
    "Comma in the name",
  ]);

  // Numeric-as-string SKU: keep leading zeros by storing as text.
  const numericRow = sheet.addRow([
    "Gadget Plus",
    "00042",
    "Main Warehouse",
    10,
    2,
    "Numeric-as-string SKU",
  ]);
  // Force the SKU cell to be treated as text to preserve leading zeros.
  numericRow.getCell(2).numFmt = "@";

  // Blank trailing row — should be ignored, not counted as an import or skip.
  sheet.addRow(["", "", "", "", "", ""]);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/**
 * Pull the raw .xlsx bytes back out of a multipart/form-data POST body.
 * The body looks like:
 *   --<boundary>\r\n
 *   Content-Disposition: form-data; name="file"; filename="inventory.xlsx"\r\n
 *   Content-Type: application/vnd.openxmlformats-...\r\n
 *   \r\n
 *   <file bytes>\r\n
 *   --<boundary>--\r\n
 */
function extractFilePartFromMultipart(body: Buffer, boundary: string): Buffer {
  const delimiter = Buffer.from(`--${boundary}`);
  const closing = Buffer.from(`--${boundary}--`);

  const start = body.indexOf(delimiter);
  if (start === -1) throw new Error("multipart: opening boundary not found");

  const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
  if (headerEnd === -1) throw new Error("multipart: header terminator not found");
  const fileStart = headerEnd + 4;

  // The file ends right before "\r\n--<boundary>". Look for either the next
  // part boundary or the closing boundary.
  const nextBoundary = body.indexOf(delimiter, fileStart);
  if (nextBoundary === -1) throw new Error("multipart: closing boundary not found");
  const fileEnd = nextBoundary - 2; // strip the trailing \r\n that precedes the boundary

  // sanity: ensure we found *some* boundary (either inner or closing)
  if (
    body.indexOf(closing, fileStart) === -1 &&
    body.indexOf(delimiter, fileStart) === -1
  ) {
    throw new Error("multipart: no terminating boundary");
  }

  return body.subarray(fileStart, fileEnd);
}

test.describe("Inventory → Spreadsheets → Excel import wizard", () => {
  test.beforeEach(async ({ page, context }) => {
    await seedWorkspace(context);
    await mockBaseLayout(page);
  });

  test("uploads an .xlsx, walks the column mapper, and imports a normalized workbook", async ({
    page,
  }) => {
    // ---- API mocks for the marketplace page ----
    // Register the catch-all FIRST so the more specific routes below win
    // (Playwright matches routes in reverse-registration order).
    await mockCatchAll(page);

    // Note the trailing `**` — apiGet appends a `?_t=…` cache-buster, and
    // Playwright's URL glob is matched against the full URL (path + query).
    const commercePath = `**/commerce/businesses/${TEST_BUSINESS_ID}/products**`;
    const warehousesPath = `**/marketplace/businesses/${TEST_BUSINESS_ID}/warehouses**`;
    const driveStatusPath = `**/drive/businesses/${TEST_BUSINESS_ID}/inventory-sheet/status**`;
    const importPath = `**/marketplace/businesses/${TEST_BUSINESS_ID}/inventory/import-excel`;

    await page.route(commercePath, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: PRODUCTS }),
      }),
    );

    await page.route(warehousesPath, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(WAREHOUSES),
      }),
    );

    // The inventory list (`/marketplace/businesses/:id/inventory`) is
    // intentionally not stubbed here — the catch-all returns `[]` for any
    // unhandled GET, which is the empty-state we want for this test.

    await page.route(driveStatusPath, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        // `connected: false` keeps the Sheets section in its default (no-op) state
        // so we can focus on the Excel import card.
        body: JSON.stringify({ connected: false, linkedSheetId: null }),
      }),
    );

    // ---- The endpoint under test: capture the upload, validate the normalized
    // workbook, then return a deterministic import result. ----
    let importInvocations = 0;
    let capturedHeaders: string[] = [];
    let capturedRowValues: string[][] = [];

    await page.route(importPath, async (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      importInvocations += 1;

      const contentType = route.request().headers()["content-type"] ?? "";
      const boundaryMatch = contentType.match(/boundary=(.+)$/);
      expect(boundaryMatch, `expected multipart content-type, got: ${contentType}`).toBeTruthy();
      const boundary = boundaryMatch![1];

      const raw = route.request().postDataBuffer();
      expect(raw, "expected the request to have a body").toBeTruthy();

      const fileBytes = extractFilePartFromMultipart(raw!, boundary);

      // Parse the workbook the client actually uploaded.
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(fileBytes as unknown as ArrayBuffer);
      const sheet = wb.worksheets[0];
      expect(sheet, "uploaded workbook had no worksheet").toBeTruthy();

      const headerRow = sheet!.getRow(1);
      capturedHeaders = [];
      for (let c = 1; c <= sheet!.columnCount; c++) {
        capturedHeaders.push(String(headerRow.getCell(c).value ?? "").trim());
      }

      capturedRowValues = [];
      for (let r = 2; r <= sheet!.rowCount; r++) {
        const row = sheet!.getRow(r);
        const arr: string[] = [];
        for (let c = 1; c <= sheet!.columnCount; c++) {
          arr.push(String(row.getCell(c).value ?? ""));
        }
        capturedRowValues.push(arr);
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ imported: 2, skipped: 0, errors: [] }),
      });
    });

    // ---- Drive the UI ----
    await page.goto("/app/marketplace");

    // Outer marketplace tabs are rendered as role="tab"; inner inventory
    // sub-tabs ("Overview", "Spreadsheets", ...) are plain <button>s.
    await page.getByRole("tab", { name: /^Inventory$/ }).click();
    await page.getByRole("button", { name: /^Spreadsheets$/ }).click();

    await expect(
      page.getByRole("heading", { name: "Excel Import / Export" }),
    ).toBeVisible();

    const sourceXlsx = await buildSourceWorkbook();

    // The "Import Excel" trigger is a hidden <input type="file"> wrapped in a
    // <label>; setInputFiles works on hidden inputs.
    const fileInput = page.locator('input[type="file"][accept=".xlsx,.xls"]');
    await fileInput.setInputFiles({
      name: "stock.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: sourceXlsx,
    });

    // The mapping wizard appears.
    await expect(page.getByText("Column Mapping")).toBeVisible();
    await expect(page.getByText("File:")).toBeVisible();
    await expect(page.getByText("stock.xlsx")).toBeVisible();

    // The auto-mapper matches headers case-insensitively. Our source workbook
    // uses non-canonical names ("Item Code", "Location", "On Hand"), so those
    // expected fields will be left unmapped and we have to wire them up by hand.
    // Confirm the source's column header is actually offered as an option.
    await expect(page.getByRole("option", { name: "Item Code" }).first()).toBeAttached();

    // Each expected column has its own <select>; they appear in the same order
    // as EXPECTED_COLUMNS in the component:
    //   [SKU, Product Name, Warehouse, Quantity On Hand, Reserved, Reorder Level, Cost Per Unit, Currency]
    // The mapping wizard is the only thing on the spreadsheets tab that
    // renders <select> elements, so a flat locator is unambiguous here.
    const selects = page.locator("select");
    await expect(selects).toHaveCount(8);
    // Map the four columns we care about.
    await selects.nth(0).selectOption("Item Code"); // SKU
    await selects.nth(1).selectOption("Product Name"); // Product Name
    await selects.nth(2).selectOption("Location"); // Warehouse
    await selects.nth(3).selectOption("On Hand"); // Quantity On Hand
    await selects.nth(5).selectOption("Reorder Level"); // Reorder Level

    // Preview rows render the source workbook's rows verbatim — the comma
    // value must NOT be split across cells.
    await expect(page.getByText("Acme, Inc Widget")).toBeVisible();
    await expect(page.getByText("00042")).toBeVisible();

    // Apply the mapping → triggers the upload.
    await page.getByRole("button", { name: /Import with Mapping/ }).click();

    // Server (mock) reports 2 imported / 0 skipped.
    await expect(
      page.getByText(/Import complete: 2 imported, 0 skipped/),
    ).toBeVisible();

    // The wizard collapses after a successful import.
    await expect(page.getByText("Column Mapping")).toHaveCount(0);

    // The import endpoint was called exactly once.
    expect(importInvocations).toBe(1);

    // ---- Validate the *normalized* workbook the client actually sent ----
    expect(capturedHeaders).toEqual([
      "SKU",
      "Product Name",
      "Warehouse",
      "Quantity On Hand",
      "Reserved",
      "Reorder Level",
      "Cost Per Unit",
      "Currency",
    ]);

    // The blank trailing row must have been dropped, leaving exactly the two
    // real product rows.
    expect(capturedRowValues).toHaveLength(2);

    const widgetRow = capturedRowValues.find((r) => r[1] === "Acme, Inc Widget");
    expect(widgetRow, "expected the comma-bearing row to round-trip intact").toBeTruthy();
    expect(widgetRow![0]).toBe("WID-001");
    expect(widgetRow![2]).toBe("Main Warehouse");
    expect(widgetRow![3]).toBe("25");
    expect(widgetRow![5]).toBe("5");
    // Reserved / Cost / Currency were not mapped → they stay empty in the
    // normalized workbook.
    expect(widgetRow![4]).toBe("");
    expect(widgetRow![6]).toBe("");
    expect(widgetRow![7]).toBe("");

    const gadgetRow = capturedRowValues.find((r) => r[1] === "Gadget Plus");
    expect(
      gadgetRow,
      "expected the numeric-as-string SKU row to round-trip intact",
    ).toBeTruthy();
    // Critical: the leading zero on the SKU must be preserved end-to-end.
    expect(gadgetRow![0]).toBe("00042");
    expect(gadgetRow![3]).toBe("10");
  });
});
