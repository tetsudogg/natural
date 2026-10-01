// The shape of the valley: terrain height, the stream's path and the open clearings.
// Everything else (trees, grass, water, sound) is placed from these functions.

import { fbm, mulberry32, smoothstep } from './noise';

export const HALF = 300; // playable area is [-HALF, HALF] on x and z
export const WALK_LIMIT = 285;

export const WATERFALL_Z = 82;

export function streamX(z: number) {
  return 30 * Math.sin(z * 0.009) + 12 * Math.sin(z * 0.023 + 1.3) + 3 * Math.sin(z * 0.07 + 0.4);
}

function streamSlope(z: number) {
  return 30 * 0.009 * Math.cos(z * 0.009) + 12 * 0.023 * Math.cos(z * 0.023 + 1.3) + 3 * 0.07 * Math.cos(z * 0.07 + 0.4);
}

// Distance from (x, z) to the stream's centre line.
export function streamDist(x: number, z: number) {
  const s = streamSlope(z);
  return Math.abs(x - streamX(z)) / Math.sqrt(1 + s * s);
}

// The valley floor falls gently toward +z, with one small waterfall.
// Away from the stream the waterfall's step fades into a long, gentle slope, so it
// doesn't cut a straight ledge across the whole mountainside.
function floorHeight(z: number, d = 0) {
  const w = 3 + d * 0.8;
  return -z * 0.035 - 2.2 * smoothstep(WATERFALL_Z - w, WATERFALL_Z + w, z);
}

export function waterLevel(z: number) {
  return floorHeight(z) - 0.45;
}

export interface Clearing {
  x: number;
  z: number;
  r: number;
}

export const clearings: Clearing[] = [
  { x: streamX(-40) + 20, z: -40, r: 18 },
  { x: streamX(130) - 26, z: 130, r: 22 },
  { x: streamX(-160) - 30, z: -160, r: 22 },
  { x: streamX(30) + 70, z: 30, r: 20 },
  { x: streamX(220) + 24, z: 220, r: 18 },
];

export function clearingFactor(x: number, z: number) {
  let f = 0;
  for (const c of clearings) {
    const d = Math.hypot(x - c.x, z - c.z);
    f = Math.max(f, 1 - smoothstep(c.r * 0.6, c.r, d));
  }
  return f;
}

// ---------- The pond ----------
// Downstream the valley opens into a wide basin and the stream fills a big, still pond,
// like Taisho-ike at Kamikochi: forest and gravel shores, dead trees standing in the
// shallows, and a high, snow-streaked range beyond, all mirrored in the water.

export const POND = { x: 45, z: 480, rx: 240, rz: 250 };
export const POND_LEVEL = waterLevel(232);

function pondE(x: number, z: number) {
  return Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz) + (fbm(x * 0.007 + 17, z * 0.007 - 5, 3) - 0.5) * 0.45;
}

// 1 in the basin, 0 outside, with an uneven edge.
export function pondMask(x: number, z: number) {
  if (z < 150) return 0;
  return 1 - smoothstep(0.72, 1.12, pondE(x, z));
}

// The low, flat, wooded ground around the pond before the mountains rise.
function lowland(x: number, z: number) {
  if (z < 120) return 0;
  return 1 - smoothstep(1.0, 2.3, pondE(x, z));
}

// The far range beyond the pond: a long wall of jagged peaks with snow in the gullies.
export function farRange(x: number, z: number) {
  const env = Math.exp(-(((z - 1950) / 360) ** 2)) * (1 - smoothstep(1400, 2600, Math.abs(x)) * 0.6);
  if (env < 0.01) return 0;
  const ridge = 1 - Math.abs(2 * fbm(x * 0.0018 + 3, z * 0.0018 + 9, 4) - 1);
  const jag = 1 - Math.abs(2 * fbm(x * 0.008 - 4, z * 0.008 + 2, 3) - 1);
  return env * (200 + 230 * ridge * ridge + 100 * jag * jag);
}

