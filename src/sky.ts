// Sun, sky, stars, fog and light for any time of day.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mulberry32, smoothstep } from './noise';
import { glowTexture } from './textures';
import { waterLevel } from './world';

export interface DayState {
  sunDir: THREE.Vector3;
  daylight: number; // 0 at night, 1 in full day
  night: number; // 0 in the day, 1 in deep night
  hour: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  mist: number; // 0..1, how thick the morning mist is
  warm: number; // 0..1, golden-hour warmth of the sunlight
  fogColor: THREE.Color;
}

const NIGHT_FOG = new THREE.Color().setRGB(0.018, 0.024, 0.04, THREE.SRGBColorSpace);
const DUSK_FOG = new THREE.Color().setRGB(0.75, 0.52, 0.4, THREE.SRGBColorSpace);
const DAY_FOG = new THREE.Color().setRGB(0.6, 0.73, 0.84, THREE.SRGBColorSpace);
const MIST_FOG = new THREE.Color().setRGB(0.78, 0.8, 0.8, THREE.SRGBColorSpace);

export function createSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const sky = new Sky();
  sky.scale.setScalar(3500);
  const u = sky.material.uniforms;
  u.turbidity.value = 3;
  u.rayleigh.value = 2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  scene.add(sky);

  // A second sky in its own scene, used to light the world by reflection.
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(100);
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget: THREE.WebGLRenderTarget | null = null;
  let lastEnvHour = -99;

  const stars = (() => {
    const rnd = mulberry32(5);
    const n = 2600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = rnd() * 0.95 + 0.05;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 3000, y * 3000, Math.sin(a) * r * 3000], i * 3);
      const b = 0.4 + rnd() * rnd() * 1.4;
      col.set([b, b, b * (0.9 + rnd() * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false });
    const p = new THREE.Points(g, m);
    p.renderOrder = -1;
    return p;
  })();
  scene.add(stars);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70;
  sc.right = 70;
  sc.top = 70;
  sc.bottom = -70;
  sc.near = 10;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.camera.layers.enableAll(); // small plants live on their own layer
  scene.add(sun, sun.target);

  const moon = new THREE.DirectionalLight(0x8ea6d8, 0);
  scene.add(moon, moon.target);
  const moonDisc = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xf4f0e0, fog: false, depthWrite: false, transparent: true }),
  );
  moonDisc.scale.setScalar(120);
  moonDisc.renderOrder = -1;
  scene.add(moonDisc);

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3a22, 0.5);
  scene.add(hemi);

  // Height fog (see atmosphere.ts): near = mist density at its base, far = base height.
  const fog = new THREE.Fog(DAY_FOG.getHex(), 0.004, 0);
  scene.fog = fog;

  const state: DayState = { sunDir: new THREE.Vector3(), daylight: 1, night: 0, hour: 12, sunColor: new THREE.Color(), sunIntensity: 0, mist: 0, warm: 0, fogColor: fog.color };
  const tmp = new THREE.Color();

  function update(hour: number, focus: THREE.Vector3) {
    state.hour = hour;
    const angle = ((hour - 6) / 12) * Math.PI;
    state.sunDir.set(Math.cos(angle), Math.sin(angle) * 0.92, 0.38).normalize();
    const e = state.sunDir.y;
    state.daylight = smoothstep(-0.08, 0.25, e);
    state.night = 1 - smoothstep(-0.2, -0.02, e);

    u.sunPosition.value.copy(state.sunDir);
    envSky.material.uniforms.sunPosition.value.copy(state.sunDir);
    stars.material.opacity = state.night;
    stars.visible = state.night > 0.01;
    stars.position.copy(focus);
    stars.rotation.y = hour * 0.05;

    // Warm, low sun at dawn and dusk; white at noon.
    const warm = 1 - smoothstep(0.05, 0.4, e);
    sun.color.setRGB(1, 1 - warm * 0.35, 1 - warm * 0.6);
    sun.intensity = 3.2 * smoothstep(-0.02, 0.15, e);
    sun.position.copy(focus).addScaledVector(state.sunDir, 200);
    sun.target.position.copy(focus);
    sun.castShadow = sun.intensity > 0.05;
    state.sunColor.copy(sun.color);
    state.sunIntensity = sun.intensity;

    moon.intensity = 0.7 * state.night;
    moon.position.copy(focus).addScaledVector(state.sunDir, -200).add(new THREE.Vector3(0, 80, 0));
    moon.target.position.copy(focus);
    const moonDir = state.sunDir.clone().multiplyScalar(-1).add(new THREE.Vector3(0, 0.35, 0)).normalize();
    moonDisc.position.copy(focus).addScaledVector(moonDir, 2800);
    moonDisc.material.opacity = state.night;
    moonDisc.visible = state.night > 0.01;

    hemi.intensity = 0.14 + 0.4 * state.daylight;
    hemi.color.setRGB(0.75 + 0.1 * warm, 0.85, 1);

    // Fog: misty in the early morning, warm at dusk, dark blue at night.
    const morning = smoothstep(4.5, 6, hour) * (1 - smoothstep(7.5, 9.5, hour));
    tmp.copy(DAY_FOG).lerp(DUSK_FOG, warm * state.daylight * 0.7).lerp(MIST_FOG, morning * 0.5);
    tmp.lerp(NIGHT_FOG, 1 - state.daylight);
    fog.color.copy(tmp);
    const evening = smoothstep(17, 19, hour) * (1 - smoothstep(21, 23, hour));
    // By the pond the air is clearer still, so the far shore and the peaks mirror crisply.
    const byPond = smoothstep(120, 220, focus.z);
    fog.near = 0.0014 * (1 - 0.65 * byPond) + morning * 0.017 + evening * 0.004 + (1 - state.daylight) * 0.0015;
    fog.far = waterLevel(focus.z) + 1.5;
    state.mist = morning;
    state.warm = warm;

    scene.environmentIntensity = 0.06 + 0.3 * state.daylight;

    // Refresh the reflected sky when the sun has moved enough.
    if (Math.abs(hour - lastEnvHour) > 0.1) {
      lastEnvHour = hour;
      envTarget?.dispose();
      envTarget = pmrem.fromScene(envScene, 0, 0.1, 1000);
      scene.environment = envTarget.texture;
    }

    renderer.toneMappingExposure = 0.55 + 0.25 * (1 - state.daylight);
    return state;
  }

  return { update, state };
}
