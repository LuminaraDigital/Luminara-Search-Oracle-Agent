#!/usr/bin/env python3
"""
Bake Luminara Visibility Field plates + archive GLB with Blender (headless).

Product metaphor only: brand hub + Google/SERP, AI Overviews, ChatGPT, Perplexity.
Statuses match idle or SAMPLE_FIXTURE. Never invent SEO KPIs.

Layout mirrors components/marketing/constellationLayout.ts (0-100 viewBox).
Authoring only: runtime stays SVG + Canvas2D. Do not load the GLB in marketing.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bpy
import mathutils

VIEW = 100.0
SCALE = 2.2


def pct_to_world(x: float, y: float, z: float = 0.12) -> tuple[float, float, float]:
    wx = ((x - 50.0) / VIEW) * SCALE
    wy = ((50.0 - y) / VIEW) * SCALE
    return (wx, wy, z)


NODE_POS = {
    "web_serp": (50.0, 12.0),
    "google_aio": (88.0, 42.0),
    "chatgpt": (50.0, 88.0),
    "perplexity": (12.0, 42.0),
}

LABELS = {
    "web_serp": "Google",
    "google_aio": "AIO",
    "chatgpt": "ChatGPT",
    "perplexity": "Perplexity",
}

SAMPLE_STATUS = {
    "web_serp": "measured",
    "google_aio": "not_measured",
    "chatgpt": "not_measured",
    "perplexity": "estimated",
}

IDLE_STATUS = {k: "idle" for k in NODE_POS}

COL_PAPER = (0.015, 0.015, 0.012, 1.0)
COL_PAPER2 = (0.09, 0.085, 0.065, 1.0)
COL_ACCENT = (0.78, 0.58, 0.22, 1.0)
COL_ACCENT2 = (0.99, 0.95, 0.72, 1.0)
COL_DIM = (0.28, 0.28, 0.25, 1.0)
COL_METAL = (0.55, 0.48, 0.32, 1.0)


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Bake Visibility Field constellation")
    p.add_argument("--out", required=True)
  p.add_argument("--archive", default="")
  p.add_argument("--states", default="idle,sample,hero,og")
  p.add_argument(
      "--with-archive",
      action="store_true",
      help="Regenerate design/constellation/visibility-field.glb (off by default)",
  )
    p.add_argument("--width", type=int, default=1280)
    p.add_argument("--height", type=int, default=960)
    p.add_argument("--hero-width", type=int, default=1600)
    p.add_argument("--hero-height", type=int, default=1200)
    p.add_argument("--og-width", type=int, default=1200)
    p.add_argument("--og-height", type=int, default=630)
    return p.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.lights):
        bpy.data.lights.remove(block)
    for block in list(bpy.data.cameras):
        bpy.data.cameras.remove(block)
    for block in list(bpy.data.worlds):
        bpy.data.worlds.remove(block)


def make_emission(name: str, color: tuple, strength: float) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    em.inputs["Strength"].default_value = strength
    links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def make_principled(
    name: str,
    color: tuple,
    metallic: float = 0.2,
    rough: float = 0.45,
    emission: tuple | None = None,
    emission_strength: float = 0.0,
    clearcoat: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if clearcoat > 0:
        if "Coat Weight" in bsdf.inputs:
            bsdf.inputs["Coat Weight"].default_value = clearcoat
        elif "Clearcoat" in bsdf.inputs:
            bsdf.inputs["Clearcoat"].default_value = clearcoat
    if emission is not None:
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = emission
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def add_uv_sphere(name: str, loc: tuple, radius: float, mat: bpy.types.Material, segments: int = 64) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, segments=segments, ring_count=segments // 2)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    return obj


def add_torus_ring(
    name: str,
    loc: tuple,
    major: float,
    minor: float,
    mat: bpy.types.Material,
    major_segments: int = 48,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=major_segments,
        minor_segments=12,
        location=loc,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = (math.radians(90), 0.0, 0.0)
    bpy.ops.object.shade_smooth()
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    return obj


def add_cylinder_edge(name: str, a: tuple, b: tuple, radius: float, mat: bpy.types.Material) -> bpy.types.Object:
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    length = math.sqrt(dx * dx + dy * dy + dz * dz) or 0.001
    mid = ((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=length, location=mid, vertices=24)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    quat = mathutils.Vector((0, 0, 1)).rotation_difference(mathutils.Vector((dx, dy, dz)))
    obj.rotation_quaternion = quat
    bpy.ops.object.shade_smooth()
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    return obj


def status_material(status: str, mats: dict) -> bpy.types.Material:
    return mats.get(status, mats["idle"])


def build_scene(
    statuses: dict[str, str],
    *,
    cinematic: bool = False,
    nodes_only: bool = False,
    detail: str = "high",
) -> None:
    clear_scene()
    hub_segs = 96 if detail == "high" else 32
    node_segs = 64 if detail == "high" else 32
    torus_major = 48 if detail == "high" else 24
    mats = {
        "hub": make_principled(
            "HubMat",
            COL_METAL,
            metallic=0.85,
            rough=0.28,
            emission=COL_ACCENT,
            emission_strength=0.15,
            clearcoat=0.28,
        ),
        "measured": make_principled(
            "MeasuredMat",
            COL_ACCENT,
            metallic=0.55,
            rough=0.22,
            emission=COL_ACCENT2,
            emission_strength=2.2,
        ),
        "estimated": make_principled(
            "EstimatedMat",
            COL_ACCENT,
            metallic=0.4,
            rough=0.35,
            emission=COL_ACCENT,
            emission_strength=1.0,
        ),
        "pending": make_emission("PendingMat", COL_ACCENT2, 2.2),
        "not_measured": make_principled("NotMeasuredMat", COL_DIM, metallic=0.15, rough=0.75),
        "idle": make_principled("IdleMat", COL_DIM, metallic=0.12, rough=0.72),
        "edge_lit": make_emission("EdgeLit", COL_ACCENT, 1.4),
        "edge_dim": make_principled("EdgeDim", (0.18, 0.18, 0.15, 1.0), rough=0.85),
        "ring": make_emission("RingMat", COL_ACCENT2, 1.6),
        "ground": make_principled("Ground", COL_PAPER, metallic=0.05, rough=0.92),
        "plinth": make_principled("Plinth", COL_PAPER2, metallic=0.4, rough=0.4),
    }

    if not nodes_only:
        bpy.ops.mesh.primitive_cylinder_add(radius=SCALE * 0.72, depth=0.06, location=(0, 0, -0.06), vertices=64 if detail == "high" else 32)
        plinth = bpy.context.active_object
        plinth.name = "Plinth"
        bpy.ops.object.shade_smooth()
        plinth.data.materials.append(mats["plinth"])

        bpy.ops.mesh.primitive_plane_add(size=SCALE * 2.4, location=(0, 0, -0.12))
        ground = bpy.context.active_object
        ground.name = "Ground"
        ground.data.materials.append(mats["ground"])

    hub_loc = pct_to_world(50, 50, 0.22)
    add_uv_sphere("Hub", hub_loc, 0.2, mats["hub"], segments=hub_segs)
    add_torus_ring("HubRing", (hub_loc[0], hub_loc[1], hub_loc[2] - 0.02), 0.28, 0.012, mats["ring"], major_segments=torus_major)

    for eid, (px, py) in NODE_POS.items():
        loc = pct_to_world(px, py, 0.18)
        st = statuses.get(eid, "idle")
        lit = st in ("measured", "estimated", "pending")
        edge_mat = mats["edge_lit"] if lit else mats["edge_dim"]
        add_cylinder_edge(f"Edge_{eid}", hub_loc, loc, 0.014 if lit else 0.009, edge_mat)
        add_uv_sphere(f"Node_{eid}", loc, 0.13 if lit else 0.11, status_material(st, mats), segments=node_segs)
        if lit:
            add_torus_ring(f"Ring_{eid}", loc, 0.18, 0.01, mats["ring"], major_segments=torus_major)

    if cinematic:
        bpy.ops.object.camera_add(location=(1.55, -2.55, 1.95))
        cam = bpy.context.active_object
        cam.rotation_euler = (math.radians(58), math.radians(8), math.radians(28))
        cam.data.lens = 45
    else:
        bpy.ops.object.camera_add(location=(0.15, -2.95, 2.35))
        cam = bpy.context.active_object
        cam.rotation_euler = (math.radians(50), 0.0, math.radians(4))
        cam.data.lens = 50
    cam.name = "BakeCamera"
    bpy.context.scene.camera = cam

    bpy.ops.object.light_add(type="AREA", location=(1.6, -1.2, 2.8))
    key = bpy.context.active_object
    key.data.energy = 220 if cinematic else 160
    key.data.size = 2.4
    key.data.color = (1.0, 0.9, 0.72)

    bpy.ops.object.light_add(type="AREA", location=(-1.8, 0.4, 1.8))
    fill = bpy.context.active_object
    fill.data.energy = 55
    fill.data.size = 3.0
    fill.data.color = (0.45, 0.55, 0.75)

    bpy.ops.object.light_add(type="AREA", location=(0.2, 2.0, 1.4))
    rim = bpy.context.active_object
    rim.data.energy = 90 if cinematic else 60
    rim.data.size = 1.8
    rim.data.color = (1.0, 0.85, 0.55)

    world = bpy.data.worlds.new("BakeWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # Soft studio backdrop (no external HDRI dependency in CI bake machines)
    bg.inputs["Color"].default_value = (0.04, 0.04, 0.035, 1.0) if nodes_only else COL_PAPER
    bg.inputs["Strength"].default_value = 0.12 if nodes_only else 0.35


def configure_render(width: int, height: int, filepath: str, *, transparent: bool = False) -> None:
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = transparent
    scene.render.filepath = filepath
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        if hasattr(eevee, "use_bloom"):
            eevee.use_bloom = True
            if hasattr(eevee, "bloom_intensity"):
                eevee.bloom_intensity = 0.05
        if hasattr(eevee, "use_gtao"):
            eevee.use_gtao = True
        if hasattr(eevee, "use_ssr") and not transparent:
            eevee.use_ssr = True


def render_still(path: str, width: int, height: int, *, transparent: bool = False) -> None:
    configure_render(width, height, path, transparent=transparent)
    bpy.ops.render.render(write_still=True)


def export_glb(path: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )


def write_manifest(out_dir: str, files: dict, archive_glb: str | None) -> None:
    manifest = {
        "name": "luminara-visibility-field",
        "version": 2,
        "metaphor": "answer-engine-visibility-constellation",
        "product": "Instant Audit Visibility Probe: hub + Google/SERP, AI Overviews, ChatGPT, Perplexity",
        "layout_source": "components/marketing/constellationLayout.ts",
        "runtime": "SVG + Canvas2D only; GLB is archive/authoring",
        "honesty": "Statuses are idle or sample-fixture labels only; never invent SEO KPIs",
        "nodes": {
            eid: {"pct": {"x": NODE_POS[eid][0], "y": NODE_POS[eid][1]}, "label": LABELS[eid]}
            for eid in NODE_POS
        },
        "files": files,
        "archive_glb": archive_glb,
        "budgets": {
            "plate_webp_max_bytes": 100_000,
            "hero_webp_max_bytes": 140_000,
            "hero_nodes_webp_max_bytes": 60_000,
            "og_png_max_bytes": 220_000,
            "glb_archive_max_bytes": 700_000,
            "soft_hero_idle_combined_bytes": 48_000,
            "hard_hero_idle_combined_bytes": 72_000,
        },
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")


def main() -> int:
    args = parse_args(sys.argv)
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    archive_dir = os.path.abspath(args.archive) if args.archive else ""
    if archive_dir:
        os.makedirs(archive_dir, exist_ok=True)

    states = [s.strip() for s in args.states.split(",") if s.strip()]
    files: dict[str, str] = {}
    archive_glb = None

    for state in states:
        if state == "idle":
            build_scene(IDLE_STATUS, cinematic=False)
            png = os.path.join(out_dir, "field-idle.png")
            render_still(png, args.width, args.height)
            files["idle_png"] = "field-idle.png"
        elif state == "sample":
            build_scene(SAMPLE_STATUS, cinematic=False)
            png = os.path.join(out_dir, "field-sample.png")
            render_still(png, args.width, args.height)
            files["sample_png"] = "field-sample.png"
        elif state == "hero":
            build_scene(SAMPLE_STATUS, cinematic=True)
            png = os.path.join(out_dir, "field-hero.png")
            render_still(png, args.hero_width, args.hero_height)
            files["hero_png"] = "field-hero.png"
        elif state == "hero_nodes":
            build_scene(SAMPLE_STATUS, cinematic=True, nodes_only=True)
            png = os.path.join(out_dir, "field-hero-nodes.png")
            render_still(png, args.hero_width, args.hero_height, transparent=True)
            files["hero_nodes_png"] = "field-hero-nodes.png"
        elif state == "og":
            build_scene(SAMPLE_STATUS, cinematic=True)
            png = os.path.join(out_dir, "og-visibility-field.png")
            render_still(png, args.og_width, args.og_height)
            files["og"] = "og-visibility-field.png"
        else:
            print(f"Unknown state: {state}", file=sys.stderr)
            return 2

    if archive_dir and args.with_archive:
        build_scene(SAMPLE_STATUS, cinematic=False, detail="archive")
        glb_path = os.path.join(archive_dir, "visibility-field.glb")
        export_glb(glb_path)
        archive_glb = "design/constellation/visibility-field.glb"
    elif archive_dir and os.path.isfile(os.path.join(archive_dir, "visibility-field.glb")):
        archive_glb = "design/constellation/visibility-field.glb"

    write_manifest(out_dir, files, archive_glb)
    print(json.dumps({"ok": True, "out": out_dir, "files": files, "archive_glb": archive_glb}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
