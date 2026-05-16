"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, ShoppingCart, Calendar } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchPresenceOrders,
  fetchPresenceBookings,
  type PresenceOrder,
  type PresenceBooking,
} from "@/lib/client";

export default function PresenceOrdersAndBookingsPage() {
  const [businessId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredBusinessId(),
  );
  const [orders, setOrders] = useState<PresenceOrder[] | null>(null);
  const [bookings, setBookings] = useState<PresenceBooking[] | null>(null);
  const [bookingsFiltered, setBookingsFiltered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    Promise.all([fetchPresenceOrders(businessId, 50), fetchPresenceBookings(businessId, 50)]).then(
      ([o, b]) => {
        if (o.error) setError(o.error);
        else setOrders(o.data?.items ?? []);
        if (b.error) setError(b.error);
        else {
          setBookings(b.data?.items ?? []);
          setBookingsFiltered(b.data?.sourceFiltered ?? false);
        }
      },
    );
  }, [businessId]);

  if (!businessId) return <div className="p-6 text-sm text-muted-foreground">Pick a workspace.</div>;
  if (error) return <div className="p-6 text-sm text-rose-300">{error}</div>;

  return (
    <div className="p-4 space-y-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-orange-400" /> Storefront orders
            </h2>
            <p className="text-xs text-muted-foreground">Orders placed through your storefront.</p>
          </div>
          <Link href="/app/store?tab=orders" className="text-xs text-orange-400 hover:underline">
            Manage all orders →
          </Link>
        </div>
        {orders === null ? (
          <Loading label="orders" />
        ) : orders.length === 0 ? (
          <Empty text="No storefront orders yet." />
        ) : (
          <div className="rounded-lg border border-border/40 overflow-hidden">
            <div className="overflow-x-auto">
<table className="min-w-full w-full text-xs">
              <thead className="bg-slate-900/60 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Order</th>
                  <th className="text-left px-3 py-2 font-medium">Customer</th>
                  <th className="text-left px-3 py-2 font-medium">Items</th>
                  <th className="text-left px-3 py-2 font-medium">Total</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border/30 hover:bg-slate-900/40">
                    <td className="px-3 py-2 font-medium">{o.orderNumber}</td>
                    <td className="px-3 py-2 text-muted-foreground">{o.customerName}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {o.items.slice(0, 2).map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                      {o.items.length > 2 ? ` +${o.items.length - 2}` : ""}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{o.currency} {Math.round(o.total).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800/60 text-[10px] uppercase">{o.status}</span>{" "}
                      <span className="px-1.5 py-0.5 rounded bg-slate-800/60 text-[10px] uppercase">{o.paymentStatus}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(o.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
</div>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="w-4 h-4 text-orange-400" /> Storefront bookings
            </h2>
            <p className="text-xs text-muted-foreground">
              {bookingsFiltered
                ? "Bookings from contacts captured via your storefront."
                : "Recent bookings (no storefront leads yet — showing all)."}
            </p>
          </div>
          <Link href="/app/calendar" className="text-xs text-orange-400 hover:underline">
            Open calendar →
          </Link>
        </div>
        {bookings === null ? (
          <Loading label="bookings" />
        ) : bookings.length === 0 ? (
          <Empty text="No bookings yet." />
        ) : (
          <div className="rounded-lg border border-border/40 overflow-hidden">
            <div className="overflow-x-auto">
<table className="min-w-full w-full text-xs">
              <thead className="bg-slate-900/60 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Customer</th>
                  <th className="text-left px-3 py-2 font-medium">Service</th>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Payment</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => {
                  const name =
                    b.contact?.displayName ||
                    [b.contact?.firstName, b.contact?.lastName].filter(Boolean).join(" ") ||
                    "—";
                  return (
                    <tr key={b.id} className="border-t border-border/30 hover:bg-slate-900/40">
                      <td className="px-3 py-2">{name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.service?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(b.startTime).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800/60 text-[10px] uppercase">{b.status}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{b.paymentStatus}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
</div>
          </div>
        )}
      </section>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="text-sm text-muted-foreground flex items-center py-4">
      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading {label}…
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-slate-900/40 p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
