"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UsePushToTalkOptions {
  onStart?: () => void;
  onStop?: () => void;
  onCancel?: () => void;
  minHoldMs?: number;
  disabled?: boolean;
}

export function usePushToTalk({
  onStart,
  onStop,
  onCancel,
  minHoldMs = 300,
  disabled = false,
}: UsePushToTalkOptions) {
  const [isListening, setIsListening] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const holdStartRef = useRef<number>(0);
  const activeRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isInputElement = useCallback((el: EventTarget | null): boolean => {
    if (!el || !(el instanceof HTMLElement)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    const parent = el.closest("input, textarea, select, [contenteditable='true']");
    return !!parent;
  }, []);

  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key !== " ") return;
      if (isInputElement(e.target)) return;
      if (activeRef.current) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      activeRef.current = true;
      holdStartRef.current = Date.now();
      setShowOverlay(true);
      timerRef.current = setTimeout(() => {
        if (activeRef.current) {
          setIsListening(true);
          onStart?.();
        }
      }, minHoldMs);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      if (!activeRef.current) return;
      e.preventDefault();
      activeRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const heldFor = Date.now() - holdStartRef.current;
      setShowOverlay(false);
      if (isListening) {
        setIsListening(false);
        onStop?.();
      } else if (heldFor < minHoldMs) {
        onCancel?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [disabled, isListening, isInputElement, minHoldMs, onStart, onStop, onCancel]);

  return { isListening, showOverlay };
}
