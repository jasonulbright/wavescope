import type { AudioFrame } from "./types";

/**
 * v2 Phase C: a WebGPU render backend (see ROADMAP-V2.md). The point is not
 * to port the cheap 2D modes but to add GPU-native per-pixel modes that run a
 * fragment shader over every pixel at full resolution, up to 8K, which the
 * CPU/canvas path cannot do at 60fps. Capability-gated on `navigator.gpu`;
 * the console only offers these modes where WebGPU is present.
 *
 * WebGPU DOM types are not in the project's TS lib and adding @webgpu/types
 * would require a lockfile change we can't make here, so the GPU objects are
 * typed loosely and the behavior is verified in a real browser instead.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GpuMode {
  id: string;
  name: string;
  /** Fragment-shader body appended to the shared prelude. */
  fragment: string;
}

export const PRELUDE = /* wgsl */ `
struct U {
  res: vec2<f32>,
  time: f32,
  level: f32,
  bass: f32,
  mid: f32,
  treble: f32,
  beat: f32,
};
@group(0) @binding(0) var<uniform> u: U;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[i], 0.0, 1.0);
  out.uv = p[i] * 0.5 + 0.5;
  return out;
}
`;

export const GPU_MODES: GpuMode[] = [
  {
    id: "gpu-plasma",
    name: "Plasma field",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time;
  let boost = 0.5 + u.level * 2.0;
  var v = sin(p.x * 6.0 + t)
        + sin(p.y * 6.0 - t * 1.2)
        + sin((p.x + p.y) * 5.0 + t * 0.7)
        + sin(length(p) * 8.0 - t * 2.0 + u.bass * 6.0);
  v = v / 4.0;
  let hue = 0.6 + 0.15 * v + u.mid * 0.3;
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)) + v * 3.0);
  let bright = clamp((0.4 + 0.6 * abs(v)) * boost + u.beat * 0.4, 0.0, 1.0);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-tunnel",
    name: "Warp tunnel",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let r = length(p);
  let a = atan2(p.y, p.x);
  let depth = 0.4 / (r + 0.05) + u.time * (0.5 + u.level * 1.5);
  let ang = a * 3.0 + u.time * 0.2;
  let stripes = 0.5 + 0.5 * sin(depth * 12.566);
  let spokes = 0.5 + 0.5 * sin(ang * 6.0 + u.bass * 10.0);
  let m = stripes * spokes;
  let fade = smoothstep(0.0, 0.15, r);
  let hue = fract(depth * 0.1 + u.treble * 0.3);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let bright = m * fade * (0.6 + u.level + u.beat * 0.5);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-fractal",
    name: "Fractal fold",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = (in.uv * 2.0 - 1.0) * 1.5;
  p.x *= u.res.x / u.res.y;
  var z = p;
  let c = vec2<f32>(
    0.7 + 0.15 * sin(u.time * 0.3) + u.bass * 0.2,
    0.5 + 0.15 * cos(u.time * 0.27) + u.mid * 0.2
  );
  var orbit = 1e9;
  for (var i = 0; i < 12; i = i + 1) {
    z = abs(z) / dot(z, z) - c;
    orbit = min(orbit, length(z));
  }
  let g = exp(-orbit * 3.0);
  let hue = fract(0.55 + orbit * 0.3 + u.treble * 0.4 + u.time * 0.02);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let bright = clamp(g * (1.0 + u.level * 2.0) + u.beat * 0.3, 0.0, 1.0);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-kaleido",
    name: "Kaleidoscope",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time;
  let r = length(p);
  var a = atan2(p.y, p.x);
  let n = 6.0 + floor(u.bass * 6.0);
  let seg = 6.28318 / n;
  a = a - seg * floor(a / seg);
  a = abs(a - seg * 0.5);
  let q = vec2<f32>(cos(a), sin(a)) * r;
  let v = sin(q.x * 8.0 + t)
        + sin(q.y * 8.0 - t * 1.3)
        + sin(r * 10.0 - t * 2.0 + u.mid * 5.0);
  let hue = fract(0.5 + 0.1 * v + u.treble * 0.3 + t * 0.03);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let bright = clamp(0.35 + 0.45 * abs(v) + u.level + u.beat * 0.4, 0.0, 1.3);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-hextunnel",
    name: "Hex tunnel",
    fragment: /* wgsl */ `
fn hexDist(pp: vec2<f32>) -> f32 {
  let q = abs(pp);
  return max(q.x * 0.866025 + q.y * 0.5, q.y);
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let r = length(p);
  let a = atan2(p.y, p.x);
  let z = 1.0 / (r + 0.06) + u.time * (0.6 + u.level * 1.5);
  var g = vec2<f32>(a * 0.9549, z);
  g = fract(g * vec2<f32>(3.0, 2.0)) - 0.5;
  let d = hexDist(g);
  let cell = smoothstep(0.5, 0.44, d + 0.1 * sin(z * 2.0 + u.bass * 6.0));
  let fade = smoothstep(0.0, 0.2, r);
  let hue = fract(z * 0.08 + u.treble * 0.3);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let bright = cell * fade * (0.5 + u.level + u.beat * 0.5);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-voronoi",
    name: "Voronoi cells",
    fragment: /* wgsl */ `
