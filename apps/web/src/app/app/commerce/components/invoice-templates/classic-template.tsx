"use client";

import {
  Phone,
  Mail,
  Globe,
  MapPin,
} from "lucide-react";
import type { InvoiceTemplateData } from "./template-types";

function fmt(amount: number, currency: string) {
  const sym = currency === "TTD" ? "TT$" : currency === "USD" ? "$" : `${currency} `;
  return `${sym}${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export function ClassicTemplate({ data }: { data: InvoiceTemplateData }) {
  const { business, contact, items } = data;
  const pc = business.primaryColor;
  const isQuote = data.type === "quote";
  const docLabel = isQuote ? "QUOTE" : "INVOICE";
  const contactName = contact
    ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "—"
    : "—";

  return (
    <div className="bg-white text-gray-900 rounded-xl overflow-hidden shadow-lg">
      <div className="h-1.5 w-full" style={{ backgroundColor: pc }} />

      <div className="p-8">
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            {business.logoUrl ? (
              <img
                src={business.logoUrl}
                alt={business.name}
                className="h-14 w-14 object-contain rounded-lg"
              />
            ) : (
              <div
                className="h-14 w-14 rounded-lg flex items-center justify-center text-white font-bold text-xl"
                style={{ backgroundColor: pc }}
              >
                {business.name.charAt(0)}
              </div>
            )}
            <div>
              <h2 className="text-lg font-bold text-gray-900">{business.name}</h2>
              {business.address && (
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3" />
                  {business.address}{business.city ? `, ${business.city}` : ""}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-extrabold tracking-wide" style={{ color: pc }}>
              {docLabel}
            </h1>
            <p className="text-sm text-gray-600 mt-1">#{data.number}</p>
          </div>
        </div>

        {(business.phone || business.email || business.website) && (
          <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-6 pb-4 border-b border-gray-200">
            {business.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {business.phone}
              </span>
            )}
            {business.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {business.email}
              </span>
            )}
            {business.website && (
              <span className="flex items-center gap-1">
                <Globe className="w-3 h-3" />
                {business.website}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-6 mb-8">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
              {isQuote ? "Quote For" : "Bill To"}
            </p>
            <p className="font-semibold text-gray-900">{contactName}</p>
            {contact?.email && (
              <p className="text-xs text-gray-500">{contact.email}</p>
            )}
            {contact?.phone && (
              <p className="text-xs text-gray-500">{contact.phone}</p>
            )}
          </div>
          <div className="text-right">
            <div className="space-y-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400">
                  {isQuote ? "Quote Date" : "Issue Date"}
                </p>
                <p className="text-sm font-medium">
                  {data.issueDate
                    ? new Date(data.issueDate).toLocaleDateString("en-TT", { day: "numeric", month: "short", year: "numeric" })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400">
                  {isQuote ? "Valid Until" : "Due Date"}
                </p>
                <p className="text-sm font-medium">
                  {(isQuote ? data.expiryDate : data.dueDate)
                    ? new Date((isQuote ? data.expiryDate! : data.dueDate!)).toLocaleDateString("en-TT", { day: "numeric", month: "short", year: "numeric" })
                    : "—"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr style={{ backgroundColor: pc }}>
              <th className="text-left py-3 px-4 text-white font-semibold rounded-tl-lg">Description</th>
              <th className="text-center py-3 px-4 text-white font-semibold">Qty</th>
              <th className="text-right py-3 px-4 text-white font-semibold">Unit Price</th>
              <th className="text-right py-3 px-4 text-white font-semibold rounded-tr-lg">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id ?? idx} className="border-b border-gray-100">
                <td className="py-3 px-4 text-gray-800">{item.description || "Unnamed item"}</td>
                <td className="text-center py-3 px-4 text-gray-600">{item.quantity}</td>
                <td className="text-right py-3 px-4 text-gray-600">{fmt(item.unitPrice ?? 0, data.currency)}</td>
                <td className="text-right py-3 px-4 font-medium text-gray-800">{fmt(item.total ?? 0, data.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-6">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span>
              <span>{fmt(data.subtotal, data.currency)}</span>
            </div>
            {data.taxRate > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Tax ({data.taxRate}%)</span>
                <span>{fmt(data.taxAmount, data.currency)}</span>
              </div>
            )}
            {data.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Discount{data.discountType === "PERCENT" ? ` (${data.discountValue}%)` : ""}</span>
                <span>-{fmt(data.discountAmount, data.currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg border-t border-gray-200 pt-2" style={{ color: pc }}>
              <span>Total</span>
              <span>{fmt(data.total, data.currency)}</span>
            </div>
          </div>
        </div>

        {data.notes && (
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 mb-4">
            <p className="text-xs font-semibold text-amber-800 mb-1">Notes</p>
            <p className="text-sm text-amber-900 whitespace-pre-wrap">{data.notes}</p>
          </div>
        )}
      </div>

      <div className="px-8 py-4 bg-gray-50 border-t border-gray-200 text-center">
        <p className="text-xs text-gray-400">Thank you for your business!</p>
        {business.website && (
          <p className="text-xs mt-1">
            <a href={business.website} style={{ color: pc }}>{business.website}</a>
          </p>
        )}
      </div>
    </div>
  );
}
