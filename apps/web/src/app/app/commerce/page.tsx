"use client";

import { Table } from "@keyflow/ui";

const invoices = [
  ["INV-004", "Sarah Smith", "TTD 850.00", "Paid"],
  ["INV-003", "John Doe", "TTD 600.00", "Sent"],
  ["INV-002", "Amira Khan", "TTD 1,200.00", "Draft"],
];

export default function CommercePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Commerce</h1>
        <p className="text-sm text-muted-foreground">Quotes, invoices, and payments dashboards.</p>
      </div>
      <Table headers={["Invoice", "Contact", "Amount", "Status"]} rows={invoices} />
    </div>
  );
}
