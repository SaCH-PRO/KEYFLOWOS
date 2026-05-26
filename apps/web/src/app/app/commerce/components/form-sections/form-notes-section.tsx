"use client";

import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { SectionHeader } from "../billing-form-modal";

interface FormNotesSectionProps {
  open: boolean;
  onToggle: () => void;
  accentColor: string;
  notes: string;
  onNotesChange: (value: string) => void;
  placeholder: string;
}

export function FormNotesSection({ open, onToggle, accentColor, notes, onNotesChange, placeholder }: FormNotesSectionProps) {
  return (
    <>
      <SectionHeader label="Notes" icon={MessageSquare} open={open} onToggle={onToggle} accentColor={accentColor} />
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="pb-3">
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="kf-input w-full resize-none text-sm"
          />
        </motion.div>
      )}
    </>
  );
}
