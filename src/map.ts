// The map: a small, see-through minimap with a compass in the corner while walking, and
// a full-screen map (M) where favourite places can be marked, given a short note and a
// colour, and jumped back to. North is -z, east is +x (the sun rises over +x).

import { HALF, brookEdgeDist, clearingFactor, forestDensity, waterLevel } from './world';
import { groundHeight, groundSlope } from './terrain';

export interface Pin {
  id: number;
  x: number;
  z: number;
  yaw: number;
  color: number;
  note: string;
}

export const PIN_COLORS = ['#e8574a', '#f0a830', '#f2e14c', '#5cc46a', '#4aa3e8', '#b07ce8', '#f4f2ec'];
const PINS_KEY = 'natural.pins.v1';
const MAP_PX = 400; // the whole world, 1.5 m per pixel
const MINI_RANGE = 70; // metres from the centre to the edge of the minimap

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadPins(): Pin[] {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    return raw ? (JSON.parse(raw) as Pin[]) : [];
  } catch {
    return [];
  }
}

function savePins(pins: Pin[]) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    // No storage (private window): the marks last until the page closes.
  }
}

// A shaded relief of the world: forest and meadow colours, grey crags, water in blue,
// contour lines every 10 m.
function paintWorld() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MAP_PX;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(MAP_PX, MAP_PX);
  const m = (HALF * 2) / MAP_PX;
  const h = new Float32Array(MAP_PX * MAP_PX);
  for (let j = 0; j < MAP_PX; j++)
    for (let i = 0; i < MAP_PX; i++) h[j * MAP_PX + i] = groundHeight(-HALF + (i + 0.5) * m, -HALF + (j + 0.5) * m);
  for (let j = 0; j < MAP_PX; j++) {
    for (let i = 0; i < MAP_PX; i++) {
      const x = -HALF + (i + 0.5) * m;
      const z = -HALF + (j + 0.5) * m;
      const c = h[j * MAP_PX + i];
      const e = h[j * MAP_PX + Math.min(MAP_PX - 1, i + 1)];
      const s = h[Math.min(MAP_PX - 1, j + 1) * MAP_PX + i];
      // Light from the north-west.
      const shade = Math.max(0.45, Math.min(1.25, 0.9 - ((e - c) + (s - c)) * 0.35 / m));
      const dens = forestDensity(x, z);
      const open = clearingFactor(x, z);
      let r = 150 - dens * 70;
      let g = 168 - dens * 50;
      let b = 108 - dens * 40;
      r += open * 40;
      g += open * 30;
      b += open * 10;
      const rock = Math.min(1, Math.max(0, (groundSlope(x, z) - 0.9) * 2));
      r += (140 - r) * rock;
      g += (136 - g) * rock;
      b += (126 - b) * rock;
      r *= shade;
      g *= shade;
      b *= shade;
      if (c < waterLevel(z) + 0.05 || brookEdgeDist(x, z) < 0.3) {
        r = 70;
        g = 140;
        b = 190;
      } else if (Math.floor(c / 10) !== Math.floor(e / 10) || Math.floor(c / 10) !== Math.floor(s / 10)) {
        r *= 0.72;
        g *= 0.72;
        b *= 0.72;
      }
      const k = (j * MAP_PX + i) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale: number, selected: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-3, -6, -8, -10, -8, -15);
  ctx.arc(0, -15, 8, Math.PI, 0);
  ctx.bezierCurveTo(8, -10, 3, -6, 0, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -15, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.75);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.7, size * 0.75);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  ctx.restore();
}

export interface MapHandlers {
  player: () => { x: number; z: number; yaw: number };
  jump: (pin: Pin) => void;
  opened: () => void;
  closed: () => void;
}

