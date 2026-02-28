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
  const XLSX = await import("xlsx");
  const rows = contacts.map(contactToRow);
  const ws = XLSX.utils.json_to_sheet(rows);

  const colWidths = EXPORT_COLUMNS.map((col) => {
    const maxLen = Math.max(
      col.label.length,
      ...rows.map((r) => (r[col.label] || "").length),
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contacts");
  XLSX.writeFile(wb, filename);
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
