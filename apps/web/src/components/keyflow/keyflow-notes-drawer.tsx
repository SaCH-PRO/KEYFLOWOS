"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Sparkles,
  Pin,
  PinOff,
  Trash2,
  Save,
  RefreshCw,
  StickyNote,
  BookOpen,
  Lightbulb,
  ListChecks,
  Building2,
  Users,
  FolderKanban,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchKeyflowNotes,
  createKeyflowNote,
  updateKeyflowNote,
  deleteKeyflowNote,
  generateKeyflowNoteBrief,
  type KeyflowNote,
} from "@/lib/client";
import { useNotes, type NotesTabKey, type NotesScope } from "./notes-context";
import { getPageNote, type PageNote } from "@/lib/notes-catalog";

/** Legacy export shape used by the dashboard page (now optional). */
export interface KeyflowNotesTarget {
  type: string;
  id: string;
  label: string;
}

interface LegacyProps {
  businessId?: string;
  open?: boolean;
  target?: KeyflowNotesTarget | null;
  onClose?: () => void;
}

/**
 * Unified Notes drawer. Renders a single, page-aware drawer with four tabs:
 * Page · Contact · Project · Business. The Page tab shows the typed Notes
 * catalog entry (briefing, walkthrough, key terms); user-authored notes are
 * stored against whatever scope is active.
 *
 * The drawer can be driven globally via the NotesProvider (preferred) or
 * controlled by the legacy `open`/`target` props for backwards compatibility.
 */
