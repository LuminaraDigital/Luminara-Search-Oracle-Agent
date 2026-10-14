# Landing Earth story

Illustrative 3D Earth for the landing page `#visibility-map` section ("From local business to global discovery").

## Files

| File | Role |
|---|---|
| `earthStory.ts` | **Edit here.** Chapter copy, scene descriptions, camera focus per chapter, layer targets, illustrative places, example evidence/action, palette. |
| `earthScene.ts` | Canvas2D orthographic renderer. Lazy chunk, imperative `createEarthScene()` API. |
| `landDots.generated.ts` | Generated land bitset. Do not edit. |
| `../EarthStorySection.tsx` | Section HTML: heading, chapter tabs, panel, CTA, notice, fallback. |
| `scripts/earth/bake-land-dots.mjs` | Regenerates the bitset and `public/brand/earth-fallback.webp` (`npm run earth:bake`). |

## Invariants

- **Illustrative only.** Places, arcs and evidence examples are not customers, offices, traffic, coverage or audit output. Keep real audit data (`demo/demoFixtures`, `liveSampleSnapshot`) out of this folder. The notice "Illustrative experience. Actual visibility requires a live audit." stays visible under the globe.
- **Evidence semantics** match methodology: Measured = live evidence, Estimated = directional, Not measured = missing data and never a poor result. No scores, percentages or outcome claims (enforced in `tests/earthStory.test.ts`).
- **Channels are not places.** Google Search, AI Overviews, ChatGPT and Perplexity appear in HTML only.
- **HTML owns meaning.** All copy and controls are semantic HTML; the canvas is `aria-hidden` inside a `role="img"` wrapper whose label is the chapter `scene` text.
- **One state.** `activeChapter` lives in `EarthStorySection`; the scene receives it via `setChapter()`. No per-frame React state.
- **No Three.js / WebGL** on marketing (`docs/plans/landing-moat-100x.md`). Canvas2D only, zero runtime dependencies.
- **Bake and runtime agree.** `fibPoint` and the view rotation are duplicated in the bake script and `earthScene.ts`; the land/ocean tests fail if they drift. Chapter 1 focus, business marker and palette are imported from `earthStory.ts` by the bake, so re-run `npm run earth:bake` after changing them (the fallback image depends on them).
- **Motion.** Idle sway, marker pulse, arc glints and scan sweep run only when not paused and not `prefers-reduced-motion`. The loop stops off-screen, on hidden tabs, on canvas context loss, and once transitions settle while paused.
- **Failure.** Renderer chunk failure or missing 2D context shows `public/brand/earth-fallback.webp`; narrative and CTA are unaffected.

## Assets

Geography: [Natural Earth](https://www.naturalearthdata.com/) `ne_110m_land` v5.1.2, public domain ([terms](https://www.naturalearthdata.com/about/terms-of-use/)). Only a derived 20,000-sample land bitset (about 3 KB) ships.
