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

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

export function ModernTemplate({ data }: { data: InvoiceTemplateData }) {
  const { business, contact, items } = data;
  const pc = business.primaryColor;
  const sc = business.secondaryColor;
  const isQuote = data.type === "quote";
  const docLabel = isQuote ? "QUOTE" : "INVOICE";
  const contactName = contact
    ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "—"
    : "—";

  return (
    <div className="bg-white text-gray-900 rounded-xl overflow-hidden shadow-lg">
      <div
        className="relative px-5 py-6 sm:px-8 sm:py-10 text-white overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${pc} 0%, ${sc} 100%)` }}
      >
        <div className="absolute top-0 right-0 w-32 sm:w-40 h-32 sm:h-40 rounded-full opacity-10 bg-white" style={{ transform: "translate(30%, -30%)" }} />
        <div className="absolute bottom-0 left-0 w-16 sm:w-24 h-16 sm:h-24 rounded-full opacity-10 bg-white" style={{ transform: "translate(-30%, 30%)" }} />

        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            {business.logoUrl ? (
              <img
                src={business.logoUrl}
                alt={business.name}
                className="h-12 w-12 sm:h-16 sm:w-16 object-contain rounded-xl bg-white/20 p-1"
              />
            ) : (
              <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-xl sm:text-2xl backdrop-blur-sm shrink-0">
                {business.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold truncate">{business.name}</h2>
              {business.tagline && (
                <p className="text-xs sm:text-sm text-white/70 mt-0.5 truncate">{business.tagline}</p>
              )}
            </div>
          </div>
          <div className="text-left sm:text-right shrink-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-wider">{docLabel}</h1>
            <p className="text-sm text-white/80 mt-0.5 sm:mt-1 font-medium">#{data.number}</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-8 sm:py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8 -mt-4 sm:-mt-8">
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-3 sm:p-4 text-center">
            <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-400 mb-1">
              {isQuote ? "Quote Date" : "Issue Date"}
            </p>
            <p className="text-xs sm:text-sm font-bold text-gray-900">
              {data.issueDate
                ? new Date(data.issueDate).toLocaleDateString("en-TT", { day: "numeric", month: "short", year: "numeric" })
                : "—"}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-3 sm:p-4 text-center">
            <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-400 mb-1">
              {isQuote ? "Valid Until" : "Due Date"}
            </p>
            <p className="text-xs sm:text-sm font-bold text-gray-900">
              {(isQuote ? data.expiryDate : data.dueDate)
                ? new Date((isQuote ? data.expiryDate! : data.dueDate!)).toLocaleDateString("en-TT", { day: "numeric", month: "short", year: "numeric" })
                : "—"}
            </p>
          </div>
          <div className="col-span-2 sm:col-span-1 bg-white rounded-xl shadow-md border border-gray-100 p-3 sm:p-4 text-center">
            <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-400 mb-1">Total Due</p>
            <p className="text-sm sm:text-sm font-bold" style={{ color: pc }}>{fmt(data.total, data.currency)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8 mb-6 sm:mb-8">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: pc }}>From</p>
            <div className="space-y-1 text-sm text-gray-600">
              <p className="font-semibold text-gray-900">{business.name}</p>
              {business.address && (
                <p className="flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate">{business.address}{business.city ? `, ${business.city}` : ""}</span></p>
              )}
              {business.phone && (
                <p className="flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" />{business.phone}</p>
              )}
              {business.email && (
                <p className="flex items-center gap-1"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{business.email}</span></p>
              )}
              {business.website && (
                <p className="flex items-center gap-1"><Globe className="w-3 h-3 shrink-0" />{business.website}</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: pc }}>
              {isQuote ? "Quote For" : "Bill To"}
            </p>
            <p className="font-semibold text-gray-900">{contactName}</p>
            {contact?.email && <p className="text-sm text-gray-500">{contact.email}</p>}
            {contact?.phone && <p className="text-sm text-gray-500">{contact.phone}</p>}
          </div>
        </div>

        <div className="hidden sm:block rounded-xl overflow-hidden border border-gray-200 mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left py-3 px-4 text-gray-500 font-semibold text-xs uppercase tracking-wider">Description</th>
                <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs uppercase tracking-wider">Qty</th>
                <th className="text-right py-3 px-4 text-gray-500 font-semibold text-xs uppercase tracking-wider">Rate</th>
                <th className="text-right py-3 px-4 text-gray-500 font-semibold text-xs uppercase tracking-wider">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id ?? idx} className="border-t border-gray-100">
                  <td className="py-3 px-4 text-gray-800 font-medium">{item.description || "Unnamed item"}</td>
                  <td className="text-center py-3 px-4 text-gray-600">{item.quantity}</td>
                  <td className="text-right py-3 px-4 text-gray-600">{fmt(item.unitPrice ?? 0, data.currency)}</td>
                  <td className="text-right py-3 px-4 font-semibold text-gray-800">{fmt(item.total ?? 0, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sm:hidden mb-6 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-1">Items</div>
          {items.map((item, idx) => (
            <div
              key={item.id ?? idx}
              className="rounded-xl border border-gray-100 p-3"
            >
              <p className="text-sm font-medium text-gray-800 mb-2">{item.description || "Unnamed item"}</p>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{item.quantity} x {fmt(item.unitPrice ?? 0, data.currency)}</span>
                <span className="font-semibold text-gray-800">{fmt(item.total ?? 0, data.currency)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mb-6">
          <div
            className="w-full sm:w-72 rounded-xl p-4 sm:p-5 space-y-2"
            style={{ backgroundColor: `rgba(${hexToRgb(pc)}, 0.05)` }}
          >
            <div className="flex justify-between text-sm text-gray-500">
              <span>Subtotal</span>
              <span className="font-medium text-gray-700">{fmt(data.subtotal, data.currency)}</span>
            </div>
            {data.taxRate > 0 && (
              <div className="flex justify-between text-sm text-gray-500">
                <span>Tax ({data.taxRate}%)</span>
                <span className="font-medium text-gray-700">{fmt(data.taxAmount, data.currency)}</span>
              </div>
            )}
            {data.discountAmount > 0 && (
              <div className="flex justify-between text-sm text-emerald-600">
                <span>Discount{data.discountType === "PERCENT" ? ` (${data.discountValue}%)` : ""}</span>
                <span className="font-medium">-{fmt(data.discountAmount, data.currency)}</span>
              </div>
            )}
            <div
              className="flex justify-between items-center text-lg sm:text-xl font-bold pt-3 mt-2 border-t"
              style={{ color: pc, borderColor: `rgba(${hexToRgb(pc)}, 0.2)` }}
            >
              <span>Total</span>
              <span>{fmt(data.total, data.currency)}</span>
            </div>
          </div>
        </div>

        {data.notes && (
          <div
            className="p-3 sm:p-4 rounded-xl mb-4"
            style={{ backgroundColor: `rgba(${hexToRgb(pc)}, 0.05)`, borderLeft: `4px solid ${pc}` }}
          >
            <p className="text-xs font-semibold text-gray-600 mb-1">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{data.notes}</p>
          </div>
        )}
      </div>

      <div
        className="px-5 sm:px-8 py-3 sm:py-4 text-center text-white text-xs"
        style={{ background: `linear-gradient(135deg, ${pc} 0%, ${sc} 100%)` }}
      >
        <p>Thank you for choosing {business.name}!</p>
        {business.website && <p className="mt-1 opacity-80">{business.website}</p>}
      </div>
    </div>
  );
}
