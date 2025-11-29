import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./apps/web/src/**/*.{js,ts,jsx,tsx,mdx}",
    "./packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--kf-background))",
        foreground: "hsl(var(--kf-foreground))",
        card: "hsl(var(--kf-card))",
        "card-foreground": "hsl(var(--kf-card-foreground))",
        popover: "hsl(var(--kf-popover))",
        "popover-foreground": "hsl(var(--kf-popover-foreground))",
        border: "hsl(var(--kf-border))",
        input: "hsl(var(--kf-input))",
        primary: {
          DEFAULT: "hsl(var(--kf-primary))",
          foreground: "hsl(var(--kf-primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--kf-secondary))",
          foreground: "hsl(var(--kf-secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--kf-muted))",
          foreground: "hsl(var(--kf-muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--kf-accent))",
          foreground: "hsl(var(--kf-accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--kf-destructive))",
          foreground: "hsl(var(--kf-destructive-foreground))",
        },
        ring: "hsl(var(--kf-ring))",
        // legacy neon palette
        'neo-black': '#000000',
        'neo-graphite': '#0D0D0E',
        'neo-chrome': '#1F2225',
        'neo-silver': '#D5D7DA',
        'electric-blue': '#4EA8FF',
        'pulse-violet': '#A374FF',
        'neon-mint': '#4CFFCE',
        'amber-circuit': '#FFC34D',
        'cyber-red': '#FF4E4E',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular'],
      },
      boxShadow: {
        'glass': '0 10px 40px rgba(0, 0, 0, 0.45)',
        'neon': '0 0 20px rgba(78, 168, 255, 0.35)',
      },
      borderRadius: {
        lg: '14px',
        xl: '18px',
      },
      transitionTimingFunction: {
        'flow': 'cubic-bezier(0.19, 1, 0.22, 1)',
      },
    },
  },
  plugins: [],
};
export default config;