fn hash2(pp: vec2<f32>) -> vec2<f32> {
  let n = sin(vec2<f32>(dot(pp, vec2<f32>(127.1, 311.7)), dot(pp, vec2<f32>(269.5, 183.3))));
  return fract(n * 43758.5453);
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time;
  let scale = 4.0 + u.mid * 4.0;
  let g = p * scale;
  let cell = floor(g);
  let f = fract(g);
  var md = 1e9;
  var id = vec2<f32>(0.0, 0.0);
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let o = vec2<f32>(f32(i), f32(j));
      var pt = hash2(cell + o);
      pt = 0.5 + 0.5 * sin(t * (0.6 + u.level) + 6.28318 * pt);
      let diff = o + pt - f;
      let dd = dot(diff, diff);
      if (dd < md) {
        md = dd;
        id = cell + o;
      }
    }
  }
  let d = sqrt(md);
  let idh = fract(sin(dot(id, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let hue = fract(idh + u.treble * 0.2 + t * 0.02);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let pulse = 0.5 + 0.7 * u.bass + u.beat * 0.5;
  let edge = smoothstep(0.0, 0.06, d);
  let bright = clamp((1.0 - d) * pulse, 0.0, 1.2) * (0.35 + edge * 0.65);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-metaballs",
    name: "Metaballs",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time;
  var field = 0.0;
  for (var i = 0; i < 5; i = i + 1) {
    let fi = f32(i);
    let c = 0.6 * vec2<f32>(sin(t * (0.5 + fi * 0.13) + fi), cos(t * (0.43 + fi * 0.17) + fi * 1.7));
    let rr = 0.16 + 0.10 * sin(t * 0.7 + fi) + u.bass * 0.12;
    let d = p - c;
    field = field + rr * rr / (dot(d, d) + 0.0008);
  }
  let m = smoothstep(0.8, 1.4, field);
  let hue = fract(0.55 + 0.10 * field + u.treble * 0.3 + t * 0.02);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let bright = clamp(m * (0.7 + u.level) + u.beat * 0.3, 0.0, 1.2);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-moire",
    name: "Moiré",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time;
  let a1 = t * 0.1;
  let a2 = -t * 0.13 + u.mid * 1.5;
  let r1 = vec2<f32>(cos(a1) * p.x - sin(a1) * p.y, sin(a1) * p.x + cos(a1) * p.y);
  let f = 22.0 + u.bass * 30.0;
  let g1 = sin(r1.x * f) * sin(r1.y * f);
  let g2 = sin(length(p) * (f * 0.7) - t * 2.0 + a2);
  let v = g1 * 0.6 + g2 * 0.4;
  let hue = fract(0.5 + 0.2 * v + u.treble * 0.3 + t * 0.02);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let bright = clamp(0.4 + 0.6 * abs(v) + u.level * 0.6 + u.beat * 0.3, 0.0, 1.3);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-lava",
    name: "Liquid noise",
    fragment: /* wgsl */ `
fn hash(pp: vec2<f32>) -> f32 {
  return fract(sin(dot(pp, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn vnoise(pp: vec2<f32>) -> f32 {
  let ip = floor(pp);
  let fp = fract(pp);
  let w = fp * fp * (3.0 - 2.0 * fp);
  let a = hash(ip);
  let b = hash(ip + vec2<f32>(1.0, 0.0));
  let c = hash(ip + vec2<f32>(0.0, 1.0));
  let d = hash(ip + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn fbm(pp: vec2<f32>) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var q = pp;
  for (var i = 0; i < 5; i = i + 1) {
    v = v + amp * vnoise(q);
    q = q * 2.0;
    amp = amp * 0.5;
  }
  return v;
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time * 0.15;
  let warp = vec2<f32>(
    fbm(p * 2.0 + vec2<f32>(t, 0.0)),
    fbm(p * 2.0 + vec2<f32>(0.0, t) + 5.2)
  );
  let n = fbm(p * 3.0 + warp * (2.0 + u.bass * 3.0) + t);
  let hue = fract(0.05 + 0.12 * n + u.treble * 0.2 + u.time * 0.01);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.25, 0.5)));
  let bright = clamp(0.2 + 1.1 * n * (0.6 + u.level) + u.beat * 0.3, 0.0, 1.3);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-aurora",
    name: "Aurora",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time * 0.3;
  var glow = 0.0;
  var hueShift = 0.0;
  // Three drifting curtains, each a soft vertical band whose centerline waves.
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    let sway = sin(p.y * (1.4 + fi * 0.6) + t * (1.0 + fi * 0.4) + fi * 2.1)
             + 0.5 * sin(p.y * 3.7 + t * 2.0 + fi * 4.0 + u.mid * 3.0);
    let center = -0.7 + fi * 0.7 + 0.35 * sway;
    let d = abs(p.x - center);
    let band = exp(-d * d * (7.0 - u.bass * 4.0));
    // Curtains brighten toward the top and shimmer with treble.
    let vert = 0.55 + 0.45 * smoothstep(-1.0, 1.0, p.y);
    let shimmer = 0.8 + 0.2 * sin(p.y * 24.0 - u.time * 5.0 + fi * 3.0) * u.treble * 3.0;
    glow = glow + band * vert * shimmer;
    hueShift = hueShift + band * fi;
  }
  // Green-teal-violet aurora band.
  let hue = 0.36 + 0.10 * hueShift + 0.08 * sin(t + p.y) + u.treble * 0.15;
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let bright = clamp(glow * (0.45 + u.level * 1.2) + u.beat * 0.15, 0.0, 1.25);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-supernova",
    name: "Supernova",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let r = length(p);
  let a = atan2(p.y, p.x);
  let t = u.time;
  // Expanding shockwave rings, sharpened; the beat recharges their brightness.
  let ringPhase = r * 9.0 - t * (2.0 + u.level * 3.0);
  var rings = pow(0.5 + 0.5 * sin(ringPhase * 3.14159), 6.0);
  rings = rings * smoothstep(0.05, 0.35, r) * (0.3 + u.beat * 1.2);
  // Ray spokes flare with treble.
  let spokes = pow(abs(sin(a * 9.0 + t * 0.4)), 8.0) * exp(-r * 2.2) * (0.4 + u.treble * 2.0);
  // Core pulses with bass.
  let core = exp(-r * r * (14.0 - u.bass * 8.0)) * (0.8 + u.bass * 1.5);
  let v = rings + spokes + core;
  let hue = fract(0.02 + r * 0.12 - t * 0.02 + u.mid * 0.15);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.25, 0.55)));
  let bright = clamp(v, 0.0, 1.35);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-ripples",
    name: "Interference",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time;
  // Three orbiting wave sources; bass stretches the wavelength.
  let freq = 14.0 - u.bass * 7.0;
  var v = 0.0;
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    let src = 0.7 * vec2<f32>(
      sin(t * (0.31 + fi * 0.11) + fi * 2.09),
      cos(t * (0.23 + fi * 0.13) + fi * 4.19),
    );
    v = v + sin(length(p - src) * freq - t * 2.5 + fi);
  }
  v = v / 3.0;
  // Sharpen crests into caustic-like filaments.
  let crest = pow(1.0 - abs(v), 3.0);
  let hue = fract(0.52 + 0.12 * v + u.treble * 0.25 + t * 0.015);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let bright = clamp(0.15 + crest * (0.8 + u.level * 1.2) + u.beat * 0.25, 0.0, 1.25);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-phyllo",
    name: "Phyllotaxis",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time;
  let spin = t * 0.08;
  let rot = vec2<f32>(cos(spin), sin(spin));
  p = vec2<f32>(p.x * rot.x - p.y * rot.y, p.x * rot.y + p.y * rot.x);
  // Golden-angle seed spiral: accumulate glow from each floret.
  let GA = 2.39996323;
  let count = 72;
  let spread = 0.105 + 0.02 * sin(t * 0.5) + u.bass * 0.02;
  var glow = 0.0;
  var hueAcc = 0.0;
  for (var i = 1; i <= count; i = i + 1) {
    let fi = f32(i);
    let ang = fi * GA + t * 0.15;
    let rad = spread * sqrt(fi);
    let c = vec2<f32>(cos(ang), sin(ang)) * rad;
    let d = p - c;
    // Florets swell with the band matching their ring: inner=bass, mid, outer=treble.
    let ring = fi / f32(count);
    let energy = mix(u.bass, mix(u.mid, u.treble, clamp(ring * 2.0 - 1.0, 0.0, 1.0)), clamp(ring * 2.0, 0.0, 1.0));
    let size = 3600.0 - energy * 2400.0 - u.beat * 600.0;
    let g = exp(-dot(d, d) * size);
    glow = glow + g;
    hueAcc = hueAcc + g * ring;
  }
  let hue = fract(0.08 + hueAcc / max(glow, 0.001) * 0.5 + t * 0.02);
  let col = 0.5 + 0.5 * cos(6.28318 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
  let bright = clamp(glow * (0.55 + u.level * 0.9), 0.0, 1.3);
  return vec4<f32>(col * bright, 1.0);
}
`,
  },
  {
    id: "gpu-horizon",
    name: "Neon horizon",
    fragment: /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv * 2.0 - 1.0;
  p.x *= u.res.x / u.res.y;
  let t = u.time;
  var col = vec3<f32>(0.0);
  let horizon = -0.12;
  if (p.y < horizon) {
    // Perspective floor: project to grid space, scroll toward the viewer.
    let depth = horizon - p.y;
    let z = 1.0 / (depth + 0.001);
    let gx = p.x * z * 0.7;
    let gz = z * 0.5 + t * (1.2 + u.level * 2.5);
    let lineX = pow(1.0 - abs(fract(gx) * 2.0 - 1.0), 8.0);
    let lineZ = pow(1.0 - abs(fract(gz) * 2.0 - 1.0), 8.0);
    let grid = clamp(lineX + lineZ, 0.0, 1.0) * exp(-depth * 0.25) * smoothstep(0.0, 0.05, depth);
    let gridHue = fract(0.78 + u.mid * 0.1);
    col = col + grid * (0.6 + u.bass * 0.8) * (0.5 + 0.5 * cos(6.28318 * (gridHue + vec3<f32>(0.0, 0.33, 0.67))));
  } else {
    // Sun: bass-swollen disc with animated scanline gaps.
    let sunC = vec2<f32>(0.0, horizon + 0.34);
    let sr = 0.26 + u.bass * 0.10 + u.beat * 0.04;
    let d = length(p - sunC);
    let disc = smoothstep(sr, sr - 0.015, d);
    let gaps = smoothstep(0.35, 0.65, 0.5 + 0.5 * sin((p.y - horizon) * 70.0 - t * 3.0));
    let sun = disc * mix(1.0, gaps, smoothstep(sunC.y + sr * 0.1, sunC.y - sr, p.y));
    let sunCol = mix(vec3<f32>(1.0, 0.25, 0.55), vec3<f32>(1.0, 0.85, 0.3), clamp((p.y - sunC.y) / sr * 0.5 + 0.5, 0.0, 1.0));
    // Treble starfield: hash sparkle above the horizon.
    let cell = floor(p * 24.0);
    let star = fract(sin(dot(cell, vec2<f32>(127.1, 311.7))) * 43758.5453);
    let tw = step(0.985, star) * (0.5 + 0.5 * sin(t * 6.0 + star * 40.0)) * (0.3 + u.treble * 2.5);
    col = col + sun * sunCol * (0.9 + u.level * 0.6) + vec3<f32>(tw);
    // Horizon glow.
    col = col + vec3<f32>(0.9, 0.2, 0.6) * exp(-abs(p.y - horizon) * 9.0) * (0.35 + u.bass * 0.5);
  }
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.35)), 1.0);
}
`,
  },
];

export function gpuModeById(id: string | undefined): GpuMode {
  return GPU_MODES.find((m) => m.id === id) ?? GPU_MODES[0];
}

export function webgpuSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as any).gpu !== "undefined"
  );
}

/** A live WebGPU renderer bound to one canvas. */
export class WebGPURenderer {
  private device: any;
  private ctx: any;
  private format: any;
  private uniformBuf: any;
  private uniformData = new Float32Array(8);
  private pipelines = new Map<string, any>();
  private bindGroups = new Map<string, any>();
  private canvas: HTMLCanvasElement;

  private constructor(canvas: HTMLCanvasElement, device: any, ctx: any, format: any) {
    this.canvas = canvas;
    this.device = device;
    this.ctx = ctx;
    this.format = format;
    this.uniformBuf = device.createBuffer({
      size: 32,
      usage: 0x40 | 0x8, // UNIFORM | COPY_DST
    });
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGPURenderer | null> {
    const gpu = (navigator as any).gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    if (!device) return null;
    const ctx = canvas.getContext("webgpu") as any;
    if (!ctx) return null;
    const format = gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "opaque" });
    return new WebGPURenderer(canvas, device, ctx, format);
  }

  private pipelineFor(mode: GpuMode): any {
    let pipe = this.pipelines.get(mode.id);
    if (!pipe) {
      const module = this.device.createShaderModule({
        code: PRELUDE + mode.fragment,
      });
      pipe = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: {
          module,
          entryPoint: "fs",
          targets: [{ format: this.format }],
        },
        primitive: { topology: "triangle-list" },
      });
      this.pipelines.set(mode.id, pipe);
      const bind = this.device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }],
      });
      this.bindGroups.set(mode.id, bind);
    }
    return pipe;
  }

  render(mode: GpuMode, f: AudioFrame) {
    const pipe = this.pipelineFor(mode);
    const bind = this.bindGroups.get(mode.id);
    const d = this.uniformData;
    d[0] = this.canvas.width;
    d[1] = this.canvas.height;
    d[2] = f.t;
    d[3] = f.level;
    d[4] = f.bass;
    d[5] = f.mid;
    d[6] = f.treble;
    d[7] = f.beat;
    this.device.queue.writeBuffer(this.uniformBuf, 0, d);

    const encoder = this.device.createCommandEncoder();
    const view = this.ctx.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.043, g: 0.051, b: 0.047, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy() {
    try {
      this.ctx.unconfigure();
      this.device.destroy();
    } catch {
      // already gone
    }
  }
}
