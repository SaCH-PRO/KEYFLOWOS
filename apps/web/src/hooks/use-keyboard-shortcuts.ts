"use client";

import { useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

interface ShortcutConfig {
  key: string;
  modifier?: "ctrl" | "meta" | "alt" | "shift";
  global?: boolean;
  handler: () => void;
  description: string;
  category: string;
}

// Legacy format used by some pages (bookings, etc.)
interface LegacyShortcutItem {
  key: string;
  action: () => void;
  description: string;
}

interface LegacyShortcutGroup {
  groupName: string;
  shortcuts: LegacyShortcutItem[];
}

// Backward compatibility export
export type ShortcutGroup = LegacyShortcutGroup;

const SHORTCUTS: ShortcutConfig[] = [
  {
    key: "k",
    modifier: "meta",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } })),
    description: "Open command palette",
    category: "Navigation",
  },
  {
    key: "K",
    modifier: "shift",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:open-module-launcher")),
    description: "Open module launcher",
    category: "Navigation",
  },
  {
    key: "j",
    modifier: "meta",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "chat" } })),
    description: "Talk to KEY",
    category: "Navigation",
  },
  {
    key: "n",
    modifier: "meta",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:new-entity")),
    description: "Create new item",
    category: "Actions",
  },
  {
    key: "h",
    modifier: "meta",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:go-home")),
    description: "Go to Cockpit",
    category: "Navigation",
  },
  {
    key: "1",
    modifier: "meta",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:nav-mode", { detail: { mode: "startup" } })),
    description: "Switch to Startup mode",
    category: "Mode",
  },
  {
    key: "2",
    modifier: "meta",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:nav-mode", { detail: { mode: "growth" } })),
    description: "Switch to Growth mode",
    category: "Mode",
  },
  {
    key: "3",
    modifier: "meta",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:nav-mode", { detail: { mode: "enterprise" } })),
    description: "Switch to Enterprise mode",
    category: "Mode",
  },
  {
    key: "Escape",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:escape")),
    description: "Close overlays / go back",
    category: "Navigation",
  },
  {
    key: "?",
    modifier: "shift",
    global: true,
    handler: () => window.dispatchEvent(new CustomEvent("kf:show-shortcuts")),
    description: "Show keyboard shortcuts",
    category: "Help",
  },
];

export function useKeyboardShortcuts(legacyGroups?: LegacyShortcutGroup[], _enabled?: boolean) {
  const _router = useRouter();
  const _pathname = usePathname();
  const lastNavTime = useRef(0);

  const isInputFocused = useCallback(() => {
    const active = document.activeElement;
    if (!active) return false;
    return (
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.getAttribute("contenteditable") === "true"
    );
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs (unless global)
      if (isInputFocused() && !e.metaKey && !e.ctrlKey) return;

      const modifier = e.metaKey || e.ctrlKey
        ? "meta"
        : e.altKey
        ? "alt"
        : e.shiftKey
        ? "shift"
        : undefined;

      const key = e.key.toLowerCase();

      // Check global shortcuts first
      for (const shortcut of SHORTCUTS) {
        const keyMatch = shortcut.key.toLowerCase() === key;
        const modifierMatch = shortcut.modifier === modifier || (!shortcut.modifier && !modifier);
        const isQuestionMark = shortcut.key === "?" && e.key === "?";

        if ((keyMatch || isQuestionMark) && modifierMatch) {
          e.preventDefault();
          const now = Date.now();
          if (shortcut.category === "Navigation" && now - lastNavTime.current < 100) continue;
          lastNavTime.current = now;
          shortcut.handler();
          return;
        }
      }

      // Check legacy page-specific shortcuts
      if (legacyGroups) {
        for (const group of legacyGroups) {
          for (const shortcut of group.shortcuts) {
            const keyMatch = shortcut.key.toLowerCase() === key;
            const needsModifier = shortcut.key.length === 1 && /^[a-z0-9]$/i.test(shortcut.key);
            const modifierMatch = needsModifier ? modifier === "meta" : !modifier;

            if (keyMatch && modifierMatch) {
              e.preventDefault();
              shortcut.action();
              return;
            }
          }
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isInputFocused]);

  return { shortcuts: SHORTCUTS };
}

export function useRouteKeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const goHome = () => router.push("/app/keyflow-command");
    const handleEscape = () => {
      // If on a detail page, go back to list
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length > 2 && segments[0] === "app") {
        const parentRoute = "/" + segments.slice(0, -1).join("/");
        router.push(parentRoute);
      }
    };

    window.addEventListener("kf:go-home", goHome);
    window.addEventListener("kf:escape", handleEscape);
    return () => {
      window.removeEventListener("kf:go-home", goHome);
      window.removeEventListener("kf:escape", handleEscape);
    };
  }, [router, pathname]);
}
