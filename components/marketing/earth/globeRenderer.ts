/* Gold Earth renderer for the landing page.
 * One WebGL fragment shader draws the starfield, an orthographic Earth with gold
 * dot-matrix continents on the night side, the satellite day side, and a gold
 * atmosphere with a sunrise flare. A Canvas2D overlay draws the illustrative arcs,
 * markers and labels with the same projection. No dependencies; lazy-loaded by
 * SpaceStage.tsx. Throws when WebGL is unavailable so the caller can fall back.
 */
import {
  angleDelta,
  applyMatrix,
  clamp,
  dotLevel,
  fromLatLon,
  liftedArc,
  viewMatrix,
  type GlobePose,
  type Vec3,
} from './globeMath';
import {
  AUDIENCE_PLACES,
  EXAMPLE_BUSINESS,
  FIX_PLACE_ID,
  GLOBE_RGB,
  NETWORK_LINKS,
  NETWORK_PLACES,
  type EvidenceState,
} from './globeStory';

export interface GlobeLayers {
  /** Ambient city network (hero, statement). */
  network: number;
  /** Audience-to-business arcs. */
  story: number;
  /** Example business marker and label. */
  marker: number;
  /** Evidence-state markers on audience places. */
  proof: number;
  /** One highlighted arc, the rest dimmed. */
  fix: number;
  /** Scan band sweeping the disc. */
  scan: number;
}

export interface GlobeTarget {
  pose: GlobePose;
  /** Latitude facing the viewer; lon null means slow free spin. */
  lat: number;
  lon: number | null;
  layers: GlobeLayers;
  /** Star parallax offset in CSS px. */
  starShift: number;
}

export interface GlobeRendererOptions {
  reducedMotion: boolean;
  lowPower: boolean;
  businessLabel: string;
  getTarget: (width: number, height: number) => GlobeTarget;
  onReady?: () => void;
  /** The renderer can no longer draw (link failure, lost context): show the static fallback. */
  onFail?: () => void;
}

export interface GlobeRenderer {
  setVisible(visible: boolean): void;
  /** Request a frame (reduced motion renders on demand only). */
  invalidate(): void;
  destroy(): void;
}

const DAYMAP_URL = '/brand/earth-daymap.webp';
const SPIN_DEG_PER_S = 2.4;
const DOT_SPACING_CSS = 8.5;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec3 uGlobe;
uniform mat3 uRot;
uniform vec3 uSun;
uniform vec4 uHalo;
uniform vec4 uFlare;
uniform vec4 uDots;
uniform vec4 uMisc;
uniform vec2 uPx;
uniform sampler2D uDay;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float starLayer(vec2 p, float cell, float density, float seed, float t) {
  vec2 g = floor(p / cell);
  vec2 f = fract(p / cell);
  float h = hash12(g + seed);
  if (h > density) return 0.0;
  vec2 o = vec2(hash12(g + seed + 11.7), hash12(g + seed + 23.1)) * 0.8 + 0.1;
  vec2 d = (f - o) * cell;
  float h2 = hash12(g + seed + 41.3);
  float size = mix(0.5, 1.45, h2 * h2 * h2) * uPx.x;
  float b = exp(-dot(d, d) / (size * size));
  float tw = 0.72 + 0.28 * sin(t * (0.5 + h2 * 1.7) + h * 60.0);
  return b * tw * mix(0.3, 1.0, h2);
}

// Blue Marble oceans (shelves included) are blue-dominant; ice is bright and neutral.
float landOf(vec3 c) { return 1.0 - step(c.r + 0.118, c.b) * step(c.g - 0.031, c.b); }
float iceOf(vec3 c) { return step(0.667, min(min(c.r, c.g), c.b)); }