// 0 = open ground, 1 = dense forest.
export function forestDensity(x: number, z: number) {
  const d = streamDist(x, z);
  const n = fbm(x * 0.012 + 40, z * 0.012 - 20, 3);
  let f = smoothstep(0.32, 0.55, n) * smoothstep(9, 22, d);
  f *= 1 - clearingFactor(x, z);
  return f;
}

// Large-scale shape: a gentle valley floor along the stream, then mountainsides that
// get steeper and rougher as they climb. Spurs and gullies run down the slopes at odd
// angles, with knolls, hollows and rocky crags on them, so flat ground gets rarer the
// higher you go.
function baseHeight(x: number, z: number) {
  const d0 = streamDist(x, z);
  const r = Math.hypot(x, z);
  // Bend the contours so the slopes don't run neatly parallel to the stream.
  const away = smoothstep(18, 90, d0);
  const d = Math.max(0, d0 + (fbm(x * 0.006 + 31, z * 0.006 - 7, 3) - 0.5) * 70 * away);
  // Beyond the walkable valley the slopes level off into rolling forested hills.
  const dm = d < 320 ? d : 320 + 70 * (1 - Math.exp(-(d - 320) / 70));
  const mountain = 0.2 * Math.max(0, dm - 26) + 0.0008 * Math.max(0, dm - 26) ** 2;
  let rise = 5 * smoothstep(12, 55, d0) + mountain * (0.75 + 0.5 * fbm(x * 0.005 - 3, z * 0.005 + 11, 3));
  // Spurs and gullies: sharp-crested ridged noise, stronger higher up.
  const rn = 1 - Math.abs(2 * fbm(x * 0.011 + 5, z * 0.011 - 13, 4) - 1);
  rise += (rn * rn - 0.45) * 16 * smoothstep(25, 160, d0);
  // Knolls and hollows.
  rise += (fbm(x * 0.03 - 9, z * 0.03 + 4, 3) - 0.5) * 7 * smoothstep(18, 90, d0);
  // Rocky crags: short, steep lumps here and there.
  const crag = Math.max(0, fbm(x * 0.045 + 21, z * 0.045 - 2, 3) - 0.6);
  rise += crag * crag * 90 * smoothstep(35, 110, d0);
  const pond = pondMask(x, z);
  const low = lowland(x, z);
  // Past the pond's inlet the valley floor stops falling; the pond fills the hollow.
  let fl = floorHeight(z, d0);
  if (z > 232) fl = Math.max(fl, POND_LEVEL + 1.2 + 0.03 * Math.max(0, z - 760));
  let h = fl + Math.max(0, rise) * (1 - 0.88 * low);
  // Lower in the wide valley north of the pond, so the range shows from its forested feet up.
  const vale = smoothstep(600, 950, z) * (1 - smoothstep(350, 1000, Math.abs(x - POND.x)));
  h += 160 * smoothstep(320, 1000, r) * (0.5 + fbm(x * 0.002 + 7, z * 0.002, 3)) * (1 - low) * (1 - 0.7 * vale);
  h += farRange(x, z);
  if (pond > 0) {
    // The basin: a broad, shallow bowl under the pond, shelving up to its shores.
    const bowl = POND_LEVEL - 0.6 - 5 * smoothstep(0.35, 1, pond) + (fbm(x * 0.02, z * 0.02 + 40, 2) - 0.5) * 1.2;
    h += (bowl - h) * smoothstep(0, 0.6, pond);
  }
  h += smoothstep(0, 9, d0) * 0.9;
  return h;
}

// The terrain before the side brooks cut their ravines.
function terrainNoBrooks(x: number, z: number) {
  const d = streamDist(x, z);
  let h = baseHeight(x, z);
  // Gentle unevenness underfoot, and the stream bed carved into the floor.
  h += (fbm(x * 0.04 + 3, z * 0.04, 2) - 0.5) * 0.8 * smoothstep(6, 20, d);
  h += (fbm(x * 0.13, z * 0.13, 2) - 0.5) * (0.35 + 1.1 * smoothstep(40, 150, d)) * smoothstep(3, 10, d);
  h -= 1.3 * Math.max(0, 1 - (d / 4.5) ** 2);
  // Clearings are levelled so a tent can go there.
  for (const c of clearings) {
    const f = 1 - smoothstep(c.r * 0.7, c.r * 1.3, Math.hypot(x - c.x, z - c.z));
    if (f > 0) h += (clearingLevel(c) - h) * f * 0.9;
  }
  return h;
}

