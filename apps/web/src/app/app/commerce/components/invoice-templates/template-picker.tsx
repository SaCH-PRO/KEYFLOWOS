"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Eye, X } from "lucide-react";
import type { TemplateId, InvoiceTemplateData } from "./template-types";
import { TEMPLATE_META } from "./template-types";
import { InvoiceTemplateRenderer } from "./template-renderer";

interface TemplatePickerProps {
  selected: TemplateId;
  onChange: (id: TemplateId) => void;
  businessName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
}

const TEMPLATE_IDS: TemplateId[] = ["classic", "modern", "minimal"];

function MiniPreview({ id, primaryColor, secondaryColor }: { id: TemplateId; primaryColor: string; secondaryColor: string }) {
  if (id === "classic") {
    return (
      <div className="w-full aspect-[3/4] bg-white rounded-md overflow-hidden">
        <div className="h-1" style={{ backgroundColor: primaryColor }} />
        <div className="p-2">
          <div className="flex items-center gap-1 mb-2">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: primaryColor }} />
            <div className="h-1.5 w-8 bg-gray-300 rounded-full" />
          </div>
          <div className="flex justify-between mb-2">
            <div className="space-y-0.5">
              <div className="h-1 w-6 bg-gray-200 rounded-full" />
              <div className="h-1 w-4 bg-gray-200 rounded-full" />
            </div>
            <div className="h-2 w-8 rounded font-mono text-[5px] font-bold flex items-center justify-end" style={{ color: primaryColor }}>
              INVOICE
            </div>
          </div>
          <div className="h-2 w-full rounded-sm mb-1" style={{ backgroundColor: primaryColor }} />
          <div className="space-y-0.5">
            <div className="h-1 w-full bg-gray-100 rounded-full" />
            <div className="h-1 w-full bg-gray-100 rounded-full" />
            <div className="h-1 w-3/4 bg-gray-100 rounded-full" />
          </div>
          <div className="mt-2 pt-1 border-t border-gray-100 flex justify-end">
            <div className="h-1.5 w-6 rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.3 }} />
          </div>
        </div>
      </div>
    );
  }

  if (id === "modern") {
    return (
      <div className="w-full aspect-[3/4] bg-white rounded-md overflow-hidden">
        <div
          className="h-8 px-2 flex items-center justify-between"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
        >
          <div className="w-3 h-3 rounded-sm bg-white/30" />
          <div className="text-[4px] text-white/80 font-bold">INVOICE</div>
        </div>
        <div className="p-2 -mt-1">
          <div className="flex gap-1 mb-2">
            <div className="flex-1 bg-white border border-gray-100 rounded-sm p-1 shadow-sm">
              <div className="h-0.5 w-3 bg-gray-200 rounded-full mb-0.5" />
              <div className="h-1 w-4 bg-gray-300 rounded-full" />
            </div>
            <div className="flex-1 bg-white border border-gray-100 rounded-sm p-1 shadow-sm">
              <div className="h-0.5 w-3 bg-gray-200 rounded-full mb-0.5" />
              <div className="h-1 w-4 bg-gray-300 rounded-full" />
            </div>
          </div>
          <div className="space-y-0.5 mb-2">
            <div className="h-1 w-full bg-gray-50 rounded-full" />
            <div className="h-1 w-full bg-gray-50 rounded-full" />
            <div className="h-1 w-2/3 bg-gray-50 rounded-full" />
          </div>
          <div className="p-1 rounded-sm" style={{ backgroundColor: `${primaryColor}10` }}>
            <div className="flex justify-between">
              <div className="h-1 w-4 bg-gray-200 rounded-full" />
              <div className="h-1.5 w-6 rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.4 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full aspect-[3/4] bg-white rounded-md overflow-hidden p-3">
      <div className="flex justify-between mb-3">
        <div className="h-1.5 w-8 bg-gray-800 rounded-full" />
        <div className="text-right">
          <div className="h-0.5 w-5 bg-gray-200 rounded-full mb-0.5 ml-auto" />
          <div className="h-1 w-7 bg-gray-300 rounded-full" />
        </div>
      </div>
      <div className="w-4 h-px mb-3" style={{ backgroundColor: primaryColor }} />
      <div className="space-y-0.5 mb-3">
        <div className="h-1 w-full bg-gray-100 rounded-full" />
        <div className="h-1 w-full bg-gray-100 rounded-full" />
      </div>
      <div className="flex justify-end">
        <div className="space-y-0.5">
          <div className="h-0.5 w-8 bg-gray-100 rounded-full" />
          <div className="h-px w-6 ml-auto" style={{ backgroundColor: primaryColor }} />
          <div className="h-1.5 w-10 rounded-full text-right text-[4px] font-light flex items-center justify-end" style={{ color: primaryColor }}>
            $0.00
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplatePicker({
  selected,
  onChange,
  businessName,
  primaryColor,
  secondaryColor,
  logoUrl,
}: TemplatePickerProps) {
  const [previewing, setPreviewing] = useState<TemplateId | null>(null);

  // Static sample dates to prevent hydration mismatches
  const sampleIssueDate = "2024-01-15T00:00:00.000Z";
  const sampleDueDate = "2024-02-14T00:00:00.000Z";

  const sampleData: InvoiceTemplateData = {
    type: "invoice",
    number: "INV-001",
    status: "SENT",
    issueDate: sampleIssueDate,
    dueDate: sampleDueDate,
    contact: {
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      phone: "+1 868 555 0123",
    },
    items: [
      { id: "1", description: "Website Design & Development", quantity: 1, unitPrice: 5000, total: 5000 },
      { id: "2", description: "Logo & Brand Identity Package", quantity: 1, unitPrice: 1500, total: 1500 },
      { id: "3", description: "Monthly SEO Retainer", quantity: 3, unitPrice: 800, total: 2400 },
    ],
    subtotal: 8900,
    taxRate: 12.5,
    taxAmount: 1112.5,
    discountType: "PERCENT",
    discountValue: 5,
    discountAmount: 445,
    total: 9567.5,
    currency: "TTD",
    notes: "Payment is due within 30 days. Thank you for your business!",
    business: {
      name: businessName || "Your Business",
      logoUrl,
      address: "123 Main Street",
      city: "Port of Spain",
      country: "Trinidad & Tobago",
      phone: "+1 868 555 0000",
      email: "hello@yourbusiness.com",
      website: "www.yourbusiness.com",
      primaryColor,
      secondaryColor,
    },
  };

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {TEMPLATE_IDS.map((id) => {
          const meta = TEMPLATE_META[id];
          const isSelected = selected === id;

          return (
            <div
              key={id}
              onClick={() => onChange(id)}
              className="group relative rounded-xl border-2 p-2 transition-all hover:scale-[1.02] cursor-pointer"
              style={{
                borderColor: isSelected ? primaryColor : "rgba(255,255,255,0.08)",
                backgroundColor: isSelected ? `${primaryColor}08` : "transparent",
              }}
            >
              {isSelected && (
                <div
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center z-10"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}

              <MiniPreview id={id} primaryColor={primaryColor} secondaryColor={secondaryColor} />

              <div className="mt-2 text-left">
                <p className="text-xs font-semibold">{meta.name}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{meta.description}</p>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewing(id);
                }}
                className="absolute top-3 right-3 p-1 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="Preview"
              >
                <Eye className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {previewing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto py-8 px-4"
            onClick={() => setPreviewing(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setPreviewing(null)}
                className="absolute -top-3 -right-3 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white">{TEMPLATE_META[previewing].name} Template</h3>
                  <p className="text-sm text-white/60">Preview with sample data</p>
                </div>
                <button
                  onClick={() => {
                    onChange(previewing);
                    setPreviewing(null);
                  }}
                  className="px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors"
                  style={{ backgroundColor: primaryColor }}
                >
                  Use This Template
                </button>
              </div>

              <InvoiceTemplateRenderer templateId={previewing} data={sampleData} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
