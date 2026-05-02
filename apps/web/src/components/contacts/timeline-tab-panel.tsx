"use client";

import { useState } from "react";
import {
  MessageSquare,
  ListTodo,
  History,
  Copy,
  MessageCircle,
  Mail,
  StickyNote,
  AlertCircle,
  Check,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Circle,
  Sparkles,
  Heart,
  Brain,
  Zap,
  Target,
  RefreshCw,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactDetailData, ContactEvent } from "./contact-detail";
import {
  EVENT_LABELS,
  EVENT_ICONS,
  MILESTONE_ICONS,
  HEALTH_METRICS_CONFIG,
  type JourneyMilestoneData,
  type HealthMetricsData,
  type ConversationContextData,
  type AiInsightData,
} from "./tab-constants";

interface TimelineTabPanelProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  healthMetrics?: HealthMetricsData | null;
  journeyMilestones?: JourneyMilestoneData[];
  conversationContext?: ConversationContextData | null;
  aiInsight?: AiInsightData | null;
  aiInsightLoading?: boolean;
  onGenerateAiInsight?: () => Promise<void>;
  onRefreshConversationContext?: () => Promise<void>;
  onAddNote?: (body: string, source?: string) => Promise<void>;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
}

export function TimelineTabPanel({
  contact, events,
  healthMetrics, journeyMilestones = [],
  conversationContext, aiInsight, aiInsightLoading,
  onGenerateAiInsight, onRefreshConversationContext,
  onAddNote, onAddTask,
}: TimelineTabPanelProps) {
  const [timelineLimit, setTimelineLimit] = useState(20);
  const [timelineSection, setTimelineSection] = useState<"journey" | "events" | "insights">("journey");
  const [timelineEventCopied, setTimelineEventCopied] = useState<string | null>(null);
  const [aiSuggestionCopied, setAiSuggestionCopied] = useState(false);

  const waPhone = getContactPhone(contact);

  const handleCopyEvent = (eventId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setTimelineEventCopied(eventId);
    setTimeout(() => setTimelineEventCopied(null), 2000);
  };

  const handleCreateTaskFromEvent = async (eventType: string) => {
    if (!onAddTask) return;
    const label = EVENT_LABELS[eventType] || eventType;
    await onAddTask(`Follow up on: ${label}`, { priority: "NORMAL" });
  };

  const handleCreateNoteFromEvent = async (eventType: string) => {
    if (!onAddNote) return;
    const label = EVENT_LABELS[eventType] || eventType;
    await onAddNote(`Event: ${label}`, "general");
  };

  const handleCopyAiSuggestion = (text: string) => {
    navigator.clipboard.writeText(text);
    setAiSuggestionCopied(true);
    setTimeout(() => setAiSuggestionCopied(false), 2000);
  };

  const handleShareAiSuggestionWhatsApp = (text: string) => {
    if (!waPhone) return;
    window.open(buildWhatsAppLink(waPhone, text), "_blank");
  };

  const handleShareAiSuggestionEmail = (text: string) => {
    if (!contact.email) return;
    const subject = encodeURIComponent(`Following up — ${contact.firstName || "contact"}`);
    const body = encodeURIComponent(text);
    window.open(`mailto:${contact.email}?subject=${subject}&body=${body}`, "_blank");
  };

  const handleShareWhatsApp = (text: string) => {
    if (!waPhone) return;
    window.open(buildWhatsAppLink(waPhone, text), "_blank");
  };

  return (
    <>
      <div className="flex items-center gap-1">
        {([
          { key: "journey" as const, label: "Journey", icon: Clock },
          { key: "events" as const, label: "Events", icon: History },
          { key: "insights" as const, label: "Insights", icon: Brain },
        ]).map((s) => (
          <button
            key={s.key}
            onClick={() => setTimelineSection(s.key)}
            className={`text-[10px] px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1 ${
              timelineSection === s.key
                ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <s.icon className="w-3 h-3" />
            {s.label}
          </button>
        ))}
      </div>

      {timelineSection === "journey" && (
        <div className="space-y-3">
          {healthMetrics && (
            <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Heart className="w-3.5 h-3.5" style={{ color: (Object.values(healthMetrics).reduce((s, v) => s + v, 0) / 4) >= 60 ? "hsl(142 76% 36%)" : "hsl(var(--kf-accent1))" }} />
                  Contact Health
                </span>
                <span className="text-xs font-medium" style={{
                  color: (Object.values(healthMetrics).reduce((s, v) => s + v, 0) / 4) >= 80
                    ? "hsl(142 76% 36%)"
                    : (Object.values(healthMetrics).reduce((s, v) => s + v, 0) / 4) >= 60
                    ? "hsl(var(--kf-accent2))"
                    : "hsl(var(--kf-accent1))"
                }}>
                  {Math.round(Object.values(healthMetrics).reduce((s, v) => s + v, 0) / 4)}%
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {HEALTH_METRICS_CONFIG.map(({ key, label, icon: Icon }) => {
                  const value = healthMetrics[key];
                  const barColor = value >= 70 ? "hsl(142 76% 36%)" : value >= 40 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))";
                  return (
                    <div key={key} className="space-y-0.5">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Icon className="w-3 h-3" />
                        {label}
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: barColor }} />
                      </div>
                      <div className="text-[10px] font-medium" style={{ color: barColor }}>{value}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {journeyMilestones.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Clock className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                Journey with {contact.firstName || "contact"}
              </div>
              <div className="relative pl-5 space-y-3">
                <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-gradient-to-b from-[hsl(var(--kf-accent1))] via-[hsl(var(--kf-accent2))] to-muted" />
                {journeyMilestones
                  .filter((m) => !m.isNext)
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                  .map((milestone) => {
                    const config = MILESTONE_ICONS[milestone.type] || { icon: Circle, color: "hsl(var(--kf-muted-foreground))" };
                    const MIcon = config.icon;
                    return (
                      <div key={milestone.id} className="group relative flex gap-2.5">
                        <div className="absolute left-[-14px] p-1 rounded-full bg-background border-2 z-10" style={{ borderColor: config.color }}>
                          <MIcon className="w-2.5 h-2.5" style={{ color: config.color }} />
                        </div>
                        <div className="flex-1 ml-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{milestone.title}</span>
                            <span className="text-[10px] text-muted-foreground">{new Date(milestone.date).toLocaleDateString("en-TT", { month: "short", day: "numeric" })}</span>
                          </div>
                          {milestone.description && <p className="text-[11px] text-muted-foreground mt-0.5">{milestone.description}</p>}
                          {milestone.value != null && milestone.value > 0 && (
                            <p className="text-[11px] font-medium mt-0.5" style={{ color: config.color }}>TTD {milestone.value.toLocaleString()}</p>
                          )}
                          <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleCopyEvent(milestone.id, `${milestone.title} — ${new Date(milestone.date).toLocaleDateString("en-TT")}`)} className="p-1 rounded-md hover:bg-muted transition-colors" title="Copy">
                              {timelineEventCopied === milestone.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                            </button>
                            {onAddNote && (
                              <button onClick={() => handleCreateNoteFromEvent(milestone.type)} className="p-1 rounded-md hover:bg-violet-500/10 transition-colors" title="Create note from milestone">
                                <StickyNote className="w-3 h-3 text-violet-400" />
                              </button>
                            )}
                            {onAddTask && (
                              <button onClick={() => handleCreateTaskFromEvent(milestone.type)} className="p-1 rounded-md hover:bg-blue-500/10 transition-colors" title="Create task from milestone">
                                <ListTodo className="w-3 h-3 text-blue-400" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                {journeyMilestones.filter((m) => m.isNext).map((nextM) => {
                  // eslint-disable-next-line react-hooks/purity -- audited: time-relative countdown
                  const daysDiff = Math.ceil((new Date(nextM.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  return (
                    <div key={nextM.id} className="relative flex gap-2.5">
                      <div className="absolute left-[-14px] p-1 rounded-full bg-background border-2 border-dashed border-[hsl(var(--kf-accent1))] z-10">
                        <ChevronRight className="w-2.5 h-2.5 text-[hsl(var(--kf-accent1))]" />
                      </div>
                      <div className="flex-1 ml-2 p-2.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-xs flex items-center gap-1">NEXT: {nextM.title}</span>
                          <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">{daysDiff > 0 ? `${daysDiff}d away` : daysDiff === 0 ? "Today" : "Overdue"}</span>
                        </div>
                        {nextM.description && <p className="text-[11px] text-muted-foreground mt-1">{nextM.description}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <Clock className="w-6 h-6 mx-auto text-muted-foreground/40 mb-1" />
              <p className="text-xs text-muted-foreground">No journey milestones yet</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Milestones appear as the relationship develops</p>
            </div>
          )}

          {conversationContext && (
            <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                  Conversation Context
                </span>
                {onRefreshConversationContext && (
                  <button onClick={onRefreshConversationContext} className="p-1 rounded-md hover:bg-muted transition-colors" title="Refresh context">
                    <RefreshCw className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
              </div>
              {conversationContext.lastDiscussed && (
                <div className="p-2 rounded-lg bg-muted/30 text-xs">
                  <span className="text-muted-foreground">Last discussed: </span>
                  <span>{conversationContext.lastDiscussed}</span>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {conversationContext.sentiment && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    conversationContext.sentiment === "positive" ? "bg-emerald-500/10 text-emerald-400"
                    : conversationContext.sentiment === "negative" ? "bg-red-500/10 text-red-400"
                    : "bg-muted text-muted-foreground"
                  }`}>
                    {conversationContext.sentiment === "positive" ? "Positive" : conversationContext.sentiment === "negative" ? "Needs care" : "Neutral"} sentiment
                  </span>
                )}
                {conversationContext.engagementLevel && (
                  <span className="text-[10px] text-muted-foreground">
                    Engagement: <span className="font-medium capitalize">{conversationContext.engagementLevel}</span>
                  </span>
                )}
              </div>
              {conversationContext.concerns && conversationContext.concerns.length > 0 && (
                <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                  <div className="text-[10px] font-medium text-amber-400 flex items-center gap-1 mb-1"><AlertCircle className="w-2.5 h-2.5" />Concerns</div>
                  {conversationContext.concerns.map((c, i) => (<p key={i} className="text-[11px] flex items-start gap-1"><span className="text-amber-400">&bull;</span> {c}</p>))}
                </div>
              )}
              {conversationContext.preferences && conversationContext.preferences.length > 0 && (
                <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent2))]/10">
                  <div className="text-[10px] font-medium text-[hsl(var(--kf-accent2))] flex items-center gap-1 mb-1"><Heart className="w-2.5 h-2.5" />Preferences</div>
                  {conversationContext.preferences.map((p, i) => (<p key={i} className="text-[11px] flex items-start gap-1"><span className="text-[hsl(var(--kf-accent2))]">&bull;</span> {p}</p>))}
                </div>
              )}
              {conversationContext.suggestedOpening && (
                <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/10">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" />Suggested opening</span>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => handleCopyAiSuggestion(conversationContext.suggestedOpening!)} className="p-1 rounded-md hover:bg-muted transition-colors" title="Copy">
                        {aiSuggestionCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                      </button>
                      {waPhone && (
                        <button onClick={() => handleShareAiSuggestionWhatsApp(conversationContext.suggestedOpening!)} className="p-1 rounded-md hover:bg-emerald-500/10 transition-colors" title="Send via WhatsApp">
                          <MessageCircle className="w-3 h-3 text-emerald-500" />
                        </button>
                      )}
                      {contact.email && (
                        <button onClick={() => handleShareAiSuggestionEmail(conversationContext.suggestedOpening!)} className="p-1 rounded-md hover:bg-blue-500/10 transition-colors" title="Send via Email">
                          <Mail className="w-3 h-3 text-blue-400" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] italic">&ldquo;{conversationContext.suggestedOpening}&rdquo;</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {timelineSection === "events" && (
        <div className="space-y-2">
          {events.length === 0 ? (
            <div className="text-center py-6 space-y-1">
              <History className="w-6 h-6 mx-auto text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No events yet</p>
            </div>
          ) : (
            <>
              <div className="relative pl-5 space-y-2">
                <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-border/50" />
                {events.slice(0, timelineLimit).map((event) => {
                  const evConfig = EVENT_ICONS[event.type] || { icon: Circle, color: "hsl(var(--kf-muted-foreground))" };
                  const EvIcon = evConfig.icon;
                  return (
                    <div key={event.id} className="group relative flex gap-2.5">
                      <div className="absolute left-[-14px] p-1 rounded-full bg-background border-2 z-10" style={{ borderColor: evConfig.color }}>
                        <EvIcon className="w-2.5 h-2.5" style={{ color: evConfig.color }} />
                      </div>
                      <div className="flex-1 ml-2 p-2.5 rounded-xl bg-muted/30 border border-border/50">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{EVENT_LABELS[event.type] || event.type}</span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {new Date(event.createdAt).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })}
                          </span>
                        </div>
                        {(() => {
                          const data = event.data as { from?: string; to?: string; status?: string; addedTags?: string[] } | undefined;
                          return (
                            <>
                              {event.type === "status.changed" && data?.from && data?.to && (
                                <p className="text-xs text-muted-foreground mt-0.5">{data.from} &rarr; {data.to}</p>
                              )}
                              {event.type === "bulk.updated" && data?.status && (
                                <p className="text-xs text-muted-foreground mt-0.5">Status &rarr; {data.status}</p>
                              )}
                              {event.type === "bulk.updated" && data?.addedTags && (
                                <p className="text-xs text-muted-foreground mt-0.5">Tags: {data.addedTags.join(", ")}</p>
                              )}
                            </>
                          );
                        })()}
                        <div className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => handleCopyEvent(event.id, `${EVENT_LABELS[event.type] || event.type} — ${new Date(event.createdAt).toLocaleString("en-TT")}`)} className="p-1 rounded-md hover:bg-muted transition-colors" title="Copy event">
                            {timelineEventCopied === event.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                          </button>
                          {onAddNote && (
                            <button onClick={() => handleCreateNoteFromEvent(event.type)} className="p-1 rounded-md hover:bg-violet-500/10 transition-colors" title="Create note from event">
                              <StickyNote className="w-3 h-3 text-violet-400" />
                            </button>
                          )}
                          {onAddTask && (
                            <button onClick={() => handleCreateTaskFromEvent(event.type)} className="p-1 rounded-md hover:bg-blue-500/10 transition-colors" title="Create task from event">
                              <ListTodo className="w-3 h-3 text-blue-400" />
                            </button>
                          )}
                          {waPhone && (
                            <button onClick={() => handleShareWhatsApp(EVENT_LABELS[event.type] || event.type)} className="p-1 rounded-md hover:bg-emerald-500/10 transition-colors" title="Share via WhatsApp">
                              <MessageCircle className="w-3 h-3 text-emerald-500" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {events.length > timelineLimit && (
                <button onClick={() => setTimelineLimit((p) => p + 20)} className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1 transition-colors">
                  <ChevronDown className="w-3 h-3" />
                  Show more ({events.length - timelineLimit} remaining)
                </button>
              )}
              {timelineLimit > 20 && (
                <button onClick={() => setTimelineLimit(20)} className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 flex items-center justify-center gap-1 transition-colors">
                  <ChevronUp className="w-3 h-3" />
                  Show less
                </button>
              )}
            </>
          )}
        </div>
      )}

      {timelineSection === "insights" && (
        <div className="space-y-3">
          {aiInsight ? (
            <>
              <div className="rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/5 to-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent1))]/20 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] flex items-center gap-1 mb-1"><Brain className="w-3 h-3" />AI Summary</div>
                    <p className="text-sm">{aiInsight.summary}</p>
                  </div>
                  {aiInsight.confidence > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                      aiInsight.confidence >= 80 ? "bg-emerald-500/10 text-emerald-400" : aiInsight.confidence >= 50 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"
                    }`}>{aiInsight.confidence}%</span>
                  )}
                </div>
                {aiInsight.reasoning && <p className="text-[11px] text-muted-foreground italic">{aiInsight.reasoning}</p>}
              </div>

              <div className="rounded-xl bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/20 p-3 space-y-1">
                <div className="text-[10px] font-medium text-[hsl(var(--kf-accent2))] flex items-center gap-1"><Zap className="w-3 h-3" />Next Best Action</div>
                <p className="text-sm font-medium">{aiInsight.nextBestAction}</p>
                <div className="flex items-center gap-0.5 pt-1">
                  {onAddTask && (
                    <button onClick={() => onAddTask(aiInsight.nextBestAction, { priority: "HIGH" })} className="text-[10px] px-2 py-1 rounded-md bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors flex items-center gap-1">
                      <ListTodo className="w-2.5 h-2.5" />Create Task
                    </button>
                  )}
                  {onAddNote && (
                    <button onClick={() => onAddNote(aiInsight.nextBestAction, "general")} className="text-[10px] px-2 py-1 rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                      <StickyNote className="w-2.5 h-2.5" />Save as Note
                    </button>
                  )}
                </div>
              </div>

              {aiInsight.suggestedMessage && (
                <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1"><MessageSquare className="w-3 h-3" />Suggested Message</span>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => handleCopyAiSuggestion(aiInsight.suggestedMessage!)} className="p-1 rounded-md hover:bg-muted transition-colors" title="Copy">
                        {aiSuggestionCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                      </button>
                      {waPhone && (
                        <button onClick={() => handleShareAiSuggestionWhatsApp(aiInsight.suggestedMessage!)} className="p-1 rounded-md hover:bg-emerald-500/10 transition-colors" title="Send via WhatsApp">
                          <MessageCircle className="w-3 h-3 text-emerald-500" />
                        </button>
                      )}
                      {contact.email && (
                        <button onClick={() => handleShareAiSuggestionEmail(aiInsight.suggestedMessage!)} className="p-1 rounded-md hover:bg-blue-500/10 transition-colors" title="Send via Email">
                          <Mail className="w-3 h-3 text-blue-400" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm italic border-l-2 border-[hsl(var(--kf-accent1))] pl-2.5">&ldquo;{aiInsight.suggestedMessage}&rdquo;</p>
                </div>
              )}

              {aiInsight.tags && aiInsight.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {aiInsight.tags.map((tag) => (<span key={tag} className="px-2 py-0.5 text-[10px] rounded-full bg-muted text-muted-foreground">{tag}</span>))}
                </div>
              )}

              {onGenerateAiInsight && (
                <button onClick={onGenerateAiInsight} disabled={aiInsightLoading} className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <RefreshCw className={`w-3.5 h-3.5 ${aiInsightLoading ? "animate-spin" : ""}`} />
                  {aiInsightLoading ? "Analyzing..." : "Regenerate Insights"}
                </button>
              )}
            </>
          ) : (
            <div className="text-center py-6 space-y-3">
              <div className="mx-auto w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Brain className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">AI-powered insights for this contact</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">Analyzes activity, payments, and engagement</p>
              </div>
              {onGenerateAiInsight && (
                <button onClick={onGenerateAiInsight} disabled={aiInsightLoading} className="kf-btn-primary inline-flex items-center gap-1.5 text-xs">
                  <Sparkles className="w-3.5 h-3.5" />
                  {aiInsightLoading ? "Analyzing..." : "Generate Insights"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