const levels = new Map<Clearing, number>();
function clearingLevel(c: Clearing) {
  let v = levels.get(c);
  if (v === undefined) levels.set(c, (v = baseHeight(c.x, c.z)));
  return v;
}

// ---------- Side brooks ----------
// Small streams run down the valley sides into the main stream. Each follows a
// wandering line up the slope; its bed steps down the benches of the hillside, so
// flat runs and pools alternate with little waterfalls. The bed is cut into the
// ground as a ravine with steep, rocky banks, steepest beside the falls.

interface BrookDef {
  z0: number; // where it joins the main stream
  side: 1 | -1; // east or west bank
  length: number;
  turn: number; // overall lean upstream or downstream, radians
  seed: number;
  size?: number; // width and depth, 1 for the main brooks
}

const BROOK_DEFS: BrookDef[] = [
  { z0: -108, side: 1, length: 170, turn: -0.35, seed: 11 },
  { z0: 48, side: -1, length: 175, turn: -0.3, seed: 23 },
  { z0: 172, side: 1, length: 150, turn: -0.25, seed: 37 },
  // Smaller rills: narrow, just a trickle between the stones.
  { z0: -220, side: -1, length: 110, turn: -0.3, seed: 51, size: 0.6 },
  { z0: -30, side: -1, length: 95, turn: -0.25, seed: 63, size: 0.55 },
  { z0: 100, side: 1, length: 120, turn: -0.3, seed: 71, size: 0.6 },
  { z0: 250, side: -1, length: 100, turn: -0.3, seed: 83, size: 0.55 },
];

export interface BrookFall {
  x: number;
  z: number;
  top: number; // water level at the lip
  bottom: number; // water level in the pool
  dirX: number; // direction the water flows (downstream)
  dirZ: number;
  width: number;
  at: number; // sample index at the top of the fall
}

export interface Brook {
  x: Float32Array; // centre line, one sample per metre from the mouth upward
  z: Float32Array;
  bed: Float32Array; // bed height, with pools dug below the falls
  water: Float32Array; // water surface height
  width: Float32Array; // half width of the channel floor
  falls: BrookFall[];
}

let brookList: Brook[] | null = null;

