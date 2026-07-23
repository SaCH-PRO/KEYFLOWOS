/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
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
        violet: {
          DEFAULT: "hsl(var(--kf-violet))",
          foreground: "hsl(var(--kf-violet-foreground))",
        },
        gold: {
          DEFAULT: "hsl(var(--kf-gold))",
          foreground: "hsl(var(--kf-gold-foreground))",
        },
        rose: {
          DEFAULT: "hsl(var(--kf-rose))",
          foreground: "hsl(var(--kf-rose-foreground))",
        },
        mint: {
          DEFAULT: "hsl(var(--kf-mint))",
          foreground: "hsl(var(--kf-mint-foreground))",
        },
        sky: {
          DEFAULT: "hsl(var(--kf-sky))",
          foreground: "hsl(var(--kf-sky-foreground))",
        },
        surface: {
          DEFAULT: "hsl(var(--kf-surface))",
          elevated: "hsl(var(--kf-surface-elevated))",
          muted: "hsl(var(--kf-surface-muted))",
        },
      },
      fontFamily: {
        display: ['var(--font-geist)', 'ui-sans-serif', 'system-ui'],
        sans: ['var(--font-geist)', 'ui-sans-serif', 'system-ui'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular'],
      },
      boxShadow: {
        'glass': '0 10px 40px rgba(0, 0, 0, 0.45)',
        'neon': '0 0 20px rgba(78, 168, 255, 0.35)',
        'sm': '0 2px 8px rgba(0, 0, 0, 0.04)',
        'md': '0 8px 24px rgba(0, 0, 0, 0.06)',
        'lg': '0 18px 40px rgba(0, 0, 0, 0.08)',
        'depth-1': '0 4px 12px rgba(0, 0, 0, 0.08)',
        'depth-2': '0 12px 32px rgba(0, 0, 0, 0.12)',
        'depth-3': '0 24px 48px rgba(0, 0, 0, 0.16)',
      },
      borderRadius: {
        lg: '14px',
        xl: '18px',
        '2xl': '16px',
        '3xl': '24px',
      },
      transitionTimingFunction: {
        'flow': 'cubic-bezier(0.19, 1, 0.22, 1)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
