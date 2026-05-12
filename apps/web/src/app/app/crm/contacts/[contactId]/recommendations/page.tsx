"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchContactInsightSnapshot, fetchContactRevenueSummary, fetchContactMomentum } from "@/lib/client";
import { Card, Button, Badge } from "@keyflow/ui";
import { Lightbulb, CheckCircle, Calendar, Mail, MessageSquare, Phone, FileText, Target, TrendingUp, AlertTriangle, Clock, Send } from "lucide-react";
import { toast } from "sonner";

interface Recommendation {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  actionLabel?: string;
}

export default function ContactRecommendationsPage() {
  const { contactId } = useParams();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [insRes, revRes, momRes] = await Promise.all([
        fetchContactInsightSnapshot(contactId as string),
        fetchContactRevenueSummary(contactId as string),
        fetchContactMomentum(contactId as string),
      ]);

      const recs: Recommendation[] = [];
      const insight = insRes.data?.payload;
      const revenue = revRes.data;
      const momentum = momRes.data;

      // AI-suggested action from insight snapshot
      if (insight?.suggestedAction) {
        const sa = insight.suggestedAction;
        const iconMap: Record<string, React.ElementType> = {
          schedule_call: Phone,
          send_whatsapp: MessageSquare,
          send_email: Mail,
          enroll_in_sequence: Send,
          create_task: CheckCircle,
          create_invoice: FileText,
          book_appointment: Calendar,
          review_dormant: Clock,
        };
        recs.push({
          id: "ai-suggested",
          icon: iconMap[sa.kind] || Lightbulb,
          title: sa.label,
          description: sa.description,
          priority: "high",
          actionLabel: "Act now",
        });
      }

      // Churn risk warning
      if (insight && insight.churnRisk > 50) {
        recs.push({
          id: "churn-risk",
          icon: AlertTriangle,
          title: "Churn Risk Detected",
          description: insight.churnRiskReason || `Churn risk is at ${insight.churnRisk}%. Re-engage this contact promptly.`,
          priority: "high",
          actionLabel: "Reach out",
        });
      }

      // Outstanding balance
      if (revenue && revenue.outstandingBalance > 0) {
        recs.push({
          id: "outstanding",
          icon: FileText,
          title: "Outstanding Balance",
          description: `This contact has ${new Intl.NumberFormat("en-US", { style: "currency", currency: revenue.currency || "USD" }).format(revenue.outstandingBalance)} in unpaid invoices.`,
          priority: revenue.outstandingBalance > 1000 ? "high" : "medium",
          actionLabel: "Send reminder",
        });
      }

      // Low momentum
      if (momentum && momentum.score < 40) {
        recs.push({
          id: "low-momentum",
          icon: TrendingUp,
          title: "Low Engagement Momentum",
          description: `Momentum score is ${momentum.score}/100. Consider a re-engagement campaign.`,
          priority: "medium",
          actionLabel: "Plan outreach",
        });
      }

      // Open quotes follow-up
      if (revenue && revenue.openQuotes > 0) {
        recs.push({
          id: "open-quotes",
          icon: Target,
          title: "Open Quotes Follow-up",
          description: `${revenue.openQuotes} open quote${revenue.openQuotes > 1 ? "s" : ""} waiting for response. Follow up to close the deal.`,
          priority: "medium",
          actionLabel: "Follow up",
        });
      }

      // No recent payment
      if (revenue && !revenue.lastPaymentAt && revenue.lifetimeRevenue > 0) {
        recs.push({
          id: "no-recent-payment",
          icon: Clock,
          title: "No Recent Payment",
          description: "This contact hasn't made a payment recently despite previous purchases.",
          priority: "low",
          actionLabel: "Check in",
        });
      }

      setRecommendations(recs);
      setLoading(false);
    };
    load();
  }, [contactId]);

  const handleAction = (rec: Recommendation) => {
    toast.info(`${rec.actionLabel || "Action"} for: ${rec.title}`);
  };

  const handleDismiss = (id: string) => {
    setRecommendations((prev) => prev.filter((r) => r.id !== id));
    toast.success("Recommendation dismissed");
  };

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...recommendations].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const priorityColor = (p: string) => {
    if (p === "high") return "bg-red-100 text-red-800";
    if (p === "medium") return "bg-amber-100 text-amber-800";
    return "bg-blue-100 text-blue-800";
  };

  if (loading) return <div className="p-4">Loading recommendations...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <h3 className="text-lg font-semibold">Recommendations</h3>
        <span className="ml-auto text-sm text-muted-foreground">{sorted.length} suggestion{sorted.length !== 1 ? "s" : ""}</span>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <CheckCircle className="mx-auto mb-2 h-8 w-8 text-green-500" />
          <p>All caught up! No recommendations right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((rec) => {
            const Icon = rec.icon;
            return (
              <Card key={rec.id} className={rec.priority === "high" ? "border-red-200" : ""}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${rec.priority === "high" ? "bg-red-100" : "bg-muted"}`}>
                      <Icon className={`h-5 w-5 ${rec.priority === "high" ? "text-red-600" : "text-muted-foreground"}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{rec.title}</span>
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${priorityColor(rec.priority)}`}>{rec.priority}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{rec.description}</p>
                      <div className="mt-3 flex items-center gap-2">
                        {rec.actionLabel && (
                          <Button size="sm" onClick={() => handleAction(rec)}>
                            {rec.actionLabel}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => handleDismiss(rec.id)}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
