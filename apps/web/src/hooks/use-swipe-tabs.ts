"use client";

import { useRef, useCallback } from "react";

interface UseSwipeTabsOptions {
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  threshold?: number;
  maxTime?: number;
}

function isInsideScrollableContainer(el: EventTarget | null): boolean {
  let node = el as HTMLElement | null;
  while (node) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const style = getComputedStyle(node);
      const overflowX = style.overflowX;
      if (overflowX === "auto" || overflowX === "scroll") {
        return true;
      }
    }
    const tag = node.tagName;
    if (tag === "TABLE" || tag === "THEAD" || tag === "TBODY" || tag === "TR" || tag === "TD" || tag === "TH") {
      return true;
    }
    if (node.dataset?.swipeIgnore !== undefined) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function useSwipeTabs({
  tabs,
  activeTab,
  onTabChange,
  threshold = 50,
  maxTime = 400,
}: UseSwipeTabsOptions) {
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const directionRef = useRef<1 | -1 | 0>(0);

  const activeIndex = tabs.indexOf(activeTab);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isInsideScrollableContainer(e.target)) {
      touchStart.current = null;
      return;
    }
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    directionRef.current = 0;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStart.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStart.current.x;
      const dy = touch.clientY - touchStart.current.y;
      const dt = Date.now() - touchStart.current.time;
      touchStart.current = null;

      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < maxTime) {
        const direction = dx < 0 ? 1 : -1;
        const nextIndex = activeIndex + direction;
        if (nextIndex >= 0 && nextIndex < tabs.length) {
          directionRef.current = direction;
          onTabChange(tabs[nextIndex]);
        }
      }
    },
    [activeIndex, tabs, onTabChange, threshold, maxTime],
  );

  return {
    swipeHandlers: {
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd,
    },
    swipeDirection: directionRef,
  };
}
