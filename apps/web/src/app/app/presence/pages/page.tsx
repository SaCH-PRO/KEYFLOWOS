"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ArrowDown, ArrowUp, Eye, EyeOff, Globe, Loader2, Monitor, Plus, Rocket,
  Save, Smartphone, Sparkles, Trash2, Undo2, // Plus/Trash2 used in nested array editors (gallery, FAQ items)
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchPresenceDraft, savePresenceDraft, fetchPresenceDiff,
  createPresencePreview, publishPresence, unpublishPresence,
  fetchPresenceCompleteness, type PresencePayload, type PresenceSection,
  type PresenceSectionType, type PresenceDiffResponse,
} from "@/lib/client";
import { API_BASE } from "@/lib/api";

const SECTION_LABELS: Record<PresenceSectionType, { label: string; description: string }> = {
  hero: { label: "Hero", description: "Headline, subheadline, CTA, cover image" },
  about: { label: "About", description: "Tell visitors who you are" },
  services: { label: "Services", description: "Bookable services from your catalog" },
  products: { label: "Products", description: "Featured products from your catalog" },
  trust: { label: "Trust & Credentials", description: "Awards, certifications, guarantees" },
  gallery: { label: "Gallery / Media", description: "Photos and videos" },
  faq: { label: "FAQ", description: "Frequently asked questions" },
  contact: { label: "Contact / WhatsApp", description: "Ways customers can reach you" },
  location: { label: "Location & Hours", description: "Address, map and business hours" },
  custom_html: { label: "Custom HTML", description: "Raw HTML for advanced customization" },
};

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

