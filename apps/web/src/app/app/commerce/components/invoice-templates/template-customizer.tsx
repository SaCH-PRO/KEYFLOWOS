"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Monitor,
  Smartphone,
  Printer,
  Palette,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Save,
  Loader2,
  RotateCcw,
  Building2,
  MapPin,
  Phone,
  Mail,
  Globe,
  Type,
} from "lucide-react";
import type { TemplateId, InvoiceTemplateData } from "./template-types";
import { TEMPLATE_META } from "./template-types";
import { InvoiceTemplateRenderer } from "./template-renderer";

type ViewMode = "desktop" | "mobile" | "print";
const TEMPLATE_IDS: TemplateId[] = ["classic", "modern", "minimal"];

interface BrandingOverrides {
  primaryColor: string;
  secondaryColor: string;
  name: string;
  tagline: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
}

interface TemplateCustomizerProps {
  open: boolean;
  onClose: () => void;
  data: InvoiceTemplateData;
  activeTemplate: TemplateId;
  onTemplateChange?: (id: TemplateId) => void;
  onSaveBranding?: (overrides: Partial<BrandingOverrides>) => Promise<void>;
  savingBranding?: boolean;
}

function ColorSwatch({
  color,
  selected,
  onClick,
  label,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="relative w-8 h-8 rounded-lg border-2 transition-all hover:scale-110"
      style={{
        backgroundColor: color,
        borderColor: selected ? "white" : "rgba(255,255,255,0.15)",
        boxShadow: selected ? `0 0 0 2px ${color}, 0 0 12px ${color}40` : "none",
      }}
    >
      {selected && (
        <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto drop-shadow-md" />
      )}
    </button>
  );
}

const PRESET_COLORS = [
  { label: "Sunset Orange", primary: "#F97316", secondary: "#14B8A6" },
  { label: "Ocean Blue", primary: "#3B82F6", secondary: "#06B6D4" },
  { label: "Royal Purple", primary: "#8B5CF6", secondary: "#EC4899" },
  { label: "Forest Green", primary: "#22C55E", secondary: "#10B981" },
  { label: "Ruby Red", primary: "#EF4444", secondary: "#F97316" },
  { label: "Midnight", primary: "#6366F1", secondary: "#8B5CF6" },
];