vec3 dotField(float latD, float lonD, float pitch, float aaDeg) {
  float row = floor((latD + 90.0) / pitch);
  float latC = (row + 0.5) * pitch - 90.0;
  float n = max(1.0, floor(360.0 * cos(radians(latC)) / pitch));
  float stepL = 360.0 / n;
  float col = floor((lonD + 180.0) / stepL);
  float lonC = (col + 0.5) * stepL - 180.0;
  float dlat = latD - latC;
  float dlon = (lonD - lonC) * cos(radians(latD));
  float d = sqrt(dlat * dlat + dlon * dlon);
  vec3 m = texture2D(uDay, vec2(lonC / 360.0 + 0.5, 0.5 - latC / 180.0)).rgb;
  float land = landOf(m);
  float rad = pitch * 0.27;
  float a = 1.0 - smoothstep(rad - aaDeg, rad + aaDeg, d);
  float h = hash12(vec2(row, col) + pitch * 13.0);
  return vec3(a * land, h, iceOf(m) * land);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float R = uGlobe.z;
  vec2 q = (p - uGlobe.xy) / R;
  q.y = -q.y;
  float r2 = dot(q, q);
  float r = sqrt(r2);
  float t = uMisc.x;

  vec3 gold = vec3(0.86, 0.62, 0.26);
  vec3 hot = vec3(1.0, 0.9, 0.68);

  vec2 sp = p + vec2(0.0, uMisc.w);
  float s = starLayer(sp, 41.0 * uPx.x, 0.16, 1.0, t)
          + starLayer(sp, 97.0 * uPx.x, 0.34, 7.0, t) * 1.25
          + starLayer(sp, 223.0 * uPx.x, 0.55, 19.0, t) * 1.6;
  vec3 starCol = mix(vec3(0.8, 0.86, 1.0), vec3(1.0, 0.86, 0.64), hash12(floor(sp / (97.0 * uPx.x))));
  vec3 col = starCol * s * uPx.y;
  col += vec3(0.012, 0.009, 0.004) * (1.0 - p.y / uRes.y);

  vec3 sun = normalize(uSun);
  vec2 sunDir2 = normalize(sun.xy + vec2(0.0001, 0.0001));
  float behind = clamp(-sun.z, 0.0, 1.0);
  float edge = 1.5 / R;
  float inside = 1.0 - smoothstep(1.0 - edge, 1.0 + edge * 0.5, r);

  float h = max(r - 1.0, 0.0);
  vec2 dir = q / max(r, 0.0001);
  float facing = dot(dir, sunDir2);
  float lobe = pow(max(facing, 0.0), mix(2.0, 9.0, behind));
  float tight = exp(-h / uHalo.x);
  float wide = exp(-h / uHalo.y);
  vec3 halo = gold * (tight * (0.2 + 1.55 * lobe * (0.35 + behind)) + wide * (0.05 + 0.36 * lobe))
            + hot * tight * lobe * behind * 0.85;
  halo *= uHalo.z * uHalo.w;
  col = col * (1.0 - min(1.0, wide * 0.9 * uHalo.z)) + halo * (1.0 - inside);

  if (r < 1.0 + edge) {
    float nz = sqrt(max(1.0 - r2, 0.0));
    vec3 n = vec3(q, nz);
    vec3 w = uRot * n;
    float lat = asin(clamp(w.y, -1.0, 1.0));
    float lon = atan(w.x, w.z);
    float latD = degrees(lat);
    float lonD = degrees(lon);
    vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.1415927);
    vec3 dayTex = texture2D(uDay, uv).rgb;
    float landHere = landOf(dayTex);
    float lam = dot(n, sun);
    float day = smoothstep(-0.06, 0.38, lam);

    vec3 ocean = vec3(0.004, 0.006, 0.012);
    vec3 landNight = vec3(0.028, 0.022, 0.013);
    vec3 base = mix(ocean, landNight, landHere);
    vec3 dayCol = pow(dayTex, vec3(1.3)) * vec3(1.02, 0.95, 0.8) * 0.8;
    vec3 dayFallback = mix(vec3(0.03, 0.04, 0.06), vec3(0.3, 0.24, 0.14), landHere);
    dayCol = mix(dayFallback, dayCol, uMisc.y);
    vec3 surf = mix(base, dayCol, day);

    float aaDeg = 57.29578 / (R * max(nz, 0.3)) * 0.9;
    vec3 dA = dotField(latD, lonD, uDots.x, aaDeg);
    vec3 dB = dotField(latD, lonD, uDots.x * 0.5, aaDeg);
    float dots = mix(dA.x * (0.5 + 0.5 * dA.y), dB.x * (0.5 + 0.5 * dB.y), uDots.y);
    float sparkle = mix(step(0.93, dA.y) * dA.x, step(0.93, dB.y) * dB.x, uDots.y);
    float ice = mix(dA.z, dB.z, uDots.y);
    float nightW = 1.0 - day * 0.9;
    float limbFade = smoothstep(0.02, 0.3, nz);
    vec3 dotCol = mix(vec3(0.8, 0.6, 0.25), vec3(1.0, 0.88, 0.58), sparkle);
    surf += dotCol * dots * nightW * limbFade * mix(1.0, 0.4, ice) * uDots.z;

    float tk = lam / 0.1;
    float term = exp(-tk * tk);
    surf += vec3(0.55, 0.28, 0.07) * term * 0.1;

    vec3 hv = normalize(sun + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, hv), 0.0), 28.0) * (1.0 - landHere) * day;
    surf += vec3(0.95, 0.78, 0.48) * spec * 0.14;

    float bk = (q.x - uDots.w) / 0.022;
    float band = exp(-bk * bk) * uMisc.z;
    surf += gold * band * 0.16 * limbFade + dotCol * dots * band * 1.6;

    float fo = max(1.0 - nz, 0.0);
    float fres = fo * fo * fo;
    float rimFacing = smoothstep(-0.3, 0.8, dot(normalize(q + vec2(0.00001)), sunDir2));
    vec3 rimCol = mix(vec3(0.4, 0.26, 0.09), vec3(1.0, 0.82, 0.5), rimFacing * (0.4 + 0.6 * max(day, behind)));
    surf += rimCol * fres * 0.7 * uHalo.z;

    surf *= uHalo.w;
    col = mix(col, surf, inside);
  }

  if (uFlare.z > 0.001) {
    float m = min(uRes.x, uRes.y);
    vec2 fd = (p - uFlare.xy) / m;
    float core = exp(-dot(fd, fd) / 0.00012);
    float glow = exp(-length(fd) / 0.07);
    float streak = exp(-abs(fd.y) / 0.0035) * exp(-abs(fd.x) / 0.45);
    float occl = 1.0 - inside * 0.9;
    col += (hot * core * 1.4 + gold * glow * 0.32 + mix(gold, hot, 0.5) * streak * 0.5) * uFlare.z * occl;
  }

  vec2 vv = p / uRes - 0.5;
  col *= 1.0 - 0.3 * smoothstep(0.38, 0.95, length(vv * vec2(1.0, 1.15)));
  col += (hash12(p + fract(t) * 97.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Projected {
  x: number;
  y: number;
  front: boolean;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

function makeTexture(gl: WebGLRenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 120, 255]));
  return tex;
}

