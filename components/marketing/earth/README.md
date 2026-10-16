# Landing globe

The gold Earth behind the landing hero, statement and "How it works" chapters. One sticky stage (`../SpaceStage.tsx`) holds one globe for the whole sequence: a sunrise horizon under the hero pulls back to the full planet behind the statement, then settles beside the four chapters.

## Files

| File | Role |
|---|---|
| `globeStory.ts` | **Edit here.** Chapter copy (Scan, Ask, Prove, Fix), evidence legend, engine names, the globe notice, illustrative places and links, palette. |
| `globeMath.ts` | Pure math: view rotation, projection, lifted arcs, camera poses (`horizonPose`, `centerPose`, `storyPose`), dot-grid level, scroll progress. No DOM. |
| `globeRenderer.ts` | WebGL fragment shader (stars, dot-matrix continents, day side, gold atmosphere, sunrise flare) plus a Canvas2D overlay (arcs, comets, markers, label). Lazy chunk. |
| `../SpaceStage.tsx` | Sticky stage, lazy load, scroll-to-pose mapping (`targetForProgress`), chapter reporting, CSS fallback planet. |

## Invariants

- **Illustrative only.** Places, arcs and evidence markers are not customers, offices, traffic or audit output. Keep real audit data (`demo/demoFixtures`, `liveSampleSnapshot`) out of this folder. The notice in `GLOBE_NOTICE` stays visible beside the globe.
- **Evidence semantics** match methodology: Measured = live evidence, Estimated = directional, Not measured = missing data and never a poor result. No scores, percentages or outcome claims in this copy (enforced in `tests/landingGlobe.test.ts`).
- **HTML owns meaning.** All copy and controls are page HTML; the stage is `aria-hidden`.
- **Budget.** No Three.js, no runtime GLB, no new dependencies (`docs/plans/landing-moat-100x.md`). One raw WebGL shader in a lazy chunk, loaded on idle after first paint, reusing `public/brand/earth-daymap.webp` (1024x512) for both the day side and the land mask.
- **Stacking.** The stage is an `absolute inset-0` track at `z-0` spanning the story wrapper, with a `sticky` viewport-height child, so it can never overrun the wrapper. Every sibling section is `relative z-10`. Do not add an opaque fixed layer above static content.
- **Motion.** Spin, comets, pulses and the scan band stop under `prefers-reduced-motion` (frames render on scroll only). The loop stops off-screen, on hidden tabs and on context loss.
- **Failure.** No WebGL, a shader error, context loss or Save-Data shows the CSS stars and horizon (`.lx-stars`, `.lx-planet-fallback` in `../space.css`); copy and calls to action are unaffected.

## Assets

`public/brand/earth-daymap.webp`: NASA Earth Observatory Blue Marble Next Generation with Topography and Bathymetry, downsampled (public domain US Government work). Land is classified in the browser from the texture colour (blue-dominant pixels are ocean, bright neutral pixels are ice).
