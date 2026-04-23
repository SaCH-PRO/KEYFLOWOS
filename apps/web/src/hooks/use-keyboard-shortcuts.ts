"use client";

import { useEffect, useRef, useCallback } from "react";

export type ShortcutDef = {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
  when?: () => boolean;
};

export type ShortcutGroup = {
  groupName: string;
  shortcuts: ShortcutDef[];
};

function matchesShortcut(e: KeyboardEvent, s: ShortcutDef): boolean {
  const key = s.key.toLowerCase();
  if (e.key.toLowerCase() !== key) return false;
  if (s.ctrl && !e.ctrlKey) return false;
  if (s.meta && !e.metaKey) return false;
  if (s.shift && !e.shiftKey) return false;
  if (s.alt && !e.altKey) return false;
  if (!s.ctrl && e.ctrlKey && key !== "control") return false;
  if (!s.meta && e.metaKey && key !== "meta") return false;
  if (s.when && !s.when()) return false;
  return true;
}

function isTyping(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((e.target as HTMLElement)?.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(groups: ShortcutGroup[], enabled = true) {
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const typing = isTyping(e);

      for (const group of groupsRef.current) {
        for (const shortcut of group.shortcuts) {
          if (typing && !shortcut.ctrl && !shortcut.meta) continue;

          if (matchesShortcut(e, shortcut)) {
            e.preventDefault();
            e.stopPropagation();
            shortcut.action();
            return;
          }
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);

  const getShortcutMap = useCallback(() => {
    return groupsRef.current.map(g => ({
      group: g.groupName,
      shortcuts: g.shortcuts.map(s => ({
        keys: formatKeys(s),
        description: s.description,
      })),
    }));
  }, []);

  return { getShortcutMap };
}

function formatKeys(s: ShortcutDef): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push("Ctrl");
  if (s.meta) parts.push("⌘");
  if (s.shift) parts.push("Shift");
  if (s.alt) parts.push("Alt");
  parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key);
  return parts.join("+");
}
