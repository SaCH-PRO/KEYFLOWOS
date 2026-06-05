"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  Sparkles,
  Zap,
  Clock,
  AlertTriangle,
  Shield,
  Bot,
  Lightbulb,
  Copy,
  Download,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { WorkspaceShell } from "@/components/ui/workspace-shell";

interface DocTemplate {
  id: string;
  name: string;
  category: string;
  usageCount: number;
  avgTime: string;
  aiReady: boolean;
}

interface DocInsight {
  id: string;
  type: "suggestion" | "alert" | "optimization";
  title: string;
  description: string;
  actionLabel?: string;
}

interface RecentDoc {
  id: string;
  title: string;
  type: string;
  status: "draft" | "review" | "final" | "signed";
  updatedAt: string;
  aiScore?: number;
}

function TemplateCard({ template, index }: { template: DocTemplate; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-4 hover:border-[hsl(var(--kf-accent1))]/30 hover:bg-card/80 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="w-8 h-8 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
          <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        </div>
        {template.aiReady && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] font-medium">
            AI Ready
          </span>
        )}
      </div>
      <h4 className="text-xs font-semibold text-foreground mb-0.5">{template.name}</h4>
      <p className="text-[10px] text-muted-foreground mb-2">{template.category}</p>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>{template.usageCount} uses</span>
        <span>{template.avgTime} avg</span>
      </div>
    </motion.div>
  );
}

