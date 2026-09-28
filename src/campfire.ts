// Branches lying on the forest floor, and a campfire built from them.
// Pick up branches with E, build a fire with B once you have five, and feed it with E.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, forestDensity, streamDist } from './world';
import { groundHeight, groundSlope } from './terrain';
import { mulberry32 } from './noise';
import { surface } from './textures';

export const BRANCHES_TO_BUILD = 5;
export const PACK_MAX = 20;
const FIRE_MAX_FUEL = 8; // game hours of fuel the fire can hold
const HOURS_PER_BRANCH = 0.75; // one branch burns about 45 game minutes
const EMBER_HOURS = 1; // embers glow this long after the flames die

// ---------- Branches on the ground ----------

// A fallen branch: a crooked stick with a side twig or two.
function branchGeometry(seed: number) {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const len = 0.9 + rnd() * 0.6;
  const main = new THREE.CylinderGeometry(0.018, 0.03, len, 6, 4);
  main.rotateZ(Math.PI / 2);
  const p = main.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + Math.sin(p.getX(i) * 3 + seed) * 0.04);
  parts.push(main);
  for (let t = 0; t < 1 + Math.floor(rnd() * 2); t++) {
    const tl = 0.2 + rnd() * 0.25;
    const twig = new THREE.CylinderGeometry(0.007, 0.012, tl, 5);
    twig.translate(0, tl / 2, 0);
    twig.rotateZ(-Math.PI / 2 + 0.6 + rnd() * 0.4);
    twig.rotateY((rnd() - 0.5) * 1.2);
    twig.translate((rnd() - 0.5) * len * 0.6, 0, 0);
    parts.push(twig);
  }
  const g = mergeGeometries(parts.map((x) => x.toNonIndexed()))!;
  g.translate(0, 0.025, 0);
  return g;
}

interface Branch {
  x: number;
  z: number;
  taken: boolean;
}

