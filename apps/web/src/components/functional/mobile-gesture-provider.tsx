"use client";

import { useEffect, createContext, useContext, useRef } from "react";

interface GestureContextType {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

const GestureContext = createContext<GestureContextType>({});

export function useMobileGestures() {
  return useContext(GestureContext);
}

function detectSwipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): { direction: "left" | "right" | "up" | "down"; distance: number } | null {
  const diffX = endX - startX;
  const diffY = endY - startY;
  const absX = Math.abs(diffX);
  const absY = Math.abs(diffY);
  const minSwipeDistance = 50;

  if (absX < minSwipeDistance && absY < minSwipeDistance) return null;

  if (absX > absY) {
    return { direction: diffX > 0 ? "right" : "left", distance: absX };
  } else {
    return { direction: diffY > 0 ? "down" : "up", distance: absY };
  }
}

export function MobileGestureProvider({ children }: { children: React.ReactNode }) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStart.current) return;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const swipe = detectSwipe(touchStart.current.x, touchStart.current.y, endX, endY);
      touchStart.current = null;

      if (!swipe) return;

      // Edge swipe from left = open mobile drawer
      if (swipe.direction === "right" && endX < 100) {
        window.dispatchEvent(new CustomEvent("kf:mobile-drawer-open"));
      }

      // Edge swipe from right = close mobile drawer or panels
      if (swipe.direction === "left" && window.innerWidth - endX < 100) {
        window.dispatchEvent(new CustomEvent("kf:escape"));
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, []);

  return (
    <GestureContext.Provider value={{}}>
      {children}
    </GestureContext.Provider>
  );
}
