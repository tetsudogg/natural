// A two-person dome tent in olive green: pitch it with P, crawl in with E and look
// out through the open door, sleep until morning. At night a lantern inside makes
// the fabric glow.

import * as THREE from 'three';
import { groundHeight, groundSlope } from './terrain';
import { streamDist } from './world';
import { mulberry32 } from './noise';

export interface TentSave {
  x: number;
  z: number;
  yaw: number;
}

// Footprint of the fly sheet (local x = width, local z = depth; the door faces +z).
const HALF_W = 1.2;
const HALF_D = 1.0;
const HEIGHT = 1.15;
const VESTIBULE = 0.55;
const PITCH_SECONDS = 3.2;

// ---------- Fabric ----------

// Olive ripstop: a fine grid of heavier threads, slight mottling and darker seams.
function fabricTexture(base: [number, number, number], seed: number) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  ctx.fillStyle = `rgb(${base.join(',')})`;
  ctx.fillRect(0, 0, size, size);
  // Mottling from creases and weathering.
  for (let i = 0; i < 260; i++) {
    const r = 10 + rnd() * 50;
    const v = (rnd() - 0.5) * 22;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(${v > 0 ? '255,255,240' : '0,0,0'},${Math.abs(v) / 255})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(rnd() * size, rnd() * size);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  // Ripstop grid.
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i < size; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, size);
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(size, i + 0.5);
    ctx.stroke();
  }
  // Fine weave.
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// The dome: an elliptical shell. The fabric sags between the two crossing poles,
// and at the front it runs out into a vestibule over the door.
// u goes round the base (0 = right, PI/2 = front), v from the ground (0) to the top (1).
function domePoint(u: number, v: number, inset: number, out: THREE.Vector3) {
  const phi = v * Math.PI * 0.5;
  // Poles run along the diagonals; the fabric sags most halfway between them.
  const sag = 0.13 * Math.pow(Math.cos(2 * u), 2) * Math.sin(phi * 2);
  const r = Math.cos(phi) * (1 - sag);
  let x = Math.cos(u) * (HALF_W - inset) * r;
  let z = Math.sin(u) * (HALF_D - inset) * r;
  let y = Math.sin(phi) * (HEIGHT - inset) * (1 - sag * 0.4);
  if (inset === 0) {
    // Vestibule: the fly reaches forward low down at the front.
    const front = Math.exp(-Math.pow((u - Math.PI / 2) / 0.55, 2));
    z += front * VESTIBULE * Math.pow(1 - v, 1.6);
    x *= 1 - front * 0.25 * (1 - v);
  }
  // A little tension droop right at the hem, pegged to the ground.
  y = Math.max(0, y);
  out.set(x, y, z);
  return out;
}

function domeGeometry(inset: number, segU = 72, segV = 20) {
  const pos: number[] = [];
  const uv: number[] = [];
  const uvRaw: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= segV; j++) {
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * Math.PI * 2;
      const v = j / segV;
      domePoint(u, v, inset, p);
      pos.push(p.x, p.y, p.z);
      // Fabric texture laid on roughly by surface distance.
      uv.push((i / segU) * 6, v * 2.2);
      uvRaw.push(u, v);
    }
  }
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * (segU + 1) + i;
      const b = a + segU + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uvRaw', new THREE.Float32BufferAttribute(uvRaw, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Shared uniforms for the tent fabric.
const fabricUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.5 },
  uLantern: { value: 0 },
  uDoor: { value: 1 }, // 1 = door rolled open
};

