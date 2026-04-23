"use client";

import type { InvoiceTemplateData } from "./template-types";
import { formatCurrencyShort } from "@/lib/currency";

const fmt = (amount: number, currency: string) => formatCurrencyShort(amount, currency);

export function MinimalTemplate({ data }: { data: InvoiceTemplateData }) {
  const { business, contact, items } = data;
  const pc = business.primaryColor;
  const isQuote = data.type === "quote";
  const docLabel = isQuote ? "Quote" : "Invoice";
  const contactName = contact
    ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "—"
    : "—";

  return (
    <div className="bg-white text-gray-900 rounded-xl overflow-hidden shadow-lg">
      <div className="p-5 sm:p-10">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8 sm:mb-12">
          <div className="min-w-0">
            {business.logoUrl ? (
              <img
                src={business.logoUrl}
                alt={business.name}
                className="h-8 sm:h-10 w-auto object-contain mb-3"
              />
            ) : (
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 truncate">{business.name}</h2>
            )}
            <div className="text-[10px] sm:text-xs text-gray-400 space-y-0.5">
              {business.address && <p className="truncate">{business.address}{business.city ? `, ${business.city}` : ""}</p>}
              {business.email && <p className="truncate">{business.email}</p>}
              {business.phone && <p>{business.phone}</p>}
            </div>
          </div>
          <div className="text-left sm:text-right shrink-0">
            <h1 className="text-sm uppercase tracking-[0.3em] text-gray-400 mb-1">{docLabel}</h1>
            <p className="text-xl sm:text-2xl font-light text-gray-900">#{data.number}</p>
          </div>
        </div>

        <div className="w-16 h-0.5 mb-8 sm:mb-10" style={{ backgroundColor: pc }} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8 mb-8 sm:mb-10">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 mb-2">
              {isQuote ? "Prepared for" : "Billed to"}
            </p>
            <p className="text-sm font-semibold text-gray-900">{contactName}</p>
            {contact?.email && <p className="text-xs text-gray-400 mt-0.5">{contact.email}</p>}
            {contact?.phone && <p className="text-xs text-gray-400">{contact.phone}</p>}
          </div>
          <div className="sm:text-right">
            <div className="flex sm:flex-col gap-4 sm:gap-3 sm:items-end">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">
                  {isQuote ? "Date" : "Issued"}
                </p>
                <p className="text-sm text-gray-700">
                  {data.issueDate
                    ? new Date(data.issueDate).toLocaleDateString("en-TT", { day: "numeric", month: "long", year: "numeric" })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">
                  {isQuote ? "Expires" : "Due"}
                </p>
                <p className="text-sm text-gray-700">
                  {(isQuote ? data.expiryDate : data.dueDate)
                    ? new Date((isQuote ? data.expiryDate! : data.dueDate!)).toLocaleDateString("en-TT", { day: "numeric", month: "long", year: "numeric" })
                    : "—"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden sm:block mb-8">
          <div className="grid grid-cols-12 text-[10px] uppercase tracking-[0.15em] text-gray-400 pb-3 border-b border-gray-200">
            <div className="col-span-6">Item</div>
            <div className="col-span-2 text-center">Qty</div>
            <div className="col-span-2 text-right">Rate</div>
            <div className="col-span-2 text-right">Amount</div>
          </div>
          {items.map((item, idx) => (
            <div
              key={item.id ?? idx}
              className="grid grid-cols-12 py-4 border-b border-gray-100 text-sm items-center"
            >
              <div className="col-span-6 text-gray-800">{item.description || "Unnamed item"}</div>
              <div className="col-span-2 text-center text-gray-500">{item.quantity}</div>
              <div className="col-span-2 text-right text-gray-500">{fmt(item.unitPrice ?? 0, data.currency)}</div>
              <div className="col-span-2 text-right font-medium text-gray-800">{fmt(item.total ?? 0, data.currency)}</div>
            </div>
          ))}
        </div>

        <div className="sm:hidden mb-8 space-y-3">
          {items.map((item, idx) => (
            <div key={item.id ?? idx} className="py-3 border-b border-gray-100">
              <p className="text-sm text-gray-800 mb-1.5">{item.description || "Unnamed item"}</p>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{item.quantity} x {fmt(item.unitPrice ?? 0, data.currency)}</span>
                <span className="font-medium text-gray-700">{fmt(item.total ?? 0, data.currency)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mb-8 sm:mb-10">
          <div className="w-full sm:w-56 space-y-2 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>Subtotal</span>
              <span className="text-gray-600">{fmt(data.subtotal, data.currency)}</span>
            </div>
            {data.taxRate > 0 && (
              <div className="flex justify-between text-gray-400">
                <span>Tax ({data.taxRate}%)</span>
                <span className="text-gray-600">{fmt(data.taxAmount, data.currency)}</span>
              </div>
            )}
            {data.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Discount{data.discountType === "PERCENT" ? ` (${data.discountValue}%)` : ""}</span>
                <span>-{fmt(data.discountAmount, data.currency)}</span>
              </div>
            )}
            <div className="h-px my-2" style={{ backgroundColor: pc }} />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Total</span>
              <span className="text-xl sm:text-2xl font-light" style={{ color: pc }}>
                {fmt(data.total, data.currency)}
              </span>
            </div>
          </div>
        </div>

        {data.notes && (
          <div className="mb-6">
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 mb-2">Notes</p>
            <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{data.notes}</p>
          </div>
        )}

        <div className="pt-6 sm:pt-8 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-300">{business.name}</p>
          {business.website && (
            <p className="text-xs mt-0.5">
              <a href={business.website} style={{ color: pc }} className="hover:underline">{business.website}</a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