function createBranches(barkMat: THREE.Material) {
  const rnd = mulberry32(404);
  const list: Branch[] = [];
  for (let tries = 0; list.length < 900 && tries < 20000; tries++) {
    const x = (rnd() * 2 - 1) * (HALF - 10);
    const z = (rnd() * 2 - 1) * (HALF - 10);
    const f = forestDensity(x, z);
    if (rnd() > f * f || streamDist(x, z) < 6) continue;
    list.push({ x, z, taken: false });
  }
  const kinds = [branchGeometry(1), branchGeometry(2), branchGeometry(3)];
  const meshes = kinds.map((g) => new THREE.InstancedMesh(g, barkMat, list.length));
  const slot: { mesh: number; index: number }[] = [];
  const counts = [0, 0, 0];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  list.forEach((b, i) => {
    const k = i % 3;
    const y = groundHeight(b.x, b.z);
    q.setFromEuler(e.set((rnd() - 0.5) * 0.15, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.15));
    meshes[k].setMatrixAt(counts[k], m.compose(new THREE.Vector3(b.x, y, b.z), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.85 + rnd() * 0.4)));
    slot.push({ mesh: k, index: counts[k]++ });
  });
  meshes.forEach((mesh, k) => {
    mesh.count = counts[k];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  const group = new THREE.Group();
  group.add(...meshes);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  return {
    group,
    // The nearest branch still lying within reach, or -1.
    nearest(pos: THREE.Vector3, reach: number) {
      let best = -1;
      let bestD = reach;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.taken) continue;
        const d = Math.hypot(b.x - pos.x, b.z - pos.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    take(i: number) {
      list[i].taken = true;
      const s = slot[i];
      meshes[s.mesh].setMatrixAt(s.index, hidden);
      meshes[s.mesh].instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- Fire ----------

const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A flame drawn from rising, stretched noise: hot white-yellow at the core,
// orange and red toward the ragged edges and tip.
const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform float uSeed;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 uv = vUv;
    float t = uTime * 1.6 + uSeed * 10.0;
    // Flicker sideways more toward the top.
    uv.x += (fbm(vec2(uv.y * 3.0 - t, uSeed)) - 0.5) * 0.35 * uv.y;
    float n = fbm(vec2(uv.x * 4.0 + uSeed, uv.y * 3.0 - t * 1.4));
    // Teardrop: wide at the bottom, narrowing to a tip.
    float width = mix(0.46, 0.07, pow(uv.y, 0.9));
    float d = abs(uv.x - 0.5) / width;
    float body = (1.0 - d) * (1.0 - uv.y * 0.85) + (n - 0.5) * 0.9;
    float a = smoothstep(0.0, 0.35, body) * smoothstep(0.0, 0.08, uv.y) * uPower;
    float heat = clamp(body * 1.3 + 0.2 - uv.y * 0.5, 0.0, 1.0);
    vec3 col = mix(vec3(0.9, 0.18, 0.02), vec3(1.0, 0.55, 0.1), smoothstep(0.1, 0.5, heat));
    col = mix(col, vec3(1.0, 0.92, 0.65), smoothstep(0.6, 1.0, heat));
    gl_FragColor = vec4(col * (1.6 + heat * 2.0) * a * (uSeed > 0.2 ? 0.7 : 1.0), a);
  }
`;

const PARTICLE_VERT = /* glsl */ `
  attribute float seed;
  uniform float uTime;
  uniform float uPower;
  uniform float uSmoke;
  varying float vLife;
  varying float vSeed;
  void main() {
    // Each particle loops: rises from the fire, drifts, fades, and starts again.
    float life = fract(uTime * (uSmoke > 0.5 ? 0.07 : 0.45) * (0.7 + seed * 0.6) + seed * 13.7);
    vLife = life;
    vSeed = seed;
    vec3 p = position;
    float rise = uSmoke > 0.5 ? 0.3 + life * 7.0 : life * (1.4 + seed * 1.6);
    p.y += rise;
    // Wander and a steady drift with the breeze.
    p.x += sin(life * 6.0 + seed * 40.0) * (uSmoke > 0.5 ? 0.5 : 0.25) * life + life * life * (uSmoke > 0.5 ? 2.5 : 0.3);
    p.z += cos(life * 5.0 + seed * 27.0) * (uSmoke > 0.5 ? 0.5 : 0.25) * life + life * life * (uSmoke > 0.5 ? 1.6 : 0.2);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = uSmoke > 0.5 ? (0.6 + life * 3.0) : 0.03 * (1.0 - life * 0.6);
    gl_PointSize = size * 600.0 / -mv.z * (uSmoke > 0.5 ? 1.0 : uPower);
  }
`;

const SPARK_FRAG = /* glsl */ `
  uniform float uPower;
  varying float vLife;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, r) * (1.0 - vLife) * uPower;
    gl_FragColor = vec4(mix(vec3(1.0, 0.75, 0.35), vec3(1.0, 0.35, 0.08), vLife) * 3.0 * a, a);
  }
`;

const SMOKE_FRAG = /* glsl */ `
  uniform float uPower;
  uniform float uFire;
  uniform vec3 uColor;
  varying float vLife;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    float wisp = 0.75 + 0.25 * sin(atan(c.y, c.x) * 3.0 + vSeed * 20.0);
    float a = smoothstep(0.5 * wisp, 0.0, r) * smoothstep(0.0, 0.15, vLife) * (1.0 - vLife) * 0.16 * uPower;
    // Low smoke catches the firelight.
    vec3 col = uColor + vec3(0.6, 0.25, 0.06) * (1.0 - smoothstep(0.0, 0.35, vLife)) * uFire;
    gl_FragColor = vec4(col, a);
  }
`;

interface FireState {
  x: number;
  z: number;
  fuel: number; // game hours of flame left
  ember: number; // game hours of glowing embers left once the flames are out
}

function createFirePit() {
  const group = new THREE.Group();
  const rnd = mulberry32(77);
  const rock = surface('rock');
  // A ring of stones.
  const stoneMat = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normal, roughness: 0.9, color: 0xb8b0a6 });
  const stones: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rnd() * 0.2;
    const g = new THREE.DodecahedronGeometry(0.13 + rnd() * 0.05, 1);
    g.scale(1.2, 0.7, 1);
    g.rotateY(a);
    g.translate(Math.cos(a) * 0.62, 0.04, Math.sin(a) * 0.62);
    stones.push(g.toNonIndexed());
  }
  const ring = new THREE.Mesh(mergeGeometries(stones)!, stoneMat);
  ring.castShadow = true;
  ring.receiveShadow = true;
  group.add(ring);

  // Scorched earth and ash inside the ring.
  const ashCanvas = document.createElement('canvas');
  ashCanvas.width = ashCanvas.height = 128;
  const ctx = ashCanvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(40,36,32,1)');
  grad.addColorStop(0.5, 'rgba(60,55,50,0.95)');
  grad.addColorStop(1, 'rgba(40,34,28,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 300; i++) {
    const g = 90 + rnd() * 90;
    ctx.fillStyle = `rgba(${g},${g * 0.97},${g * 0.93},${0.3 + rnd() * 0.4})`;
    const r = rnd() * 40;
    const a = rnd() * Math.PI * 2;
    ctx.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const ashTex = new THREE.CanvasTexture(ashCanvas);
  ashTex.colorSpace = THREE.SRGBColorSpace;
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ashTex, transparent: true, depthWrite: false, roughness: 1 }));
  ash.position.y = 0.02;
  ash.receiveShadow = true;
  group.add(ash);

  // Branches stacked into a small teepee. Their lower ends glow with heat.
  const glow = { value: 0 };
  const woodMat = new THREE.MeshStandardMaterial({ map: surface('bark').map, color: 0x6a5a4c, roughness: 0.95 });
  woodMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;\nvarying float vH;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // Charred, glowing ends near the heart of the fire.
          float hot = smoothstep(0.35, 0.0, vH) * uGlow;
          float cracks = smoothstep(0.35, 0.8, texture2D(map, vMapUv * 3.0).r);
          diffuseColor.rgb *= mix(1.0, 0.25, smoothstep(0.5, 0.0, vH));
          totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * hot * (0.4 + cracks * 2.5);
        }`,
      );
  };
  const sticks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.3;
    const l = 0.75 + rnd() * 0.2;
    const g = new THREE.CylinderGeometry(0.022, 0.035, l, 6);
    g.translate(0, l / 2, 0);
    g.rotateX(0.55 + rnd() * 0.1);
    g.rotateY(-a);
    g.translate(Math.sin(a) * 0.32, 0.02, Math.cos(a) * 0.32);
    sticks.push(g.toNonIndexed());
  }
  const wood = new THREE.Mesh(mergeGeometries(sticks)!, woodMat);
  wood.castShadow = true;
  group.add(wood);

  // Flames: a few crossed cards that always turn to face the camera around the upright axis.
  const flames = new THREE.Group();
  const flameMats: THREE.ShaderMaterial[] = [];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uSeed: { value: i * 0.37 + 0.1 } },
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    flameMats.push(mat);
    const w = i === 0 ? 0.9 : 0.4 + rnd() * 0.2;
    const h = i === 0 ? 1.05 : 0.55 + rnd() * 0.35;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), mat);
    card.position.set(i === 0 ? 0 : (rnd() - 0.5) * 0.4, 0.05, i === 0 ? 0 : (rnd() - 0.5) * 0.4);
    card.renderOrder = 3;
    flames.add(card);
  }
  group.add(flames);

  // Sparks and smoke.
  const particles = (count: number, frag: string, smoke: boolean) => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([(rnd() - 0.5) * 0.35, 0.3, (rnd() - 0.5) * 0.35], i * 3);
      seed[i] = rnd();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uSmoke: { value: smoke ? 1 : 0 }, uFire: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.55, 0.55) } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = smoke ? 2 : 4;
    return pts;
  };
  const sparks = particles(70, SPARK_FRAG, false);
  const smoke = particles(36, SMOKE_FRAG, true);
  group.add(sparks, smoke);

  // Warm, flickering light. It stays in the scene at zero strength when there is no
  // fire, so lighting a fire never forces every material to recompile.
  const light = new THREE.PointLight(0xff8a3a, 0, 14, 1.6);
  light.position.set(0, 0.7, 0);

  return { group, light, flames, flameMats, sparks, smoke, glow };
}