export function KeyflowNotesDrawer(props: LegacyProps = {}) {
  const ctx = useNotes();
  const businessId = props.businessId ?? ctx.businessId ?? "";

  // Sync legacy controlled mode → context.
  useEffect(() => {
    if (props.open === undefined) return;
    if (props.open && props.target) {
      ctx.openNotes({
        scope: { kind: legacyTypeToKind(props.target.type), id: props.target.id, label: props.target.label } as NotesScope,
      });
    } else if (props.open === false) {
      ctx.closeNotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.target?.id]);

  const open = ctx.open;
  const handleClose = () => {
    ctx.closeNotes();
    props.onClose?.();
  };

  const scope = ctx.scope;
  const activeTab = ctx.activeTab;

  const targetForApi = useMemo(() => scopeToTarget(scope, ctx.pageNote), [scope, ctx.pageNote]);
  const pageNoteForTab = useMemo<PageNote | undefined>(() => {
    if (scope?.kind === "page") return getPageNote(scope.pageKey) ?? ctx.pageNote;
    return ctx.pageNote;
  }, [scope, ctx.pageNote]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[55]"
            onClick={handleClose}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] z-[56] flex flex-col"
            style={{
              background: "hsl(var(--card))",
              borderLeft: "1px solid hsl(var(--border))",
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Notes"
          >
            <DrawerHeader
              scope={scope}
              pageNote={pageNoteForTab}
              onClose={handleClose}
            />
            <TabBar
              activeTab={activeTab}
              onChange={(t) => ctx.setActiveTab(t)}
              hasContact={Boolean(scope?.kind === "contact" || (scope === null && false))}
              hasProject={Boolean(scope?.kind === "project")}
            />
            <div className="flex-1 overflow-y-auto">
              {activeTab === "page" ? (
                <PageTab pageNote={pageNoteForTab} />
              ) : (
                <NotesList
                  businessId={businessId}
                  target={targetForApi}
                  emptyHint={emptyHintFor(activeTab)}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function legacyTypeToKind(type: string): NotesScope["kind"] {
  if (type.includes("contact")) return "contact";
  if (type.includes("project")) return "project";
  if (type.includes("business")) return "business";
  return "page";
}

function scopeToTarget(
  scope: NotesScope | null,
  pageNote: PageNote | undefined,
): KeyflowNotesTarget | null {
  if (!scope) {
    if (pageNote) return { type: "page", id: pageNote.key, label: pageNote.title };
    return null;
  }
  switch (scope.kind) {
    case "page":
      return { type: "page", id: scope.pageKey, label: getPageNote(scope.pageKey)?.title ?? scope.pageKey };
    case "contact":
      return { type: "contact", id: scope.id, label: scope.label };
    case "project":
      return { type: "project", id: scope.id, label: scope.label };
    case "business":
      return { type: "business", id: scope.id, label: scope.label };
  }
}

function emptyHintFor(tab: NotesTabKey): string {
  switch (tab) {
    case "contact":
      return "No contact notes yet. Open a contact to capture conversation notes.";
    case "project":
      return "No project notes yet. Open a project to capture meeting & status notes.";
    case "business":
      return "No business notes yet. Use this for cross-cutting reminders & SOPs.";
    default:
      return "No notes yet. Capture the first one above.";
  }
}

function DrawerHeader({
  scope,
  pageNote,
  onClose,
}: {
  scope: NotesScope | null;
  pageNote: PageNote | undefined;
  onClose: () => void;
}) {
  const Icon = pageNote?.icon ?? StickyNote;
  const title = scopeTitle(scope, pageNote);
  const subtitle = scopeSubtitle(scope, pageNote);
  return (
    <div className="p-4 border-b border-border flex items-start gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--kf-accent1)/0.2), hsl(var(--kf-accent2)/0.2))",
        }}
      >
        <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Notes
        </div>
        <div className="text-sm font-semibold truncate">{title}</div>
        {subtitle && (
          <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
        )}
      </div>
      <button
        onClick={onClose}
        className="w-8 h-8 rounded-lg hover:bg-muted/50 flex items-center justify-center"
        aria-label="Close Notes"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function scopeTitle(scope: NotesScope | null, pageNote: PageNote | undefined) {
  if (scope?.kind === "contact") return scope.label;
  if (scope?.kind === "project") return scope.label;
  if (scope?.kind === "business") return scope.label || "Business notes";
  return pageNote?.title ?? "Notes";
}

function scopeSubtitle(scope: NotesScope | null, pageNote: PageNote | undefined) {
  if (scope?.kind === "page" || !scope) return pageNote?.subtitle ?? "";
  return pageNote ? `In ${pageNote.title}` : "";
}

function TabBar({
  activeTab,
  onChange,
}: {
  activeTab: NotesTabKey;
  onChange: (t: NotesTabKey) => void;
  hasContact?: boolean;
  hasProject?: boolean;
}) {
  const tabs: { key: NotesTabKey; label: string; icon: React.ElementType }[] = [
    { key: "page", label: "Page", icon: BookOpen },
    { key: "contact", label: "Contact", icon: Users },
    { key: "project", label: "Project", icon: FolderKanban },
    { key: "business", label: "Business", icon: Building2 },
  ];
  return (
    <div role="tablist" className="flex border-b border-border bg-muted/20">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = activeTab === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors ${
              active
                ? "text-foreground border-b-2"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={
              active
                ? {
                    borderColor: "hsl(var(--kf-accent1))",
                    background: "hsl(var(--kf-accent1) / 0.05)",
                  }
                : undefined
            }
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function PageTab({ pageNote }: { pageNote: PageNote | undefined }) {
  if (!pageNote) {
    return (
      <div className="p-6 text-xs text-muted-foreground text-center">
        No briefing for this page yet.
      </div>
    );
  }
  return (
    <div className="p-4 space-y-5">
      {/* Briefing */}
      <section aria-labelledby="notes-briefing">
        <SectionHeader id="notes-briefing" icon={BookOpen} label="Briefing" />
        <div className="space-y-2 text-[12px] leading-relaxed text-foreground/80 whitespace-pre-line">
          {pageNote.briefing}
        </div>
      </section>

      {/* Walkthrough */}
      {pageNote.walkthroughSteps.length > 0 && (
        <section aria-labelledby="notes-walkthrough">
          <SectionHeader id="notes-walkthrough" icon={ListChecks} label="Walkthrough" />
          <ol className="space-y-2">
            {pageNote.walkthroughSteps.map((step, i) => {
              const Icon = step.icon ?? Lightbulb;
              return (
                <li
                  key={`${step.title}-${i}`}
                  className="flex gap-2.5 p-2.5 rounded-lg"
                  style={{
                    background: "hsl(var(--kf-muted) / 0.25)",
                    border: "1px solid hsl(var(--kf-border) / 0.3)",
                  }}
                >
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                    style={{
                      background: "hsl(var(--kf-accent1) / 0.15)",
                      color: "hsl(var(--kf-accent1))",
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Icon
                        className="w-3 h-3 shrink-0"
                        style={{ color: "hsl(var(--kf-accent1))" }}
                      />
                      <p className="text-[12px] font-medium leading-tight">{step.title}</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {step.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Key terms */}
      {pageNote.keyTerms.length > 0 && (
        <section aria-labelledby="notes-terms">
          <SectionHeader id="notes-terms" icon={Sparkles} label="Key terms" />
          <ul className="space-y-2">
            {pageNote.keyTerms.map((kt) => (
              <li
                key={kt.term}
                className="rounded-lg p-2.5"
                style={{
                  background: "hsl(var(--kf-muted) / 0.18)",
                  border: "1px solid hsl(var(--kf-border) / 0.25)",
                }}
              >
                <div className="text-[11px] font-semibold">{kt.term}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  {kt.definition}
                </div>
                {kt.formula && (
                  <div
                    className="text-[10px] mt-1 px-2 py-1 rounded font-mono"
                    style={{
                      background: "hsl(var(--kf-muted) / 0.4)",
                      color: "hsl(var(--kf-accent1))",
                    }}
                  >
                    {kt.formula}
                  </div>
                )}
                {kt.goodValue && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    <span
                      className="font-medium"
                      style={{ color: "hsl(var(--kf-success))" }}
                    >
                      Good:{" "}
                    </span>
                    {kt.goodValue}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Related */}
      {pageNote.relatedNotes.length > 0 && (
        <section aria-labelledby="notes-related">
          <SectionHeader id="notes-related" icon={ArrowRight} label="Related" />
          <div className="flex flex-wrap gap-1.5">
            {pageNote.relatedNotes.map((r) => (
              <a
                key={r.pageKey}
                href={getPageNote(r.pageKey)?.href ?? "#"}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full transition-colors hover:bg-muted/40"
                style={{
                  background: "hsl(var(--kf-accent1) / 0.08)",
                  color: "hsl(var(--kf-accent1))",
                }}
              >
                {r.label}
                <ChevronRight className="w-3 h-3" />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeader({
  id,
  icon: Icon,
  label,
}: {
  id: string;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <h4
      id={id}
      className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2"
    >
      <Icon className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
      {label}
    </h4>
  );
}

function NotesList({
  businessId,
  target,
  emptyHint,
}: {
  businessId: string;
  target: KeyflowNotesTarget | null;
  emptyHint: string;
}) {
  const [notes, setNotes] = useState<KeyflowNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [briefingId, setBriefingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!target || !businessId) return;
    setLoading(true);
    const res = await fetchKeyflowNotes(businessId, target.type, target.id);
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setNotes(res.data?.items ?? []);
  }, [businessId, target]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets draft when target changes
    setDraft("");
    void load();
  }, [load]);

  if (!target || !businessId) {
    return (
      <div className="p-6 text-[11px] text-muted-foreground text-center">{emptyHint}</div>
    );
  }

  const handleSave = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    const res = await createKeyflowNote(businessId, {
      targetType: target.type,
      targetId: target.id,
      targetLabel: target.label,
      body: draft.trim(),
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Note saved");
    setDraft("");
    void load();
  };

  const togglePinned = async (note: KeyflowNote) => {
    const res = await updateKeyflowNote(businessId, note.id, { pinned: !note.pinned });
    if (res.error) {
      toast.error(res.error);
      return;
    }
    void load();
  };

  const remove = async (note: KeyflowNote) => {
    if (!confirm("Delete this note?")) return;
    const res = await deleteKeyflowNote(businessId, note.id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Note deleted");
    void load();
  };

  const generateBrief = async (note: KeyflowNote) => {
    setBriefingId(note.id);
    const res = await generateKeyflowNoteBrief(businessId, note.id);
    setBriefingId(null);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("AI brief ready");
    void load();
  };

  return (
    <div className="flex flex-col">
      <div className="p-4 border-b border-border space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Capture a note for ${target.label}…`}
          rows={3}
          className="kf-input w-full text-sm resize-none"
        />
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={!draft.trim() || saving}
            className="px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 flex items-center gap-1.5"
            style={{
              background:
                "linear-gradient(to right, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
              color: "white",
            }}
          >
            {saving ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Save className="w-3 h-3" />
            )}
            Save note
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
            Loading notes…
          </div>
        ) : notes.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">{emptyHint}</div>
        ) : (
          notes.map((n) => (
            <div
              key={n.id}
              className="kf-card p-3 space-y-2"
              style={
                n.pinned
                  ? {
                      border: "1px solid hsl(var(--kf-accent1) / 0.4)",
                      background: "hsl(var(--kf-accent1) / 0.04)",
                    }
                  : undefined
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-[10px] text-muted-foreground">
                  {new Date(n.createdAt).toLocaleString()}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => togglePinned(n)}
                    className="p-1 rounded hover:bg-muted/50"
                    aria-label={n.pinned ? "Unpin" : "Pin"}
                  >
                    {n.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => remove(n)}
                    className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="text-sm whitespace-pre-wrap">{n.body}</div>
              {n.aiBrief ? (
                <div
                  className="p-2 rounded-lg text-xs"
                  style={{
                    background:
                      "linear-gradient(to right, hsl(var(--kf-accent1)/0.08), hsl(var(--kf-accent2)/0.08))",
                    border: "1px solid hsl(var(--kf-accent1)/0.2)",
                  }}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <Sparkles
                      className="w-3 h-3"
                      style={{ color: "hsl(var(--kf-accent1))" }}
                    />
                    <span
                      className="text-[10px] uppercase tracking-wide font-semibold"
                      style={{ color: "hsl(var(--kf-accent1))" }}
                    >
                      AI Brief
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap">{n.aiBrief}</div>
                </div>
              ) : (
                <button
                  onClick={() => generateBrief(n)}
                  disabled={briefingId === n.id}
                  className="text-[10px] flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  {briefingId === n.id ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  Generate AI brief
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
