import { GeneratedReport } from "@/lib/client";
import { formatCurrency, formatDate } from "./report-types";

export function exportReportCSV(report: GeneratedReport) {
  const m = report.metrics;
  const rows: string[][] = [];

  rows.push(["Report Type", report.type]);
  rows.push(["Business", m.business.name]);
  rows.push(["Period Start", formatDate(m.period.start)]);
  rows.push(["Period End", formatDate(m.period.end)]);
  rows.push(["Generated", formatDate(report.generatedAt)]);
  rows.push(["Currency", m.currency]);
  rows.push([]);

  rows.push(["--- Key Metrics ---"]);
  rows.push(["Metric", "Value"]);
  rows.push(["Total Revenue", formatCurrency(m.revenue.total, m.currency)]);
  rows.push(["Invoice Count", String(m.revenue.invoiceCount)]);
  rows.push(["Average Invoice", formatCurrency(m.revenue.averageInvoice, m.currency)]);
  rows.push(["Outstanding", formatCurrency(m.revenue.outstanding, m.currency)]);
  rows.push(["Outstanding Count", String(m.revenue.outstandingCount)]);
  rows.push(["Overdue Count", String(m.revenue.overdueCount)]);
  rows.push(["Total Expenses", formatCurrency(m.expenses.total, m.currency)]);
  rows.push(["Expense Count", String(m.expenses.count)]);
  rows.push(["Average Expense", formatCurrency(m.expenses.averageExpense, m.currency)]);
  rows.push(["Net Profit", formatCurrency(m.profitability.netProfit, m.currency)]);
  rows.push(["Profit Margin", `${m.profitability.profitMargin}%`]);
  rows.push(["Total Contacts", String(m.clients.totalContacts)]);
  rows.push(["Total Bookings", String(m.bookings.total)]);
  rows.push(["Bookings Confirmed", String(m.bookings.confirmed)]);
  rows.push(["Bookings Completed", String(m.bookings.completed)]);
  rows.push(["Bookings Cancelled", String(m.bookings.cancelled)]);
  rows.push(["Completion Rate", `${m.bookings.completionRate}%`]);
  rows.push([]);

  if (m.expenses.byCategory.length > 0) {
    rows.push(["--- Expenses by Category ---"]);
    rows.push(["Category", "Amount", "Count"]);
    for (const c of m.expenses.byCategory) {
      rows.push([c.category, formatCurrency(c.total, m.currency), String(c.count)]);
    }
    rows.push([]);
  }

  if (m.revenue.topClients.length > 0) {
    rows.push(["--- Top Clients ---"]);
    rows.push(["Client", "Revenue"]);
    for (const c of m.revenue.topClients) {
      rows.push([c.name, formatCurrency(c.total, m.currency)]);
    }
    rows.push([]);
  }

  if (m.expenses.topVendors.length > 0) {
    rows.push(["--- Top Vendors ---"]);
    rows.push(["Vendor", "Amount"]);
    for (const v of m.expenses.topVendors) {
      rows.push([v.vendor, formatCurrency(v.total, m.currency)]);
    }
    rows.push([]);
  }

  if (m.clients.byStatus.length > 0) {
    rows.push(["--- Contacts by Status ---"]);
    rows.push(["Status", "Count"]);
    for (const s of m.clients.byStatus) {
      rows.push([s.status, String(s.count)]);
    }
    rows.push([]);
  }

  const csvContent = rows.map(row =>
    row.map(cell => {
      const val = cell ?? "";
      return val.includes(",") || val.includes('"') || val.includes("\n")
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    }).join(",")
  ).join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${m.business.name?.replace(/\s+/g, "_") || "Report"}_${report.type}_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportReportPDF(report: GeneratedReport) {
  const jsPDFModule = await import("jspdf");
  const jsPDF = jsPDFModule.default;
  await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const m = report.metrics;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  const reportTitles: Record<string, string> = {
    executive: "Executive Summary",
    pnl: "Profit & Loss Statement",
    revenue: "Revenue Analysis Report",
    expenses: "Expense Analysis Report",
    clients: "Client Portfolio Report",
  };

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 45, "F");

  doc.setTextColor(255, 165, 0);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text(m.business.name || "Business Report", margin, y + 12);

  doc.setTextColor(180, 180, 180);
  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.text(reportTitles[report.type] || "Report", margin, y + 22);

  doc.setFontSize(9);
  doc.text(`Period: ${formatDate(m.period.start)} — ${formatDate(m.period.end)}`, margin, y + 30);
  doc.text(`Generated: ${formatDate(report.generatedAt)}`, pageW - margin - 60, y + 30);

  y = 55;

  doc.setDrawColor(255, 165, 0);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  doc.setTextColor(255, 165, 0);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Key Financial Metrics", margin, y);
  y += 7;

  const metrics = [
    ["Total Revenue", formatCurrency(m.revenue.total, m.currency)],
    ["Total Expenses", formatCurrency(m.expenses.total, m.currency)],
    ["Net Profit", formatCurrency(m.profitability.netProfit, m.currency)],
    ["Profit Margin", `${m.profitability.profitMargin}%`],
    ["Outstanding Receivables", formatCurrency(m.revenue.outstanding, m.currency)],
    ["Overdue Invoices", m.revenue.overdueCount.toString()],
    ["Total Contacts", m.clients.totalContacts.toString()],
    ["Bookings (Period)", m.bookings.total.toString()],
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reports payload — pending typed reporting schema
  const at = (doc as any).autoTable?.bind(doc);
  if (at) {
    at({
      startY: y,
      head: [["Metric", "Value"]],
      body: metrics,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 3, textColor: [200, 200, 200], fillColor: [20, 30, 50] },
      headStyles: { fillColor: [255, 165, 0], textColor: [0, 0, 0], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [15, 25, 45] },
      theme: "grid",
      tableLineColor: [60, 60, 80],
      tableLineWidth: 0.1,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reports payload — pending typed reporting schema
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  if (m.expenses.byCategory.length > 0) {
    if (y > 240) { doc.addPage(); y = margin; }

    doc.setTextColor(255, 165, 0);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Expense Breakdown by Category", margin, y);
    y += 7;

    at?.({
      startY: y,
      head: [["Category", "Amount", "Count"]],
      body: m.expenses.byCategory.map(c => [c.category, formatCurrency(c.total, m.currency), c.count.toString()]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 3, textColor: [200, 200, 200], fillColor: [20, 30, 50] },
      headStyles: { fillColor: [255, 165, 0], textColor: [0, 0, 0], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [15, 25, 45] },
      theme: "grid",
      tableLineColor: [60, 60, 80],
      tableLineWidth: 0.1,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reports payload — pending typed reporting schema
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  if (m.revenue.topClients.length > 0) {
    if (y > 240) { doc.addPage(); y = margin; }

    doc.setTextColor(255, 165, 0);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Top Revenue Clients", margin, y);
    y += 7;

    at?.({
      startY: y,
      head: [["Client", "Revenue"]],
      body: m.revenue.topClients.map(c => [c.name, formatCurrency(c.total, m.currency)]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 3, textColor: [200, 200, 200], fillColor: [20, 30, 50] },
      headStyles: { fillColor: [255, 165, 0], textColor: [0, 0, 0], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [15, 25, 45] },
      theme: "grid",
      tableLineColor: [60, 60, 80],
      tableLineWidth: 0.1,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reports payload — pending typed reporting schema
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  if (report.aiNarrative) {
    if (y > 200) { doc.addPage(); y = margin; }

    doc.setTextColor(255, 165, 0);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("AI-Powered Analysis", margin, y);
    y += 7;

    doc.setTextColor(200, 200, 200);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");

    const cleanNarrative = report.aiNarrative.replace(/\*\*/g, "").replace(/^[-•]\s*/gm, "  - ");
    const lines = doc.splitTextToSize(cleanNarrative, contentW);

    for (const line of lines) {
      if (y > 280) { doc.addPage(); y = margin; }
      doc.text(line, margin, y);
      y += 4.5;
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(15, 23, 42);
    doc.rect(0, doc.internal.pageSize.getHeight() - 12, pageW, 12, "F");
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7);
    doc.text(`KEYFLOWOS | ${m.business.name} | Confidential`, margin, doc.internal.pageSize.getHeight() - 5);
    doc.text(`Page ${i} of ${pageCount}`, pageW - margin - 20, doc.internal.pageSize.getHeight() - 5);
  }

  const fileName = `${m.business.name?.replace(/\s+/g, "_") || "Report"}_${reportTitles[report.type]?.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;
  doc.save(fileName);
}