export interface CampfireSave {
  pack: number;
  fire: FireState | null;
}

export function createCampfire(saved: CampfireSave | undefined) {
  const bark = surface('bark');
  const branchMat = new THREE.MeshStandardMaterial({ map: bark.map, color: 0x9a8a78, roughness: 0.95 });
  const branches = createBranches(branchMat);
  const pit = createFirePit();
  pit.group.visible = false;
  const group = new THREE.Group();
  group.add(branches.group, pit.group);
  // The light is added to the scene separately and always present.
  const light = pit.light;

  let pack = saved?.pack ?? 0;
  let fire: FireState | null = saved?.fire ?? null;
  let power = 0; // how big the flames are right now, 0..1
  let lit = 0; // flames grow for a little while after lighting
  const tmp = new THREE.Vector3();

  function placePit() {
    if (!fire) return;
    pit.group.visible = true;
    pit.group.position.set(fire.x, groundHeight(fire.x, fire.z), fire.z);
    light.position.set(fire.x, pit.group.position.y + 0.7, fire.z);
  }
  placePit();
  if (fire) lit = 1;

  return {
    group,
    light,
    get pack() {
      return pack;
    },
    get firePosition() {
      return fire && (fire.fuel > 0 || fire.ember > 0) ? pit.group.position : null;
    },
    // Where the fire pit sits (burning or not), so plants can be kept out of it.
    get clearing() {
      return fire ? { x: fire.x, z: fire.z } : null;
    },
    get power() {
      return power;
    },
    debugGive(n: number) {
      pack = Math.min(PACK_MAX, pack + n);
    },
    // Skip the slow catch so a test frame shows full flames.
    debugBlaze() {
      lit = 1;
      power = 1;
    },
    save(): CampfireSave {
      return { pack, fire };
    },
    // What E would do from here, for the on-screen hint.
    hint(pos: THREE.Vector3): string | null {
      if (fire && fire.fuel + fire.ember > 0 && tmp.set(fire.x, 0, fire.z).distanceTo(new THREE.Vector3(pos.x, 0, pos.z)) < 2.6) {
        if (pack > 0 && fire.fuel < FIRE_MAX_FUEL - HOURS_PER_BRANCH) return 'E：枝をくべる';
        if (pack === 0) return null;
      }
      if (pack < PACK_MAX && branches.nearest(pos, 2.2) >= 0) return 'E：枝を拾う';
      if (pack >= BRANCHES_TO_BUILD && !(fire && fire.fuel > 0)) return 'B：焚き火を組む';
      return null;
    },
    // E: feed the fire if standing by it, otherwise pick up the nearest branch.
    interact(pos: THREE.Vector3): string | null {
      if (fire && fire.fuel + fire.ember > 0 && Math.hypot(fire.x - pos.x, fire.z - pos.z) < 2.6 && pack > 0) {
        if (fire.fuel >= FIRE_MAX_FUEL - HOURS_PER_BRANCH) return 'これ以上くべると燃えすぎます';
        pack--;
        const wasOut = fire.fuel <= 0;
        fire.fuel += HOURS_PER_BRANCH;
        fire.ember = 0;
        if (wasOut) lit = 0.4; // embers catch again
        return `枝をくべました（残り ${pack} 本）`;
      }
      if (pack >= PACK_MAX) return 'リュックがいっぱいです';
      const i = branches.nearest(pos, 2.2);
      if (i < 0) return null;
      branches.take(i);
      pack++;
      return `枝を拾いました（${pack} 本）`;
    },
    // B: build and light a fire in front of the player.
    build(pos: THREE.Vector3, yaw: number): string {
      if (fire && fire.fuel > 0) return 'もう焚き火があります（E で枝をくべる）';
      if (pack < BRANCHES_TO_BUILD) return `焚き火には枝が ${BRANCHES_TO_BUILD} 本いります（今 ${pack} 本）`;
      const x = pos.x - Math.sin(yaw) * 1.8;
      const z = pos.z - Math.cos(yaw) * 1.8;
      if (streamDist(x, z) < 6) return '水辺からもう少し離れてください';
      if (groundSlope(x, z) > 0.35) return 'もう少し平らな場所を選んでください';
      pack -= BRANCHES_TO_BUILD;
      fire = { x, z, fuel: BRANCHES_TO_BUILD * HOURS_PER_BRANCH, ember: 0 };
      lit = 0;
      placePit();
      return '焚き火に火をつけました';
    },
    // gameHours: how much game time passed this frame.
    update(time: number, dt: number, gameHours: number, camera: THREE.Camera, wind: number, daylight: number) {
      if (!fire) {
        light.intensity = 0;
        return;
      }
      const smokeU = (pit.smoke.material as THREE.ShaderMaterial).uniforms;
      smokeU.uColor.value.setScalar(0.06 + daylight * 0.5);
      smokeU.uFire.value = power;
      if (fire.fuel > 0) {
        fire.fuel = Math.max(0, fire.fuel - gameHours);
        if (fire.fuel === 0) fire.ember = EMBER_HOURS;
      } else if (fire.ember > 0) {
        fire.ember = Math.max(0, fire.ember - gameHours);
      }
      lit = Math.min(1, lit + dt / 12); // flames take a few seconds to catch
      // Big while there is plenty of fuel, dying down over the last hour.
      const flame = fire.fuel > 0 ? THREE.MathUtils.smoothstep(fire.fuel, 0, 1) * 0.75 + 0.25 : 0;
      const target = flame * THREE.MathUtils.smoothstep(lit, 0, 1);
      power += (target - power) * Math.min(1, dt * 1.5);
      const embers = fire.fuel > 0 ? 1 : fire.ember / EMBER_HOURS;

      // Face the flame cards to the camera around the upright axis.
      camera.getWorldPosition(tmp);
      pit.flames.children.forEach((c, i) => {
        c.lookAt(tmp.x, c.getWorldPosition(new THREE.Vector3()).y, tmp.z);
        c.scale.setScalar(0.35 + power * 0.75 + Math.sin(time * 7 + i * 2) * 0.03);
        c.visible = power > 0.01;
      });
      for (const m of pit.flameMats) {
        m.uniforms.uTime.value = time;
        m.uniforms.uPower.value = power;
      }
      for (const p of [pit.sparks, pit.smoke]) {
        const u = (p.material as THREE.ShaderMaterial).uniforms;
        u.uTime.value = time;
        u.uPower.value = p === pit.smoke ? Math.max(power, embers * 0.5) * (0.6 + wind * 0.4) : power;
      }
      pit.sparks.visible = power > 0.05;
      pit.smoke.visible = power > 0.01 || embers > 0.02;
      pit.glow.value = Math.max(power, embers * 0.6);
      // Flicker: a few layered wobbles so it never repeats.
      const flick = 0.82 + 0.1 * Math.sin(time * 11.3) + 0.06 * Math.sin(time * 23.7 + 1.3) + 0.05 * Math.sin(time * 5.1 + 0.4);
      light.intensity = (power * 9 + embers * 0.8) * flick;
      light.position.y = pit.group.position.y + 0.55 + power * 0.25;
    },
  };
}
