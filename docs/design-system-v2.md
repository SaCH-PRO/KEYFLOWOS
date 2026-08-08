# KEYFLOWOS Design System v2 — Playful Luminous

## Concept
KEYFLOWOS is a living business operating system: friendly enough for a founder, powerful enough for an operator. The visual language mixes the warmth of a well-loved notebook with the clarity of a mission-control deck. Every surface feels tactile, every status feels earned, and every interaction has a little spring in its step.

## Brand roots we keep
- Primary orange: `#F97316` (`hsl(24 95% 53%)`)
- Secondary teal: `#14B8A6` (`hsl(173 58% 39%)`)
- The KEY "flow" gradient from orange → teal is preserved and extended.

## New accent palette
| Token | Hex | HSL | Usage |
|---|---|---|---|
| `violet` | `#7C5CFF` | `260 100% 68%` | AI/KEY presence, highlights, unlocks |
| `gold` | `#F5C542` | `45 90% 61%` | Achievements, milestones, premium unlocks |
| `rose` | `#F43F7A` | `342 89% 60%` | Urgent nudges, deadlines |
| `mint` | `#34D399` | `158 64% 52%` | Success/ready states |
| `sky` | `#38BDF8` | `199 94% 60%` | Info, links, calm status |

## Surfaces
| Token | Light | Dark |
|---|---|---|
| Background | `#FAF8F5` | `#131316` |
| Card | `#FFFFFF` | `#1C1C21` |
| Elevated | `#FFFFFF` with soft shadow | `#23232A` |
| Muted | `#F2F0EC` | `#25252C` |
| Border | `#E8E4DD` | `#2E2E36` |

## Typography
Load via `next/font/google`:
- **Headings / display**: `Fredoka` (400/500/600/700)
- **Body / UI**: `Nunito` (400/500/600/700)
- **Data / mono**: `JetBrains Mono` (400/500)

Tailwind mapping:
```js
fontFamily: {
  display: ['var(--font-fredoka)', 'ui-sans-serif', 'system-ui'],
  sans: ['var(--font-nunito)', 'ui-sans-serif', 'system-ui'],
  mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'SFMono-Regular'],
}
```

Type scale (px):
- 12 label / micro
- 14 body / caption
- 16 body
- 18 emphasis
- 20 title
- 24 heading
- 32 display
- 40 hero

## Shapes
- Card radius: `16px` (`rounded-2xl`) default, `24px` (`rounded-3xl`) for hero/feature cards.
- Button radius: `12px` (`rounded-xl`) default, `9999px` for floating actions.
- Input radius: `12px`.
- Shadows (soft, directionless):
  - `shadow-sm`: `0 2px 8px rgba(0,0,0,0.04)`
  - `shadow-md`: `0 8px 24px rgba(0,0,0,0.06)`
  - `shadow-lg`: `0 18px 40px rgba(0,0,0,0.08)`
- Depth (lifted):
  - `depth-1`: `0 4px 12px rgba(0,0,0,0.08)`
  - `depth-2`: `0 12px 32px rgba(0,0,0,0.12)`

## Illustration language
- Spot illustrations: simple geometric SVGs with orange/teal/violet accents.
- Module orbs: circular icons with soft gradient fills and inner shadows.
- DNA visual: segmented ring / helix where each segment maps to a DNA section.
- Empty states: friendly spot illustration + one-line guidance + primary action.
- No emojis anywhere; use Lucide icons.

## Motion
All durations are CSS custom properties so we can respect `prefers-reduced-motion` in one place.

| Token | Value | Use |
|---|---|---|
| `--kf-duration-micro` | `120ms` | hover, focus |
| `--kf-duration-base` | `200ms` | state changes |
| `--kf-duration-reveal` | `350ms` | card/page enters |
| `--kf-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | bouncy presses |
| `--kf-ease-flow` | `cubic-bezier(0.19, 1, 0.22, 1)` | smooth enters |

Patterns:
- Cards enter with `opacity 0→1` + `translateY(8px)→0`, staggered 40ms.
- Tappable cards scale to `0.98` on press.
- Buttons brighten + lift `1px` on hover.
- Loading: shimmer on skeletons, orbit spin for KEY presence.
- Progress: animated gradient fill for bars; segmented ring for integrity.

## Components (ui-v2)
- `Surface` — card primitive. Variants: `default`, `elevated`, `glass`, `accent`, `interactive`.
- `Button` — `primary`, `glow`, `soft`, `ghost`, `icon`. Loading state with spinner.
- `Badge` — `status`, `level`, `achievement`, `notification`.
- `Input`, `Select`, `Textarea` — rounded, focus ring, error state.
- `ProgressRing` — circular meter with segment support.
- `StatOrb` — circular KPI with trend arrow.
- `MissionCard` — large tappable module card with icon, title, status, progress.
- `QuickAction` — pill-shaped suggestion chip.
- `SpotIllustration` — SVG wrapper with theme-aware recoloring.
- `BottomSheet` — mobile drawer replacement.
- `EmptyState` — illustration + headline + subline + CTA.

## Accessibility
- Minimum contrast 4.5:1 for body text.
- Focus rings: `2px` solid `violet` with `2px` offset.
- Touch targets ≥44×44px; buttons use `min-h-11`.
- `prefers-reduced-motion`: disable transforms and shimmer, switch to instant fades.
- Icon-only buttons always have `aria-label`.

## Migration notes
1. New work uses `ui-v2` components and the tokens in this doc.
2. Legacy `.kf-card*` classes remain as aliases during the transition.
3. Inline `hsl(...)` styles should be replaced with Tailwind utility classes.
4. Dead `neo-*` Tailwind colors will be removed after confirming zero usage.