function SidebarSection({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.06]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white/90 hover:bg-white/[0.04] transition-colors"
      >
        <span className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-white/50" />
          {title}
        </span>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-white/40" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-white/40" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BrandInput({
  label,
  value,
  onChange,
  icon: Icon,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon: React.ElementType;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[11px] text-white/50 mb-1 block">{label}</label>
      <div className="relative">
        <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors"
        />
      </div>
    </div>
  );
}

export function TemplateCustomizer({
  open,
  onClose,
  data,
  activeTemplate,
  onTemplateChange,
  onSaveBranding,
  savingBranding,
}: TemplateCustomizerProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>(activeTemplate);
  const [viewMode, setViewMode] = useState<ViewMode>("desktop");
  const [branding, setBranding] = useState<BrandingOverrides>({
    primaryColor: data.business.primaryColor,
    secondaryColor: data.business.secondaryColor,
    name: data.business.name,
    tagline: data.business.tagline || "",
    address: data.business.address || "",
    city: data.business.city || "",
    country: data.business.country || "",
    phone: data.business.phone || "",
    email: data.business.email || "",
    website: data.business.website || "",
  });
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setSelectedTemplate(activeTemplate);
      setBranding({
        primaryColor: data.business.primaryColor,
        secondaryColor: data.business.secondaryColor,
        name: data.business.name,
        tagline: data.business.tagline || "",
        address: data.business.address || "",
        city: data.business.city || "",
        country: data.business.country || "",
        phone: data.business.phone || "",
        email: data.business.email || "",
        website: data.business.website || "",
      });
      setViewMode("desktop");
    }
  }, [open, activeTemplate, data.business]);

  const setBrandField = useCallback(
    (field: keyof BrandingOverrides, value: string) => {
      setBranding((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const resetBranding = useCallback(() => {
    setBranding({
      primaryColor: data.business.primaryColor,
      secondaryColor: data.business.secondaryColor,
      name: data.business.name,
      tagline: data.business.tagline || "",
      address: data.business.address || "",
      city: data.business.city || "",
      country: data.business.country || "",
      phone: data.business.phone || "",
      email: data.business.email || "",
      website: data.business.website || "",
    });
  }, [data.business]);

  const previewData: InvoiceTemplateData = {
    ...data,
    business: {
      ...data.business,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      name: branding.name || data.business.name,
      tagline: branding.tagline || null,
      address: branding.address || null,
      city: branding.city || null,
      country: branding.country || null,
      phone: branding.phone || null,
      email: branding.email || null,
      website: branding.website || null,
    },
  };

  const handlePrint = useCallback(() => {
    if (!printRef.current) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${data.type === "quote" ? "Quote" : "Invoice"} #${data.number}</title>
          <style>
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            @media print { @page { margin: 0.5cm; size: A4; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
          </style>
          <script src="https://cdn.tailwindcss.com"><\/script>
        </head>
        <body>
          ${printRef.current.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 600);
  }, [data.type, data.number]);

  const handleSelectTemplate = useCallback(
    (id: TemplateId) => {
      setSelectedTemplate(id);
      onTemplateChange?.(id);
    },
    [onTemplateChange],
  );

  const handleSave = useCallback(async () => {
    if (!onSaveBranding) return;
    await onSaveBranding(branding);
  }, [onSaveBranding, branding]);

  const isDirty =
    branding.primaryColor !== data.business.primaryColor ||
    branding.secondaryColor !== data.business.secondaryColor ||
    branding.name !== data.business.name ||
    branding.tagline !== (data.business.tagline || "") ||
    branding.address !== (data.business.address || "") ||
    branding.city !== (data.business.city || "") ||
    branding.country !== (data.business.country || "") ||
    branding.phone !== (data.business.phone || "") ||
    branding.email !== (data.business.email || "") ||
    branding.website !== (data.business.website || "");

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const viewModes: { id: ViewMode; icon: React.ElementType; label: string }[] = [
    { id: "desktop", icon: Monitor, label: "Desktop" },
    { id: "mobile", icon: Smartphone, label: "Mobile" },
    { id: "print", icon: Printer, label: "Print" },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex"
        >
          <div className="hidden lg:flex w-80 shrink-0 flex-col bg-[#111318] border-r border-white/[0.06] overflow-hidden">
            <div className="px-4 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${branding.primaryColor}20` }}
                >
                  <Eye className="w-4.5 h-4.5" style={{ color: branding.primaryColor }} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Template Studio</h2>
                  <p className="text-[11px] text-white/40">Customize & preview</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <SidebarSection title="Template" icon={Eye} defaultOpen>
                <div className="space-y-2">
                  {TEMPLATE_IDS.map((id) => {
                    const meta = TEMPLATE_META[id];
                    const isSelected = selectedTemplate === id;
                    return (
                      <button
                        key={id}
                        onClick={() => handleSelectTemplate(id)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-lg transition-all text-left"
                        style={{
                          backgroundColor: isSelected ? `${branding.primaryColor}15` : "transparent",
                          border: isSelected
                            ? `1px solid ${branding.primaryColor}40`
                            : "1px solid transparent",
                        }}
                      >
                        <div
                          className="w-10 h-12 rounded-md bg-white overflow-hidden shrink-0 shadow-sm"
                          style={{
                            border: isSelected ? `2px solid ${branding.primaryColor}` : "1px solid rgba(255,255,255,0.1)",
                          }}
                        >
                          <MiniThumb id={id} primaryColor={branding.primaryColor} secondaryColor={branding.secondaryColor} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white/90 flex items-center gap-1.5">
                            {meta.name}
                            {isSelected && (
                              <span
                                className="w-4 h-4 rounded-full flex items-center justify-center"
                                style={{ backgroundColor: branding.primaryColor }}
                              >
                                <Check className="w-2.5 h-2.5 text-white" />
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-white/40 leading-tight mt-0.5 line-clamp-2">{meta.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </SidebarSection>

              <SidebarSection title="Brand Colors" icon={Palette} defaultOpen>
                <div>
                  <label className="text-[11px] text-white/50 mb-2 block">Color Presets</label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => {
                          setBrandField("primaryColor", preset.primary);
                          setBrandField("secondaryColor", preset.secondary);
                        }}
                        title={preset.label}
                        className="flex items-center gap-0.5 p-1 rounded-md border transition-all hover:scale-105"
                        style={{
                          borderColor:
                            branding.primaryColor === preset.primary
                              ? "rgba(255,255,255,0.4)"
                              : "rgba(255,255,255,0.08)",
                          backgroundColor:
                            branding.primaryColor === preset.primary
                              ? "rgba(255,255,255,0.06)"
                              : "transparent",
                        }}
                      >
                        <div className="w-5 h-5 rounded-sm" style={{ backgroundColor: preset.primary }} />
                        <div className="w-5 h-5 rounded-sm" style={{ backgroundColor: preset.secondary }} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <label className="text-[11px] text-white/50 mb-1.5 block">Primary</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={branding.primaryColor}
                        onChange={(e) => setBrandField("primaryColor", e.target.value)}
                        className="w-8 h-8 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                      />
                      <input
                        type="text"
                        value={branding.primaryColor}
                        onChange={(e) => setBrandField("primaryColor", e.target.value)}
                        className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded-md px-2 py-1.5 text-[11px] text-white/80 font-mono focus:outline-none focus:ring-1 focus:ring-white/20"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-white/50 mb-1.5 block">Secondary</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={branding.secondaryColor}
                        onChange={(e) => setBrandField("secondaryColor", e.target.value)}
                        className="w-8 h-8 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                      />
                      <input
                        type="text"
                        value={branding.secondaryColor}
                        onChange={(e) => setBrandField("secondaryColor", e.target.value)}
                        className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded-md px-2 py-1.5 text-[11px] text-white/80 font-mono focus:outline-none focus:ring-1 focus:ring-white/20"
                      />
                    </div>
                  </div>
                </div>
              </SidebarSection>

              <SidebarSection title="Business Details" icon={Building2}>
                <BrandInput label="Business Name" value={branding.name} onChange={(v) => setBrandField("name", v)} icon={Building2} placeholder="Your Business" />
                <BrandInput label="Tagline" value={branding.tagline} onChange={(v) => setBrandField("tagline", v)} icon={Type} placeholder="Your tagline..." />
                <BrandInput label="Address" value={branding.address} onChange={(v) => setBrandField("address", v)} icon={MapPin} placeholder="123 Main Street" />
                <div className="grid grid-cols-2 gap-2">
                  <BrandInput label="City" value={branding.city} onChange={(v) => setBrandField("city", v)} icon={MapPin} placeholder="Port of Spain" />
                  <BrandInput label="Country" value={branding.country} onChange={(v) => setBrandField("country", v)} icon={Globe} placeholder="Trinidad" />
                </div>
                <BrandInput label="Phone" value={branding.phone} onChange={(v) => setBrandField("phone", v)} icon={Phone} placeholder="+1 868 555 0000" />
                <BrandInput label="Email" value={branding.email} onChange={(v) => setBrandField("email", v)} icon={Mail} placeholder="hello@business.com" />
                <BrandInput label="Website" value={branding.website} onChange={(v) => setBrandField("website", v)} icon={Globe} placeholder="www.business.com" />
              </SidebarSection>
            </div>

            <div className="border-t border-white/[0.06] p-3 space-y-2">
              {isDirty && (
                <div className="flex gap-2">
                  <button
                    onClick={resetBranding}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white/70 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reset
                  </button>
                  {onSaveBranding && (
                    <button
                      onClick={handleSave}
                      disabled={savingBranding}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white transition-colors"
                      style={{ backgroundColor: branding.primaryColor }}
                    >
                      {savingBranding ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      {savingBranding ? "Saving..." : "Save Changes"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/[0.06] bg-[#111318]/80 backdrop-blur-sm">
              <div className="flex items-center gap-4">
                <div className="lg:hidden flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${branding.primaryColor}20` }}
                  >
                    <Eye className="w-4 h-4" style={{ color: branding.primaryColor }} />
                  </div>
                  <span className="text-sm font-semibold text-white">Template Studio</span>
                </div>

                <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-1 border border-white/[0.06]">
                  {viewModes.map(({ id, icon: ModeIcon, label }) => (
                    <button
                      key={id}
                      onClick={() => setViewMode(id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                      style={{
                        backgroundColor: viewMode === id ? `${branding.primaryColor}20` : "transparent",
                        color: viewMode === id ? branding.primaryColor : "rgba(255,255,255,0.5)",
                        border: viewMode === id ? `1px solid ${branding.primaryColor}30` : "1px solid transparent",
                      }}
                    >
                      <ModeIcon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>

                <div className="hidden sm:flex items-center gap-2 text-xs text-white/40">
                  <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                    {TEMPLATE_META[selectedTemplate].name}
                  </span>
                  <span>
                    {data.type === "quote" ? "Quote" : "Invoice"} #{data.number}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {viewMode === "print" && (
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
                    style={{ backgroundColor: branding.primaryColor }}
                  >
                    <Printer className="w-3.5 h-3.5" /> Print
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-[#0c0e12]">
              <div className="flex items-start justify-center p-4 sm:p-8 min-h-full">
                <motion.div
                  key={`${selectedTemplate}-${viewMode}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="relative"
                  style={{
                    width:
                      viewMode === "mobile"
                        ? "375px"
                        : viewMode === "print"
                          ? "210mm"
                          : "100%",
                    maxWidth:
                      viewMode === "desktop" ? "800px" : undefined,
                  }}
                >
                  {viewMode === "mobile" && (
                    <div className="absolute -inset-3 rounded-[2.5rem] border-2 border-white/[0.08] bg-black/40 pointer-events-none z-0">
                      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-1.5 rounded-full bg-white/10" />
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/10" />
                    </div>
                  )}

                  <div
                    ref={printRef}
                    className="relative z-10"
                    style={{
                      transform: viewMode === "mobile" ? "scale(0.95)" : undefined,
                      transformOrigin: "top center",
                    }}
                  >
                    <InvoiceTemplateRenderer templateId={selectedTemplate} data={previewData} />
                  </div>

                  {viewMode === "print" && (
                    <div className="mt-6 flex items-center justify-center">
                      <button
                        onClick={handlePrint}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-white transition-colors shadow-lg"
                        style={{ backgroundColor: branding.primaryColor }}
                      >
                        <Printer className="w-4 h-4" /> Print / Save as PDF
                      </button>
                    </div>
                  )}
                </motion.div>
              </div>
            </div>

            <div className="lg:hidden border-t border-white/[0.06] bg-[#111318]/90 backdrop-blur-sm px-4 py-2.5">
              <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                {TEMPLATE_IDS.map((id) => {
                  const isSelected = selectedTemplate === id;
                  return (
                    <button
                      key={id}
                      onClick={() => handleSelectTemplate(id)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all shrink-0"
                      style={{
                        backgroundColor: isSelected ? `${branding.primaryColor}20` : "rgba(255,255,255,0.04)",
                        color: isSelected ? branding.primaryColor : "rgba(255,255,255,0.6)",
                        border: isSelected ? `1px solid ${branding.primaryColor}40` : "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      {isSelected && <Check className="w-3 h-3" />}
                      {TEMPLATE_META[id].name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MiniThumb({
  id,
  primaryColor,
  secondaryColor,
}: {
  id: TemplateId;
  primaryColor: string;
  secondaryColor: string;
}) {
  if (id === "classic") {
    return (
      <div className="w-full h-full p-1">
        <div className="h-0.5 w-full rounded-full" style={{ backgroundColor: primaryColor }} />
        <div className="mt-1 space-y-0.5">
          <div className="h-0.5 w-3/4 bg-gray-200 rounded-full" />
          <div className="h-0.5 w-1/2 bg-gray-200 rounded-full" />
          <div className="h-1 w-full rounded-sm mt-1" style={{ backgroundColor: primaryColor, opacity: 0.3 }} />
          <div className="h-0.5 w-full bg-gray-100 rounded-full" />
          <div className="h-0.5 w-full bg-gray-100 rounded-full" />
        </div>
      </div>
    );
  }
  if (id === "modern") {
    return (
      <div className="w-full h-full">
        <div
          className="h-4 w-full"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
        />
        <div className="p-1 space-y-0.5">
          <div className="h-0.5 w-3/4 bg-gray-200 rounded-full" />
          <div className="h-0.5 w-1/2 bg-gray-200 rounded-full" />
          <div className="h-0.5 w-full bg-gray-100 rounded-full" />
        </div>
      </div>
    );
  }
  return (
    <div className="w-full h-full p-1.5">
      <div className="flex justify-between mb-1">
        <div className="h-0.5 w-4 bg-gray-800 rounded-full" />
        <div className="h-0.5 w-3 bg-gray-200 rounded-full" />
      </div>
      <div className="w-2 h-px mb-1" style={{ backgroundColor: primaryColor }} />
      <div className="space-y-0.5">
        <div className="h-0.5 w-full bg-gray-100 rounded-full" />
        <div className="h-0.5 w-full bg-gray-100 rounded-full" />
      </div>
    </div>
  );
}
