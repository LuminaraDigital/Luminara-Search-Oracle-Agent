# Landing scene: from template to a 10

**Status:** Plan, ready to implement  
**Surface:** Marketing landing only (`components/LandingPage.tsx`)  
**Companions:** `design.md`, `docs/plans/landing-moat-100x.md`, `docs/plans/premium-craft-surface.md`

## What the references actually are

The two references are the same composition wearing two materials.

| | Earth page | Finance globe | Luminara translation |
|---|---|---|---|
| Object | A planet, cropped by the bottom edge | A wireframe sphere, cropped by every edge | A visibility sphere, cropped by the bottom and the sides |
| Type | Centered stack on the sky: kicker, one huge word, hairline, one sentence | Centered stack on the sphere: two-line headline, one sentence | Centered stack on the upper hemisphere |
| Actions | One pill sitting on the horizon | Two pills, solid plus ghost, centered | Two pills on the limb |
| Sides | Venus and Mars, partly off-canvas | A single bright node | Four engines as bodies on the limb. Names only |
| Nav | Floats on the scene | Word links, text login, one pill. No heavy bar | Same, landing hero only |
| What is absent | No card, no grid, no second accent wash | No card beside the headline | No workbench in the first viewport |

Ignore the HoverNotes chips in the Earth capture. Those are a browser overlay, not the page.

## Why the current landing reads as generated

`LandingPage.tsx` puts a serif claim in a 7-column and a Probe card in a 5-column. Under both, `MarketingCinematicStage` stacks the standard dark-SaaS kit: several radial blooms, two light shafts, a perspective floor grid, six dust motes, a vignette, and film grain.

That kit has no object. The references have one object, and the type is placed on it. Gold gradient words, equal-weight buttons, and a card beside the headline are the tells. Removing them is the job.

## Direction

**One scene.** The first viewport is a dotted sphere on a starfield. The claim sits on the upper hemisphere. The two actions sit on the bright limb, where Earth's button sits on the atmosphere. Scroll, and the next viewport is the Probe: the instrument you just landed on.

**Material.** Ink-white dots and two faint meridians plus an equator. Gold is a scalpel: the hairline under the headline, the four engine nodes, the primary button, and a thin limb glow. A gold cage would blow the accent budget in `design.md` (at most 5% of the viewport) and would repeat the current wash.

**Not this.** No photograph of Earth. No purple. No Three.js, no runtime GLB, no GSAP, no Framer. `landing-moat-100x.md` already measured `three` plus the archive GLB at roughly 264 KB gzip, which fails the hard gate. The sphere is Canvas2D. `VisibilityFieldMap.tsx` already draws a Fibonacci sphere. The hero reuses that math at hero scale.

## Locked frame

Desktop, 1440 wide. Mobile stacks the same stack. It does not invent a second layout.

1. Nav floats. Transparent, no border, until `scrollY > 12`, then the existing paper bar and hairline return.
2. Kicker, mono, uppercase, tracking as `.mkt-eyebrow`: `Visibility`
3. Headline, Instrument Serif, solid `--color-ink`, never a gradient, never italic: `Where answers happen.`
4. A 2.5rem gold hairline, 1px, centered.
5. One sentence, max 42ch, `.mkt-body`: `See whether Google, ChatGPT, and Perplexity mention your business. Leave with one fix.`
6. Primary `Run sample scout` (scrolls to the Probe and focuses it, as today). Secondary ghost `Open Instant Audit`. Authenticated visitors get `Open Instant Audit` and `Open dashboard`.
7. Sphere diameter about 118vw, center low enough that the limb crosses near 68% of the viewport and the bottom is cut by the fold.
8. Four engine labels in Outfit, 13px, sitting just outside the limb: Google and AI Overviews higher and smaller, ChatGPT and Perplexity at the side edges like Venus and Mars. Under 768px the labels hide. The coverage strip below already names the four.
9. One brighter hub point labeled with the sample domain and the word `Sample`. No score, no percentage, no dollar.
10. A 32px ring at the bottom center scrolls to `#visibility-workbench`.

The cost-displacement section stays where it is, under the fold. The hero names the object. It does not explain the company.

## Build order

### 1. Share the sphere math

Extract `fibSphere` and the projection helpers from `components/marketing/VisibilityFieldMap.tsx` into `components/marketing/sphereField.ts`.

Export a pure projector:

- Inputs: points, yaw, pitch, radius, origin.
- Output: screen x, y, scale, and a front flag (`z` after rotation > 0).
- Deterministic. No `Math.random`.

