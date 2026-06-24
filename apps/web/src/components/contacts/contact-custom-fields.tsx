"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Type, Hash, Calendar, List, CheckSquare, Link, Mail, Text, Loader2 } from "lucide-react";
import {
  fetchCustomFieldDefinitions,
  type CustomFieldDefinition,
} from "@/lib/client";

const TYPE_ICONS: Record<string, React.ElementType> = {
  TEXT: Type,
  TEXTAREA: Text,
  NUMBER: Hash,
  DATE: Calendar,
  SELECT: List,
  MULTI_SELECT: List,
  CHECKBOX: CheckSquare,
  URL: Link,
  EMAIL: Mail,
};

export interface TypedFieldValue {
  definitionId: string;
  name: string;
  value: unknown;
}

interface ContactCustomFieldsProps {
  businessId?: string;
  values?: Record<string, unknown>;
  onChange?: (values: Record<string, unknown>) => void;
  readOnly?: boolean;
}

export function useCustomFieldDefinitions(businessId?: string) {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchCustomFieldDefinitions(businessId)
      .then((res) => {
        if (!cancelled && res.data) {
          setDefinitions(res.data.filter((d) => !d.archivedAt).sort((a, b) => a.order - b.order));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [businessId]);

  return { definitions, loading };
}

export function ContactCustomFields({ businessId, values = {}, onChange, readOnly = false }: ContactCustomFieldsProps) {
  const { definitions, loading } = useCustomFieldDefinitions(businessId);
  const [localValues, setLocalValues] = useState<Record<string, unknown>>(values);

  useEffect(() => {
    setLocalValues(values);
  }, [values]);

  const handleChange = useCallback((name: string, value: unknown) => {
    const next = { ...localValues, [name]: value };
    setLocalValues(next);
    onChange?.(next);
  }, [localValues, onChange]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading custom fields...</span>
      </div>
    );
  }

  if (definitions.length === 0) return null;

  return (
    <div className="space-y-3">
      {definitions.map((def) => {
        const Icon = TYPE_ICONS[def.type] || Type;
        const val = localValues[def.name];

        return (
          <motion.div
            key={def.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-1"
          >
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Icon className="h-3 w-3" />
              {def.label}
              {def.required && <span className="text-destructive">*</span>}
            </label>
            {readOnly ? (
              <div className="text-sm">
                {renderReadOnlyValue(def, val)}
              </div>
            ) : (
              <CustomFieldInput
                definition={def}
                value={val}
                onChange={(v) => handleChange(def.name, v)}
              />
            )}
            {def.description && (
              <p className="text-[10px] text-muted-foreground">{def.description}</p>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function renderReadOnlyValue(def: CustomFieldDefinition, value: unknown): React.ReactNode {
  if (value === undefined || value === null || value === "") {
    return <span className="text-muted-foreground italic">—</span>;
  }
  if (def.type === "CHECKBOX") {
    return value ? "Yes" : "No";
  }
  if (def.type === "URL" && typeof value === "string") {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
        {value}
      </a>
    );
  }
  if (def.type === "EMAIL" && typeof value === "string") {
    return (
      <a href={`mailto:${value}`} className="text-primary hover:underline break-all">
        {value}
      </a>
    );
  }
  if (def.type === "DATE" && typeof value === "string") {
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return String(value);
    }
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

function CustomFieldInput({
  definition,
  value,
  onChange,
}: {
  definition: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const placeholder = definition.placeholder || undefined;
  const rawOptions = definition.options && typeof definition.options === "object"
    ? (definition.options as Record<string, unknown>).options
    : undefined;
  const opts = Array.isArray(rawOptions)
    ? (rawOptions as Array<{ label: string; value: string }>)
    : [];

  switch (definition.type) {
    case "TEXT":
    case "EMAIL":
    case "URL":
      return (
        <input
          type={definition.type === "EMAIL" ? "email" : definition.type === "URL" ? "url" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      );
    case "TEXTAREA":
      return (
        <textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      );
    case "NUMBER":
      return (
        <input
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          placeholder={placeholder}
          className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      );
    case "DATE":
      return (
        <input
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      );
    case "SELECT":
      return (
        <div className="relative">
          <select
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value || null)}
            className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{placeholder || "Select..."}</option>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      );
    case "MULTI_SELECT": {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => {
            const isSelected = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  const next = isSelected
                    ? selected.filter((v) => v !== o.value)
                    : [...selected, o.value];
                  onChange(next.length > 0 ? next : null);
                }}
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {isSelected && <CheckSquare className="h-3 w-3" />}
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "CHECKBOX":
      return (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-muted-foreground">{placeholder || "Yes"}</span>
        </label>
      );
    default:
      return (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      );
  }
}

