"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

export interface GuideStep {
  id: string;
  target?: string; // CSS selector for element to spotlight
  title: string;
  content: string;
  position?: "top" | "bottom" | "left" | "right";
  action?: "navigate" | "click" | "scroll" | "highlight";
  actionTarget?: string;
  actionValue?: string;
  autoAdvance?: number; // ms to auto-advance, undefined = wait for user
}

interface GuideState {
  isActive: boolean;
  steps: GuideStep[];
  currentIndex: number;
  currentStep: GuideStep | null;
  targetRect: DOMRect | null;
}

interface GuideContextValue extends GuideState {
  startGuide: (steps: GuideStep[], startIndex?: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  endGuide: () => void;
  goToStep: (index: number) => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuide() {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuide must be used within GuideProvider");
  return ctx;
}

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [steps, setSteps] = useState<GuideStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number | null>(null);

  const currentStep = steps[currentIndex] ?? null;

  const updateTargetRect = useCallback(() => {
    if (!currentStep?.target) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(currentStep.target);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [currentStep]);

  useEffect(() => {
    updateTargetRect();

    if (!currentStep?.target || !isActive) {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    // Watch for element changes
    const el = document.querySelector(currentStep.target);
    if (el && window.ResizeObserver) {
      observerRef.current = new ResizeObserver(() => updateTargetRect());
      observerRef.current.observe(el);
    }

    // Also track on scroll/resize
    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateTargetRect);
    };

    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
      if (observerRef.current) observerRef.current.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [currentStep, isActive, updateTargetRect]);

  const startGuide = useCallback((newSteps: GuideStep[], startIndex = 0) => {
    setSteps(newSteps);
    setCurrentIndex(startIndex);
    setIsActive(true);
  }, []);

  const nextStep = useCallback(() => {
    setCurrentIndex((i) => {
      if (i >= steps.length - 1) {
        setIsActive(false);
        return i;
      }
      return i + 1;
    });
  }, [steps.length]);

  const prevStep = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const endGuide = useCallback(() => {
    setIsActive(false);
    setSteps([]);
    setCurrentIndex(0);
    setTargetRect(null);
  }, []);

  const goToStep = useCallback((index: number) => {
    if (index >= 0 && index < steps.length) {
      setCurrentIndex(index);
    }
  }, [steps.length]);

  return (
    <GuideContext.Provider
      value={{
        isActive,
        steps,
        currentIndex,
        currentStep,
        targetRect,
        startGuide,
        nextStep,
        prevStep,
        endGuide,
        goToStep,
      }}
    >
      {children}
    </GuideContext.Provider>
  );
}