`VisibilityFieldMap` imports it and keeps its current look in this pass, aside from the shared function. Add `tests/sphereField.test.ts`: point count, same input gives the same points, a point on the near side projects in front.

### 2. Hero sphere

New `components/marketing/VisibilitySphere.tsx`.

- One `<canvas aria-hidden>`, sized to the hero, `devicePixelRatio` capped at 1.5.
- Starfield in the same canvas: about 90 stars, two sizes, drawn before the sphere. This replaces the dust-mote layer.
- About 1100 dots at `≥768px`, about 420 below. Alpha and radius from depth. Color is ink, not gold.
- Two meridians and one equator at roughly 14% white.
- Four engine nodes from `CONSTELLATION_ENGINE_LABELS`, gold, with the labels in HTML absolutely positioned from the projected points so they stay crisp and selectable as text (still `aria-hidden` on the decorative canvas; the coverage strip remains the accessible list).
- Hub uses `SAMPLE_FIXTURE.domain` and the literal `Sample`.
- Motion, two only: a slow yaw (about 0.15 rad/s) and a pointer parallax of ±0.08 rad, eased with the existing lerp. `prefers-reduced-motion: reduce` freezes a composed angle and does not start a frame loop. `IntersectionObserver` cancels the loop when the hero is off screen.
- A radial scrim behind the type block only, about 520px, paper at 55% in the middle, transparent at the edge. No page-wide fog, no floor grid, no film grain.

### 3. Recompose the first viewport

In `components/LandingPage.tsx`, replace the `lg:grid-cols-12` hero with a `min-h-[100dvh]` section:

- `VisibilitySphere` is `absolute inset-0`.
- The type stack is a centered column, `max-w-[40rem]`, optically in the upper half so it lands on the dark cap of the sphere.
- Delete the tertiary "open Instant Audit with their own keys" line from the hero. That sentence moves under the Probe, where the guest path already exists.
- Stop rendering `MarketingAtmosphere` on the landing page. The stage's floor grid is the slop. Leave `MarketingCinematicStage` in place for the other marketing pages at `page` intensity.

The bottom 120px of the hero is a gradient from transparent to `--color-paper`, so the limb dissolves into the next section instead of ending in a hard cut.

### 4. Nav over the scene

`components/MarketingNav.tsx` gains `tone?: 'solid' | 'overlay'`, default `solid`.

- `overlay`: no background and no border while `scrollY <= 12`. Past that, the current paper and hairline.
- Landing passes `overlay`. `MarketingPageShell` stays `solid`.
- Link set, primary pill, and sign-in text do not change.

### 5. The Probe is the second viewport

Move `MarketingStage` out of the hero into the next section, `#visibility-workbench`, centered, `max-w-xl`. Heading above it: `Run a labeled sample.` The existing scroll-and-focus behavior stays.

Do not restyle the Probe into glass. `design.md` bans glass and fake browser chrome.

### 6. One sphere, two distances

`VisibilityFieldMap` keeps the shared math and a tighter crop (zoom about 1.6) so it reads as the instrument panel, not a second hero. Hero and map each pause when they are off screen, so two canvases never tick together.

Engine brightness stays the existing enum map: Measured bright, Estimated mid, Not measured dim. Sample copy on that section stays.

### 7. Token note

Update the landing line in `design.md`:

> Landing hero is a full-viewport visibility sphere with the claim centered on it. The Probe is the next section. No cinematic floor grid on the landing hero. Sphere structure is neutral ink. Gold is the hairline, the engine nodes, and the primary button.

No new color. No new font.

## Out of scope

- App shell: Home, Audit, Ask, Profile. Those stay as they are.
- Pricing, Why, Methodology chrome.
- New Blender plates, photography, or a GLB.
- Rewriting FAQ or sell-point claims.
- Any metric that is not already in `SAMPLE_FIXTURE` and labeled Sample.

## Done when

- First viewport at 1440 and at 375: one sphere, one headline, two actions, no card, no floor grid.
- Headline contrast holds when dots pass behind it (the type scrim).
- Gold area stays a hairline, four nodes, and one button.
- Reduced motion: still composed, no rotation loop.
- Keyboard: nav and both hero buttons show the existing focus ring on the dark scene.
- `npm run typecheck` and the new sphere tests pass.
- Marketing bundle does not gain `three`.

## Implementation order

1. `sphereField.ts` and its test.
2. `VisibilitySphere.tsx`.
3. Landing composition and the overlay nav.
4. Remove the landing atmosphere.
5. Move the Probe down.
6. Map shares the math and pauses off screen.
7. `design.md` line.
8. Browser pass at 1440 and 375, including reduced motion and keyboard focus.
