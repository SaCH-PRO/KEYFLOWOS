"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  fetchContactInsightSnapshot,
  fetchContactRevenueSummary,
  fetchContactMomentum,
  fetchContactDetail,
  addContactTask,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { useCompose } from "@/components/email/compose-context";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import { Card, Button } from "@keyflow/ui";
import {
  Lightbulb,
  CheckCircle,
  Calendar,
  Mail,
  MessageSquare,
  Phone,
  FileText,
  Target,
  TrendingUp,
  AlertTriangle,
  Clock,
  Send,
} from "lucide-react";
import { toast } from "sonner";

interface Recommendation {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  actionLabel?: string;
  action?: () => void | Promise<void>;
}

export default function ContactRecommendationsPage() {
  const { contactId } = useParams();
  const router = useRouter();
  const { open: openComposer } = useCompose();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const businessId = getStoredBusinessId() ?? undefined;
      const [insRes, revRes, momRes, contactRes] = await Promise.all([
        fetchContactInsightSnapshot(contactId as string, businessId),
        fetchContactRevenueSummary(contactId as string, businessId),
        fetchContactMomentum(contactId as string, businessId),
        fetchContactDetail(contactId as string, businessId),
      ]);

      const recs: Recommendation[] = [];
      const insight = insRes.data?.payload;
      const revenue = revRes.data;
      const momentum = momRes.data;
      const contact = contactRes.data?.contact;
      const contactName = `${contact?.firstName ?? ""} ${contact?.lastName ?? ""}`.trim() || contact?.displayName || "there";
      const phone = getContactPhone({ phone: contact?.phone ?? null, whatsappNumber: contact?.whatsappNumber ?? null });

      const addTask = async (title: string, priority: "NORMAL" | "HIGH" | "LOW" = "NORMAL") => {
        const res = await addContactTask(contactId as string, title, { priority });
        if (res.data) {
          toast.success("Task created");
        } else {
          toast.error(res.error ?? "Failed to create task");
          throw new Error(res.error ?? "Failed");
        }
      };

      const openEmail = (subject: string, _contextType: Recommendation["id"]) => {
        openComposer({
          to: contact?.email ?? "",
          subject,
          body: "",
          context: {
            type: "general",
            contactName,
          },
        });
      };

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

        let action: (() => void | Promise<void>) | undefined;
        switch (sa.kind) {
          case "send_email":
            action = () => openEmail(sa.prefill?.subject || "Quick follow-up", "ai-suggested");
            break;
          case "send_whatsapp":
            action = () => {
              if (!phone) { toast.error("No phone number available"); return; }
              window.open(buildWhatsAppLink(phone, sa.prefill?.message ?? ""), "_blank", "noopener,noreferrer");
            };
            break;
          case "schedule_call":
          case "book_appointment":
          case "create_task":
            action = () => addTask(sa.prefill?.taskTitle ?? sa.label, (sa.prefill?.priority as "NORMAL" | "HIGH" | "LOW") ?? "NORMAL");
            break;
          case "create_invoice":
            action = () => router.push("/app/commerce?tab=invoices");
            break;
          case "enroll_in_sequence":
            action = () => { toast.info("Sequences coming soon"); };
            break;
          case "review_dormant":
          default:
            action = () => openEmail("Checking in", "ai-suggested");
            break;
        }

        recs.push({
          id: "ai-suggested",
          icon: iconMap[sa.kind] || Lightbulb,
          title: sa.label,
          description: sa.description,
          priority: "high",
          actionLabel: "Act now",
          action,
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
          action: () => openEmail("Checking in", "churn-risk"),
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
          action: () => openEmail("Friendly reminder: outstanding invoice", "outstanding"),
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
          action: () => addTask("Plan re-engagement outreach", "HIGH"),
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
          action: () => openEmail("Following up on your quote", "open-quotes"),
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
          action: () => openEmail("Checking in", "no-recent-payment"),
        });
      }

      setRecommendations(recs);
      setLoading(false);
    };
    load();
  }, [contactId, openComposer, router]);

  const handleAction = async (rec: Recommendation) => {
    if (!rec.action || actingId) return;
    setActingId(rec.id);
    try {
      await rec.action();
    } finally {
      setActingId(null);
    }
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
                          <Button size="sm" onClick={() => handleAction(rec)} disabled={actingId === rec.id}>
                            {actingId === rec.id ? "Working…" : rec.actionLabel}
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
