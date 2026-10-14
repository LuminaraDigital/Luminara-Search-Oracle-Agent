# Landing Earth story

Illustrative 3D globe and 2D world map for the landing page `#visibility-map` section ("From local business to global discovery").

## Files

| File | Role |
|---|---|
| `earthStory.ts` | **Edit here.** Chapter copy, scene descriptions, camera focus per chapter, layer targets, illustrative hubs (`EARTH_HUBS`), spherical distance/coord helpers, example evidence/action, palette. |
| `earthScene.ts` | Canvas2D orthographic 3D globe + equirectangular 2D world map renderer: photorealistic satellite/bathymetric Earth texture (`public/brand/earth-daymap.webp`), 3D graticule & 2D latitude/meridian bands, vector coastlines, market country polygons, directional solar shading, lifted great-circle geodesic arcs, HUD labels, and click-to-focus hub hit-testing. |
| `landDots.generated.ts` | Generated land bitset + quantized coastline & market country rings. Do not edit. |
| `../EarthStorySection.tsx` | Section HTML: heading, chapter tabs, panel, observatory HUD header with `3D globe` / `2D map` toggle, market location pills, CTA, notice, fallback. |
| `scripts/earth/bake-land-dots.mjs` | Regenerates `landDots.generated.ts`, `public/brand/earth-daymap.webp`, and `public/brand/earth-fallback.webp` (`npm run earth:bake`) from Natural Earth 110m, `world-atlas` 2.0.2, and NASA Blue Marble daymap imagery. |

## Invariants

- **Illustrative only.** Places, arcs and evidence examples are not customers, offices, traffic, coverage or audit output. Keep real audit data (`demo/demoFixtures`, `liveSampleSnapshot`) out of this folder. The notice "Illustrative experience. Actual visibility requires a live audit." stays visible under the globe.
- **Evidence semantics** match methodology: Measured = live evidence, Estimated = directional, Not measured = missing data and never a poor result. No scores, percentages or outcome claims (enforced in `tests/earthStory.test.ts`).
- **Channels are not places.** Google Search, AI Overviews, ChatGPT and Perplexity appear in HTML only.
- **HTML owns meaning.** All copy and controls are semantic HTML; the canvas is `aria-hidden` inside a `role="img"` wrapper whose label is the chapter `scene` text.
- **Shared state.** `chapterId`, `viewMode` (`'3d' | '2d'`), and optional `selectedHub` live in `EarthStorySection`; the scene receives them via `setChapter()`, `setHub()`, `setViewMode()`, and `resetView()`. No per-frame React state.
- **No Three.js / WebGL** on marketing (`docs/plans/landing-moat-100x.md`). Canvas2D only, zero runtime dependencies.
- **Bake and runtime agree.** `fibPoint` and the view rotation are duplicated in the bake script and `earthScene.ts`; the land/ocean tests fail if they drift. Chapter 1 focus, business marker, hubs and palette are imported from `earthStory.ts` by the bake, so re-run `npm run earth:bake` after changing them (the fallback image and market rings depend on them). Singapore (`ISO 702`) is omitted from 1:110m country polygons and intentionally renders as marker-only.
- **Motion.** Idle sway, marker pulse, arc glints and scan sweep run only when not paused and not `prefers-reduced-motion`. The loop stops off-screen, on hidden tabs, on canvas context loss, and once transitions settle while paused.
- **Failure.** Renderer chunk failure or missing 2D context shows `public/brand/earth-fallback.webp`; narrative and CTA are unaffected.

## Assets

Geography & Imagery: [Natural Earth](https://www.naturalearthdata.com/) `ne_110m_land` v5.1.2 (public domain, [terms](https://www.naturalearthdata.com/about/terms-of-use/)), [`topojson/world-atlas`](https://github.com/topojson/world-atlas/tree/v2.0.2) 2.0.2 `countries-110m.json` (ISC license, derived from Natural Earth 1:110m public domain), and NASA Earth Observatory Blue Marble Next Generation with Topography and Bathymetry (public domain US Government work).
