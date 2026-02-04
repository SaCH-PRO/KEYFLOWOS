"use client";

import { useState } from "react";
import { Palette, RotateCcw, Check, Sun, Moon, Sparkles } from "lucide-react";
import { Button, Card } from "@keyflow/ui";
import { useThemeColors } from "@/lib/theme-context";
import { useTheme } from "next-themes";

const PRESET_COLORS = {
  accent1: [
    { name: "Blue", value: "#3B82F6" },
    { name: "Indigo", value: "#6366F1" },
    { name: "Violet", value: "#8B5CF6" },
    { name: "Cyan", value: "#06B6D4" },
    { name: "Emerald", value: "#10B981" },
    { name: "Orange", value: "#F97316" },
  ],
  accent2: [
    { name: "Pink", value: "#EC4899" },
    { name: "Rose", value: "#F43F5E" },
    { name: "Fuchsia", value: "#D946EF" },
    { name: "Purple", value: "#A855F7" },
    { name: "Amber", value: "#F59E0B" },
    { name: "Lime", value: "#84CC16" },
  ],
};

export default function BrandSettingsPage() {
  const { colors, setAccent1, setAccent2, resetToDefaults } = useThemeColors();
  const { theme, setTheme } = useTheme();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          Brand & Theme
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize your workspace appearance with your brand colors
        </p>
      </div>

      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {theme === "dark" ? (
              <Moon className="h-4 w-4 text-primary" />
            ) : (
              <Sun className="h-4 w-4 text-amber-500" />
            )}
            <span className="text-sm font-medium">Theme Mode</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setTheme("light")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                theme === "light"
                  ? "bg-primary text-white"
                  : "bg-secondary text-muted-foreground hover:bg-muted"
              }`}
            >
              <Sun className="h-4 w-4 inline mr-2" />
              Light
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                theme === "dark"
                  ? "bg-primary text-white"
                  : "bg-secondary text-muted-foreground hover:bg-muted"
              }`}
            >
              <Moon className="h-4 w-4 inline mr-2" />
              Dark
            </button>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-sm font-semibold mb-1">Primary Accent</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Main brand color for buttons, links, and highlights
          </p>
          
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={colors.accent1}
                onChange={(e) => setAccent1(e.target.value)}
                className="w-12 h-12 rounded-xl cursor-pointer border-2 border-border"
              />
              <input
                type="text"
                value={colors.accent1}
                onChange={(e) => setAccent1(e.target.value)}
                className="w-28 px-3 py-2 rounded-xl border border-border bg-background text-sm font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.accent1.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setAccent1(preset.value)}
                className={`relative w-10 h-10 rounded-xl transition-all hover:scale-110 ${
                  colors.accent1.toLowerCase() === preset.value.toLowerCase()
                    ? "ring-2 ring-offset-2 ring-offset-background ring-primary"
                    : ""
                }`}
                style={{ backgroundColor: preset.value }}
                title={preset.name}
              >
                {colors.accent1.toLowerCase() === preset.value.toLowerCase() && (
                  <Check className="absolute inset-0 m-auto h-5 w-5 text-white" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold mb-1">Secondary Accent</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Complementary color for gradients and emphasis
          </p>
          
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={colors.accent2}
                onChange={(e) => setAccent2(e.target.value)}
                className="w-12 h-12 rounded-xl cursor-pointer border-2 border-border"
              />
              <input
                type="text"
                value={colors.accent2}
                onChange={(e) => setAccent2(e.target.value)}
                className="w-28 px-3 py-2 rounded-xl border border-border bg-background text-sm font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.accent2.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setAccent2(preset.value)}
                className={`relative w-10 h-10 rounded-xl transition-all hover:scale-110 ${
                  colors.accent2.toLowerCase() === preset.value.toLowerCase()
                    ? "ring-2 ring-offset-2 ring-offset-background ring-accent"
                    : ""
                }`}
                style={{ backgroundColor: preset.value }}
                title={preset.name}
              >
                {colors.accent2.toLowerCase() === preset.value.toLowerCase() && (
                  <Check className="absolute inset-0 m-auto h-5 w-5 text-white" />
                )}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Preview
        </h3>
        
        <div className="space-y-4">
          <div 
            className="h-20 rounded-2xl flex items-center justify-center text-white font-semibold text-lg"
            style={{ background: `linear-gradient(135deg, ${colors.accent1}, ${colors.accent2})` }}
          >
            KeyFlow Gradient
          </div>
          
          <div className="flex gap-3 flex-wrap">
            <button
              className="px-4 py-2 rounded-xl text-white font-medium transition-all hover:opacity-90"
              style={{ backgroundColor: colors.accent1 }}
            >
              Primary Button
            </button>
            <button
              className="px-4 py-2 rounded-xl text-white font-medium transition-all hover:opacity-90"
              style={{ backgroundColor: colors.accent2 }}
            >
              Secondary Button
            </button>
            <button
              className="px-4 py-2 rounded-xl font-medium transition-all"
              style={{ 
                background: `linear-gradient(135deg, ${colors.accent1}, ${colors.accent2})`,
                color: "white"
              }}
            >
              Gradient Button
            </button>
          </div>

          <div className="flex gap-4 items-center">
            <span className="text-sm" style={{ color: colors.accent1 }}>Primary Text</span>
            <span className="text-sm" style={{ color: colors.accent2 }}>Accent Text</span>
            <span 
              className="text-sm font-semibold"
              style={{ 
                background: `linear-gradient(135deg, ${colors.accent1}, ${colors.accent2})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent"
              }}
            >
              Gradient Text
            </span>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          onClick={resetToDefaults}
          variant="outline"
          className="gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to Defaults
        </Button>
        
        <Button onClick={handleSave} className="gap-2">
          {saved ? (
            <>
              <Check className="h-4 w-4" />
              Saved!
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>
    </div>
  );
}
