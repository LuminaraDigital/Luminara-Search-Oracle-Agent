# Design system: Luminara Suite

Locked system for marketing and app chrome. Pages share tokens and voice; they
vary only within the macrostructure family below. Do not rotate themes per page.

## Genre

Atmospheric dark visibility tool (Night Foundry register).

## Macrostructure family

- Marketing pages: Workbench base
  - Landing: space story (sunrise globe hero with the inline live crawl check, statement, four-chapter globe story, report, value props, FAQ, closing horizon)
  - Pricing: Catalogue-within-Workbench
  - Why / How / AI: Narrative Workflow or Split Studio variants
- App pages: util Workbench (tool chrome; atmosphere subtle only), in the Ledger shell (`ledger.css`, `components/shell/AppShell.tsx`):
  - Left rail from 1024px, a five-tab bar below it; one top bar with the view name and the agent's state
  - Ask is a ledger: every turn is a dated row, an answer shows its steps, its sources and how it failed
  - The landing's sunrise horizon sits under the Ask composer and shows the agent's state (idle, working, waiting for you). It is the only glass in the app
  - Anything an agent wants to do outside Luminara waits in Review (the `mcp_action_requests` queue) with an approval card: what happens, the site, why it asks, what you allow, the details sent
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

- The claim is the hero headline at display size. Brand sits in the nav and one eyebrow above the claim
- Landing hero is the SpaceStage sunrise horizon + serif claim + one domain input (see components/marketing/earth/README.md)
- Menu pages share MarketingAtmosphere (starfield) + MarketingPageShell
- One nav link set and one footer on every marketing page (MarketingChromeContext, built in App.tsx)
- Opacity modifiers need theme colors (`bg-gold/10`, `text-ink/75`). `bg-[var(--token)]/10` compiles to nothing in Tailwind 3
- Font sizes from tokens use `text-[length:var(--token)]`. A bare `text-[var(--token)]` is parsed as a color and silently drops the size
- Marketing body copy is `.mkt-body` (17px). No 14px light gray paragraphs
- Section surfaces alternate paper / paper-2. Eyebrows are the only accent text
- Honest sell points only: dual surface, evidence labels, operator loop / MCP. No invented customer counts or ROI
- Marketing pages address operators and owners. No investor-addressed copy on customer pages
- Marketing and app use the same names: Instant Audit, Ask, Dashboard
- No default Inter/Roboto/Arial stacks on marketing
- No purple-on-white / cream-terracotta / broadsheet default clusters
- Labs and simulated metrics are labeled in UI
- Prefer edit over inventing new visual systems
- Ban on marketing: gradient wordmarks; glassmorphism; fake browser chrome; Blender glow underlays behind the Probe; third-party video hotlinks without owned assets
