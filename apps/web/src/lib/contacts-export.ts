import type { LocalContact } from "./contacts-db";

const EXPORT_COLUMNS = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "displayName", label: "Display Name" },
  { key: "email", label: "Email" },
  { key: "secondaryEmail", label: "Secondary Email" },
  { key: "phone", label: "Phone" },
  { key: "secondaryPhone", label: "Secondary Phone" },
  { key: "whatsappNumber", label: "WhatsApp" },
  { key: "status", label: "Status" },
  { key: "companyName", label: "Company" },
  { key: "jobTitle", label: "Job Title" },
  { key: "department", label: "Department" },
  { key: "industry", label: "Industry" },
  { key: "segment", label: "Segment" },
  { key: "source", label: "Source" },
  { key: "tags", label: "Tags" },
  { key: "addressLine1", label: "Address Line 1" },
  { key: "addressLine2", label: "Address Line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postalCode", label: "Postal Code" },
  { key: "country", label: "Country" },
  { key: "timezone", label: "Timezone" },
  { key: "language", label: "Language" },
  { key: "preferredChannel", label: "Preferred Channel" },
  { key: "lifecycleStage", label: "Lifecycle Stage" },
  { key: "marketingOptIn", label: "Marketing Opt-In" },
  { key: "doNotContact", label: "Do Not Contact" },
  { key: "notesInternal", label: "Internal Notes" },
  { key: "createdAt", label: "Created" },
] as const;

function contactToRow(c: LocalContact): Record<string, string> {
  const row: Record<string, string> = {};
  for (const col of EXPORT_COLUMNS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inherited untyped data — pending typed contract
    const val = (c as any)[col.key];
    if (col.key === "tags") {
      row[col.label] = Array.isArray(val) ? val.join(", ") : "";
    } else if (col.key === "createdAt" && val) {
      row[col.label] = new Date(val).toLocaleDateString("en-TT", {
        year: "numeric", month: "short", day: "numeric",
      });
    } else if (col.key === "marketingOptIn" || col.key === "doNotContact") {
      row[col.label] = val === true ? "Yes" : val === false ? "No" : "";
    } else {
      row[col.label] = val ?? "";
    }
  }
  return row;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportToCSV(contacts: LocalContact[], filename = "contacts.csv") {
  const headers = EXPORT_COLUMNS.map((c) => c.label);
  const rows = contacts.map(contactToRow);

  const escape = (s: string) => {
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv = [
    headers.map(escape).join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h] || "")).join(",")),
  ].join("\n");

  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename);
}