function DocRow({ doc, index }: { doc: RecentDoc; index: number }) {
  const statusConfig = {
    draft: { bg: "bg-amber-500/10", text: "text-amber-500", label: "Draft" },
    review: { bg: "bg-[hsl(var(--kf-accent2))]/10", text: "text-[hsl(var(--kf-accent2))]", label: "Review" },
    final: { bg: "bg-emerald-500/10", text: "text-emerald-500", label: "Final" },
    signed: { bg: "bg-[hsl(var(--kf-accent1))]/10", text: "text-[hsl(var(--kf-accent1))]", label: "Signed" },
  };
  const status = statusConfig[doc.status];

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0 hover:bg-muted/20 px-2 -mx-2 rounded-lg transition-colors cursor-pointer"
    >
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground truncate">{doc.title}</div>
        <div className="text-[10px] text-muted-foreground">{doc.type} &middot; {doc.updatedAt}</div>
      </div>
      <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${status.bg} ${status.text} font-medium shrink-0`}>
        {status.label}
      </span>
      {doc.aiScore !== undefined && (
        <div className="flex items-center gap-1 shrink-0">
          <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent2))]" />
          <span className="text-[10px] font-medium">{doc.aiScore}%</span>
        </div>
      )}
    </motion.div>
  );
}

export default function DocumentIntelligencePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 700);
    return () => clearTimeout(timer);
  }, []);

  const stats = useMemo(() => [
    { label: "Documents", value: "47", change: "+5 this week", icon: FileText },
    { label: "AI Generated", value: "32", change: "68% of total", icon: Sparkles },
    { label: "Avg. Time Saved", value: "18 min", change: "per document", icon: Clock },
    { label: "Compliance Score", value: "94%", change: "+2% this month", icon: Shield },
  ], []);

  const templates: DocTemplate[] = useMemo(() => [
    { id: "1", name: "Service Agreement", category: "Legal", usageCount: 24, avgTime: "4 min", aiReady: true },
    { id: "2", name: "Invoice Template", category: "Finance", usageCount: 56, avgTime: "2 min", aiReady: true },
    { id: "3", name: "Proposal", category: "Sales", usageCount: 18, avgTime: "6 min", aiReady: true },
    { id: "4", name: "NDA", category: "Legal", usageCount: 12, avgTime: "3 min", aiReady: true },
    { id: "5", name: "Quote Template", category: "Sales", usageCount: 34, avgTime: "2 min", aiReady: true },
    { id: "6", name: "Onboarding Doc", category: "Operations", usageCount: 9, avgTime: "8 min", aiReady: false },
    { id: "7", name: "Contract Amendment", category: "Legal", usageCount: 7, avgTime: "5 min", aiReady: true },
    { id: "8", name: "Meeting Minutes", category: "Operations", usageCount: 15, avgTime: "3 min", aiReady: true },
  ], []);

  const recentDocs: RecentDoc[] = useMemo(() => [
    { id: "1", title: "Q2 Service Agreement - Acme Corp", type: "Service Agreement", status: "signed", updatedAt: "2 hrs ago", aiScore: 96 },
    { id: "2", title: "Marketing Proposal v3", type: "Proposal", status: "review", updatedAt: "5 hrs ago", aiScore: 88 },
    { id: "3", title: "Invoice #2048", type: "Invoice", status: "final", updatedAt: "1 day ago" },
    { id: "4", title: "Partner NDA", type: "NDA", status: "draft", updatedAt: "2 days ago", aiScore: 92 },
    { id: "5", title: "Project Scope - Website Redesign", type: "Proposal", status: "final", updatedAt: "3 days ago", aiScore: 91 },
    { id: "6", title: "Retainer Agreement - Monthly", type: "Service Agreement", status: "signed", updatedAt: "4 days ago" },
  ], []);

  const insights: DocInsight[] = useMemo(() => [
    { id: "1", type: "optimization", title: "Template Library Gap", description: "You create 3 new contracts weekly but only have 1 contract template. Creating variants could save 45 min/week.", actionLabel: "Create Template" },
    { id: "2", type: "suggestion", title: "Auto-Generate Invoices", description: "Your invoice creation follows a predictable pattern. A flow could auto-generate and send invoices on completion.", actionLabel: "Build Flow" },
    { id: "3", type: "alert", title: "Compliance Review Due", description: "3 signed documents are approaching their annual review date. Set reminders to avoid lapses.", actionLabel: "Review Documents" },
    { id: "4", type: "optimization", title: "Signature Tracking", description: "Average time to signature: 4.2 days. Adding e-signature reminders could reduce this to 2 days.", actionLabel: "Enable Reminders" },
  ], []);

  if (loading) {
    return (
      <WorkspaceShell icon={FileText} title="Document Intelligence" subtitle="AI-powered document generation and management">
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-4 h-24 animate-pulse" />
            ))}
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell icon={FileText} title="Document Intelligence" subtitle="AI-powered document generation and management">
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
              className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
                  <s.icon className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                </div>
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </div>
              <div className="text-xl font-bold tabular-nums">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{s.change}</div>
            </motion.div>
          ))}
        </div>

        {/* Quick Create */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
        >
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Quick Create
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "AI Generate", icon: Bot, desc: "Describe what you need", color: "bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))]" },
              { label: "From Template", icon: Copy, desc: "Use existing template", color: "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]" },
              { label: "Blank Document", icon: FileText, desc: "Start from scratch", color: "bg-muted/30 text-muted-foreground" },
              { label: "Import", icon: Download, desc: "Upload existing file", color: "bg-muted/30 text-muted-foreground" },
            ].map((action) => (
              <button
                key={action.label}
                className="flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-card/30 hover:bg-card/60 transition-all text-left group"
              >
                <div className={`w-9 h-9 rounded-lg ${action.color} flex items-center justify-center shrink-0`}>
                  <action.icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{action.label}</div>
                  <div className="text-[10px] text-muted-foreground">{action.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Templates & Recent Docs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Copy className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
                Templates
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {templates.map((t, i) => (
                <TemplateCard key={t.id} template={t} index={i} />
              ))}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
          >
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              Recent Documents
            </h2>
            <div>
              {recentDocs.map((doc, i) => (
                <DocRow key={doc.id} doc={doc} index={i} />
              ))}
            </div>
          </motion.div>
        </div>

        {/* Insights */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              AI Insights
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((insight, i) => {
              const config = {
                optimization: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: Lightbulb },
                suggestion: { bg: "bg-emerald-500/5", border: "border-emerald-500/20", icon: Sparkles },
                alert: { bg: "bg-rose-500/5", border: "border-rose-500/20", icon: AlertTriangle },
              }[insight.type];
              const Icon = config.icon;
              return (
                <motion.div
                  key={insight.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.3 }}
                  className={`rounded-xl border ${config.border} ${config.bg} p-4 hover:shadow-md transition-all`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xs font-semibold text-foreground mb-1">{insight.title}</h3>
                      <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">{insight.description}</p>
                      {insight.actionLabel && (
                        <button className="text-[11px] font-medium text-[hsl(var(--kf-accent1))] hover:underline">
                          {insight.actionLabel} →
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