function buildBrook(def: BrookDef): Brook {
  const n = def.length;
  const size = def.size ?? 1;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  let x = streamX(def.z0) + def.side * 2.5;
  let z = def.z0;
  const base = def.side > 0 ? 0 : Math.PI;
  let a = base + def.turn * def.side;
  for (let i = 0; i < n; i++) {
    xs[i] = x;
    zs[i] = z;
    // Meander, but keep heading up the slope.
    a += (fbm(i * 0.035 + def.seed, def.seed * 1.7, 2) - 0.5) * 0.16;
    const target = base + def.turn * def.side;
    a += (target - a) * 0.02;
    x += Math.cos(a);
    z += Math.sin(a);
  }
  // Raw bed: the hillside minus a shallow ravine that deepens a little away from the mouth.
  const raw = new Float32Array(n);
  const mouth = waterLevel(def.z0) - 0.1;
  for (let i = 0; i < n; i++) {
    const depth = (0.5 + 1.5 * smoothstep(4, 40, i) + 1.0 * fbm(i * 0.05, def.seed, 2)) * (0.5 + 0.5 * size);
    raw[i] = i < 4 ? mouth : Math.max(mouth, terrainNoBrooks(xs[i], zs[i]) - depth);
  }
  // Water runs downhill: the bed never rises going downstream.
  const smooth = new Float32Array(n);
  let low = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    low = Math.min(low, raw[i]);
    smooth[i] = low;
  }
  // Where the hillside has a cliff, the brook has cut a notch into it: the bed never
  // climbs more than a metre per metre, so the ravine deepens into a short gorge instead.
  for (let i = 1; i < n; i++) smooth[i] = Math.min(smooth[i], smooth[i - 1] + 1);
  // A mountain brook climbs untidily: long reaches of steep riffle and cascade over
  // cobbles where the bed hugs the hillside, flatter gravel runs, and now and then a
  // rock step the water drops over. Steps come at uneven spacing, mostly small, a few
  // bigger, and some drops are spread over a short chute instead of a clean fall.
  const rnd = mulberry32(def.seed * 7 + 1);
  const bed = new Float32Array(n);
  const falls: BrookFall[] = [];
  const width = new Float32Array(n);
  for (let i = 0; i < n; i++) width[i] = (0.55 + 0.5 * (1 - i / n) + 0.3 * fbm(i * 0.08, def.seed + 5, 2)) * size;
  let level = smooth[0];
  const stepMax = 0.5 + 0.5 * size;
  const nextStep = () => stepMax * (0.45 + 2.6 * rnd() ** 2) * (rnd() < 0.12 ? 1.7 : 1);
  let next = nextStep();
  const stepAt: number[] = [];
  // The bigger brooks each have one showpiece: a 3 to 5 m fall. Below it the bed runs
  // almost level (the fall takes the height), opening into a wide, deep pool.
  const bigFrom = size >= 1 ? Math.floor(n * (0.28 + 0.2 * rnd())) : Infinity;
  const bigH = 3.2 + rnd() * 1.8;
  let bigAt = -1;
  let bigTarget = -1;
  // Chutes drop a third of a metre per metre, but just above the big fall the water
  // already slides down steep rock, so leave that alone.
  const chuteSlope = (j: number) => (bigAt >= 0 && j - bigAt <= 16 ? 1.05 : 0.32);
  for (let i = 0; i < n; i++) {
    const excess = smooth[i] - level;
    if (i === bigFrom) {
      // Pick the spot: 3 to 5.5 m above the run, with the gentlest ground above it.
      let best = -1;
      let bestG = Infinity;
      for (let j = i + 4; j < Math.min(n - 10, i + 70); j++) {
        const e = smooth[j] - level;
        if (e < 3 || e > 5.5) continue;
        const g = Math.max(smooth[j + 6] - smooth[j], (smooth[j + 10] - smooth[j]) * 0.6) + Math.abs(e - bigH) * 0.5;
        if (g < bestG) {
          bestG = g;
          best = j;
        }
      }
      bigTarget = best;
    }
    if (bigAt < 0 && i >= bigFrom && bigTarget > 0) {
      if (i >= bigTarget) {
        level = smooth[i];
        bed[i] = level;
        stepAt.push(i);
        bigAt = i;
        next = nextStep();
      } else bed[i] = Math.max(bed[i - 1], level + excess * 0.04);
      continue;
    }
    if (bigAt >= 0 && i - bigAt <= 10) {
      // Just above the big fall the water slides steeply down bare rock to the lip.
      level = smooth[i];
      bed[i] = Math.max(bed[i - 1], level);
      continue;
    }
    // How closely the bed follows the hillside: riffles hug it, runs lag behind it.
    const follow = 0.15 + 0.8 * smoothstep(0.35, 0.65, fbm(i * 0.045, def.seed + 11, 2));
    if (excess > next && i > 6) {
      const drop = smooth[i] - bed[i - 1];
      level = smooth[i];
      bed[i] = level;
      // Tall drops and drops right after another fall tumble down as cascades.
      const lastStep = stepAt.length ? stepAt[stepAt.length - 1] : -99;
      if (rnd() < 0.4 || drop > 2.4 || i - lastStep < 3) {
        // A steep chute over a few metres: raise the bed below so no single sample
        // drops much. Whatever the chute cannot take drops as a fall at its foot.
        let j = i - 1;
        const end = i - 2 - Math.floor(rnd() * 5);
        // (and keep going while the fall left over would be taller than a couple of metres)
        for (; j > Math.max(6, bigAt) && (j >= end || bed[j] < bed[j + 1] - 2) && bed[j] < bed[j + 1] - chuteSlope(j); j--) bed[j] = bed[j + 1] - chuteSlope(j);
        if (bed[j + 1] - bed[j] > 0.35) stepAt.push(j + 1);
      } else stepAt.push(i);
      next = nextStep();
    } else {
      bed[i] = Math.max(i ? bed[i - 1] : -Infinity, level + excess * follow);
    }
  }
  const water = new Float32Array(n);
  for (let k = 0; k < n; k++) water[k] = bed[k] + 0.12;
  for (const k of new Set(stepAt)) {
    const drop = water[k] - water[k - 1];
    if (drop < 0.35) continue;
    // The lip is a rock ledge, rarely square across the channel.
    const big = k === bigAt;
    const skew = (rnd() - 0.5) * (big ? 0.3 : 0.8);
    const cx = xs[k - 1] - xs[k];
    const cz = zs[k - 1] - zs[k];
    const dx = cx * Math.cos(skew) - cz * Math.sin(skew);
    const dz = cx * Math.sin(skew) + cz * Math.cos(skew);
    const l = Math.hypot(dx, dz) || 1;
    falls.push({
      at: k,
      x: (xs[k] + xs[k - 1]) / 2,
      z: (zs[k] + zs[k - 1]) / 2,
      top: water[k],
      bottom: water[k - 1],
      dirX: dx / l,
      dirZ: dz / l,
      width: big ? Math.max(1.1, width[k]) * (0.8 + 0.25 * rnd()) : width[k] * (0.35 + 0.5 * rnd()),
    });
    if (big) {
      // The big pool: wide and chest deep under the fall, shelving to gravel downstream.
      for (let j = Math.max(1, k - 12); j < k; j++) {
        const t = (j - (k - 12)) / 12; // 0 downstream end .. 1 at the fall
        const bell = Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5) * (1 - smoothstep(0.9, 1, t) * 0.25);
        width[j] = Math.max(width[j], 1 + 3.2 * bell);
        bed[j] -= 0.9 * smoothstep(0.2, 0.85, t);
      }
      continue;
    }
    // A small plunge pool, only knee deep, just below the fall.
    for (let j = Math.max(1, k - 4); j < k; j++) {
      const t = (j - (k - 4)) / 4;
      bed[j] -= 0.35 * Math.sin(Math.max(0, t) * Math.PI * 0.5 + 0.3) * Math.min(1, drop);
      width[j] *= 1 + 0.4 * Math.sin(Math.max(0, t) * Math.PI);
    }
  }
  return { x: xs, z: zs, bed, water, width, falls };
}

