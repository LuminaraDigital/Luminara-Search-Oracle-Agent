# Landing globe

The gold Earth behind the landing hero, statement and "How it works" chapters. One sticky stage (`../SpaceStage.tsx`) holds one globe for the whole sequence: a sunrise horizon under the hero pulls back to the full planet behind the statement, then settles beside the four chapters.

## Files

| File | Role |
|---|---|
| `globeStory.ts` | **Edit here.** Chapter copy (Scan, Ask, Prove, Fix), evidence legend, engine names, the globe notice, illustrative places and links, palette. |
| `globeMath.ts` | Pure math: view rotation, projection, lifted arcs, camera poses (`horizonPose`, `centerPose`, `storyPose`), dot-grid level, scroll progress. No DOM. |
| `globeRenderer.ts` | WebGL fragment shader (stars, dot-matrix continents, day side, gold atmosphere, sunrise flare) plus a Canvas2D overlay (arcs, comets, markers, label). Lazy chunk. |
| `../SpaceStage.tsx` | Sticky stage, lazy load, scroll-to-pose mapping (`targetForProgress`), chapter reporting, CSS fallback planet. |
| `../deviceCapability.ts` | Reduced motion, Save-Data and low-memory checks used by the stage and the scroll reveal. |
| `../EvidenceGlyph.tsx` | The one Measured / Estimated / Not measured glyph and the engine status labels, shared by the landing and `DomainCheck`. |

## Invariants

- **Illustrative only.** Places, arcs and evidence markers are not customers, offices, traffic or audit output. Keep real audit data (`demo/demoFixtures`, `liveSampleSnapshot`) out of this folder. The notice in `GLOBE_NOTICE` stays visible beside the globe.
- **Evidence semantics** match methodology: Measured = live evidence, Estimated = directional, Not measured = missing data and never a poor result. No scores, percentages or outcome claims in this copy (enforced in `tests/landingGlobe.test.ts`).
- **HTML owns meaning.** All copy and controls are page HTML; the stage is `aria-hidden`.
- **Budget.** No Three.js, no runtime GLB, no new dependencies (decision log in `docs/plans/landing-moat-100x.md`). The budget:
  - One raw WebGL1 shader in a lazy chunk, loaded on idle after first paint.
  - It links in the background when `KHR_parallel_shader_compile` is available.
  - It reuses `public/brand/earth-daymap.webp` (1024x512, power of two), decoded with `createImageBitmap`. The shader classifies land and ice from that texture, so there is no CPU mask.
  - The drawing buffer is capped at about 4.5 megapixels and DPR 1.75 (1 on low-power devices), and frames at about 60 fps (30 on low-power devices).
  - `failIfMajorPerformanceCaveat` refuses software rasterisers, and the shader requires highp.
- **Stacking.** The stage is an `absolute inset-0` track at `z-0` spanning the story wrapper, with a `sticky` viewport-height child, so it can never overrun the wrapper. Every sibling section is `relative z-10`. Do not add an opaque fixed layer above static content.
- **Layout.** The story pose follows the CSS `lg` breakpoint through `matchMedia`, not the canvas width, so a classic scrollbar cannot put the globe behind the chapter copy.
- **Motion.** Under `prefers-reduced-motion`:
  - spin, comets, pulses, the scan band and star parallax all stop;
  - each section holds one still pose, with no scroll-linked zoom;
  - frames render on scroll only.

  The loop stops off-screen, on hidden tabs and on context loss.
- **Failure.** No WebGL, a shader error, context loss or Save-Data shows the CSS stars and horizon (`.lx-stars`, `.lx-planet-fallback` in `../space.css`); copy and calls to action are unaffected.

## Assets

`public/brand/earth-daymap.webp`: NASA Earth Observatory Blue Marble Next Generation with Topography and Bathymetry, downsampled (public domain US Government work). The shader classifies land from the texture colour: blue-dominant pixels, including continental shelves, are ocean, and bright neutral pixels are ice. Any replacement texture must stay a power of two for `REPEAT` wrapping in WebGL1.
