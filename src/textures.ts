// Textures: CC0 photos from Poly Haven (see scripts/fetch_textures.py) for surfaces
// and leaves, plus a few drawn at startup.

import * as THREE from 'three';
import { mulberry32 } from './noise';
import barkDiff from './assets/bark_diff.webp';
import barkNor from './assets/bark_nor.webp';
import cliffDiff from './assets/cliff_diff.webp';
import cliffNor from './assets/cliff_nor.webp';
import fernUrl from './assets/fern.webp';
import grassDiff from './assets/grass_diff.webp';
import grassNor from './assets/grass_nor.webp';
import gravelDiff from './assets/gravel_diff.webp';
import gravelNor from './assets/gravel_nor.webp';
import leavesUrl from './assets/leaves.webp';
import litterDiff from './assets/litter_diff.webp';
import litterNor from './assets/litter_nor.webp';
import mossDiff from './assets/moss_diff.webp';
import mossNor from './assets/moss_nor.webp';
import rockDiff from './assets/rock_diff.webp';
import rockNor from './assets/rock_nor.webp';

const loader = new THREE.TextureLoader();

function photo(url: string, color: boolean) {
  const tex = loader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export type Surface = { map: THREE.Texture; normal: THREE.Texture };
const SURFACE_URLS = {
  grass: [grassDiff, grassNor],
  litter: [litterDiff, litterNor],
  gravel: [gravelDiff, gravelNor],
  cliff: [cliffDiff, cliffNor],
  moss: [mossDiff, mossNor],
  rock: [rockDiff, rockNor],
  bark: [barkDiff, barkNor],
} as const;
const surfaces = new Map<string, Surface>();

// A tileable photo surface: colour and normal map. Shared, so each loads once.
export function surface(name: keyof typeof SURFACE_URLS): Surface {
  let s = surfaces.get(name);
  if (!s) {
    const [map, normal] = SURFACE_URLS[name];
    s = { map: photo(map, true), normal: photo(normal, false) };
    surfaces.set(name, s);
  }
  return s;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function image(url: string) {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

// Tileable noise built from sine waves so it repeats seamlessly.
function tileNoise(size: number, seed: number, waves: number, maxFreq: number) {
  const rnd = mulberry32(seed);
  const comps: { fx: number; fy: number; ph: number; a: number }[] = [];
  for (let i = 0; i < waves; i++) {
    const f = 1 + Math.floor(rnd() * maxFreq);
    const ang = rnd() * Math.PI * 2;
    comps.push({
      fx: Math.round(Math.cos(ang) * f),
      fy: Math.round(Math.sin(ang) * f),
      ph: rnd() * Math.PI * 2,
      a: 1 / f,
    });
  }
  const out = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const c of comps) v += Math.sin(((c.fx * x + c.fy * y) / size) * Math.PI * 2 + c.ph) * c.a;
      out[y * size + x] = v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / (max - min);
  return out;
}

// Normal map of small ripples for the stream.
export function waterNormalTexture() {
  const size = 256;
  const h = tileNoise(size, 7, 60, 12);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  const strength = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Soft round dot used for fireflies.
export function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Leaf sprays with transparent gaps, used on the cards that make up tree crowns.
export function foliageTexture(kind: 'leaf' | 'needle' | 'maple', seed: number) {
  const size = 512;
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const S = size / 256; // drawing below is in 256-unit space
  ctx.scale(S, S);
  const half = 128;
  if (kind !== 'needle') {
    // Twigs carrying real leaves photographed for Poly Haven. 'leaf' mixes broad
    // heart-shaped and oval leaves; 'maple' uses smaller, denser serrated ones.
    const maple = kind === 'maple';
    const twigs: { a: number; len: number }[] = [];
    const leaves: { x: number; y: number; rot: number; s: number; cell: number; shade: number }[] = [];
    for (let b = 0; b < (maple ? 7 : 8); b++) {
      const a = rnd() * Math.PI * 2;
      const len = 256 * (0.24 + rnd() * 0.2);
      twigs.push({ a, len });
      for (let i = 0; i < (maple ? 16 : 13); i++) {
        const t = 0.15 + rnd() * 0.85;
        leaves.push({
          x: half + Math.cos(a) * len * t + (rnd() - 0.5) * 20,
          y: half + Math.sin(a) * len * t + (rnd() - 0.5) * 20,
          rot: a + Math.PI / 2 + (rnd() - 0.5) * 1.6,
          s: maple ? 20 + rnd() * 10 : 26 + rnd() * 14,
          cell: maple ? Math.floor(rnd() * 6) : Math.floor(rnd() * 8),
          shade: 0.7 + rnd() * 0.45,
        });
      }
    }
    image(leavesUrl).then((img) => {
      ctx.strokeStyle = 'rgb(88,70,48)';
      ctx.lineWidth = 1.5;
      for (const { a, len } of twigs) {
        ctx.beginPath();
        ctx.moveTo(half, half);
        ctx.lineTo(half + Math.cos(a) * len, half + Math.sin(a) * len);
        ctx.stroke();
      }
      for (const l of leaves) {
        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate(l.rot);
        ctx.filter = `brightness(${l.shade.toFixed(2)})`;
        // Each atlas cell holds one leaf, tip up and stalk at the bottom.
        ctx.drawImage(img, (l.cell % 4) * 256, Math.floor(l.cell / 4) * 256, 256, 256, -l.s / 2, -l.s * 0.95, l.s, l.s);
        ctx.restore();
      }
      tex.needsUpdate = true;
    });
  } else {
    // Cedar sprays: dense short strokes along forking stems.
    for (let b = 0; b < 9; b++) {
      const a = rnd() * Math.PI * 2;
      const len = 256 * (0.28 + rnd() * 0.18);
      for (let i = 0; i < 140; i++) {
        const t = rnd();
        const px = half + Math.cos(a) * len * t + (rnd() - 0.5) * 16 * (1 - t * 0.5);
        const py = half + Math.sin(a) * len * t + (rnd() - 0.5) * 16 * (1 - t * 0.5);
        const ang = a + (rnd() - 0.5) * 2.2;
        const l = 6 + rnd() * 8;
        const g = 70 + rnd() * 60;
        ctx.strokeStyle = `rgb(${g * 0.45},${g},${g * 0.4})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * l, py + Math.sin(ang) * l);
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Eight wild plants in one texture, four per row:
// top row: white fleabane, yellow buttercup, purple bellflower, blue dayflower;
// bottom row: pink fringed pink (nadeshiko), yellow patrinia (ominaeshi),
// silver grass (susuki), white clover.
export type FlowerKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const FLOWER_KINDS = 8;
export function flowerAtlas() {
  const q = 256;
  const rnd = mulberry32(21);
  const canvas = document.createElement('canvas');
  canvas.width = q * 4;
  canvas.height = q * 2;
  const ctx = canvas.getContext('2d')!;
  const stem = (x: number, y0: number, y1: number, bend: number) => {
    ctx.strokeStyle = 'rgb(70,110,45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.quadraticCurveTo(x + bend, (y0 + y1) / 2, x + bend * 0.6, y1);
    ctx.stroke();
    // a couple of leaves
    ctx.fillStyle = 'rgb(80,125,50)';
    for (let i = 0; i < 2; i++) {
      const ly = y0 - (y0 - y1) * (0.2 + rnd() * 0.35);
      ctx.save();
      ctx.translate(x + bend * 0.3, ly);
      ctx.rotate((i ? 1 : -1) * (0.6 + rnd() * 0.4));
      ctx.beginPath();
      ctx.ellipse(0, -8, 3, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return [x + bend * 0.6, y1] as const;
  };
  for (let k = 0; k < 4; k++) {
    const ox = k * q;
    const oy = 0;
    const n = k === 2 ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const x = ox + q * (0.15 + 0.7 * (i + rnd() * 0.6) / n);
      const top = oy + q * (0.15 + rnd() * 0.35);
      const [hx, hy] = stem(x, oy + q - 2, top, (rnd() - 0.5) * 20);
      ctx.save();
      ctx.translate(hx, hy);
      if (k === 0) {
        // many thin white petals around a yellow centre
        ctx.fillStyle = 'rgb(245,242,235)';
        for (let p = 0; p < 18; p++) {
          ctx.save();
          ctx.rotate((p / 18) * Math.PI * 2);
          ctx.fillRect(-1, 2, 2, 9);
          ctx.restore();
        }
        ctx.fillStyle = 'rgb(235,200,60)';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (k === 1) {
        ctx.fillStyle = 'rgb(250,215,40)';
        for (let p = 0; p < 5; p++) {
          ctx.save();
          ctx.rotate((p / 5) * Math.PI * 2);
          ctx.beginPath();
          ctx.ellipse(0, 5, 4.5, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = 'rgb(200,160,30)';
        ctx.beginPath();
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (k === 2) {
        // hanging bells along the stem top
        for (let b = 0; b < 3; b++) {
          ctx.save();
          ctx.translate((b - 1) * 7, b * 12);
          ctx.fillStyle = 'rgb(140,110,200)';
          ctx.beginPath();
          ctx.moveTo(-6, 12);
          ctx.quadraticCurveTo(-6, 0, 0, 0);
          ctx.quadraticCurveTo(6, 0, 6, 12);
          ctx.lineTo(-6, 12);
          ctx.fill();
          ctx.restore();
        }
      } else {
        // two rounded blue petals
        ctx.fillStyle = 'rgb(60,110,230)';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(s * 5, -2, 5, 6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgb(240,210,60)';
        ctx.fillRect(-1, 2, 2, 5);
      }
      ctx.restore();
    }
  }

  // Nadeshiko: five pink petals with finely fringed edges.
  for (let i = 0; i < 5; i++) {
    const x = q * (0.15 + 0.7 * (i + rnd() * 0.6) / 5);
    const [hx, hy] = stem(x, q * 2 - 2, q + q * (0.2 + rnd() * 0.3), (rnd() - 0.5) * 20);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(rnd());
    for (let p = 0; p < 5; p++) {
      ctx.save();
      ctx.rotate((p / 5) * Math.PI * 2);
      ctx.fillStyle = 'rgb(236,150,190)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-4, 8);
      for (let f = 0; f <= 6; f++) ctx.lineTo(-4 + (f / 6) * 8, f % 2 ? 11 : 15);
      ctx.lineTo(4, 8);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgb(200,90,130)';
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Ominaeshi: tall stems topped with flat sprays of tiny yellow flowers.
  for (let i = 0; i < 4; i++) {
    const x = q + q * (0.15 + 0.7 * (i + rnd() * 0.6) / 4);
    const [hx, hy] = stem(x, q * 2 - 2, q + q * (0.1 + rnd() * 0.15), (rnd() - 0.5) * 16);
    ctx.fillStyle = 'rgb(240,210,50)';
    for (let d = 0; d < 60; d++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 16;
      ctx.beginPath();
      ctx.arc(hx + Math.cos(a) * r, hy + Math.sin(a) * r * 0.35, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Susuki: arching leaves and silky plumes bending with the wind.
  {
    const ox = q * 2;
    ctx.strokeStyle = 'rgb(110,130,70)';
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 14; i++) {
      const x = ox + q * 0.5 + (rnd() - 0.5) * 30;
      const lean = (rnd() - 0.5) * 220;
      ctx.beginPath();
      ctx.moveTo(x, q * 2);
      ctx.quadraticCurveTo(x + lean * 0.2, q * 1.3, x + lean * 0.5, q * 1.2 + rnd() * 90);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = ox + q * 0.5 + (i - 2) * 12 + (rnd() - 0.5) * 8;
      const tx = x + 30 + rnd() * 30;
      const ty = q + 20 + rnd() * 40;
      ctx.strokeStyle = 'rgb(150,140,100)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, q * 2);
      ctx.quadraticCurveTo(x, ty + 60, tx, ty);
      ctx.stroke();
      // plume: many fine hairs sweeping down to one side
      for (let h = 0; h < 40; h++) {
        const t2 = rnd();
        const sx = tx - 10 * t2;
        const sy = ty + t2 * 50;
        ctx.strokeStyle = `rgba(${225 + rnd() * 20},${210 + rnd() * 20},${180 + rnd() * 20},0.9)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + 10, sy + 6, sx + 14 + rnd() * 10, sy + 14 + rnd() * 10);
        ctx.stroke();
      }
    }
  }

  // White clover: low round heads and three-part leaves.
  {
    const ox = q * 3;
    for (let i = 0; i < 12; i++) {
      const x = ox + 20 + rnd() * (q - 40);
      const y = q * 2 - 10 - rnd() * 40;
      ctx.fillStyle = 'rgb(70,120,50)';
      for (let l = 0; l < 3; l++) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(l * 2.1) * 5, y + Math.sin(l * 2.1) * 5, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < 6; i++) {
      const x = ox + 30 + rnd() * (q - 60);
      const [hx, hy] = stem(x, q * 2 - 2, q * 2 - 70 - rnd() * 50, (rnd() - 0.5) * 10);
      for (let d = 0; d < 36; d++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 9;
        ctx.fillStyle = rnd() < 0.2 ? 'rgb(235,200,210)' : 'rgb(250,248,240)';
        ctx.beginPath();
        ctx.ellipse(hx + Math.cos(a) * r, hy + Math.sin(a) * r, 1.6, 2.6, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A single fern frond pointing up the texture, stalk at the bottom (photo, with alpha).
export function fernTexture() {
  const tex = loader.load(fernUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