export default function PresencePage() {
  const [businessId, setBusinessId] = useState<string | null>(() => getStoredBusinessId());
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<PresencePayload | null>(null);
  const [savedPayload, setSavedPayload] = useState<PresencePayload | null>(null);
  const [draftStatus, setDraftStatus] = useState<string>("DRAFT");
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [unpublishedAt, setUnpublishedAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"sections" | "branding" | "seo" | "domain">("sections");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [diff, setDiff] = useState<PresenceDiffResponse | null>(null);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [completenessScore, setCompletenessScore] = useState<number | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  useEffect(() => {
    if (!businessId) {
      const id = getStoredBusinessId();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (id) setBusinessId(id);
    }
  }, [businessId]);

  const loadDraft = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await fetchPresenceDraft(businessId);
    if (res.error || !res.data) {
      toast.error(res.error || "Failed to load presence draft");
      setLoading(false);
      return;
    }
    setPayload(res.data.draft.payload);
    setSavedPayload(clone(res.data.draft.payload));
    setDraftStatus(res.data.draft.status);
    setPreviewToken(res.data.draft.previewToken);
    setPublishedAt(res.data.published?.publishedAt ?? null);
    setUnpublishedAt(res.data.published?.unpublishedAt ?? null);
    if (res.data.draft.payload.sections.length > 0) {
      setActiveSectionId(res.data.draft.payload.sections[0].id);
    }
    setLoading(false);
    // Always have an active preview token so the iframe shows the live draft
    // (not a published or fallback version). The token rotates each call.
    if (!res.data.draft.previewToken) {
      const tok = await createPresencePreview(businessId);
      if (tok.data) setPreviewToken(tok.data.previewToken);
    }
    const c = await fetchPresenceCompleteness(businessId);
    if (c.data) setCompletenessScore(c.data.score);
  }, [businessId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDraft().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadDraft]);

  const dirty = useMemo(() => {
    if (!payload || !savedPayload) return false;
    return JSON.stringify(payload) !== JSON.stringify(savedPayload);
  }, [payload, savedPayload]);

  const updatePayload = useCallback((mut: (p: PresencePayload) => void) => {
    setPayload((cur) => {
      if (!cur) return cur;
      const next = clone(cur);
      mut(next);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!businessId || !payload) return;
    setSaving(true);
    const res = await savePresenceDraft(businessId, payload);
    setSaving(false);
    if (res.error) { toast.error(res.error); return; }
    setSavedPayload(clone(payload));
    setPreviewNonce((n) => n + 1);
    toast.success("Draft saved");
    const c = await fetchPresenceCompleteness(businessId);
    if (c.data) setCompletenessScore(c.data.score);
  }, [businessId, payload]);

  // Auto-refresh the iframe preview a short moment after the user stops
  // typing, so the live pane reflects the in-progress draft. We save first
  // then bump the iframe key so the latest payload is re-fetched.
  useEffect(() => {
    if (!businessId || !payload || !savedPayload) return;
    if (JSON.stringify(payload) === JSON.stringify(savedPayload)) return;
    const t = setTimeout(() => {
      void (async () => {
        const res = await savePresenceDraft(businessId, payload);
        if (!res.error) {
          setSavedPayload(clone(payload));
          setPreviewNonce((n) => n + 1);
        }
      })();
    }, 1500);
    return () => clearTimeout(t);
  }, [businessId, payload, savedPayload]);

  const handleOpenPreview = useCallback(async () => {
    if (!businessId) return;
    if (dirty) await handleSave();
    const res = await createPresencePreview(businessId);
    if (res.error || !res.data) { toast.error(res.error || "Failed to create preview"); return; }
    setPreviewToken(res.data.previewToken);
    setDraftStatus("PREVIEW");
    toast.success("Preview link created");
    if (typeof window !== "undefined") {
      window.open(`/site/preview/${res.data.previewToken}`, "_blank");
    }
  }, [businessId, dirty, handleSave]);

  const handleOpenPublishConfirm = useCallback(async () => {
    if (!businessId) return;
    if (dirty) await handleSave();
    const res = await fetchPresenceDiff(businessId);
    if (res.error || !res.data) { toast.error(res.error || "Failed to load diff"); return; }
    setDiff(res.data);
    setShowPublishConfirm(true);
  }, [businessId, dirty, handleSave]);

  const handlePublish = useCallback(async () => {
    if (!businessId) return;
    setPublishing(true);
    const res = await publishPresence(businessId);
    setPublishing(false);
    setShowPublishConfirm(false);
    if (res.error || !res.data) { toast.error(res.error || "Publish failed"); return; }
    setPublishedAt(res.data.publishedAt);
    setUnpublishedAt(null);
    toast.success(`Published version ${res.data.version}`);
  }, [businessId]);

  const handleUnpublish = useCallback(async () => {
    if (!businessId) return;
    setUnpublishing(true);
    const res = await unpublishPresence(businessId);
    setUnpublishing(false);
    setShowUnpublishConfirm(false);
    if (res.error) { toast.error(res.error); return; }
    setUnpublishedAt(new Date().toISOString());
    toast.success("Site unpublished — back to Draft");
  }, [businessId]);

  const handleDiscard = useCallback(() => {
    if (!savedPayload) return;
    setPayload(clone(savedPayload));
    toast.info("Discarded unsaved changes");
  }, [savedPayload]);

  const moveSection = useCallback((index: number, dir: -1 | 1) => {
    updatePayload((p) => {
      const target = index + dir;
      if (target < 0 || target >= p.sections.length) return;
      const [moved] = p.sections.splice(index, 1);
      p.sections.splice(target, 0, moved);
    });
  }, [updatePayload]);

  const toggleSection = useCallback((index: number) => {
    updatePayload((p) => { p.sections[index].visible = !p.sections[index].visible; });
  }, [updatePayload]);

  const isPublished = !!(publishedAt && !unpublishedAt);
  const stateLabel = isPublished ? "Published" : (draftStatus === "PREVIEW" ? "Preview" : "Draft");
  const stateColor = isPublished ? "text-emerald-500" : (draftStatus === "PREVIEW" ? "text-amber-500" : "text-slate-400");

  if (loading || !payload) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading presence editor…
      </div>
    );
  }

  const activeSection = payload.sections.find((s) => s.id === activeSectionId) ?? null;
  const activeSectionIndex = payload.sections.findIndex((s) => s.id === activeSectionId);
  const previewUrl = previewToken
    ? `/site/preview/${previewToken}`
    : (payload.slug ? `/site/${payload.slug}` : "");

  return (
    <div className="space-y-4" aria-label="Presence editor">
      <header className="flex items-center justify-between gap-3 rounded-2xl border border-border/40 bg-slate-900/40 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-orange-400" />
            <h1 className="text-base font-semibold">Presence editor</h1>
            <span className={`text-xs font-medium ${stateColor}`}>· {stateLabel}</span>
            {completenessScore !== null && (
              <span className="text-xs text-muted-foreground">· Completeness {completenessScore}%</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {payload.slug ? `${API_BASE.replace(/^https?:\/\//, "").split("/")[0]}/${payload.slug}` : "Configure a slug to publish"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={handleDiscard}>
              <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Discard
            </Button>
          )}
          <Button variant="subtle" size="sm" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
            Save draft
          </Button>
          <Button variant="subtle" size="sm" onClick={handleOpenPreview}>
            <Eye className="w-3.5 h-3.5 mr-1.5" /> Preview
          </Button>
          {isPublished ? (
            <Button variant="ghost" size="sm" onClick={() => setShowUnpublishConfirm(true)}>
              <EyeOff className="w-3.5 h-3.5 mr-1.5" /> Unpublish
            </Button>
          ) : null}
          <Button variant="default" size="sm" onClick={handleOpenPublishConfirm}>
            <Rocket className="w-3.5 h-3.5 mr-1.5" /> Publish
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        <aside className="space-y-3">
          <nav role="tablist" className="flex items-center gap-1 p-1 rounded-xl border border-border/40 bg-slate-900/40">
            {(["sections", "branding", "seo", "domain"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={activeTab === t}
                onClick={() => setActiveTab(t)}
                className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                  activeTab === t ? "bg-orange-500/15 text-orange-200" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "domain" ? "Slug & Domain" : t}
              </button>
            ))}
          </nav>

          {activeTab === "sections" && (
            <SectionsPanel
              payload={payload}
              activeSectionId={activeSectionId}
              setActiveSectionId={setActiveSectionId}
              moveSection={moveSection}
              toggleSection={toggleSection}
            />
          )}
          {activeTab === "branding" && (
            <BrandingPanel payload={payload} updatePayload={updatePayload} />
          )}
          {activeTab === "seo" && (
            <SeoPanel payload={payload} updatePayload={updatePayload} />
          )}
          {activeTab === "domain" && (
            <DomainPanel payload={payload} updatePayload={updatePayload} />
          )}

          {activeTab === "sections" && activeSection && (
            <SectionEditor
              section={activeSection}
              index={activeSectionIndex}
              onChange={(data) => updatePayload((p) => { p.sections[activeSectionIndex].data = data; })}
            />
          )}
        </aside>

        <section className="rounded-2xl border border-border/40 bg-slate-950/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-muted-foreground">Live preview</div>
            <div className="flex items-center gap-1 p-1 rounded-lg border border-border/40">
              <button
                onClick={() => setViewport("desktop")}
                className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 ${viewport === "desktop" ? "bg-orange-500/15 text-orange-200" : "text-muted-foreground"}`}
                aria-pressed={viewport === "desktop"}
              >
                <Monitor className="w-3.5 h-3.5" /> Desktop
              </button>
              <button
                onClick={() => setViewport("mobile")}
                className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 ${viewport === "mobile" ? "bg-orange-500/15 text-orange-200" : "text-muted-foreground"}`}
                aria-pressed={viewport === "mobile"}
              >
                <Smartphone className="w-3.5 h-3.5" /> Mobile
              </button>
            </div>
          </div>
          <div className="flex justify-center">
            <div
              className="bg-white rounded-lg overflow-hidden border border-border/40 transition-all"
              style={{ width: viewport === "mobile" ? 390 : "100%", maxWidth: viewport === "mobile" ? 390 : 1200, height: 720 }}
            >
              {previewUrl ? (
                <iframe
                  key={`${viewport}-${previewToken ?? payload.slug}-${previewNonce}`}
                  src={previewUrl}
                  title="Site preview"
                  className="w-full h-full"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-sm text-slate-500 p-6 text-center">
                  <Sparkles className="w-6 h-6 mb-2 text-orange-400" />
                  Set a slug in the &quot;Slug &amp; Domain&quot; tab and click Preview to render the site.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={showPublishConfirm}
        title={diff?.hasPublished ? `Publish version ${(diff.publishedVersion ?? 0) + 1}?` : "Publish your site?"}
        message={
          diff && diff.diffs.length > 0
            ? `${diff.diffs.length} change${diff.diffs.length !== 1 ? "s" : ""} will go live: ${diff.diffs.slice(0, 5).map((d) => d.path).join(", ")}${diff.diffs.length > 5 ? "…" : ""}.`
            : (diff?.hasPublished ? "No changes detected since last publish — re-publishing will refresh the live version." : "This will make your site visible to the public.")
        }
        confirmLabel={publishing ? "Publishing…" : "Publish"}
        cancelLabel="Cancel"
        onConfirm={handlePublish}
        onCancel={() => setShowPublishConfirm(false)}
      />
      <ConfirmDialog
        open={showUnpublishConfirm}
        title="Unpublish your site?"
        message="The public site will be removed from search and replaced with a 'not found' page. You can re-publish at any time."
        confirmLabel={unpublishing ? "Unpublishing…" : "Unpublish"}
        cancelLabel="Keep live"
        variant="danger"
        onConfirm={handleUnpublish}
        onCancel={() => setShowUnpublishConfirm(false)}
      />
    </div>
  );
}