function fabricMaterial(map: THREE.Texture, fly: boolean) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.85, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fabricUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uvRaw;\nvarying vec2 vRaw;\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRaw = uvRaw;
        {
          // Panels between the poles breathe and flap a little in the wind;
          // the poles, the hem and the top stay put.
          float free = pow(cos(2.0 * uvRaw.x), 2.0) * sin(uvRaw.y * 3.1416);
          float w = sin(uTime * 2.3 + uvRaw.x * 3.0) * 0.6 + sin(uTime * 5.1 + uvRaw.y * 7.0 + uvRaw.x) * 0.4;
          transformed += normal * w * free * (0.004 + uWind * 0.018);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRaw;\nuniform float uLantern;\nuniform float uDoor;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float du = vRaw.x - 1.5708;
          ${
            fly
              ? `// The door: a rounded opening at the front, rolled up when open.
          float door = step(abs(du), 0.55 * (1.0 - smoothstep(0.0, 0.8, vRaw.y) * 0.5)) * step(vRaw.y, 0.78);
          if (door * uDoor > 0.5) discard;
          // Zip line and stitched seams along the pole sleeves.
          float zip = smoothstep(0.012, 0.0, abs(abs(du) - 0.55 * (1.0 - smoothstep(0.0, 0.8, vRaw.y) * 0.5))) * step(vRaw.y, 0.8);
          float seam = smoothstep(0.02, 0.0, abs(cos(2.0 * vRaw.x))) * step(0.05, vRaw.y);
          diffuseColor.rgb *= 1.0 - zip * 0.6 - seam * 0.25;
          // Hem and bottom edge darker with dirt.
          diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.12, vRaw.y));`
              : `// Inner tent: the same doorway, and a darker floor tub low down.
          float door = step(abs(du), 0.53 * (1.0 - smoothstep(0.0, 0.8, vRaw.y) * 0.5)) * step(vRaw.y, 0.76);
          if (door * uDoor > 0.5) discard;
          diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(0.02, 0.14, vRaw.y));`
          }
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Lantern light shining through the fabric, strongest high up near it.
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.62, 0.3) * uLantern * ${fly ? '1.2' : '2.4'} * (0.35 + 0.65 * smoothstep(0.0, 0.9, vRaw.y));`,
      );
  };
  return mat;
}

// A tube following a list of points.
function tube(points: THREE.Vector3[], radius: number, mat: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 40, radius, 6, false), mat);
}

function buildTent() {
  const group = new THREE.Group();
  const flyMat = fabricMaterial(fabricTexture([112, 110, 66], 3), true);
  const innerMat = fabricMaterial(fabricTexture([196, 190, 170], 4), false);
  const fly = new THREE.Mesh(domeGeometry(0), flyMat);
  fly.castShadow = true;
  fly.receiveShadow = true;
  const inner = new THREE.Mesh(domeGeometry(0.1, 48, 14), innerMat);
  inner.receiveShadow = true;
  group.add(fly, inner);

  // Pole sleeves on the outside, crossing at the top.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2e24, roughness: 0.6 });
  const p = new THREE.Vector3();
  for (const u0 of [Math.PI / 4, (3 * Math.PI) / 4]) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const u = t < 0.5 ? u0 : u0 + Math.PI;
      const v = t < 0.5 ? t * 2 : (1 - t) * 2;
      domePoint(u, Math.min(0.999, v), 0, p);
      pts.push(p.clone().multiplyScalar(1.012).setY(p.y + 0.012));
    }
    group.add(tube(pts, 0.02, poleMat));
  }

  // Groundsheet floor.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40).scale(HALF_W - 0.1, HALF_D - 0.1, 1).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
    new THREE.MeshStandardMaterial({ color: 0x3e4230, roughness: 0.9 }),
  );
  floor.receiveShadow = true;
  group.add(floor);

  // The door panel rolled up above the opening, tied with two toggles.
  const roll = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.42, 4, 10).rotateZ(Math.PI / 2), flyMat);
  domePoint(Math.PI / 2, 0.8, 0, p);
  roll.position.set(0, p.y + 0.02, p.z + 0.03);
  group.add(roll);

  // Guy lines out to pegs.
  const lineMat = new THREE.LineBasicMaterial({ color: 0x2e3026 });
  const pegMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, metalness: 0.6, roughness: 0.4 });
  const linePts: number[] = [];
  const pegs = new THREE.Group();
  const rnd = mulberry32(12);
  for (const u of [0, Math.PI, -Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const diag = Math.abs(Math.cos(2 * u)) < 0.1;
    // Hem pegs at the pole feet; guy lines from the panels.
    domePoint(u, diag ? 0 : 0.55, 0, p);
    const out = new THREE.Vector3(Math.cos(u), 0, Math.sin(u) * (u === Math.PI / 2 ? 1.6 : 1));
    const peg = diag ? p.clone() : p.clone().setY(0).addScaledVector(out, 0.75 + rnd() * 0.1);
    if (!diag) linePts.push(p.x, p.y, p.z, peg.x, 0.04, peg.z);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.12, 5), pegMat);
    m.position.set(peg.x, 0.03, peg.z);
    m.rotation.z = 0.35;
    m.rotation.y = u;
    pegs.add(m);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  group.add(lines, pegs);

  // Inside: a sleeping bag, a folded blanket as pillow, the backpack and a lantern.
  const bag = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 1.2, 6, 14).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.32, 1),
    new THREE.MeshStandardMaterial({ color: 0x3d4f66, roughness: 0.75 }),
  );
  bag.position.set(0.35, 0.09, -0.05);
  const bag2 = bag.clone();
  bag2.material = new THREE.MeshStandardMaterial({ color: 0x7a3b2a, roughness: 0.75 });
  bag2.position.x = -0.38;
  bag2.rotation.y = 0.06;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.48, 0.2), new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.85 }));
  pack.position.set(-0.75, 0.24, -0.35);
  pack.rotation.set(-0.25, 0.5, 0);
  const lanternBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.14, 12),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb060, emissiveIntensity: 0, roughness: 0.4 }),
  );
  lanternBody.position.set(0.15, HEIGHT - 0.32, -0.62);
  group.add(bag, bag2, pack, lanternBody);
  for (const o of [bag, bag2, pack]) {
    o.castShadow = false;
    o.receiveShadow = true;
  }

  return { group, lanternBody, lines, pegs };
}

// ---------- Tent in the world ----------

export function createTent(saved: TentSave | undefined, trees: { x: number; z: number }[]) {
  const built = buildTent();
  const tent = built.group;
  tent.visible = false;
  const root = new THREE.Group();
  root.add(tent);

  // The ghost shown while choosing where to pitch.
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  const ghost = new THREE.Mesh(domeGeometry(0, 36, 10), ghostMat);
  ghost.visible = false;
  root.add(ghost);

  // Lantern light: always in the scene (so nothing recompiles), dark by day.
  const light = new THREE.PointLight(0xffa860, 0, 9, 1.8);
  light.castShadow = false;

  let state: TentSave | null = saved ?? null;
  let placing = false;
  let placeOk = false;
  let placeWhy = '';
  let pitch = 1; // 0..1 while the tent goes up
  let packConfirmUntil = 0;
  let inside = false;
  let lookYaw = 0;
  let lookPitch = -0.08;
  const ghostPos = new THREE.Vector3();
  let ghostYaw = 0;

  function place() {
    if (!state) {
      tent.visible = false;
      return;
    }
    tent.visible = true;
    tent.position.set(state.x, groundHeight(state.x, state.z) - 0.02, state.z);
    tent.rotation.y = state.yaw;
    light.position.set(state.x, tent.position.y + HEIGHT - 0.35, state.z);
  }
  place();

  // Local coordinates of a world point in the tent's frame.
  function local(x: number, z: number) {
    if (!state) return null;
    const dx = x - state.x;
    const dz = z - state.z;
    const c = Math.cos(-state.yaw);
    const s = Math.sin(-state.yaw);
    return { x: dx * c + dz * s, z: -dx * s + dz * c };
  }

  function doorDistance(pos: THREE.Vector3) {
    const l = local(pos.x, pos.z);
    if (!l) return Infinity;
    return Math.hypot(l.x, l.z - (HALF_D + VESTIBULE + 0.4));
  }

  function check(x: number, z: number): string {
    if (streamDist(x, z) < 6) return '水辺からもう少し離れてください';
    if (api.avoid) {
      const a = api.avoid();
      if (a && Math.hypot(a.x - x, a.z - z) < 3.2) return '焚き火から少し離してください';
    }
    let slope = 0;
    for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) slope = Math.max(slope, groundSlope(x + ox, z + oz));
    if (slope > 0.3) return 'もう少し平らな場所を選んでください';
    for (const t of trees) if (Math.abs(t.x - x) < 3 && Math.abs(t.z - z) < 3 && Math.hypot(t.x - x, t.z - z) < 2.1) return '木が近すぎます';
    return '';
  }

  const api = {
    // Somewhere the tent must keep clear of (the campfire), set by the game.
    avoid: null as null | (() => { x: number; z: number } | null),
    group: root,
    light,
    get pitched() {
      return !!state;
    },
    get inside() {
      return inside;
    },
    get placing() {
      return placing;
    },
    // Where plants should be cleared (x, z, radius), or null.
    get clearing() {
      return state ? { x: state.x, z: state.z, r: 1.45 } : null;
    },
    save(): TentSave | null {
      return state;
    },
    // Does the tent block walking into (x, z)?
    blocks(x: number, z: number) {
      const l = local(x, z);
      if (!l || inside) return false;
      return (l.x / (HALF_W + 0.15)) ** 2 + (l.z / (HALF_D + 0.15)) ** 2 < 1;
    },
    hint(pos: THREE.Vector3): string | null {
      if (inside) return 'E：寝る（朝まで）　W：外に出る';
      if (placing) return placeOk ? 'P：ここに張る　Esc：やめる' : `${placeWhy}（Esc：やめる）`;
      if (state && pitch >= 1 && doorDistance(pos) < 1.3) return 'E：テントに入る　P：たたむ';
      return null;
    },
    // P: start choosing a spot, pitch it there, or pack the tent away.
    pressP(pos: THREE.Vector3, time: number): string | null {
      if (inside) return null;
      if (placing) {
        if (!placeOk) return placeWhy;
        placing = false;
        ghost.visible = false;
        state = { x: ghostPos.x, z: ghostPos.z, yaw: ghostYaw };
        pitch = 0;
        place();
        return 'テントを張っています…';
      }
      if (state && doorDistance(pos) < 2.5) {
        if (time < packConfirmUntil) {
          state = null;
          place();
          return 'テントをたたんでリュックにしまいました';
        }
        packConfirmUntil = time + 3;
        return 'もう一度 P でテントをたたみます';
      }
      if (state) return 'テントは別の場所に張ってあります（近くで P を2回押すとたためます）';
      placing = true;
      return '張る場所を選んでください';
    },
    // Pitch straight away in front of the player (for testing).
    debugPitch(pos: THREE.Vector3, yaw: number, turn: number, goInside: boolean) {
      const d = HALF_D + 2.2;
      state = { x: pos.x - Math.sin(yaw) * d, z: pos.z - Math.cos(yaw) * d, yaw: yaw + turn };
      pitch = 1;
      place();
      inside = goInside;
    },
    cancel() {
      placing = false;
      ghost.visible = false;
    },
    // E by the door: crawl in. Returns true if we went in.
    enter(pos: THREE.Vector3) {
      if (!state || pitch < 1 || doorDistance(pos) > 1.3) return false;
      inside = true;
      lookYaw = 0;
      lookPitch = -0.08;
      return true;
    },
    // Leave through the door; returns where to stand, facing away from the tent.
    exit() {
      inside = false;
      if (!state) return null;
      const d = HALF_D + VESTIBULE + 0.7;
      return { x: state.x + Math.sin(state.yaw) * d, z: state.z + Math.cos(state.yaw) * d, yaw: state.yaw + Math.PI };
    },
    look(dx: number, dy: number) {
      lookYaw = THREE.MathUtils.clamp(lookYaw - dx * 0.0022, -1.1, 1.1);
      lookPitch = THREE.MathUtils.clamp(lookPitch - dy * 0.0022, -0.6, 0.5);
    },
    // Sitting at the back of the tent, looking out of the door.
    applyInsideCamera(cam: THREE.PerspectiveCamera) {
      if (!state) return;
      const eye = new THREE.Vector3(0, 0.72, -0.35).applyAxisAngle(THREE.Object3D.DEFAULT_UP, state.yaw).add(tent.position);
      const yaw = state.yaw + Math.PI + lookYaw;
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(lookPitch), Math.sin(lookPitch), -Math.cos(yaw) * Math.cos(lookPitch));
      cam.position.copy(eye);
      cam.lookAt(eye.add(dir));
    },
    update(time: number, dt: number, player: { position: THREE.Vector3; yaw: number }, wind: number, night: number) {
      fabricUniforms.uTime.value = time;
      fabricUniforms.uWind.value = wind;
      // The lantern comes on at dusk.
      const lantern = state && pitch >= 1 ? THREE.MathUtils.smoothstep(night, 0.15, 0.6) : 0;
      fabricUniforms.uLantern.value = lantern * 0.55;
      light.intensity = lantern * 2.2 * (0.97 + 0.03 * Math.sin(time * 7.3));
      (built.lanternBody.material as THREE.MeshStandardMaterial).emissiveIntensity = lantern * 3;

      // Pitching: pegs first, then the poles lift the fabric up into shape.
      if (state && pitch < 1) {
        pitch = Math.min(1, pitch + dt / PITCH_SECONDS);
        const t = THREE.MathUtils.smoothstep(pitch, 0.15, 1);
        const over = Math.sin(t * Math.PI) * 0.06;
        tent.scale.set(1 + (1 - t) * 0.15, Math.max(0.02, t + over), 1 + (1 - t) * 0.15);
        built.lines.visible = pitch > 0.9;
      } else {
        tent.scale.set(1, 1, 1);
        built.lines.visible = true;
      }

      if (placing) {
        const d = HALF_D + 1.6;
        ghostPos.set(player.position.x - Math.sin(player.yaw) * d, 0, player.position.z - Math.cos(player.yaw) * d);
        ghostPos.y = groundHeight(ghostPos.x, ghostPos.z);
        // The door faces back toward the player.
        ghostYaw = player.yaw;
        ghost.position.copy(ghostPos);
        ghost.rotation.y = ghostYaw;
        placeWhy = check(ghostPos.x, ghostPos.z);
        placeOk = !placeWhy;
        ghostMat.color.set(placeOk ? 0x66ff88 : 0xff6655);
        ghostMat.opacity = 0.22 + 0.06 * Math.sin(time * 4);
        ghost.visible = true;
      }
    },
  };
  return api;
}
