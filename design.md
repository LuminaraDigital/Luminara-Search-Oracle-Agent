# Design system: Luminara Suite

Locked system for marketing and app chrome. Pages share tokens and voice; they
vary only within the macrostructure family below. Do not rotate themes per page.

## Genre

Atmospheric dark visibility tool (Night Foundry register).

## Macrostructure family

- Marketing pages: Workbench base
  - Landing: Workbench + Visibility Probe (+ constellation Map/Diagram)
  - Pricing: Catalogue-within-Workbench
  - Why / How / AI: Narrative Workflow or Split Studio variants
- App pages: util Workbench (tool chrome; atmosphere subtle only)
- Content pages (Privacy/Terms): Long Document (no blooms)

## Theme (custom, brand-mapped)

Paper band: dark. Display: classical-serif roman (Instrument Serif). Accent: warm amber-gold.

Tokens live in `tokens.css` (source of truth). Tailwind `gold` / `surface` / `ink` map to the same brand.

Accent budget: at most 5% of viewport chromatic area. No second accent hue.
Ban on marketing: gradient wordmarks (`.gold-text`); glassmorphism panels; fake browser chrome.

## Typography

- Display: Instrument Serif, weight 400, style normal (never italic headers)
- Body: Outfit 300-500
- Mono: JetBrains Mono 400-500
- Display tracking: -0.02em
- Type scale anchor: `--text-display` = clamp(2.5rem, 8vw + 1rem, 4.5rem)
- Hero headline: at most 7 words preferred; brand name is hero-level

## Spacing

4-pt named scale in `tokens.css`. Section break minimum `--space-3xl`. No card grid in heroes.

## Motion

- Stance: CSS + rAF only (no framer/gsap/three on critical path)
- Easings: `--ease-out`, `--ease-in-out`, `--ease-in`
- Ship 2-3 intentional motions on visually led surfaces; avoid decorative noise

## Craft gates (shipping checklist)

- Brand is hero-level on marketing first viewport
- No default Inter/Roboto/Arial stacks on marketing
- No purple-on-white / cream-terracotta / broadsheet default clusters
- Labs and simulated metrics are labeled in UI
- Prefer edit over inventing new visual systems
