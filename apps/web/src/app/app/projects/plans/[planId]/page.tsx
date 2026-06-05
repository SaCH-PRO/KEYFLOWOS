"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Trash2,
  Loader2,
  Target,
  Clock,
  Users,
  DollarSign,
  Calendar,
  ShieldAlert,
  Lightbulb,
} from "lucide-react";
import { Button, Badge, Card } from "@keyflow/ui";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { TabNav } from "@/components/ui/tab-nav";
import { getStoredBusinessId } from "@/lib/workspace";
import { useProjectPlan } from "../../hooks/use-project-plans";
import { PlanTimeline } from "../../components/plan-timeline";

const TAB_KEYS = [
  { key: "timeline", label: "Timeline" },
  { key: "strategy", label: "Strategy" },
  { key: "risks", label: "Risks" },
  { key: "swot", label: "SWOT" },
];

export default function PlanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.planId as string;
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("timeline");

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const {
    plan,
    loading,
    error,
    reorderEvents,
    analyzeEventImpact,
    executeEvent,
    completeEvent,
  } = useProjectPlan(businessId, planId);

  const statusTone: Record<string, "default" | "warning" | "info" | "success" | "danger"> = {
    draft: "default",
    reviewing: "warning",
    approved: "info",
    materialized: "success",
    rejected: "danger",
  };

  return (
    <WorkspaceShell icon={Target} title="Project Plan">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 -ml-2 text-muted-foreground"
              onClick={() => router.push("/app/projects?tab=plans")}
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Plans
            </Button>
            <h1 className="text-xl font-semibold">Plan Details</h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              {plan?.userIdea}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {plan && (
              <Badge tone={statusTone[plan.status] || "default"}>
                {plan.status}
              </Badge>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <Card variant="outlined" className="border-red-500/30">
            <div className="p-4">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </Card>
        )}

        {plan && (
          <>
            {/* Resource Estimates */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card>
                <div className="p-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Hours</p>
                    <p className="text-sm font-medium">{plan.estimatedTotalHours ?? "—"}</p>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="p-3 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Budget</p>
                    <p className="text-sm font-medium">{plan.estimatedBudget ?? "—"}</p>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="p-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">People</p>
                    <p className="text-sm font-medium">{plan.estimatedPeople ?? "—"}</p>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="p-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Duration</p>
                    <p className="text-sm font-medium">{plan.estimatedDurationDays ? `${plan.estimatedDurationDays}d` : "—"}</p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Strategy & Actions */}
            {plan.status === "draft" && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    const { approvePlan } = await import("@/lib/project-plans-api");
                    if (!businessId) return;
                    const res = await approvePlan(businessId, planId);
                    if (res.data) window.location.reload();
                  }}
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Approve & Create Project
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const { rejectPlan } = await import("@/lib/project-plans-api");
                    if (!businessId) return;
                    await rejectPlan(businessId, planId);
                    router.push("/app/projects?tab=plans");
                  }}
                >
                  <XCircle className="w-4 h-4 mr-1" /> Reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={async () => {
                    const { deletePlan } = await import("@/lib/project-plans-api");
                    if (!businessId) return;
                    await deletePlan(businessId, planId);
                    router.push("/app/projects?tab=plans");
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
              </div>
            )}

            <TabNav
              tabs={TAB_KEYS}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              layoutId="plan-detail-tab"
            />

            {activeTab === "timeline" && (
              <div className="pt-2">
                <PlanTimeline
                  events={plan.timelineEvents}
                  planStatus={plan.status}
                  onReorder={async (updates) => {
                    await reorderEvents(updates);
                  }}
                  onAnalyzeImpact={async (eventId, newSortOrder) => {
                    const res = await analyzeEventImpact(eventId, newSortOrder);
                    return res.data;
                  }}
                  onExecute={async (eventId) => {
                    await executeEvent(eventId);
                    window.location.reload();
                  }}
                  onComplete={async (eventId) => {
                    await completeEvent(eventId);
                    window.location.reload();
                  }}
                />
              </div>
            )}

            {activeTab === "strategy" && (
              <div className="pt-2">
                <Card>
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Lightbulb className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-semibold">Strategic Rationale</h3>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-line">
                      {plan.strategySummary || "No strategy summary available."}
                    </p>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === "risks" && (
              <div className="pt-2">
                <Card>
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ShieldAlert className="w-4 h-4 text-red-400" />
                      <h3 className="text-sm font-semibold">Risk Analysis</h3>
                    </div>
                    {plan.riskAnalysis && typeof plan.riskAnalysis === "object" && "risks" in plan.riskAnalysis ? (
                      <div className="space-y-3">
                        {(plan.riskAnalysis.risks as Array<{ description: string; impact: string; likelihood: string; mitigation: string }>)?.map((risk, idx) => (
                          <div key={idx} className="p-3 rounded-lg border border-border bg-background">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium">{risk.description}</span>
                              <Badge tone={risk.impact === "high" ? "danger" : risk.impact === "medium" ? "warning" : "default"}>{risk.impact}</Badge>
                              <Badge tone="default">{risk.likelihood}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">Mitigation: {risk.mitigation}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No risk analysis available.</p>
                    )}
                  </div>
                </Card>
              </div>
            )}

            {activeTab === "swot" && (
              <div className="pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {plan.swotAnalysis && typeof plan.swotAnalysis === "object" ? (
                    <>
                      <Card>
                        <div className="p-4">
                          <h3 className="text-sm font-semibold text-emerald-400 mb-2">Strengths</h3>
                          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                            {((plan.swotAnalysis as { strengths?: string[] }).strengths)?.map((s, i) => <li key={i}>{s}</li>) || <li>None listed</li>}
                          </ul>
                        </div>
                      </Card>
                      <Card>
                        <div className="p-4">
                          <h3 className="text-sm font-semibold text-red-400 mb-2">Weaknesses</h3>
                          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                            {((plan.swotAnalysis as { weaknesses?: string[] }).weaknesses)?.map((s, i) => <li key={i}>{s}</li>) || <li>None listed</li>}
                          </ul>
                        </div>
                      </Card>
                      <Card>
                        <div className="p-4">
                          <h3 className="text-sm font-semibold text-blue-400 mb-2">Opportunities</h3>
                          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                            {((plan.swotAnalysis as { opportunities?: string[] }).opportunities)?.map((s, i) => <li key={i}>{s}</li>) || <li>None listed</li>}
                          </ul>
                        </div>
                      </Card>
                      <Card>
                        <div className="p-4">
                          <h3 className="text-sm font-semibold text-amber-400 mb-2">Threats</h3>
                          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                            {((plan.swotAnalysis as { threats?: string[] }).threats)?.map((s, i) => <li key={i}>{s}</li>) || <li>None listed</li>}
                          </ul>
                        </div>
                      </Card>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground col-span-2">No SWOT analysis available.</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
