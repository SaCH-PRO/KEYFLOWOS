"use client";

import { useContactDetailContext } from "../contact-detail-context";
import {
  TrendingUp,
  AlertTriangle,
  Calendar,
  DollarSign,
  Target,
  MessageSquare,
  Clock,
  Shield,
} from "lucide-react";

export default function ContactOverviewPage() {
  const { contact, detail, loading } = useContactDetailContext();

  if (loading) return <div className="p-4">Loading...</div>;
  if (!contact) return <div className="p-4">Contact not found</div>;

  const score = contact.leadScore ?? 0;
  const scoreClass =
    score >= 80 ? "bg-green-100 text-green-800" : score >= 60 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";

  const cards = [
    {
      label: "Lifetime Value",
      value: `$${(contact.lifetimeValue ?? 0).toLocaleString()}`,
      icon: DollarSign,
      color: "text-green-600",
    },
    {
      label: "Avg Spend",
      value: `$${(contact.averageSpend ?? 0).toLocaleString()}`,
      icon: TrendingUp,
      color: "text-blue-600",
    },
    {
      label: "Payment Reliability",
      value: `${contact.paymentReliability ?? 0}%`,
      icon: Shield,
      color: "text-purple-600",
    },
    {
      label: "Bookings",
      value: `${contact.bookingFrequency ?? 0}`,
      icon: Calendar,
      color: "text-orange-600",
    },
    {
      label: "Cancellation Rate",
      value: `${contact.cancellationRate ?? 0}%`,
      icon: AlertTriangle,
      color: "text-red-600",
    },
    {
      label: "Conversion Probability",
      value: `${contact.conversionProbability ?? 0}%`,
      icon: Target,
      color: "text-emerald-600",
    },
    ...(contact.bestChannel
      ? [
          {
            label: "Best Channel",
            value: `${contact.bestChannel}${contact.bestChannelConfidence ? ` (${Math.round(contact.bestChannelConfidence * 100)}%)` : ""}`,
            icon: MessageSquare,
            color: "text-sky-600",
          },
        ]
      : []),
    ...(contact.bestTimeWindow
      ? [
          {
            label: "Best Time",
            value: contact.bestTimeWindow.label,
            icon: Clock,
            color: "text-indigo-600",
          },
        ]
      : []),
    ...(detail?.meta?.openDealsCount != null
      ? [
          {
            label: "Open Deals",
            value: `${detail.meta.openDealsCount} ($${(detail.meta.openDealsValue ?? 0).toLocaleString()})`,
            icon: Target,
            color: "text-blue-600",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          {contact.firstName} {contact.lastName}
        </h2>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${scoreClass}`}>Lead Score: {score}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className={`h-4 w-4 ${c.color}`} />
                {c.label}
              </div>
              <p className="mt-1 text-2xl font-semibold">{c.value}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
