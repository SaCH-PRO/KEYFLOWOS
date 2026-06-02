"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Inbox,
  MessageSquare,
  Phone,
  Mail,
  AlertCircle,
  Star,
  Calendar,
  DollarSign,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { TabNav } from "@/components/ui/tab-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchUnifiedInbox } from "@/lib/api/omnichannel";
import { CaptureButton } from "@/components/device/capture-button";

const TABS = [
  { key: "all", label: "All", icon: Inbox },
  { key: "needs_reply", label: "Needs Reply", icon: MessageSquare },
  { key: "leads", label: "New Leads", icon: Star },
  { key: "bookings", label: "Bookings", icon: Calendar },
  { key: "payments", label: "Payments", icon: DollarSign },
  { key: "complaints", label: "Complaints", icon: AlertCircle },
  { key: "calls", label: "Missed Calls", icon: Phone },
  { key: "email", label: "Email", icon: Mail },
];

export default function InboxPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params.businessId ?? "";
  const [activeTab, setActiveTab] = useState("all");
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchUnifiedInbox>>["data"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    setIsLoading(true);
    fetchUnifiedInbox(businessId, { limit: 50 })
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setIsLoading(false));
  }, [businessId]);

  return (
    <div className="min-h-screen pb-20">
      <PageHeader
        icon={Inbox}
        title="Inbox"
        subtitle="All your business conversations in one place"
      />

      <div className="px-4 md:px-6 py-4">
        <TabNav
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      <div className="px-4 md:px-6 space-y-4">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Drafts Section */}
        {data?.drafts && data.drafts.items.length > 0 && (
          <SectionCard title="Pending Drafts" icon={CheckCircle2}>
            <div className="space-y-2">
              {data.drafts.items.slice(0, 5).map((draft: unknown) => {
                const d = draft as {
                  id: string;
                  channel: string;
                  purpose: string;
                  body: string;
                  status: string;
                  riskTier: number;
                  requiresApproval: boolean;
                };
                return (
                  <div
                    key={d.id}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="mt-0.5">
                      {d.status === "PENDING_APPROVAL" ? (
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{d.purpose}</span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {d.channel}
                        </Badge>
                        {d.requiresApproval && (
                          <Badge variant="secondary" className="text-xs">
                            Needs Approval
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate mt-1">
                        {d.body.slice(0, 120)}…
                      </p>
                    </div>
                    <Button size="sm" variant="ghost">
                      Review
                    </Button>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {/* Intents Section */}
        {data?.intents && data.intents.items.length > 0 && (
          <SectionCard title="Classified Intents" icon={Star}>
            <div className="space-y-2">
              {data.intents.items.slice(0, 5).map((intent: unknown) => {
                const i = intent as {
                  id: string;
                  intentType: string;
                  confidence: number;
                  riskLevel: string;
                  recommendedAction: string | null;
                  createdAt: string;
                };
                return (
                  <div
                    key={i.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <Badge
                      variant={i.riskLevel === "HIGH" ? "destructive" : "outline"}
                      className="text-xs capitalize shrink-0"
                    >
                      {i.intentType.replace(/_/g, " ")}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        {i.recommendedAction ?? "No action recommended"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {i.confidence}% confidence ·{" "}
                        {new Date(i.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {/* Threads Section */}
        {data?.threads && data.threads.items.length > 0 && (
          <SectionCard title="Conversations" icon={MessageSquare}>
            <div className="space-y-2">
              {data.threads.items.slice(0, 10).map((thread: unknown) => {
                const t = thread as {
                  id: string;
                  subject: string | null;
                  channel: string;
                  status: string;
                  messages: { body: string; direction: string; sentAt: string }[];
                  contact: { firstName: string | null; lastName: string | null; email: string | null } | null;
                };
                const lastMsg = t.messages?.[0];
                const contactName = t.contact
                  ? [t.contact.firstName, t.contact.lastName].filter(Boolean).join(" ") || t.contact.email
                  : "Unknown";
                return (
                  <div
                    key={t.id}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                  >
                    <div className="mt-0.5 text-muted-foreground">
                      {t.channel === "email" ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{contactName}</span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {t.channel}
                        </Badge>
                        {t.status === "open" && (
                          <span className="h-2 w-2 rounded-full bg-green-500" />
                        )}
                      </div>
                      {t.subject && (
                        <p className="text-sm text-muted-foreground truncate">{t.subject}</p>
                      )}
                      {lastMsg && (
                        <p className="text-sm text-muted-foreground truncate mt-0.5">
                          {lastMsg.direction === "INBOUND" ? "→" : "←"} {lastMsg.body.slice(0, 80)}…
                        </p>
                      )}
                    </div>
                    {lastMsg && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(lastMsg.sentAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {!isLoading && !data?.threads?.items?.length && !data?.drafts?.items?.length && !data?.intents?.items?.length && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Your inbox is empty</h3>
            <p className="text-sm text-muted-foreground max-w-xs mt-1">
              Connect WhatsApp, email, or forms to start seeing business conversations here.
            </p>
            <Button className="mt-4" variant="outline" onClick={() => {}}>
              Connect a channel
            </Button>
          </div>
        )}
      </div>

      <CaptureButton businessId={businessId} variant="fab" />
    </div>
  );
}