export async function exportToExcel(contacts: LocalContact[], filename = "contacts.xlsx") {
  const ExcelJS = (await import("exceljs")).default;
  const rows = contacts.map(contactToRow);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Contacts");
  ws.columns = EXPORT_COLUMNS.map((col) => {
    const maxLen = Math.max(
      col.label.length,
      ...rows.map((r) => (r[col.label] || "").length),
    );
    return {
      header: col.label,
      key: col.label,
      width: Math.min(Math.max(maxLen + 2, 10), 40),
    };
  });
  for (const row of rows) {
    ws.addRow(row);
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}

export async function exportToVCard(contacts: LocalContact[], filename = "contacts.vcf") {
  const cards = contacts.map((c) => {
    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:${c.lastName || ""};${c.firstName || ""};;;`,
      `FN:${[c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown"}`,
    ];
    if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${c.email}`);
    if (c.phone) lines.push(`TEL;TYPE=CELL:${c.phone}`);
    if (c.whatsappNumber) lines.push(`TEL;TYPE=VOICE:${c.whatsappNumber}`);
    if (c.companyName) lines.push(`ORG:${c.companyName}`);
    if (c.jobTitle) lines.push(`TITLE:${c.jobTitle}`);
    if (c.secondaryEmail) lines.push(`EMAIL;TYPE=HOME:${c.secondaryEmail}`);
    if (c.secondaryPhone) lines.push(`TEL;TYPE=HOME:${c.secondaryPhone}`);
    if (c.addressLine1 || c.city || c.state || c.postalCode || c.country) {
      lines.push(`ADR;TYPE=WORK:;;${c.addressLine1 || ""}${c.addressLine2 ? " " + c.addressLine2 : ""};${c.city || ""};${c.state || ""};${c.postalCode || ""};${c.country || ""}`);
    }
    lines.push("END:VCARD");
    return lines.join("\r\n");
  });

  downloadBlob(
    new Blob([cards.join("\r\n")], { type: "text/vcard;charset=utf-8;" }),
    filename,
  );
}

export async function exportToPDF(contacts: LocalContact[], filename = "contacts.pdf") {
  const { default: jsPDF } = await import("jspdf");
  await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.setTextColor(40);
  doc.text("Contact Database", 14, 15);

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Exported ${new Date().toLocaleDateString("en-TT", { year: "numeric", month: "long", day: "numeric" })} · ${contacts.length} contacts`,
    14,
    22,
  );

  const columns = ["Name", "Email", "Phone", "Status", "Company", "City", "Source", "Tags"];
  const rows = contacts.map((c) => [
    [c.firstName, c.lastName].filter(Boolean).join(" ") || "—",
    c.email || "—",
    c.phone || "—",
    c.status || "—",
    c.companyName || "—",
    c.city || "—",
    c.source || "—",
    Array.isArray(c.tags) ? c.tags.join(", ") : "—",
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inherited untyped data — pending typed contract
  (doc as any).autoTable({
    head: [columns],
    body: rows,
    startY: 28,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [249, 115, 22], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 14, right: 14 },
  });

  doc.save(filename);
}

export type ExportFormat = "csv" | "xlsx" | "vcf" | "pdf";

export async function exportContacts(
  contacts: LocalContact[],
  format: ExportFormat,
  filename?: string,
) {
  const ts = new Date().toISOString().slice(0, 10);
  switch (format) {
    case "csv":
      return exportToCSV(contacts, filename || `contacts_${ts}.csv`);
    case "xlsx":
      return exportToExcel(contacts, filename || `contacts_${ts}.xlsx`);
    case "vcf":
      return exportToVCard(contacts, filename || `contacts_${ts}.vcf`);
    case "pdf":
      return exportToPDF(contacts, filename || `contacts_${ts}.pdf`);
  }
}

export type InsightsExportFormat = "pdf" | "csv";

interface InsightsMetrics {
  totalContacts: number;
  leads: number;
  prospects: number;
  clients: number;
  conversionRate: string;
  pipelineValue: number;
  newThisWeek: number;
  period: string;
  contacts: { firstName?: string | null; lastName?: string | null; email?: string | null; status?: string; meta?: { totalRevenue?: number } }[];
}

function formatTTDExport(value: number): string {
  return `TTD ${value.toLocaleString("en-TT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export async function exportInsightsReport(metrics: InsightsMetrics, format: InsightsExportFormat) {
  const ts = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const rows: string[][] = [];
    rows.push(["CRM Insights Report"]);
    rows.push([`Period: ${metrics.period}`]);
    rows.push([`Exported: ${new Date().toLocaleDateString("en-TT", { year: "numeric", month: "long", day: "numeric" })}`]);
    rows.push([]);
    rows.push(["Metric", "Value"]);
    rows.push(["Total Contacts", metrics.totalContacts.toString()]);
    rows.push(["Leads", metrics.leads.toString()]);
    rows.push(["Prospects", metrics.prospects.toString()]);
    rows.push(["Clients", metrics.clients.toString()]);
    rows.push(["Conversion Rate", metrics.conversionRate]);
    rows.push(["Pipeline Value", formatTTDExport(metrics.pipelineValue)]);
    rows.push(["New This Week", metrics.newThisWeek.toString()]);
    rows.push([]);

    const topRevenue = metrics.contacts
      .filter((c) => c.meta?.totalRevenue && c.meta.totalRevenue > 0)
      .sort((a, b) => (b.meta?.totalRevenue ?? 0) - (a.meta?.totalRevenue ?? 0))
      .slice(0, 10);

    if (topRevenue.length > 0) {
      rows.push(["Top Revenue Clients"]);
      rows.push(["Name", "Revenue"]);
      for (const c of topRevenue) {
        const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown";
        rows.push([name, formatTTDExport(c.meta?.totalRevenue ?? 0)]);
      }
    }

    const escape = (s: string) => {
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `insights_report_${ts}.csv`);
    return;
  }

  const { default: jsPDF } = await import("jspdf");
  await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  doc.setFontSize(18);
  doc.setTextColor(40);
  doc.text("CRM Insights Report", 14, 20);

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Period: ${metrics.period} · Exported ${new Date().toLocaleDateString("en-TT", { year: "numeric", month: "long", day: "numeric" })}`,
    14,
    28,
  );

  const summaryData = [
    ["Total Contacts", metrics.totalContacts.toString()],
    ["Leads", metrics.leads.toString()],
    ["Prospects", metrics.prospects.toString()],
    ["Clients", metrics.clients.toString()],
    ["Conversion Rate", metrics.conversionRate],
    ["Pipeline Value", formatTTDExport(metrics.pipelineValue)],
    ["New This Week", metrics.newThisWeek.toString()],
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inherited untyped data — pending typed contract
  (doc as any).autoTable({
    head: [["Metric", "Value"]],
    body: summaryData,
    startY: 34,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [249, 115, 22], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 14, right: 14 },
  });

  const topRevenue = metrics.contacts
    .filter((c) => c.meta?.totalRevenue && c.meta.totalRevenue > 0)
    .sort((a, b) => (b.meta?.totalRevenue ?? 0) - (a.meta?.totalRevenue ?? 0))
    .slice(0, 10);

  if (topRevenue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inherited untyped data — pending typed contract
    const finalY = (doc as any).lastAutoTable?.finalY ?? 80;
    doc.setFontSize(12);
    doc.setTextColor(40);
    doc.text("Top Revenue Clients", 14, finalY + 10);

    const revenueRows = topRevenue.map((c, i) => [
      (i + 1).toString(),
      [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown",
      formatTTDExport(c.meta?.totalRevenue ?? 0),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inherited untyped data — pending typed contract
    (doc as any).autoTable({
      head: [["#", "Client", "Revenue"]],
      body: revenueRows,
      startY: finalY + 14,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      margin: { left: 14, right: 14 },
    });
  }

  doc.save(`insights_report_${ts}.pdf`);
}