export function brooks() {
  if (!brookList) brookList = BROOK_DEFS.map(buildBrook);
  return brookList;
}

// A 1 m raster of the nearest brook: distance to its centre line, and the bed,
// half-width and sample of that nearest point. Built once, looked up everywhere.
const RES = 1;
const RN = Math.round((HALF * 2) / RES) + 1;
let rDist: Float32Array | null = null;
let rBed: Float32Array;
let rWidth: Float32Array;
let rSteep: Float32Array;
let rRef: Int32Array; // brook index * 100000 + sample index

function ensureRaster() {
  if (rDist) return;
  const list = brooks();
  const dist = new Float32Array(RN * RN).fill(1e9);
  rDist = dist;
  rBed = new Float32Array(RN * RN);
  rWidth = new Float32Array(RN * RN);
  rSteep = new Float32Array(RN * RN);
  rRef = new Int32Array(RN * RN).fill(-1);
  const R = 26;
  list.forEach((b, bi) => {
    const n = b.x.length;
    for (let k = 0; k < n - 1; k++) {
      const ax = b.x[k], az = b.z[k], bx = b.x[k + 1], bz = b.z[k + 1];
      const vx = bx - ax, vz = bz - az;
      const vv = vx * vx + vz * vz || 1;
      // Banks are steepest beside falls, and vary along the way.
      let nearFall = 0;
      for (const f of b.falls) nearFall = Math.max(nearFall, (1 - smoothstep(2, 6, Math.hypot(f.x - ax, f.z - az))) * Math.min(1, (f.top - f.bottom) / 1.5));
      const steep = 0.45 + 0.6 * fbm(k * 0.06, bi * 3.1, 2) + 0.6 * nearFall;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + HALF) / RES));
      const i1 = Math.min(RN - 1, Math.ceil((Math.max(ax, bx) + R + HALF) / RES));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + HALF) / RES));
      const j1 = Math.min(RN - 1, Math.ceil((Math.max(az, bz) + R + HALF) / RES));
      for (let j = j0; j <= j1; j++) {
        const pz = -HALF + j * RES;
        for (let i = i0; i <= i1; i++) {
          const px = -HALF + i * RES;
          const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / vv));
          const d = Math.hypot(px - ax - vx * t, pz - az - vz * t);
          const c = j * RN + i;
          if (d < dist[c]) {
            dist[c] = d;
            rBed[c] = b.bed[k] + (b.bed[k + 1] - b.bed[k]) * t;
            rWidth[c] = b.width[k] + (b.width[k + 1] - b.width[k]) * t;
            rSteep[c] = steep;
            rRef[c] = bi * 100000 + (t < 0.5 ? k : k + 1);
          }
        }
      }
    }
  });
}

