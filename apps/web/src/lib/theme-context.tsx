"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

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
  accent1: "#3B82F6",
  accent2: "#EC4899",
};

const STORAGE_KEY = "kf_theme_colors";

const ThemeColorsContext = createContext<ThemeContextType | null>(null);

function hexToHSL(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "217 91% 60%";
  
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  
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
    // Ignore parse errors
  }
  return DEFAULT_COLORS;
}

export function ThemeColorsProvider({ children }: { children: ReactNode }) {
  const [colors, setColors] = useState<ThemeColors>(() => getInitialColors());

  useEffect(() => {
    applyColorsToDOM(colors);
  }, [colors]);

  const updateColors = (newColors: ThemeColors) => {
    setColors(newColors);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newColors));
    applyColorsToDOM(newColors);
  };

  const setAccent1 = (color: string) => {
    updateColors({ ...colors, accent1: color });
  };

  const setAccent2 = (color: string) => {
    updateColors({ ...colors, accent2: color });
  };

  const resetToDefaults = () => {
    updateColors(DEFAULT_COLORS);
  };

  return (
    <ThemeColorsContext.Provider value={{ colors, setAccent1, setAccent2, resetToDefaults }}>
      {children}
    </ThemeColorsContext.Provider>
  );
}

export function useThemeColors() {
  const context = useContext(ThemeColorsContext);
  if (!context) {
    return {
      colors: DEFAULT_COLORS,
      setAccent1: () => {},
      setAccent2: () => {},
      resetToDefaults: () => {},
    };
  }
  return context;
}
