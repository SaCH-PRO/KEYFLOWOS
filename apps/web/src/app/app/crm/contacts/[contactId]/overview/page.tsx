"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { TrendingUp, AlertTriangle, Calendar, DollarSign, Target } from "lucide-react";

interface ContactOverview {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  status?: string;
  leadScore?: number;
  lifetimeValue?: number;
  averageSpend?: number;
  paymentReliability?: number;
  bookingFrequency?: number;
  cancellationRate?: number;
  followUpPriority?: string;
  nextBestAction?: string;
  conversionProbability?: number;
  relationshipHealth?: string;
}

export default function ContactOverviewPage() {
  const { contactId } = useParams();
  const [contact, setContact] = useState<ContactOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ContactOverview>(`/crm/contacts/${contactId}`).then((res) => {
      setContact(res.data ?? null);
      setLoading(false);
    });
  }, [contactId]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (!contact) return <div className="p-4">Contact not found</div>;

  const score = contact.leadScore ?? 0;
  const scoreClass = score >= 80 ? "bg-green-100 text-green-800" : score >= 60 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";

  const cards = [
    { label: "Lifetime Value", value: `$${(contact.lifetimeValue ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-green-600" },
    { label: "Avg Spend", value: `$${(contact.averageSpend ?? 0).toLocaleString()}`, icon: TrendingUp, color: "text-blue-600" },
    { label: "Payment Reliability", value: `${contact.paymentReliability ?? 0}%`, icon: Target, color: "text-purple-600" },
    { label: "Bookings", value: `${contact.bookingFrequency ?? 0}`, icon: Calendar, color: "text-orange-600" },
    { label: "Cancellation Rate", value: `${contact.cancellationRate ?? 0}%`, icon: AlertTriangle, color: "text-red-600" },
    { label: "Conversion Probability", value: `${contact.conversionProbability ?? 0}%`, icon: TrendingUp, color: "text-emerald-600" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          {contact.firstName} {contact.lastName}
        </h2>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${scoreClass}`}>
          Lead Score: {score}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-lg border bg-card p-4 shadow-sm">
              <p className="text-sm text-muted-foreground">{c.label}</p>
              <div className="mt-1 flex items-center gap-2">
                <Icon className={`h-5 w-5 ${c.color}`} />
                <span className="text-2xl font-bold">{c.value}</span>
              </div>
            </div>
          );
        })}
      </div>

      {contact.nextBestAction && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Next Best Action</p>
              <p className="text-lg font-semibold">{contact.nextBestAction}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