function rasterSample(arr: Float32Array, x: number, z: number) {
  const fx = Math.min(RN - 1.001, Math.max(0, (x + HALF) / RES));
  const fz = Math.min(RN - 1.001, Math.max(0, (z + HALF) / RES));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const a = arr[j * RN + i];
  const b = arr[j * RN + i + 1];
  const c = arr[(j + 1) * RN + i];
  const d = arr[(j + 1) * RN + i + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

// Distance from (x, z) to the nearest brook's water edge (negative inside the channel).
export function brookEdgeDist(x: number, z: number) {
  if (Math.abs(x) > HALF || Math.abs(z) > HALF) return 1e9;
  ensureRaster();
  const d = rasterSample(rDist!, x, z);
  if (d > 1e8) return 1e9;
  return d - rasterSample(rWidth, x, z);
}

// The nearest point on a brook: its sample, for sound and wildlife.
export function nearestBrook(x: number, z: number) {
  if (Math.abs(x) > HALF || Math.abs(z) > HALF) return null;
  ensureRaster();
  const i = Math.round((x + HALF) / RES);
  const j = Math.round((z + HALF) / RES);
  const ref = rRef[j * RN + i];
  if (ref < 0) return null;
  const b = brooks()[Math.floor(ref / 100000)];
  const k = ref % 100000;
  return { x: b.x[k], z: b.z[k], water: b.water[k], dist: rDist![j * RN + i] };
}

// Distance to open water, main stream or brook, measured so that the water's edge is
// about 4 m for both (the main stream's bank). Use this to keep things out of water.
export function waterDist(x: number, z: number) {
  let d = Math.min(streamDist(x, z), brookEdgeDist(x, z) + 3.3);
  if (z > 150 && pondMask(x, z) > 0.01) {
    // Near the pond: about 6 m of shore per metre above the water, edge at 4 m like the stream.
    d = Math.min(d, 4 + Math.max(-4, (heightAt(x, z) - POND_LEVEL) * 6));
  }
  return d;
}

export function heightAt(x: number, z: number) {
  const h = terrainNoBrooks(x, z);
  if (Math.abs(x) > HALF || Math.abs(z) > HALF) return h;
  ensureRaster();
  const d = rasterSample(rDist!, x, z);
  if (d > 30) return h;
  const w = rasterSample(rWidth, x, z);
  const bed = rasterSample(rBed, x, z);
  const steep = rasterSample(rSteep, x, z);
  // A rounded channel floor, then banks rising at the bank's steepness.
  const e = d - w;
  const floor = e < 0 ? bed - 0.1 * (1 - (d / w) ** 2) : bed + e * steep + e * e * 0.04;
  // Rough, rocky banks.
  const rough = (fbm(x * 0.35, z * 0.35, 2) - 0.5) * 0.6 * smoothstep(0, 2, e);
  return Math.min(h, floor + rough);
}
