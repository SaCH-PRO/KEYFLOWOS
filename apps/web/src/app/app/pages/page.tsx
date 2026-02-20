"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layout,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Eye,
  EyeOff,
  ExternalLink,
  X,
  Type,
  Star,
  MessageSquareQuote,
  MousePointerClick,
  FileText,
  ImageIcon,
  ChevronLeft,
} from "lucide-react";
import {
  fetchLandingPages,
  createLandingPage,
  updateLandingPage,
  deleteLandingPage,
  toggleLandingPagePublish,
  LandingPage,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const SECTION_TYPES = [
  { type: "hero", label: "Hero", icon: Star },
  { type: "features", label: "Features", icon: Layout },
  { type: "testimonials", label: "Testimonials", icon: MessageSquareQuote },
  { type: "cta", label: "Call to Action", icon: MousePointerClick },
  { type: "text", label: "Text Block", icon: FileText },
  { type: "gallery", label: "Gallery", icon: ImageIcon },
];

const TEMPLATES = ["Default", "Minimal", "Bold"];

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getDefaultContent(type: string): Record<string, unknown> {
  switch (type) {
    case "hero":
      return { headline: "", subheadline: "", ctaText: "", ctaUrl: "" };
    case "features":
      return { title: "", items: [{ title: "", description: "", icon: "" }] };
    case "testimonials":
      return { title: "", items: [{ name: "", quote: "", role: "" }] };
    case "cta":
      return { headline: "", buttonText: "", buttonUrl: "" };
    case "text":
      return { title: "", body: "" };
    case "gallery":
      return { title: "", imageUrls: "" };
    default:
      return {};
  }
}

export default function LandingPagesPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newTemplate, setNewTemplate] = useState("Default");
  const [editingPage, setEditingPage] = useState<LandingPage | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSectionPicker, setShowSectionPicker] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadPages = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchLandingPages(businessId);
      if (res.data) setPages(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  const handleCreate = async () => {
    if (!businessId || !newTitle.trim()) return;
    const slug = newSlug.trim() || slugify(newTitle);
    const res = await createLandingPage(businessId, {
      title: newTitle.trim(),
      slug,
      template: newTemplate,
      sections: [],
    });
    if (res.data) {
      setPages((prev) => [res.data!, ...prev]);
    }
    setNewTitle("");
    setNewSlug("");
    setNewTemplate("Default");
    setShowCreate(false);
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    await deleteLandingPage(businessId, id);
    setPages((prev) => prev.filter((p) => p.id !== id));
    if (editingPage?.id === id) setEditingPage(null);
  };

  const handleTogglePublish = async (page: LandingPage) => {
    if (!businessId) return;
    const res = await toggleLandingPagePublish(businessId, page.id);
    if (res.data) {
      setPages((prev) => prev.map((p) => (p.id === page.id ? res.data! : p)));
      if (editingPage?.id === page.id) setEditingPage(res.data);
    }
  };

  const handleSave = async () => {
    if (!businessId || !editingPage) return;
    setSaving(true);
    const res = await updateLandingPage(businessId, editingPage.id, {
      title: editingPage.title,
      slug: editingPage.slug,
      sections: editingPage.sections,
      template: editingPage.template,
    });
    if (res.data) {
      setPages((prev) => prev.map((p) => (p.id === editingPage.id ? res.data! : p)));
      setEditingPage(res.data);
    }
    setSaving(false);
  };

  const addSection = (type: string) => {
    if (!editingPage) return;
    setEditingPage({
      ...editingPage,
      sections: [
        ...editingPage.sections,
        { type, content: getDefaultContent(type) },
      ],
    });
    setShowSectionPicker(false);
  };

  const removeSection = (index: number) => {
    if (!editingPage) return;
    setEditingPage({
      ...editingPage,
      sections: editingPage.sections.filter((_, i) => i !== index),
    });
  };

  const moveSection = (index: number, direction: "up" | "down") => {
    if (!editingPage) return;
    const newSections = [...editingPage.sections];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newSections.length) return;
    [newSections[index], newSections[swapIndex]] = [newSections[swapIndex], newSections[index]];
    setEditingPage({ ...editingPage, sections: newSections });
  };

  const updateSectionContent = (index: number, content: Record<string, unknown>) => {
    if (!editingPage) return;
    const newSections = [...editingPage.sections];
    newSections[index] = { ...newSections[index], content };
    setEditingPage({ ...editingPage, sections: newSections });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Layout className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
            Landing Pages
          </h1>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-slate-950/70 p-4 h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (editingPage) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEditingPage(null)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
                <Layout className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
                {editingPage.title}
              </h1>
              <p className="text-sm text-muted-foreground">/{editingPage.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleTogglePublish(editingPage)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                editingPage.isPublished
                  ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                  : "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
              }`}
            >
              {editingPage.isPublished ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              {editingPage.isPublished ? "Published" : "Draft"}
            </button>
            {editingPage.isPublished && (
              <a
                href={`/public/businesses/${businessId}/pages/${editingPage.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground bg-white/5 border border-white/10 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Preview
              </a>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="kf-btn-primary flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Page Details</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Title</label>
                  <input
                    value={editingPage.title}
                    onChange={(e) => setEditingPage({ ...editingPage, title: e.target.value })}
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Slug</label>
                  <input
                    value={editingPage.slug}
                    onChange={(e) => setEditingPage({ ...editingPage, slug: e.target.value })}
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Sections ({editingPage.sections.length})
                </label>
                <button
                  onClick={() => setShowSectionPicker(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add Section
                </button>
              </div>

              <AnimatePresence>
                {editingPage.sections.map((section, index) => (
                  <motion.div
                    key={index}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-white/10">
                          {section.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveSection(index, "up")}
                          disabled={index === 0}
                          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => moveSection(index, "down")}
                          disabled={index === editingPage.sections.length - 1}
                          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => removeSection(index)}
                          className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <SectionEditor
                      type={section.type}
                      content={section.content}
                      onChange={(content) => updateSectionContent(index, content)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              {editingPage.sections.length === 0 && (
                <div className="border border-dashed border-white/10 rounded-xl p-8 text-center">
                  <Type className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No sections yet. Add your first section to start building.</p>
                  <button
                    onClick={() => setShowSectionPicker(true)}
                    className="mt-3 kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium"
                  >
                    Add Section
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Template</label>
              <select
                value={editingPage.template}
                onChange={(e) => setEditingPage({ ...editingPage, template: e.target.value })}
                className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
              >
                {TEMPLATES.map((t) => (
                  <option key={t} value={t} className="bg-slate-900">
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Quick Add</label>
              <div className="space-y-1">
                {SECTION_TYPES.map((st) => {
                  const Icon = st.icon;
                  return (
                    <button
                      key={st.type}
                      onClick={() => addSection(st.type)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors text-left"
                    >
                      <Icon className="w-4 h-4" />
                      {st.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {showSectionPicker && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
              onClick={() => setShowSectionPicker(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Add Section</h3>
                  <button onClick={() => setShowSectionPicker(false)} className="p-1 text-muted-foreground hover:text-foreground">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {SECTION_TYPES.map((st) => {
                    const Icon = st.icon;
                    return (
                      <button
                        key={st.type}
                        onClick={() => addSection(st.type)}
                        className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all"
                      >
                        <Icon className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
                        <span className="text-sm font-medium">{st.label}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Layout className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
            Landing Pages
          </h1>
          <p className="text-sm text-muted-foreground">Build and publish custom landing pages</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="kf-btn-primary flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Page
        </button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Create New Page</h3>
                <button onClick={() => setShowCreate(false)} className="p-1 text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Title</label>
                  <input
                    autoFocus
                    placeholder="My Landing Page"
                    value={newTitle}
                    onChange={(e) => {
                      setNewTitle(e.target.value);
                      setNewSlug(slugify(e.target.value));
                    }}
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Slug</label>
                  <input
                    placeholder="my-landing-page"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Template</label>
                  <select
                    value={newTemplate}
                    onChange={(e) => setNewTemplate(e.target.value)}
                    className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1"
                  >
                    {TEMPLATES.map((t) => (
                      <option key={t} value={t} className="bg-slate-900">
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleCreate}
                    disabled={!newTitle.trim()}
                    className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium flex-1 disabled:opacity-40"
                  >
                    Create Page
                  </button>
                  <button
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {pages.length === 0 ? (
        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-12 text-center">
          <Layout className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">No landing pages yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create your first landing page to get started</p>
          <button
            onClick={() => setShowCreate(true)}
            className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium"
          >
            Create Your First Page
          </button>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {pages.map((page) => (
            <motion.div
              key={page.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all cursor-pointer group"
              onClick={() => setEditingPage(page)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold truncate">{page.title}</h3>
                  <p className="text-xs text-muted-foreground">/{page.slug}</p>
                </div>
                <span
                  className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                    page.isPublished
                      ? "bg-green-500/20 text-green-400"
                      : "bg-yellow-500/20 text-yellow-400"
                  }`}
                >
                  {page.isPublished ? "Published" : "Draft"}
                </span>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(page.createdAt).toLocaleDateString()}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {page.isPublished && (
                    <a
                      href={`/public/businesses/${businessId}/pages/${page.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(page.id);
                    }}
                    className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground">
                {page.sections.length} section{page.sections.length !== 1 ? "s" : ""} · {page.template} template
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionEditor({
  type,
  content,
  onChange,
}: {
  type: string;
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}) {
  const updateField = (key: string, value: unknown) => {
    onChange({ ...content, [key]: value });
  };

  const inputClass = "w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] mt-1";

  switch (type) {
    case "hero":
      return (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">Headline</label>
            <input value={(content.headline as string) || ""} onChange={(e) => updateField("headline", e.target.value)} className={inputClass} placeholder="Your headline" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Subheadline</label>
            <input value={(content.subheadline as string) || ""} onChange={(e) => updateField("subheadline", e.target.value)} className={inputClass} placeholder="Supporting text" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">CTA Text</label>
              <input value={(content.ctaText as string) || ""} onChange={(e) => updateField("ctaText", e.target.value)} className={inputClass} placeholder="Get Started" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">CTA URL</label>
              <input value={(content.ctaUrl as string) || ""} onChange={(e) => updateField("ctaUrl", e.target.value)} className={inputClass} placeholder="https://..." />
            </div>
          </div>
        </div>
      );

    case "features": {
      const items = (content.items as { title: string; description: string; icon: string }[]) || [];
      return (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">Section Title</label>
            <input value={(content.title as string) || ""} onChange={(e) => updateField("title", e.target.value)} className={inputClass} placeholder="Features" />
          </div>
          {items.map((item, i) => (
            <div key={i} className="bg-white/5 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Feature {i + 1}</span>
                <button
                  onClick={() => updateField("items", items.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <input
                value={item.title}
                onChange={(e) => {
                  const newItems = [...items];
                  newItems[i] = { ...newItems[i], title: e.target.value };
                  updateField("items", newItems);
                }}
                className={inputClass}
                placeholder="Feature title"
              />
              <input
                value={item.description}
                onChange={(e) => {
                  const newItems = [...items];
                  newItems[i] = { ...newItems[i], description: e.target.value };
                  updateField("items", newItems);
                }}
                className={inputClass}
                placeholder="Feature description"
              />
              <input
                value={item.icon}
                onChange={(e) => {
                  const newItems = [...items];
                  newItems[i] = { ...newItems[i], icon: e.target.value };
                  updateField("items", newItems);
                }}
                className={inputClass}
                placeholder="Icon name (e.g. star, shield)"
              />
            </div>
          ))}
          <button
            onClick={() => updateField("items", [...items, { title: "", description: "", icon: "" }])}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Feature
          </button>
        </div>
      );
    }

    case "testimonials": {
      const items = (content.items as { name: string; quote: string; role: string }[]) || [];
      return (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">Section Title</label>
            <input value={(content.title as string) || ""} onChange={(e) => updateField("title", e.target.value)} className={inputClass} placeholder="What our clients say" />
          </div>
          {items.map((item, i) => (
            <div key={i} className="bg-white/5 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Testimonial {i + 1}</span>
                <button
                  onClick={() => updateField("items", items.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <input
                value={item.name}
                onChange={(e) => {
                  const newItems = [...items];
                  newItems[i] = { ...newItems[i], name: e.target.value };
                  updateField("items", newItems);
                }}
                className={inputClass}
                placeholder="Name"
              />
              <input
                value={item.role}
                onChange={(e) => {
                  const newItems = [...items];
                  newItems[i] = { ...newItems[i], role: e.target.value };
                  updateField("items", newItems);
                }}
                className={inputClass}
                placeholder="Role / Company"
              />
              <textarea
                value={item.quote}
                onChange={(e) => {
                  const newItems = [...items];
                  newItems[i] = { ...newItems[i], quote: e.target.value };
                  updateField("items", newItems);
                }}
                className={inputClass + " resize-none"}
                placeholder="Their testimonial..."
                rows={2}
              />
            </div>
          ))}
          <button
            onClick={() => updateField("items", [...items, { name: "", quote: "", role: "" }])}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Testimonial
          </button>
        </div>
      );
    }

    case "cta":
      return (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">Headline</label>
            <input value={(content.headline as string) || ""} onChange={(e) => updateField("headline", e.target.value)} className={inputClass} placeholder="Ready to get started?" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Button Text</label>
              <input value={(content.buttonText as string) || ""} onChange={(e) => updateField("buttonText", e.target.value)} className={inputClass} placeholder="Sign Up" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Button URL</label>
              <input value={(content.buttonUrl as string) || ""} onChange={(e) => updateField("buttonUrl", e.target.value)} className={inputClass} placeholder="https://..." />
            </div>
          </div>
        </div>
      );

    case "text":
      return (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">Title</label>
            <input value={(content.title as string) || ""} onChange={(e) => updateField("title", e.target.value)} className={inputClass} placeholder="Section title" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Body</label>
            <textarea
              value={(content.body as string) || ""}
              onChange={(e) => updateField("body", e.target.value)}
              className={inputClass + " resize-none"}
              placeholder="Write your content..."
              rows={4}
            />
          </div>
        </div>
      );

    case "gallery":
      return (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">Title</label>
            <input value={(content.title as string) || ""} onChange={(e) => updateField("title", e.target.value)} className={inputClass} placeholder="Gallery" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Image URLs (comma-separated)</label>
            <textarea
              value={(content.imageUrls as string) || ""}
              onChange={(e) => updateField("imageUrls", e.target.value)}
              className={inputClass + " resize-none"}
              placeholder="https://image1.jpg, https://image2.jpg"
              rows={3}
            />
          </div>
        </div>
      );

    default:
      return <p className="text-xs text-muted-foreground">Unknown section type: {type}</p>;
  }
}