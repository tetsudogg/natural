// The shape of the valley: terrain height, the stream's path and the open clearings.
// Everything else (trees, grass, water, sound) is placed from these functions.

import { fbm, smoothstep } from './noise';

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
function floorHeight(z: number) {
  return -z * 0.035 - 2.2 * smoothstep(WATERFALL_Z - 3, WATERFALL_Z + 3, z);
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
  { x: streamX(-40) + 20, z: -40, r: 16 },
  { x: streamX(130) - 24, z: 130, r: 20 },
  { x: -110, z: -160, r: 22 },
  { x: 150, z: 30, r: 18 },
];

export function clearingFactor(x: number, z: number) {
  let f = 0;
  for (const c of clearings) {
    const d = Math.hypot(x - c.x, z - c.z);
    f = Math.max(f, 1 - smoothstep(c.r * 0.6, c.r, d));
  }
  return f;
}

// 0 = open ground, 1 = dense forest.
export function forestDensity(x: number, z: number) {
  const d = streamDist(x, z);
  const n = fbm(x * 0.012 + 40, z * 0.012 - 20, 3);
  let f = smoothstep(0.32, 0.55, n) * smoothstep(9, 22, d);
  f *= 1 - clearingFactor(x, z);
  return f;
}

export function heightAt(x: number, z: number) {
  const d = streamDist(x, z);
  const r = Math.hypot(x, z);
  let h = floorHeight(z);
  h += 18 * (1 - Math.exp(-((d / 55) ** 2)));
  h += 70 * smoothstep(60, 300, d) * (0.4 + fbm(x * 0.004, z * 0.004, 4));
  h += 160 * smoothstep(320, 1000, r) * (0.5 + fbm(x * 0.002 + 7, z * 0.002, 3));
  h += (fbm(x * 0.02 + 10, z * 0.02, 4) - 0.3) * 7 * smoothstep(8, 40, d);
  h += (fbm(x * 0.13, z * 0.13, 2) - 0.5) * 0.7 * smoothstep(3, 10, d);
  h += smoothstep(0, 9, d) * 0.9;
  h -= 1.3 * Math.max(0, 1 - (d / 4.5) ** 2);
  // Clearings are flattened a little so a tent can go there later.
  const c = clearingFactor(x, z);
  if (c > 0) h -= c * (h - smoothFlat(x, z)) * 0.6;
  return h;
}

function smoothFlat(x: number, z: number) {
  for (const c of clearings) {
    if (Math.hypot(x - c.x, z - c.z) < c.r) return heightNoFlat(c.x, c.z);
  }
  return heightNoFlat(x, z);
}

function heightNoFlat(x: number, z: number) {
  const d = streamDist(x, z);
  let h = floorHeight(z);
  h += 18 * (1 - Math.exp(-((d / 55) ** 2)));
  h += 70 * smoothstep(60, 300, d) * (0.4 + fbm(x * 0.004, z * 0.004, 4));
  h += (fbm(x * 0.02 + 10, z * 0.02, 4) - 0.3) * 7 * smoothstep(8, 40, d);
  h += smoothstep(0, 9, d) * 0.9;
  return h;
}