export function createMap(h: MapHandlers) {
  const world = paintWorld();
  const pins = loadPins();
  let nextId = pins.reduce((a, p) => Math.max(a, p.id), 0) + 1;

  // ---------- Minimap ----------
  const mini = $<HTMLCanvasElement>('mini');
  const mctx = mini.getContext('2d')!;
  const needle = $('needle');
  function drawMini() {
    const p = h.player();
    const W = mini.width;
    const scale = W / 2 / MINI_RANGE; // canvas px per metre
    mctx.clearRect(0, 0, W, W);
    mctx.save();
    mctx.beginPath();
    mctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    mctx.clip();
    // Heading up: turn the world so the way you face points up.
    mctx.translate(W / 2, W / 2);
    mctx.rotate(p.yaw);
    mctx.scale(scale, scale);
    mctx.translate(-p.x, -p.z);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(world, -HALF, -HALF, HALF * 2, HALF * 2);
    mctx.restore();
    // Marks, kept upright.
    for (const pin of pins) {
      const dx = pin.x - p.x;
      const dz = pin.z - p.z;
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      let sx = (dx * c - dz * s) * scale;
      let sy = (dx * s + dz * c) * scale;
      const l = Math.hypot(sx, sy);
      const R = W / 2 - 14;
      if (l > R) {
        sx *= R / l;
        sy *= R / l;
      }
      drawPin(mctx, W / 2 + sx, W / 2 + sy + 8, PIN_COLORS[pin.color], 1.1, false);
    }
    drawPlayer(mctx, W / 2, W / 2, 0, 11);
    // The compass needle points north, turning as you turn.
    needle.style.transform = `rotate(${p.yaw}rad)`;
  }

  // ---------- Full map ----------
  const mapEl = $('map');
  const canvas = $<HTMLCanvasElement>('map-canvas');
  const ctx = canvas.getContext('2d')!;
  const pop = $('pin-pop');
  const note = $<HTMLInputElement>('pin-note');
  const swatches = $('pin-swatches');
  let open = false;
  let zoom = 1;
  let cx = 0; // world point at the centre of the view
  let cz = 0;
  let selected: Pin | null = null;
  let base = 1; // px per metre at zoom 1

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    base = Math.min(canvas.width, canvas.height) / (HALF * 2);
  }
  const toScreen = (x: number, z: number) => {
    const k = base * zoom;
    return [canvas.width / 2 + (x - cx) * k, canvas.height / 2 + (z - cz) * k];
  };
  const toWorld = (sx: number, sy: number) => {
    const k = base * zoom;
    return [cx + (sx - canvas.width / 2) / k, cz + (sy - canvas.height / 2) / k];
  };
  const clampView = () => {
    const lim = HALF * (1 - 1 / zoom);
    cx = Math.max(-lim, Math.min(lim, cx));
    cz = Math.max(-lim, Math.min(lim, cz));
  };

  function draw() {
    if (!open) return;
    const dpr = canvas.width / canvas.getBoundingClientRect().width || 1;
    ctx.fillStyle = '#18201a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const [x0, y0] = toScreen(-HALF, -HALF);
    const size = HALF * 2 * base * zoom;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(world, x0, y0, size, size);
    // A compass rose in the corner: north is up on this map.
    ctx.save();
    ctx.translate(canvas.width - 40 * dpr, 40 * dpr);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = 'rgba(10,14,10,0.45)';
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(6, 0);
    ctx.lineTo(-6, 0);
    ctx.fillStyle = '#e8574a';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(6, 0);
    ctx.lineTo(-6, 0);
    ctx.fillStyle = '#f2f1ea';
    ctx.fill();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('N', 0, -27);
    ctx.restore();
    // Marks with their notes.
    ctx.font = `${12 * dpr}px 'Hiragino Sans','Noto Sans JP',system-ui,sans-serif`;
    ctx.textAlign = 'left';
    for (const pin of pins) {
      const [sx, sy] = toScreen(pin.x, pin.z);
      drawPin(ctx, sx, sy, PIN_COLORS[pin.color], 1.2 * dpr, pin === selected);
      if (pin.note) {
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeText(pin.note, sx + 12 * dpr, sy - 14 * dpr);
        ctx.fillStyle = '#fff';
        ctx.fillText(pin.note, sx + 12 * dpr, sy - 14 * dpr);
      }
    }
    const p = h.player();
    const [px, py] = toScreen(p.x, p.z);
    // Facing (-sin yaw, -cos yaw) in world; on the map that is the angle -yaw from up.
    drawPlayer(ctx, px, py, -p.yaw, 10 * dpr);
    if (selected) placePop();
  }

  function placePop() {
    if (!selected) return;
    const dpr = canvas.width / canvas.getBoundingClientRect().width || 1;
    const [sx, sy] = toScreen(selected.x, selected.z);
    const r = canvas.getBoundingClientRect();
    const fr = mapEl.querySelector('.map-frame')!.getBoundingClientRect();
    const left = Math.min(fr.width - pop.offsetWidth - 8, Math.max(8, r.left - fr.left + sx / dpr - pop.offsetWidth / 2));
    let top = r.top - fr.top + sy / dpr + 10;
    if (top + pop.offsetHeight > fr.height - 8) top = r.top - fr.top + sy / dpr - 40 - pop.offsetHeight;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(8, top)}px`;
  }

  function select(pin: Pin | null) {
    selected = pin;
    pop.hidden = !pin;
    swatches.hidden = true;
    if (pin) {
      note.value = pin.note;
      placePop();
    }
    draw();
  }

  function addHere() {
    const p = h.player();
    const pin: Pin = { id: nextId++, x: p.x, z: p.z, yaw: p.yaw, color: pins.length % PIN_COLORS.length, note: '' };
    pins.push(pin);
    savePins(pins);
    select(pin);
    note.focus();
  }

  // Swatches for picking a colour.
  PIN_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.title = `色 ${i + 1}`;
    b.addEventListener('click', () => {
      if (!selected) return;
      selected.color = i;
      savePins(pins);
      swatches.hidden = true;
      draw();
    });
    swatches.appendChild(b);
  });

  note.addEventListener('input', () => {
    if (!selected) return;
    selected.note = note.value.slice(0, 12);
    savePins(pins);
    draw();
  });
  note.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') note.blur();
  });
  $('pin-go').addEventListener('click', () => {
    if (!selected) return;
    const pin = selected;
    close();
    h.jump(pin);
  });
  $('pin-color').addEventListener('click', () => {
    swatches.hidden = !swatches.hidden;
    placePop();
  });
  $('pin-del').addEventListener('click', () => {
    if (!selected) return;
    pins.splice(pins.indexOf(selected), 1);
    savePins(pins);
    select(null);
  });
  $('map-add').addEventListener('click', addHere);
  $('map-close').addEventListener('click', () => close());

  // Mouse and touch: drag to pan, wheel to zoom, tap a mark to select it.
  let drag: { id: number; x: number; y: number; moved: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dpr = canvas.width / canvas.getBoundingClientRect().width || 1;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    cx -= (dx * dpr) / (base * zoom);
    cz -= (dy * dpr) / (base * zoom);
    clampView();
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (moved > 6) return;
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width || 1;
    const sx = (e.clientX - r.left) * dpr;
    const sy = (e.clientY - r.top) * dpr;
    let best: Pin | null = null;
    let bd = 22 * dpr;
    for (const pin of pins) {
      const [px, py] = toScreen(pin.x, pin.z);
      const d = Math.hypot(px - sx, py - 15 * dpr - sy);
      if (d < bd) {
        bd = d;
        best = pin;
      }
    }
    select(best);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const dpr = canvas.width / r.width || 1;
      const [wx, wz] = toWorld((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
      zoom = Math.max(1, Math.min(8, zoom * Math.exp(-e.deltaY * 0.0015)));
      // Keep the point under the mouse where it is.
      const k = base * zoom;
      cx = wx - ((e.clientX - r.left) * dpr - canvas.width / 2) / k;
      cz = wz - ((e.clientY - r.top) * dpr - canvas.height / 2) / k;
      clampView();
      draw();
    },
    { passive: false },
  );
  window.addEventListener('resize', () => {
    if (!open) return;
    resize();
    draw();
  });

  function show() {
    if (open) return;
    open = true;
    mapEl.hidden = false;
    document.body.classList.add('map-open');
    const p = h.player();
    zoom = 2;
    cx = p.x;
    cz = p.z;
    resize();
    clampView();
    select(null);
    h.opened();
  }

  function close() {
    if (!open) return;
    open = false;
    note.blur();
    mapEl.hidden = true;
    document.body.classList.remove('map-open');
    select(null);
    h.closed();
  }

  return {
    get open() {
      return open;
    },
    toggle() {
      if (open) close();
      else show();
    },
    close,
    update() {
      drawMini();
      draw();
    },
  };
}
