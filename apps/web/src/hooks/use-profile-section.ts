"use client";

import { useState, useEffect, useCallback } from "react";

interface UseProfileSectionOptions<T> {
  initialState: T;
  isDirtyFn: (current: T, initial: T) => boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

interface UseProfileSectionReturn<T> {
  form: T;
  setForm: React.Dispatch<React.SetStateAction<T>>;
  initialForm: T;
  setInitialForm: React.Dispatch<React.SetStateAction<T>>;
  isDirty: boolean;
  saving: boolean;
  setSaving: React.Dispatch<React.SetStateAction<boolean>>;
  status: { type: "success" | "error"; message: string } | null;
  setStatus: (status: { type: "success" | "error"; message: string } | null) => void;
}

export function useProfileSection<T>({
  initialState,
  isDirtyFn,
  onDirtyChange,
}: UseProfileSectionOptions<T>): UseProfileSectionReturn<T> {
  const [form, setForm] = useState<T>(initialState);
  const [initialForm, setInitialForm] = useState<T>(initialState);
  const [saving, setSaving] = useState(false);
  const [status, setStatusRaw] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [dismissTimer, setDismissTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const isDirty = isDirtyFn(form, initialForm);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const setStatus = useCallback((s: { type: "success" | "error"; message: string } | null) => {
    setStatusRaw(s);
    if (dismissTimer) clearTimeout(dismissTimer);
    if (s) {
      const timer = setTimeout(() => setStatusRaw(null), 4000);
      setDismissTimer(timer);
    }
  }, [dismissTimer]);

  useEffect(() => {
    return () => {
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, [dismissTimer]);

  return {
    form,
    setForm,
    initialForm,
    setInitialForm,
    isDirty,
    saving,
    setSaving,
    status,
    setStatus,
  };
}
