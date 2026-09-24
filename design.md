# Design - Luminara Suite

Locked system for marketing + app chrome. Pages share tokens/voice; they vary only
within the macrostructure family below. Do not rotate themes per page.

Hallmark stamp: Workbench + Visibility Probe · N10 · Ft5 · Night Foundry gold

## Genre
atmospheric (dark AI visibility tool · Night Foundry register)

## Macrostructure family
- Marketing pages: Workbench base
  - Landing: Workbench + Visibility Probe (+ constellation Map/Diagram)
  - Pricing: Catalogue-within-Workbench
  - Why / How / AI: Narrative Workflow or Split Studio variants
- App pages: util Workbench (tool chrome; atmosphere subtle only)
- Content pages (Privacy/Terms): Long Document (no blooms)

## Theme (custom · brand-mapped)
Paper band: dark · Display: classical-serif roman (Instrument Serif) · Accent: warm amber-gold

Tokens live in `tokens.css` (source of truth). Tailwind `gold` / `surface` / `ink` map to the same brand.

Accent budget: ≤5% of viewport chromatic area. No second accent hue.
Ban on marketing: gradient wordmarks (`.gold-text`); glassmorphism panels; fake browser chrome.

## Typography
- Display: Instrument Serif, weight 400, style normal (never italic headers)
- Body: Outfit 300-500
- Mono: JetBrains Mono 400-500
- Display tracking: -0.02em
- Type scale anchor: `--text-display` = clamp(2.5rem, 8vw + 1rem, 4.5rem)
- Hero headline: ≤7 words preferred; brand name is hero-level

## Spacing
4-pt named scale in `tokens.css`. Section break minimum `--space-3xl`. No card grid in heroes.

## Motion
- Stance: CSS + rAF only (no framer/gsap/three on critical path)
- Easings: `--ease-out`, `--ease-in-out`, `--ease-in`
- Reveal: fade ≤220ms; reduced-motion → opacity ≤150ms, atmosphere static
- Cap: ≤3 named microinteraction primitives per page
- Hero polish: HP3 cursor-spotlight via MarketingAtmosphere

## Microinteractions
- Silent success; hover tooltips 800ms; focus 0ms
- Primary CTA: active press translateY(1px); focus-visible ring instant
- Demo probe: optimistic URL normalize; invalid = inline error (Instant Audit voice)

## CTA voice
- Primary: solid accent fill, black ink, rounded-xl (12px), sentence case
  Pattern: "Audit my site" / "Open the app". Kill ALL-CAPS 9-10px tracking.
- Secondary: hairline accent border, transparent fill
- Tertiary: typographic link (Windows app, MCP, studio)
- One primary CTA per viewport. Nav CTA mirrors page primary.

## Nav / footer
- Marketing: N10 scroll-morph (bar → detached pill)
- Marketing footer: Ft5 Statement
- App shell: keep tool header (no floating pill)

## Honesty invariant
Never invent SEO/AEO metrics. Use Measured / Not measured / Requires sign-in / Unknown.
Sample landing demo uses fixtures only. Live guest scout is Instant Audit with client BYOK; hosted spend needs auth.

## Atmosphere
- Landing: MarketingAtmosphere full
- Marketing siblings: subtle
- App shell: PremiumAtmosphere subtle
- Legal: none

## Provenance
Locked from Premium Craft Surface plan (`docs/plans/premium-craft-surface.md`) 2026-09-23.
CONFIRM_DELETE=false.