/** Decode the daymap off the main thread where possible; fall back to an <img>. */
async function loadDaymap(): Promise<TexImageSource | null> {
  try {
    if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
      const res = await fetch(DAYMAP_URL);
      if (!res.ok) return null;
      return await createImageBitmap(await res.blob());
    }
  } catch {
    /* fall back to an <img> below */
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = DAYMAP_URL;
  });
}

export function createGlobeRenderer(
  canvas: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  opts: GlobeRendererOptions,
): GlobeRenderer {
  const attrs: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    // Software rasterisers would run this full-viewport shader on the CPU, so refuse them.
    failIfMajorPerformanceCaveat: true,
    powerPreference: opts.lowPower ? 'low-power' : 'default',
  };
  const glMaybe = (canvas.getContext('webgl', attrs) ??
    canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
  if (!glMaybe) throw new Error('WebGL unavailable');
  const ctxMaybe = overlay.getContext('2d');
  if (!ctxMaybe) throw new Error('Canvas 2D unavailable');
  const gl: WebGLRenderingContext = glMaybe;
  const ctx: CanvasRenderingContext2D = ctxMaybe;
  /** Release the context before giving up, so failed attempts do not pile up live contexts. */
  const bail = (message: string): never => {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw new Error(message);
  };

  // fp16 breaks the limb anti-aliasing and the hashes, so fall back to CSS instead.
  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  if (!highp || highp.precision <= 0) bail('highp float unavailable');

  const program: WebGLProgram = gl.createProgram() ?? bail('createProgram failed');
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // With KHR_parallel_shader_compile the driver links in the background; poll once per
  // frame instead of blocking the main thread on LINK_STATUS.
  const parallel = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;

  const buf = gl.createBuffer();
  const u = (name: string) => gl.getUniformLocation(program, name);
  type UniformName = 'res' | 'globe' | 'rot' | 'sun' | 'halo' | 'flare' | 'dots' | 'misc' | 'px';
  let U: Record<UniformName, WebGLUniformLocation | null> | null = null;

  /** True once the program is linked and bound; false while still linking or after failure. */
  function finishLink(): boolean {
    if (U) return true;
    if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(
        '[globe] shader link failed',
        gl.getProgramInfoLog(program) || gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs),
      );
      fail();
      return false;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(u('uDay'), 0);
    U = {
      res: u('uRes'),
      globe: u('uGlobe'),
      rot: u('uRot'),
      sun: u('uSun'),
      halo: u('uHalo'),
      flare: u('uFlare'),
      dots: u('uDots'),
      misc: u('uMisc'),
      px: u('uPx'),
    };
    return true;
  }

  const dayTex = makeTexture(gl);
  let dayMix = 0;
  let textureDone = false;

  const maxDpr = opts.lowPower ? 1 : 1.75;
  // About 4.5 megapixels keeps the shader near 3 ms on integrated GPUs.
  const PIXEL_BUDGET = 4.5e6;
  const minFrameMs = opts.lowPower ? 33 : 15;
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;

  let destroyed = false;
  let lost = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let clock = 12;
  let ready = false;

  // Damped view state.
  const state = {
    pose: null as GlobePose | null,
    lat: 10,
    lon: 20,
    layers: { network: 0, story: 0, marker: 0, proof: 0, fix: 0, scan: 0 } as GlobeLayers,
  };

  const business = fromLatLon(EXAMPLE_BUSINESS.lat, EXAMPLE_BUSINESS.lon);
  const networkById = new Map(NETWORK_PLACES.map((p) => [p.id, fromLatLon(p.lat, p.lon)]));
  const networkArcs = NETWORK_LINKS.flatMap(([a, b], i) => {
    const va = networkById.get(a);
    const vb = networkById.get(b);
    if (!va || !vb) return [];
    return [{ pts: liftedArc(va, vb, 0.05, 44), phase: (i * 0.37) % 1, speed: 0.09 + (i % 5) * 0.018 }];
  });
  const networkDots = [...networkById.values()];
  const audience = AUDIENCE_PLACES.map((p, i) => {
    const v = fromLatLon(p.lat, p.lon);
    return {
      id: p.id,
      state: p.state,
      v,
      arc: liftedArc(v, business, 0.14, 56),
      phase: (i * 0.29) % 1,
      speed: 0.12 + (i % 4) * 0.02,
    };
  });

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, maxDpr, Math.sqrt(PIXEL_BUDGET / (cssW * cssH))));
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
    }
  }

  // Resizing clears the canvas, so repaint in the same task to avoid a black frame.
  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          resize();
          if (ready && !lost && !destroyed) render(0);
        })
      : null;
  ro?.observe(canvas);
  resize();

  void loadDaymap().then((source) => {
    if (destroyed || lost) {
      if (source && 'close' in source) source.close();
      return;
    }
    if (source) {
      try {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dayTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
        dayMix = 1;
      } catch (err) {
        console.warn('[globe] texture upload failed', err);
      }
      if ('close' in source) source.close();
    }
    textureDone = true;
    markReady();
  });

  // Poll the background link once per frame until it settles.
  const pollLink = () => {
    if (destroyed || lost) return;
    if (finishLink()) markReady();
    else if (!lost) requestAnimationFrame(pollLink);
  };
  requestAnimationFrame(pollLink);

  function markReady(): void {
    if (ready || destroyed || lost || !textureDone || !U) return;
    ready = true;
    invalidate();
    opts.onReady?.();
  }

  function fail(): void {
    if (lost) return;
    lost = true;
    stop();
    opts.onFail?.();
  }

  const onLost = (e: Event) => {
    e.preventDefault();
    fail();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  const onVisibility = () => {
    if (document.visibilityState === 'visible') schedule();
    else stop();
  };
  document.addEventListener('visibilitychange', onVisibility);

  function project(m: Float32Array, pts: ArrayLike<number>, o: number, pose: GlobePose): Projected {
    const v = applyMatrix(m, pts, o);
    const rr = v[0] * v[0] + v[1] * v[1];
    return { x: pose.cx + pose.r * v[0], y: pose.cy - pose.r * v[1], front: v[2] > 0 || rr > 1 };
  }

  function strokeArc(m: Float32Array, pts: Float32Array, pose: GlobePose, rgb: string, alpha: number, width: number): void {
    if (alpha < 0.01) return;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < pts.length; i += 3) {
      const p = project(m, pts, i, pose);
      if (!p.front) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function drawComet(m: Float32Array, pts: Float32Array, pose: GlobePose, head: number, alpha: number): void {
    if (alpha < 0.01) return;
    const n = pts.length / 3;
    const hi = Math.floor(head * (n - 1));
    const tail = 9;
    for (let k = 0; k < tail; k += 1) {
      const i1 = hi - k;
      const i0 = i1 - 1;
      if (i0 < 0) break;
      const a = project(m, pts, i0 * 3, pose);
      const b = project(m, pts, i1 * 3, pose);
      if (!a.front || !b.front) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(${GLOBE_RGB.goldLight},${alpha * (1 - k / tail)})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    const h = project(m, pts, hi * 3, pose);
    if (h.front) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${GLOBE_RGB.goldLight},${alpha})`;
      ctx.fill();
    }
  }

  function dot(x: number, y: number, radius: number, rgb: string, alpha: number): void {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.fill();
  }

  function evidenceMarker(x: number, y: number, s: EvidenceState, alpha: number): void {
    const r = 5;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(${GLOBE_RGB.goldWarm},${alpha})`;
    if (s === 'Measured') {
      dot(x, y, r, GLOBE_RGB.goldWarm, alpha);
    } else if (s === 'Estimated') {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.closePath();
      ctx.fillStyle = `rgba(${GLOBE_RGB.goldWarm},${alpha})`;
      ctx.fill();
    } else {
      ctx.setLineDash([2, 2.4]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawOverlay(m: Float32Array, pose: GlobePose, L: GlobeLayers, t: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dim = pose.dim;
    const animate = !opts.reducedMotion;

    if (L.network > 0.01) {
      for (const a of networkArcs) {
        strokeArc(m, a.pts, pose, GLOBE_RGB.gold, 0.3 * L.network * dim, 1);
        if (animate) drawComet(m, a.pts, pose, (t * a.speed + a.phase) % 1, 0.85 * L.network * dim);
      }
      for (const v of networkDots) {
        const p = project(m, v, 0, pose);
        if (p.front) dot(p.x, p.y, 1.6, GLOBE_RGB.goldLight, 0.7 * L.network * dim);
      }
    }

    if (L.story > 0.01 || L.proof > 0.01) {
      for (const a of audience) {
        const isFix = a.id === FIX_PLACE_ID;
        const base = 0.42 * L.story * (isFix ? 1 : 1 - 0.85 * L.fix);
        strokeArc(m, a.arc, pose, GLOBE_RGB.gold, base, 1);
        if (isFix && L.fix > 0.01) {
          strokeArc(m, a.arc, pose, GLOBE_RGB.gold, 0.25 * L.fix, 6);
          strokeArc(m, a.arc, pose, GLOBE_RGB.goldLight, 0.95 * L.fix, 2);
        }
        if (animate && L.story > 0.05) {
          const cometAlpha = 0.9 * L.story * (isFix ? 1 : 1 - 0.8 * L.fix);
          drawComet(m, a.arc, pose, (t * a.speed + a.phase) % 1, cometAlpha);
        }
        const p = project(m, a.v, 0, pose);
        if (!p.front) continue;
        if (L.proof > 0.01) evidenceMarker(p.x, p.y, a.state, L.proof);
        const dotAlpha = Math.max(L.story, 0.4) * (1 - L.proof) * (isFix ? 1 : 1 - 0.6 * L.fix);
        if (dotAlpha > 0.01) dot(p.x, p.y, 2.2, GLOBE_RGB.goldLight, dotAlpha);
      }
    }

    if (L.marker > 0.01) {
      const p = project(m, business, 0, pose);
      if (p.front) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
        g.addColorStop(0, `rgba(${GLOBE_RGB.goldLight},${0.55 * L.marker})`);
        g.addColorStop(1, `rgba(${GLOBE_RGB.gold},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
        ctx.fill();
        dot(p.x, p.y, 4.2, GLOBE_RGB.goldLight, L.marker);
        const rings = animate ? [(t * 0.45) % 1, (t * 0.45 + 0.5) % 1] : [0.45];
        ctx.lineWidth = 1.2;
        for (const ph of rings) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 7 + ph * 30, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${GLOBE_RGB.goldLight},${(1 - ph) * 0.55 * L.marker})`;
          ctx.stroke();
        }
        if (L.fix > 0.01) {
          const start = animate ? t * 2.2 : 0;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 17, start, start + Math.PI * 0.6);
          ctx.strokeStyle = `rgba(${GLOBE_RGB.goldLight},${0.9 * L.fix})`;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        ctx.font = '500 12px Outfit, ui-sans-serif, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(${GLOBE_RGB.goldLight},${0.95 * L.marker})`;
        ctx.fillText(opts.businessLabel, p.x + 14, p.y - 14);
      }
    }
  }

  function render(dt: number): void {
    if (!U) return;
    const target = opts.getTarget(cssW, cssH);
    const snap = opts.reducedMotion || !state.pose;
    const kFast = snap ? 1 : 1 - Math.exp(-dt / 0.07);
    const kSlow = snap ? 1 : 1 - Math.exp(-dt / 0.6);
    const tp = target.pose;
    if (!state.pose) {
      state.pose = { ...tp, sun: [...tp.sun] as Vec3 };
    } else {
      const sp = state.pose;
      sp.cx += (tp.cx - sp.cx) * kFast;
      sp.cy += (tp.cy - sp.cy) * kFast;
      sp.r += (tp.r - sp.r) * kFast;
      sp.flare += (tp.flare - sp.flare) * kFast;
      sp.dim += (tp.dim - sp.dim) * kFast;
      sp.dots += (tp.dots - sp.dots) * kFast;
      for (let i = 0; i < 3; i += 1) sp.sun[i] += (tp.sun[i] - sp.sun[i]) * kFast;
    }
    state.lat += (target.lat - state.lat) * kSlow;
    if (target.lon === null) {
      if (!opts.reducedMotion) state.lon = (state.lon + SPIN_DEG_PER_S * dt) % 360;
    } else {
      state.lon += angleDelta(state.lon, target.lon) * kSlow;
    }
    const L = state.layers;
    (Object.keys(L) as Array<keyof GlobeLayers>).forEach((key) => {
      L[key] += (target.layers[key] - L[key]) * kSlow;
    });

    const pose = state.pose;
    const m = viewMatrix(state.lat, state.lon);
    const rDev = pose.r * dpr;
    const level = dotLevel(rDev, DOT_SPACING_CSS * dpr);
    const tightPx = clamp(pose.r * 0.012, 4, 26) * dpr;
    const widePx = clamp(pose.r * 0.075, 26, 150) * dpr;
    const sunLen = Math.hypot(pose.sun[0], pose.sun[1]) || 1;
    const fx = pose.cx + pose.r * 1.004 * (pose.sun[0] / sunLen);
    const fy = pose.cy - pose.r * 1.004 * (pose.sun[1] / sunLen);
    const scanX = -1.15 + ((clock * 0.28) % 1) * 2.3;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform3f(U.globe, pose.cx * dpr, pose.cy * dpr, rDev);
    gl.uniformMatrix3fv(U.rot, false, m);
    gl.uniform3f(U.sun, pose.sun[0], pose.sun[1], pose.sun[2]);
    gl.uniform4f(U.halo, tightPx / rDev, widePx / rDev, 1, pose.dim);
    gl.uniform4f(U.flare, fx * dpr, fy * dpr, pose.flare * (pose.sun[2] < 0 ? 1 : 0), 0);
    gl.uniform4f(U.dots, level.pitch, level.mix, pose.dots, scanX);
    gl.uniform4f(U.misc, clock, dayMix, L.scan, target.starShift * dpr);
    gl.uniform2f(U.px, dpr, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dayTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    drawOverlay(m, pose, L, clock);
  }

  function frame(now: number): void {
    raf = 0;
    if (destroyed || !visible) return;
    // Cap near 60 fps (30 on low-power devices); 120 Hz panels would otherwise double the work.
    if (!opts.reducedMotion && last && now - last < minFrameMs) {
      schedule();
      return;
    }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (!opts.reducedMotion) clock += dt;
    if (ready) render(dt);
    if (!opts.reducedMotion) schedule();
  }

  function schedule(): void {
    if (!raf && visible && !destroyed && !lost && document.visibilityState === 'visible') {
      raf = requestAnimationFrame(frame);
    }
  }

  function stop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  }

  function invalidate(): void {
    schedule();
  }

  return {
    setVisible(v: boolean) {
      visible = v;
      if (v) schedule();
      else stop();
    },
    invalidate,
    destroy() {
      destroyed = true;
      stop();
      ro?.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteTexture(dayTex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
