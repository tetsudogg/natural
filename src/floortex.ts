// Painted textures for the forest-floor plants and mushrooms of a Japanese mountain:
// bamboo grass (sasa), butterbur (fuki) and the caps of a few kinds of mushroom.

import * as THREE from 'three';
import { mulberry32 } from './noise';

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Four sasa leaves side by side (64 x 256 each), tip up. Long, pointed, glossy, with a
// pale midrib; two of them have the dry, straw-coloured margins sasa gets in the mountains.
export function sasaTexture() {
  return canvasTexture(256, 256, (ctx) => {
    const rnd = mulberry32(8);
    for (let i = 0; i < 4; i++) {
      const cx = i * 64 + 32;
      const w = 13 + rnd() * 4;
      const leaf = new Path2D();
      leaf.moveTo(cx, 4);
      leaf.bezierCurveTo(cx + w * 0.9, 60, cx + w, 170, cx + 2, 250);
      leaf.lineTo(cx - 2, 250);
      leaf.bezierCurveTo(cx - w, 170, cx - w * 0.9, 60, cx, 4);
      const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
      const base = 0.85 + rnd() * 0.25;
      const c = (r: number, gg: number, b: number) => `rgb(${Math.round(r * base)},${Math.round(gg * base)},${Math.round(b * base)})`;
      g.addColorStop(0, c(46, 82, 28));
      g.addColorStop(0.5, c(70, 112, 38));
      g.addColorStop(1, c(40, 74, 26));
      ctx.fillStyle = g;
      ctx.fill(leaf);
      ctx.save();
      ctx.clip(leaf);
      // Fine parallel veins, then the midrib.
      ctx.strokeStyle = 'rgba(20,40,10,0.25)';
      ctx.lineWidth = 0.8;
      for (let v = -3; v <= 3; v++) {
        if (!v) continue;
        ctx.beginPath();
        ctx.moveTo(cx + v * 3, 30);
        ctx.quadraticCurveTo(cx + v * 4, 150, cx + v * 1.2, 248);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(190,210,140,0.7)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, 10);
      ctx.lineTo(cx, 250);
      ctx.stroke();
      if (i % 2 === 1) {
        ctx.strokeStyle = 'rgba(214,196,140,0.95)';
        ctx.lineWidth = 5;
        ctx.stroke(leaf);
      }
      ctx.restore();
    }
  });
}

// A butterbur leaf seen from above, filling the texture: round with a deep notch where
// the stalk joins, fine teeth along the edge and veins fanning out from the notch.
export function fukiTexture() {
  return canvasTexture(256, 256, (ctx) => {
    const rnd = mulberry32(19);
    const cx = 128;
    const cy = 128;
    const leaf = new Path2D();
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      // The notch points to +y (toward the stalk).
      const notch = Math.max(0, Math.cos(a - Math.PI / 2)) ** 18;
      const r = 122 * (1 - notch * 0.85) - (i % 3 === 0 ? 3 : 0) + Math.sin(a * 7) * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) leaf.moveTo(x, y);
      else leaf.lineTo(x, y);
    }
    leaf.closePath();
    const g = ctx.createRadialGradient(cx, cy + 40, 10, cx, cy, 130);
    g.addColorStop(0, 'rgb(122,160,70)');
    g.addColorStop(1, 'rgb(76,118,46)');
    ctx.fillStyle = g;
    ctx.fill(leaf);
    ctx.save();
    ctx.clip(leaf);
    ctx.strokeStyle = 'rgba(200,225,150,0.55)';
    for (let v = 0; v < 11; v++) {
      const a = Math.PI / 2 + Math.PI * 0.12 + (v / 10) * Math.PI * 1.76;
      ctx.lineWidth = v === 5 ? 2.5 : 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 14);
      const bend = (rnd() - 0.5) * 0.15;
      ctx.quadraticCurveTo(cx + Math.cos(a + bend) * 60, cy + Math.sin(a + bend) * 60, cx + Math.cos(a) * 125, cy + Math.sin(a) * 125);
      ctx.stroke();
    }
    // Blotches of sun and shade.
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${rnd() < 0.5 ? '30,50,20' : '180,200,120'},0.06)`;
      ctx.beginPath();
      ctx.arc(rnd() * 256, rnd() * 256, 8 + rnd() * 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

export const MUSHROOM_CELLS = 5;
// Mushroom caps seen from above, one per 128 x 128 cell:
// 0 red with white warts (fly agaric), 1 brown, 2 glossy orange (nameko),
// 3 a shelf fungus with growth bands, 4 plain cream (white mushrooms and all stems).
export function mushroomTexture() {
  return canvasTexture(128 * MUSHROOM_CELLS, 128, (ctx) => {
    const rnd = mulberry32(31);
    const disc = (i: number, inner: string, outer: string) => {
      const g = ctx.createRadialGradient(i * 128 + 64, 64, 4, i * 128 + 64, 64, 64);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.fillStyle = g;
      ctx.fillRect(i * 128, 0, 128, 128);
    };
    disc(0, 'rgb(150,20,12)', 'rgb(214,70,30)');
    for (let k = 0; k < 40; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 54;
      ctx.fillStyle = 'rgba(245,238,220,0.95)';
      ctx.beginPath();
      ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + rnd() * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    disc(1, 'rgb(92,62,36)', 'rgb(176,140,96)');
    disc(2, 'rgb(150,70,20)', 'rgb(214,140,60)');
    // Shelf fungus: concentric growth bands, a pale growing rim.
    for (let r = 64; r > 0; r -= 4) {
      const t = r / 64;
      const shade = 0.7 + 0.3 * Math.sin(r * 0.9) * 0.5 + rnd() * 0.1;
      const col = t > 0.9 ? [226, 212, 180] : [120 * shade, 88 * shade, 56 * shade];
      ctx.fillStyle = `rgb(${col.map(Math.round).join(',')})`;
      ctx.beginPath();
      ctx.arc(3 * 128 + 64, 64, r, 0, Math.PI * 2);
      ctx.fill();
    }
    disc(4, 'rgb(236,228,206)', 'rgb(222,212,186)');
  });
}