/**
 * Fixed presence section set: every published presence has the same canonical
 * sections and operators reorder + toggle visibility (no add/remove). This
 * keeps the data model and SEO output predictable across all sites.
 */
function SectionsPanel({
  payload, activeSectionId, setActiveSectionId, moveSection, toggleSection,
}: {
  payload: PresencePayload;
  activeSectionId: string | null;
  setActiveSectionId: (id: string) => void;
  moveSection: (index: number, dir: -1 | 1) => void;
  toggleSection: (index: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-2 space-y-1">
      {payload.sections.map((sec, idx) => {
        const meta = SECTION_LABELS[sec.type];
        const isActive = sec.id === activeSectionId;
        return (
          <div
            key={sec.id}
            className={`group flex items-center gap-1.5 p-2 rounded-lg cursor-pointer transition-colors ${
              isActive ? "bg-orange-500/10 border border-orange-500/30" : "hover:bg-slate-800/40 border border-transparent"
            }`}
            onClick={() => setActiveSectionId(sec.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{meta.label}</div>
              <div className="text-[11px] text-muted-foreground truncate">{meta.description}</div>
            </div>
            <button
              className="p-1 rounded hover:bg-slate-700/50"
              onClick={(e) => { e.stopPropagation(); moveSection(idx, -1); }}
              disabled={idx === 0}
              aria-label="Move up"
            ><ArrowUp className="w-3 h-3" /></button>
            <button
              className="p-1 rounded hover:bg-slate-700/50"
              onClick={(e) => { e.stopPropagation(); moveSection(idx, 1); }}
              disabled={idx === payload.sections.length - 1}
              aria-label="Move down"
            ><ArrowDown className="w-3 h-3" /></button>
            <button
              className="p-1 rounded hover:bg-slate-700/50"
              onClick={(e) => { e.stopPropagation(); toggleSection(idx); }}
              aria-label={sec.visible ? "Hide" : "Show"}
            >{sec.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-muted-foreground" />}</button>
          </div>
        );
      })}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full px-2.5 py-1.5 rounded-md bg-slate-950/60 border border-border/40 text-xs focus:outline-none focus:border-orange-500/60";

function SectionEditor({
  section, index, onChange,
}: {
  section: PresenceSection;
  index: number;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const meta = SECTION_LABELS[section.type];
  const data = section.data;

  const setField = (key: string, value: unknown) => onChange({ ...data, [key]: value });

  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-3 space-y-2">
      <div className="text-xs font-semibold flex items-center gap-2">
        Editing: {meta.label} <span className="text-[10px] text-muted-foreground">#{index + 1}</span>
      </div>
      {section.type === "hero" && (
        <>
          <FieldRow label="Headline">
            <input className={inputCls} value={(data.headline as string) ?? ""} onChange={(e) => setField("headline", e.target.value)} />
          </FieldRow>
          <FieldRow label="Subheadline">
            <input className={inputCls} value={(data.subheadline as string) ?? ""} onChange={(e) => setField("subheadline", e.target.value)} />
          </FieldRow>
          <FieldRow label="CTA label">
            <input className={inputCls} value={(data.ctaLabel as string) ?? ""} onChange={(e) => setField("ctaLabel", e.target.value)} />
          </FieldRow>
          <FieldRow label="Cover image URL">
            <input className={inputCls} value={(data.coverImageUrl as string) ?? ""} onChange={(e) => setField("coverImageUrl", e.target.value)} />
          </FieldRow>
        </>
      )}
      {section.type === "about" && (
        <>
          <FieldRow label="Heading">
            <input className={inputCls} value={(data.heading as string) ?? ""} onChange={(e) => setField("heading", e.target.value)} />
          </FieldRow>
          <FieldRow label="Body">
            <textarea className={inputCls} rows={4} value={(data.body as string) ?? ""} onChange={(e) => setField("body", e.target.value)} />
          </FieldRow>
        </>
      )}
      {(section.type === "services" || section.type === "products") && (
        <>
          <FieldRow label="Heading">
            <input className={inputCls} value={(data.heading as string) ?? ""} onChange={(e) => setField("heading", e.target.value)} />
          </FieldRow>
          <p className="text-[11px] text-muted-foreground">Items render automatically from your catalog. Use the Catalog mode in Store to manage which items appear.</p>
        </>
      )}
      {section.type === "trust" && (
        <ListEditor
          label="Trust items"
          items={(data.items as string[]) ?? []}
          onChange={(items) => setField("items", items)}
          placeholder="e.g. SSL secure checkout"
        />
      )}
      {section.type === "gallery" && (
        <ListEditor
          label="Image URLs"
          items={(data.images as string[]) ?? []}
          onChange={(items) => setField("images", items)}
          placeholder="https://…"
        />
      )}
      {section.type === "faq" && (
        <FaqEditor
          entries={(data.entries as { question: string; answer: string }[]) ?? []}
          onChange={(entries) => setField("entries", entries)}
        />
      )}
      {section.type === "contact" && (
        <>
          <FieldRow label="Heading">
            <input className={inputCls} value={(data.heading as string) ?? ""} onChange={(e) => setField("heading", e.target.value)} />
          </FieldRow>
          <Toggle label="Show WhatsApp" checked={(data.showWhatsApp as boolean) ?? true} onChange={(v) => setField("showWhatsApp", v)} />
          <Toggle label="Show email" checked={(data.showEmail as boolean) ?? true} onChange={(v) => setField("showEmail", v)} />
          <Toggle label="Show phone" checked={(data.showPhone as boolean) ?? true} onChange={(v) => setField("showPhone", v)} />
        </>
      )}
      {section.type === "location" && (
        <>
          <Toggle label="Show map" checked={(data.showMap as boolean) ?? true} onChange={(v) => setField("showMap", v)} />
          <Toggle label="Show business hours" checked={(data.showHours as boolean) ?? true} onChange={(v) => setField("showHours", v)} />
        </>
      )}
      {section.type === "custom_html" && (
        <FieldRow label="HTML (rendered as-is — be careful with untrusted content)">
          <textarea className={`${inputCls} font-mono`} rows={8} value={(data.html as string) ?? ""} onChange={(e) => setField("html", e.target.value)} />
        </FieldRow>
      )}
    </div>
  );
}

function ListEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  return (
    <FieldRow label={label}>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex gap-1">
            <input
              className={inputCls}
              value={item}
              placeholder={placeholder}
              onChange={(e) => { const next = [...items]; next[i] = e.target.value; onChange(next); }}
            />
            <button
              className="px-2 rounded-md bg-rose-500/10 text-rose-400 text-xs"
              onClick={() => { const next = [...items]; next.splice(i, 1); onChange(next); }}
              aria-label="Remove"
            ><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
        <button
          className="text-[11px] px-2 py-1 rounded-md bg-slate-800/40 hover:bg-slate-800/70"
          onClick={() => onChange([...items, ""])}
        ><Plus className="w-3 h-3 inline mr-1" /> Add</button>
      </div>
    </FieldRow>
  );
}

function FaqEditor({ entries, onChange }: { entries: { question: string; answer: string }[]; onChange: (entries: { question: string; answer: string }[]) => void }) {
  return (
    <div className="space-y-2">
      {entries.map((e, i) => (
        <div key={i} className="space-y-1 p-2 rounded-md border border-border/40">
          <input
            className={inputCls}
            placeholder="Question"
            value={e.question}
            onChange={(ev) => { const next = [...entries]; next[i] = { ...e, question: ev.target.value }; onChange(next); }}
          />
          <textarea
            className={inputCls}
            rows={2}
            placeholder="Answer"
            value={e.answer}
            onChange={(ev) => { const next = [...entries]; next[i] = { ...e, answer: ev.target.value }; onChange(next); }}
          />
          <button
            className="text-[11px] text-rose-400"
            onClick={() => { const next = [...entries]; next.splice(i, 1); onChange(next); }}
          >Remove</button>
        </div>
      ))}
      <button
        className="text-[11px] px-2 py-1 rounded-md bg-slate-800/40 hover:bg-slate-800/70"
        onClick={() => onChange([...entries, { question: "", answer: "" }])}
      ><Plus className="w-3 h-3 inline mr-1" /> Add FAQ</button>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between text-xs py-1 cursor-pointer">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-orange-500" />
    </label>
  );
}

function BrandingPanel({ payload, updatePayload }: { payload: PresencePayload; updatePayload: (mut: (p: PresencePayload) => void) => void }) {
  const b = payload.branding;
  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-3 space-y-2">
      <div className="text-xs font-semibold mb-1">Branding</div>
      <FieldRow label="Logo URL">
        <input className={inputCls} value={b.logoUrl ?? ""} onChange={(e) => updatePayload((p) => { p.branding.logoUrl = e.target.value; })} />
      </FieldRow>
      <FieldRow label="Favicon URL">
        <input className={inputCls} value={b.faviconUrl ?? ""} onChange={(e) => updatePayload((p) => { p.branding.faviconUrl = e.target.value; })} />
      </FieldRow>
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="Primary color">
          <input type="color" className="w-full h-9 rounded-md bg-slate-950/60 border border-border/40" value={b.primaryColor ?? "#F97316"} onChange={(e) => updatePayload((p) => { p.branding.primaryColor = e.target.value; })} />
        </FieldRow>
        <FieldRow label="Secondary color">
          <input type="color" className="w-full h-9 rounded-md bg-slate-950/60 border border-border/40" value={b.secondaryColor ?? "#14B8A6"} onChange={(e) => updatePayload((p) => { p.branding.secondaryColor = e.target.value; })} />
        </FieldRow>
      </div>
      <FieldRow label="Typography">
        <select className={inputCls} value={b.fontPairing ?? "inter-inter"} onChange={(e) => updatePayload((p) => { p.branding.fontPairing = e.target.value; })}>
          <option value="inter-inter">Modern Clean (Inter)</option>
          <option value="playfair-lato">Classic Elegance (Playfair / Lato)</option>
          <option value="poppins-opensans">Friendly Pro (Poppins / Open Sans)</option>
          <option value="montserrat-roboto">Corporate (Montserrat / Roboto)</option>
          <option value="dmserif-dmsans">Editorial (DM Serif / DM Sans)</option>
          <option value="raleway-merriweather">Sophisticated (Raleway / Merriweather)</option>
        </select>
      </FieldRow>
    </div>
  );
}

function SeoPanel({ payload, updatePayload }: { payload: PresencePayload; updatePayload: (mut: (p: PresencePayload) => void) => void }) {
  const s = payload.seo;
  const titleLen = (s.metaTitle ?? "").length;
  const descLen = (s.metaDescription ?? "").length;
  const ldPreview = useMemo(() => buildLdJson(payload), [payload]);
  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-3 space-y-2">
      <div className="text-xs font-semibold mb-1">SEO &amp; sharing</div>
      <FieldRow label={`Page title (${titleLen}/60)`}>
        <input className={inputCls} value={s.metaTitle ?? ""} onChange={(e) => updatePayload((p) => { p.seo.metaTitle = e.target.value; })} maxLength={120} />
      </FieldRow>
      <FieldRow label={`Meta description (${descLen}/160)`}>
        <textarea className={inputCls} rows={3} value={s.metaDescription ?? ""} onChange={(e) => updatePayload((p) => { p.seo.metaDescription = e.target.value; })} maxLength={300} />
      </FieldRow>
      <FieldRow label="Social preview image URL">
        <input className={inputCls} value={s.socialImageUrl ?? ""} onChange={(e) => updatePayload((p) => { p.seo.socialImageUrl = e.target.value; })} />
      </FieldRow>
      <FieldRow label="Canonical URL">
        <input className={inputCls} value={s.canonicalUrl ?? ""} onChange={(e) => updatePayload((p) => { p.seo.canonicalUrl = e.target.value; })} />
      </FieldRow>
      <Toggle label="Allow search engines (robots index)" checked={s.robotsIndex !== false} onChange={(v) => updatePayload((p) => { p.seo.robotsIndex = v; })} />
      <details className="mt-2">
        <summary className="text-[11px] cursor-pointer text-muted-foreground">Schema.org JSON-LD preview</summary>
        <pre className="mt-1 p-2 text-[10px] bg-slate-950/80 rounded-md overflow-x-auto max-h-48">{JSON.stringify(ldPreview, null, 2)}</pre>
      </details>
    </div>
  );
}

function DomainPanel({ payload, updatePayload }: { payload: PresencePayload; updatePayload: (mut: (p: PresencePayload) => void) => void }) {
  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-3 space-y-2">
      <div className="text-xs font-semibold mb-1">Slug &amp; custom domain</div>
      <FieldRow label="Slug (your public URL path)">
        <input
          className={inputCls}
          value={payload.slug ?? ""}
          placeholder="my-business"
          onChange={(e) => updatePayload((p) => { p.slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"); })}
        />
      </FieldRow>
      <p className="text-[11px] text-muted-foreground">Your site will live at /site/{payload.slug || "your-slug"} once published. The legacy /book/{payload.slug || "your-slug"} URL keeps redirecting to the catalog/booking flow.</p>
      <FieldRow label="Custom domain (coming soon)">
        <input className={inputCls} value={payload.customDomain ?? ""} placeholder="www.yourbusiness.com" onChange={(e) => updatePayload((p) => { p.customDomain = e.target.value; })} />
      </FieldRow>
      <p className="text-[11px] text-muted-foreground">Set the domain you intend to connect. DNS automation will be available in a follow-up release; for now we surface this so you can collect what you need.</p>
    </div>
  );
}

function buildLdJson(payload: PresencePayload) {
  const heroSection = payload.sections.find((s) => s.type === "hero");
  const aboutSection = payload.sections.find((s) => s.type === "about");
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: payload.seo.metaTitle || (heroSection?.data?.headline as string) || "",
    description: payload.seo.metaDescription || (aboutSection?.data?.body as string) || "",
    url: payload.seo.canonicalUrl || (payload.slug ? `/site/${payload.slug}` : undefined),
    image: payload.seo.socialImageUrl || payload.branding.logoUrl || undefined,
  };
}
