# Visibility Field constellation bake

Authoring pipeline for the answer-engine visibility metaphor (brand hub + four engines).

## Locks

- **Runtime:** SVG + Canvas2D only (`components/marketing/VisibilityConstellation*`). No Three.js, no R3F, no GLB load on marketing.
- **Blender:** optional regen. Deploy and CI use **committed** files under `public/brand/constellation/`.
- **Layered plates:** `field-hero.webp` (far) + optional `field-hero-nodes.webp` (transparent near). Runtime omits near if missing.
- **Honesty:** idle / sample-fixture statuses only. Never invent SEO KPIs in baked plates.
- **Layout SSOT:** `components/marketing/constellationLayout.ts` (must match `NODE_POS` in the Python script).

## Commands

```bash
npm run constellation:bake          # requires local Blender 5.2+
npm run constellation:bake:check    # layout parity + budgets on committed assets
```

Override Blender binary:

```bash
# Windows PowerShell
$env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
npm run constellation:bake
```

## Outputs

| Path | Role |
|------|------|
| `public/brand/constellation/field-idle.webp` | Soft underlay for idle field |
| `public/brand/constellation/field-sample.webp` | Soft underlay matching sample fixture statuses |
| `public/brand/constellation/field-hero.webp` | Far cinematic stage backdrop |
| `public/brand/constellation/field-hero-nodes.webp` | Near transparent hub+nodes depth matte (optional until bake) |
| `public/brand/constellation/og-visibility-field.png` | 1200x630 still for future share/OG (VAL) |
| `public/brand/constellation/manifest.json` | Metadata + budgets |
| `design/constellation/visibility-field.glb` | Archive mesh for craft / future Instant Audit experiments |

Soft craft targets: hero+idle combined ≤48 KB; hard CI ≤72 KB combined. Hero-nodes hard ≤60 KB.
Optional WebP/PNG compression uses the repo `sharp` dependency during bake.
Deploy and CI never invoke Blender; use `npm run constellation:bake:check` (or the vitest committed-asset suite) to guard budgets.
