"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BellRing,
  Clock,
  Plus,
  Trash2,
  CheckCircle,
  Calendar,
  Sparkles,
  X,
} from "lucide-react";
import { generateItemId } from "../components/commerce-types";

interface ReminderStep {
  id: string;
  channel: "email" | "whatsapp";
  delayDays: number;
  tone: "gentle" | "firm" | "urgent";
  template: string;
}

interface ReminderCadence {
  id: string;
  name: string;
  steps: ReminderStep[];
  promiseToPayDate: string;
  bestTimeScore: number;
  notes: string;
}

interface ReminderCadencePanelProps {
  businessId: string | null;
  invoiceId?: string;
  contactName?: string;
  onClose?: () => void;
}

const TONE_COLORS: Record<string, string> = {
  gentle: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  firm: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  urgent: "bg-red-500/15 text-red-400 border-red-500/30",
};

const DEFAULT_TEMPLATES: Record<string, string> = {
  gentle: "Hi {name}, this is a friendly reminder about your outstanding invoice #{invoice}. Please let us know if you have any questions.",
  firm: "Dear {name}, your invoice #{invoice} for {amount} is now {days} days past due. We kindly request prompt payment.",
  urgent: "{name}, your payment of {amount} for invoice #{invoice} is significantly overdue. Please settle this immediately to avoid any service interruptions.",
};

export function ReminderCadencePanel({ businessId, invoiceId, contactName, onClose }: ReminderCadencePanelProps) {
  const [steps, setSteps] = useState<ReminderStep[]>([
    { id: generateItemId(), channel: "email", delayDays: 3, tone: "gentle", template: DEFAULT_TEMPLATES.gentle },
    { id: generateItemId(), channel: "email", delayDays: 7, tone: "firm", template: DEFAULT_TEMPLATES.firm },
    { id: generateItemId(), channel: "whatsapp", delayDays: 14, tone: "urgent", template: DEFAULT_TEMPLATES.urgent },
  ]);
  const [promiseDate, setPromiseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const addStep = useCallback(() => {
    const lastDelay = steps.length > 0 ? steps[steps.length - 1].delayDays : 0;
    setSteps(prev => [...prev, {
      id: generateItemId(),
      channel: "email",
      delayDays: lastDelay + 7,
      tone: "firm",
      template: DEFAULT_TEMPLATES.firm,
    }]);
  }, [steps]);

  const removeStep = useCallback((id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id));
  }, []);

  const updateStep = useCallback((id: string, field: keyof ReminderStep, value: any) => {
    setSteps(prev => prev.map(s => {
      if (s.id !== id) return s;
      const updated = { ...s, [field]: value };
      if (field === "tone" && !s.template.includes("custom")) {
        updated.template = DEFAULT_TEMPLATES[value as string] ?? s.template;
      }
      return updated;
    }));
  }, []);

  const handleSave = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card/80 overflow-hidden"
    >
      <div className="p-4 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <BellRing className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Reminder Cadence</h3>
            <p className="text-xs text-muted-foreground">
              {contactName ? `For ${contactName}` : "Multi-step follow-up sequence"}
            </p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {steps.map((step, idx) => (
          <motion.div
            key={step.id}
            layout
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative p-3 rounded-xl bg-muted/20 border border-border/30"
          >
            {idx > 0 && (
              <div className="absolute -top-3 left-6 w-px h-3 bg-border/40" />
            )}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-medium text-muted-foreground w-5 h-5 rounded-full bg-muted/40 flex items-center justify-center">
                {idx + 1}
              </span>
              <div className="flex items-center gap-2 flex-1">
                <select
                  className="text-xs rounded-lg border border-border bg-background px-2 py-1.5"
                  value={step.channel}
                  onChange={(e) => updateStep(step.id, "channel", e.target.value)}
                >
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-muted-foreground/50" />
                  <input
                    type="number"
                    min="1"
                    className="w-14 text-xs rounded-lg border border-border bg-background px-2 py-1.5 text-center"
                    value={step.delayDays}
                    onChange={(e) => updateStep(step.id, "delayDays", parseInt(e.target.value) || 1)}
                  />
                  <span className="text-[10px] text-muted-foreground">days</span>
                </div>
                <select
                  className={`text-[10px] rounded-full border px-2 py-1 font-medium ${TONE_COLORS[step.tone]}`}
                  value={step.tone}
                  onChange={(e) => updateStep(step.id, "tone", e.target.value)}
                >
                  <option value="gentle">Gentle</option>
                  <option value="firm">Firm</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              {steps.length > 1 && (
                <button
                  onClick={() => removeStep(step.id)}
                  className="p-1 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
            <textarea
              className="w-full text-xs rounded-lg border border-border bg-background px-2.5 py-2 resize-none"
              rows={2}
              value={step.template}
              onChange={(e) => updateStep(step.id, "template", e.target.value)}
              placeholder="Message template..."
            />
          </motion.div>
        ))}

        <button
          onClick={addStep}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border/50 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          <Plus className="w-3 h-3" /> Add Step
        </button>
      </div>

      <div className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Promise-to-Pay Date
            </label>
            <input
              type="date"
              className="w-full text-xs rounded-lg border border-border bg-background px-2.5 py-2"
              value={promiseDate}
              onChange={(e) => setPromiseDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
            <input
              type="text"
              className="w-full text-xs rounded-lg border border-border bg-background px-2.5 py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes..."
            />
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="w-3 h-3 text-amber-400" />
          {steps.length} steps · {steps.reduce((s, step) => s + step.delayDays, 0)} days total
        </div>
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90"
          style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", color: "white" }}
        >
          {saved ? <><CheckCircle className="w-3.5 h-3.5" /> Saved</> : "Save Cadence"}
        </button>
      </div>
    </motion.div>
  );
}
