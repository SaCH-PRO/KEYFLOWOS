"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

type ThemeColors = {
  accent1: string;
  accent2: string;
};

type ThemeContextType = {
  colors: ThemeColors;
  setAccent1: (color: string) => void;
  setAccent2: (color: string) => void;
  resetToDefaults: () => void;
};

const DEFAULT_COLORS: ThemeColors = {
  accent1: "#F97316",
  accent2: "#14B8A6",
};

const STORAGE_KEY = "kf_theme_colors";

const ThemeColorsContext = createContext<ThemeContextType | null>(null);

function hexToHSL(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "24 95% 53%";
  
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function applyColorsToDOM(colors: ThemeColors) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty("--kf-accent1", hexToHSL(colors.accent1));
  root.style.setProperty("--kf-accent2", hexToHSL(colors.accent2));
  root.style.setProperty("--kf-accent1-hex", colors.accent1);
  root.style.setProperty("--kf-accent2-hex", colors.accent2);
}

function getInitialColors(): ThemeColors {
  if (typeof window === 'undefined') return DEFAULT_COLORS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.accent1 && parsed.accent2) {
        return parsed;
      }
    }
  } catch {
  }
  return DEFAULT_COLORS;
}

export function ThemeColorsProvider({ children }: { children: ReactNode }) {
  const [colors, setColors] = useState<ThemeColors>(() => getInitialColors());

  useEffect(() => {
    applyColorsToDOM(colors);
  }, [colors]);

  useEffect(() => {
    const initialColors = getInitialColors();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    setColors(initialColors);
    applyColorsToDOM(initialColors);
  }, []);

  const setAccent1 = useCallback((color: string) => {
    setColors(prev => {
      if (prev.accent1 === color) return prev;
      const newColors = { ...prev, accent1: color };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newColors));
      return newColors;
    });
  }, []);

  const setAccent2 = useCallback((color: string) => {
    setColors(prev => {
      if (prev.accent2 === color) return prev;
      const newColors = { ...prev, accent2: color };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newColors));
      return newColors;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setColors(DEFAULT_COLORS);
    localStorage.removeItem(STORAGE_KEY);
    applyColorsToDOM(DEFAULT_COLORS);
  }, []);

  return (
    <ThemeColorsContext.Provider value={{ colors, setAccent1, setAccent2, resetToDefaults }}>
      {children}
    </ThemeColorsContext.Provider>
  );
}

export function useThemeColors() {
  const context = useContext(ThemeColorsContext);
  if (!context) {
    throw new Error("useThemeColors must be used within ThemeColorsProvider");
  }
  return context;
}

export { DEFAULT_COLORS };

