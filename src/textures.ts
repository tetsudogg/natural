// Textures drawn at startup, so the game needs no image downloads.

import * as THREE from 'three';
import { mulberry32 } from './noise';

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

// Grey speckle that breaks up the flat vertex colours of the ground.
export function groundDetailTexture() {
  const size = 256;
  const rnd = mulberry32(11);
  const base = tileNoise(size, 3, 40, 24);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 0.72 + base[i] * 0.22 + (rnd() - 0.5) * 0.16;
    const c = Math.max(0, Math.min(255, v * 255));
    img.data[i * 4] = c;
    img.data[i * 4 + 1] = c;
    img.data[i * 4 + 2] = c;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
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
export function foliageTexture(kind: 'leaf' | 'needle', seed: number) {
  const size = 256;
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  if (kind === 'leaf') {
    // A few twigs, each carrying oval leaves.
    for (let b = 0; b < 7; b++) {
      const a = rnd() * Math.PI * 2;
      const len = size * (0.25 + rnd() * 0.2);
      ctx.strokeStyle = 'rgb(70,55,35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
      for (let i = 0; i < 16; i++) {
        const t = 0.15 + rnd() * 0.85;
        const px = cx + Math.cos(a) * len * t + (rnd() - 0.5) * 30;
        const py = cy + Math.sin(a) * len * t + (rnd() - 0.5) * 30;
        const l = 55 + rnd() * 45;
        const g = 110 + rnd() * 70;
        ctx.fillStyle = `rgb(${l * 0.8},${g},${l * 0.35})`;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a + (rnd() - 0.5) * 1.8);
        ctx.beginPath();
        ctx.ellipse(0, 0, 13 + rnd() * 6, 6 + rnd() * 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,220,0.12)';
        ctx.beginPath();
        ctx.ellipse(-3, -2, 7, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  } else {
    // Cedar sprays: dense short strokes along forking stems.
    for (let b = 0; b < 9; b++) {
      const a = rnd() * Math.PI * 2;
      const len = size * (0.28 + rnd() * 0.18);
      for (let i = 0; i < 140; i++) {
        const t = rnd();
        const px = cx + Math.cos(a) * len * t + (rnd() - 0.5) * 16 * (1 - t * 0.5);
        const py = cy + Math.sin(a) * len * t + (rnd() - 0.5) * 16 * (1 - t * 0.5);
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
