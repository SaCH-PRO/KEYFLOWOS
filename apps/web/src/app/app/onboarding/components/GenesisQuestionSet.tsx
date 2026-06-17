"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Send, Loader2 } from "lucide-react";
import type { GenesisQuestion, GenesisReadinessScore } from "@/lib/blueprint-types";

interface GenesisQuestionSetProps {
  questions: GenesisQuestion[];
  onSubmit: (answers: Record<string, unknown>) => void;
  loading?: boolean;
  readiness?: GenesisReadinessScore | null;
}

type SelectOption = { label: string; value: string } | string;

function normalizeOptions(options?: SelectOption[]): { label: string; value: string }[] {
  if (!options) return [];
  return options.map((o) =>
    typeof o === "string" ? { label: o, value: o } : { label: o.label, value: o.value },
  );
}

function keyFor(question: GenesisQuestion): string {
  return `${question.section}.${question.field}`;
}

function getScoreColor(score: number): string {
  if (score >= 70) return "hsl(var(--kf-success))";
  if (score >= 40) return "hsl(var(--kf-warning))";
  return "hsl(var(--kf-error))";
}

function QuestionField({
  question,
  value,
  onChange,
  disabled,
}: {
  question: GenesisQuestion;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled?: boolean;
}) {
  const opts = useMemo(() => normalizeOptions(question.options), [question.options]);

  switch (question.type) {
    case "textarea":
      return (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
          className="w-full kf-input resize-none"
          placeholder={question.helper}
        />
      );

    case "number":
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          disabled={disabled}
          className="w-full kf-input"
          placeholder={question.helper}
        />
      );

    case "currency":
      return (
        <input
          type="number"
          min={0}
          step="0.01"
          value={typeof value === "number" ? value : typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          disabled={disabled}
          className="w-full kf-input"
          placeholder={question.helper}
        />
      );

    case "boolean": {
      const enabled = Boolean(value);
      return (
        <button
          type="button"
          onClick={() => onChange(!enabled)}
          disabled={disabled}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            enabled ? "" : "bg-muted"
          }`}
          style={{ background: enabled ? "hsl(var(--kf-accent1))" : undefined }}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      );
    }

    case "select":
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full kf-input"
        >
          <option value="">Select an option</option>
          {opts.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case "multi_select": {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="space-y-2">
          {opts.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-muted transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, opt.value]
                      : selected.filter((v) => v !== opt.value);
                    onChange(next);
                  }}
                  disabled={disabled}
                  className="w-4 h-4 rounded border-muted-foreground"
                  style={{ accentColor: "hsl(var(--kf-accent1))" }}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case "text":
    default:
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full kf-input"
          placeholder={question.helper}
        />
      );
  }
}

export function GenesisQuestionSet({
  questions,
  onSubmit,
  loading = false,
  readiness,
}: GenesisQuestionSetProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {};
    for (const q of questions) {
      const key = keyFor(q);
      const val = answers[key];
      if (val !== undefined && val !== "" && !(Array.isArray(val) && val.length === 0)) {
        payload[key] = val;
      }
    }
    onSubmit(payload);
    setAnswers({});
  };

  const allAnswered = questions.every((q) => {
    const key = keyFor(q);
    const val = answers[key];
    if (q.type === "boolean") return typeof val === "boolean";
    if (q.type === "multi_select") return Array.isArray(val) && val.length > 0;
    return val !== undefined && val !== "";
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-5"
    >
      <div className="text-center space-y-2">
        <h2 className="text-xl sm:text-2xl font-bold">A few quick questions</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          These help KEY calculate readiness and build your action plan.
        </p>
      </div>

      <div className="space-y-4">
        {questions.map((question, index) => {
          const key = keyFor(question);
          return (
            <motion.div
              key={question.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08 }}
              className="kf-card p-4"
              style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
            >
              <label className="block text-sm font-medium mb-1">{question.label}</label>
              {question.helper && (
                <p className="text-xs text-muted-foreground mb-3">{question.helper}</p>
              )}
              <QuestionField
                question={question}
                value={answers[key]}
                onChange={(val) => setAnswers((prev) => ({ ...prev, [key]: val }))}
                disabled={loading}
              />
            </motion.div>
          );
        })}
      </div>

      {readiness && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="kf-card-accent p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Readiness</span>
            <span className="text-sm font-bold" style={{ color: getScoreColor(readiness.overall) }}>
              {readiness.overall}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: getScoreColor(readiness.overall) }}
              initial={{ width: 0 }}
              animate={{ width: `${readiness.overall}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </motion.div>
      )}

      <div className="flex justify-center">
        <button
          onClick={handleSubmit}
          disabled={loading || !allAnswered}
          className="kf-btn-primary flex items-center gap-2 px-6 py-2.5"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>Submit answers</span>
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
