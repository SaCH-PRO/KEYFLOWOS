"use client";

import {
  Phone,
  Mail,
  Globe,
  MapPin,
} from "lucide-react";
import type { InvoiceTemplateData } from "./template-types";
import { formatCurrencyShort } from "@/lib/currency";

const fmt = (amount: number, currency: string) => formatCurrencyShort(amount, currency);

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

      <div className="p-5 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 sm:mb-8">
          <div className="flex items-center gap-3 sm:gap-4">
            {business.logoUrl ? (
              <img
                src={business.logoUrl}
                alt={business.name}
                className="h-10 w-10 sm:h-14 sm:w-14 object-contain rounded-lg"
              />
            ) : (
              <div
                className="h-10 w-10 sm:h-14 sm:w-14 rounded-lg flex items-center justify-center text-white font-bold text-lg sm:text-xl shrink-0"
                style={{ backgroundColor: pc }}
              >
                {business.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-gray-900 truncate">{business.name}</h2>
              {business.address && (
                <p className="text-[10px] sm:text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{business.address}{business.city ? `, ${business.city}` : ""}</span>
                </p>
              )}
            </div>
          </div>
          <div className="text-left sm:text-right shrink-0">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-wide" style={{ color: pc }}>
              {docLabel}
            </h1>
            <p className="text-sm text-gray-600 mt-0.5 sm:mt-1">#{data.number}</p>
          </div>
        </div>

        {(business.phone || business.email || business.website) && (
          <div className="flex flex-wrap gap-3 sm:gap-4 text-[10px] sm:text-xs text-gray-500 mb-5 sm:mb-6 pb-3 sm:pb-4 border-b border-gray-200">
            {business.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3 shrink-0" />
                {business.phone}
              </span>
            )}
            {business.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3 shrink-0" />
                <span className="truncate">{business.email}</span>
              </span>
            )}
            {business.website && (
              <span className="flex items-center gap-1">
                <Globe className="w-3 h-3 shrink-0" />
                {business.website}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
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
          <div className="sm:text-right">
            <div className="flex sm:flex-col gap-4 sm:gap-2 sm:items-end">
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

        <div className="hidden sm:block mb-6">
          <table className="w-full text-sm">
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
        </div>

        <div className="sm:hidden mb-6 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-1">Items</div>
          {items.map((item, idx) => (
            <div key={item.id ?? idx} className="rounded-lg border border-gray-100 p-3">
              <p className="text-sm font-medium text-gray-800 mb-2">{item.description || "Unnamed item"}</p>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{item.quantity} x {fmt(item.unitPrice ?? 0, data.currency)}</span>
                <span className="font-semibold text-gray-800">{fmt(item.total ?? 0, data.currency)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mb-6">
          <div className="w-full sm:w-64 space-y-2 text-sm">
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
            <div className="flex justify-between font-bold text-base sm:text-lg border-t border-gray-200 pt-2" style={{ color: pc }}>
              <span>Total</span>
              <span>{fmt(data.total, data.currency)}</span>
            </div>
          </div>
        </div>

        {data.notes && (
          <div className="p-3 sm:p-4 bg-amber-50 rounded-lg border border-amber-200 mb-4">
            <p className="text-xs font-semibold text-amber-800 mb-1">Notes</p>
            <p className="text-sm text-amber-900 whitespace-pre-wrap">{data.notes}</p>
          </div>
        )}
      </div>

      <div className="px-5 sm:px-8 py-3 sm:py-4 bg-gray-50 border-t border-gray-200 text-center">
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
