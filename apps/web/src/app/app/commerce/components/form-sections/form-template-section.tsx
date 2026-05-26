"use client";

import { motion } from "framer-motion";
import { FileText } from "lucide-react";
import { SectionHeader } from "../billing-form-modal";

interface Template {
  id: string;
  name: string;
}

interface FormTemplateSectionProps {
  open: boolean;
  onToggle: () => void;
  accentColor: string;
  templates: Template[] | null;
  selectedTemplate: string | null;
  savingTemplate: boolean;
  onSelectTemplate: (id: string) => void;
}

export function FormTemplateSection({
  open,
  onToggle,
  accentColor,
  templates,
  selectedTemplate,
  savingTemplate,
  onSelectTemplate,
}: FormTemplateSectionProps) {
  return (
    <>
      <SectionHeader label="Document Template" icon={FileText} open={open} onToggle={onToggle} accentColor={accentColor} />
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="pb-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {(templates ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTemplate(t.id)}
                disabled={savingTemplate}
                className={`rounded-lg border px-2 py-1.5 text-[10px] font-medium transition-all ${
                  selectedTemplate === t.id
                    ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                    : "border-border/30 text-muted-foreground hover:text-foreground hover:border-border/60"
                } disabled:opacity-50`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </>
  );
}
