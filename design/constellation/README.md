# Constellation archive (authoring)

`visibility-field.glb` is a Blender-exported archive of the Visibility Field metaphor.

- **Do not** load this GLB in the marketing app (no Three.js / R3F on the critical path).
- Regen via `npm run constellation:bake` (requires local Blender 5.2+).
- Runtime plates live in `public/brand/constellation/`.
- Layout SSOT: `components/marketing/constellationLayout.ts`.
