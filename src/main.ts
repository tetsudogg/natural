import * as THREE from 'three';
import { createClouds } from './atmosphere';
import { createPost, QUALITY_LABEL, QUALITY_PIXEL_RATIO, type Quality } from './post';
import { createTerrain } from './terrain';
import { createVegetation, updateDistanceCulling, windUniforms } from './vegetation';
import { createStream, createFireflies, NO_REFLECT_LAYER } from './water';
import { createWildlife } from './wildlife';
import { createCampfire, type CampfireSave } from './campfire';
import { createSky } from './sky';
import { Player, type ViewMode } from './player';
import { Soundscape } from './audio';
import { clearings } from './world';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TIME_SPEEDS = [
  { label: '時間：標準（1日 約40分）', hoursPerSecond: 24 / 2400 },
  { label: '時間：早回し（1日 約2分）', hoursPerSecond: 24 / 120 },
  { label: '時間：現実と同じ', hoursPerSecond: 1 / 3600 },
];

type ViewMotion = 'still' | 'pan';
const MOTION_LABEL: Record<ViewMotion, string> = { still: 'カメラ：固定', pan: 'カメラ：ゆっくり見渡す' };

interface Save {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  hour: number;
  view: ViewMode;
  speed: number;
  quality?: Quality;
  campfire?: CampfireSave;
}

const SAVE_KEY = 'natural.save.v1';
const QUALITIES: Quality[] = ['high', 'medium', 'low'];

function loadSave(): Save | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as Save) : null;
  } catch {
    return null;
  }
}

function writeSave(s: Save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private windows); the game still works.
  }
}

let toastTimer = 0;
function toast(text: string) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
}

async function main() {
  const canvas = $<HTMLCanvasElement>('scene');
  // Antialiasing happens in the post-processing target, so the canvas itself needs none.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
  camera.layers.enable(NO_REFLECT_LAYER);
  // Shadows are drawn once per frame, not again for the water reflection.
  renderer.shadowMap.autoUpdate = false;

  // Let the loading text paint before the heavy world build.
  await new Promise((r) => setTimeout(r, 30));

  const sky = createSky(scene, renderer);
  scene.add(createTerrain());
  const veg = createVegetation();
  scene.add(veg.group);
  const stream = createStream();
  scene.add(stream.mesh);
  const fireflies = createFireflies();
  scene.add(fireflies.points);
  const wildlife = createWildlife();
  scene.add(wildlife.group);
  const clouds = createClouds();
  scene.add(clouds.mesh);

  const saved = loadSave();
  const campfire = createCampfire(saved?.campfire, veg.treeSpots);
  scene.add(campfire.group, campfire.light);
  const post = createPost(renderer);
  // ?quality=low|medium|high overrides the saved choice (handy for testing).
  const qParam = new URLSearchParams(location.search).get('quality') as Quality | null;
  let quality: Quality = qParam && QUALITIES.includes(qParam) ? qParam : (saved?.quality ?? 'high');
  function applyQuality() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_PIXEL_RATIO[quality]));
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setQuality(quality);
    post.setSize();
  }
  applyQuality();
  const home = clearings[0];
  const player = new Player(saved?.x ?? home.x - 6, saved?.z ?? home.z, saved?.yaw ?? Math.PI / 2 - 0.35);
  player.pitch = saved?.pitch ?? -0.05;
  player.setView(saved?.view ?? 'first');
  scene.add(player.body);

  let hour = saved?.hour ?? 6.4;
  let speedIndex = saved?.speed ?? 0;
  // ?campfire=now lights a fire just ahead (for testing).
  if (new URLSearchParams(location.search).get('campfire') === 'now') {
    campfire.debugGive(8);
    toast(campfire.build(player.position, player.yaw));
    campfire.debugBlaze();
  }

  const sound = new Soundscape();
  player.onStep = (ground, running) => sound.footstep(ground, running);

  // Warm up shaders so the first frame after "start" does not stutter.
  sky.update(hour, player.position);
  player.applyCamera(camera);
  clouds.update(0, player.position, sky.state.sunDir, sky.state.sunColor, sky.state.daylight, sky.state.night, sky.state.fogColor);
  renderer.compile(scene, camera);
  renderer.shadowMap.needsUpdate = true;
  post.render(scene, camera, sky.state);

  $('loading').hidden = true;
  const startBtn = $<HTMLButtonElement>('start');
  startBtn.hidden = false;
  startBtn.focus();

  let started = false;
  let viewing = false;
  let motion: ViewMotion = 'still';
  let viewBaseYaw = 0;
  let viewClock = 0;
  let helpTimer = 0;
  let pointerTimer = 0;

  const hud = $('hud');
  const help = $('help');
  const pause = $('pause');

  function lock() {
    const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  }

  function showHelpBriefly() {
    help.classList.remove('off');
    clearTimeout(helpTimer);
    helpTimer = window.setTimeout(() => help.classList.add('off'), 9000);
  }

  function start() {
    if (started) return;
    started = true;
    sound.start();
    $('title').classList.add('fade');
    setTimeout(() => ($('title').hidden = true), 1300);
    lock();
    showHelpBriefly();
  }

  function enterView() {
    viewing = true;
    viewBaseYaw = player.yaw;
    viewClock = 0;
    player.releaseKeys();
    if (document.pointerLockElement) document.exitPointerLock();
    pause.hidden = true;
    hud.classList.add('hidden');
    document.body.classList.add('viewing');
    toast(`眺めモード　${MOTION_LABEL[motion]}（C で切替、V で戻る）`);
  }

  function exitView() {
    viewing = false;
    hud.classList.remove('hidden');
    document.body.classList.remove('viewing');
    toast('歩くモード');
    lock();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => toast('全画面にできませんでした'));
  }

  startBtn.addEventListener('click', start);
  $('view-btn').addEventListener('click', () => (viewing ? exitView() : enterView()));
  pause.addEventListener('click', () => {
    pause.hidden = true;
    lock();
  });
  canvas.addEventListener('click', () => {
    if (!started) return;
    if (viewing) exitView();
    else if (!document.pointerLockElement) lock();
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked) player.releaseKeys();
    pause.hidden = locked || viewing || !started;
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas && !viewing) player.look(e.movementX, e.movementY);
    if (viewing) {
      document.body.classList.add('pointer');
      clearTimeout(pointerTimer);
      pointerTimer = window.setTimeout(() => document.body.classList.remove('pointer'), 2000);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!started) {
      if (e.code === 'Enter' || e.code === 'Space') start();
      return;
    }
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyV':
        viewing ? exitView() : enterView();
        return;
      case 'Escape':
        if (viewing) exitView();
        return;
      case 'KeyC':
        if (viewing) {
          motion = motion === 'still' ? 'pan' : 'still';
          viewBaseYaw = player.yaw;
          viewClock = 0;
          toast(MOTION_LABEL[motion]);
        } else {
          player.setView(player.view === 'first' ? 'third' : 'first');
          toast(player.view === 'first' ? '一人称視点' : '三人称視点');
        }
        return;
      case 'KeyF':
        toggleFullscreen();
        return;
      case 'KeyT':
        speedIndex = (speedIndex + 1) % TIME_SPEEDS.length;
        toast(TIME_SPEEDS[speedIndex].label);
        return;
      case 'KeyH':
        help.classList.toggle('off');
        return;
      case 'KeyE': {
        if (viewing) return;
        const msg = campfire.interact(player.position);
        if (msg) toast(msg);
        return;
      }
      case 'KeyB':
        if (viewing) return;
        toast(campfire.build(player.position, player.yaw));
        return;
      case 'KeyQ':
        quality = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length];
        applyQuality();
        slowTime = 0;
        toast(QUALITY_LABEL[quality]);
        return;
    }
    if (!viewing) player.keyDown(e.code);
  });
  window.addEventListener('keyup', (e) => player.keyUp(e.code));
  window.addEventListener('blur', () => player.releaseKeys());

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize();
  });

  const save = () =>
    writeSave({ x: player.position.x, z: player.position.z, yaw: player.yaw, pitch: player.pitch, hour, view: player.view, speed: speedIndex, quality, campfire: campfire.save() });
  setInterval(() => started && save(), 5000);
  window.addEventListener('beforeunload', () => started && save());

  // ?frames=N stops drawing after N frames (used for automated screenshots).
  const frameLimit = Number(new URLSearchParams(location.search).get('frames')) || Infinity;
  let frames = 0;
  let hintTick = 0;
  const hintEl = $('hint');
  const packEl = $('pack');
  const timer = new THREE.Timer();
  timer.connect(document);
  let elapsed = 0;
  let sinceFrame = 0;
  // If the computer struggles for a while, step the picture quality down by itself.
  let slowTime = 0;

  renderer.setAnimationLoop(() => {
    timer.update();
    const raw = timer.getDelta();
    // In view mode draw at about 30 fps so a TV can run for hours without the PC working hard.
    sinceFrame += raw;
    if (viewing && sinceFrame < 1 / 31) return;
    const dt = Math.min(0.1, sinceFrame);
    sinceFrame = 0;
    elapsed += dt;
    if (started && !viewing && !document.hidden && quality !== 'low' && !qParam) {
      slowTime = raw > 1 / 26 ? slowTime + raw : Math.max(0, slowTime - raw * 0.5);
      if (slowTime > 4) {
        quality = QUALITIES[QUALITIES.indexOf(quality) + 1];
        applyQuality();
        slowTime = 0;
        toast(`動きが重いため、${QUALITY_LABEL[quality]} にしました（Q で変更）`);
      }
    }

    hour = (hour + dt * TIME_SPEEDS[speedIndex].hoursPerSecond) % 24;
    windUniforms.uTime.value = elapsed;
    windUniforms.uWind.value = 0.5 + 0.35 * Math.sin(elapsed * 0.13) * Math.sin(elapsed * 0.071);

    player.update(dt, started && !viewing && document.pointerLockElement === canvas);
    if (viewing) {
      viewClock += dt;
      if (motion === 'pan') player.yaw = viewBaseYaw + Math.sin(viewClock * ((Math.PI * 2) / 140)) * 0.5;
    }
    player.applyCamera(camera);

    const day = sky.update(hour, player.position);
    stream.update(elapsed, day.sunDir, day.sunColor, day.sunIntensity, day.daylight);
    fireflies.update(elapsed, day.night);
    wildlife.update(elapsed, dt, day.daylight, player.position, camera);
    clouds.update(elapsed, player.position, day.sunDir, day.sunColor, day.daylight, day.night, day.fogColor);
    campfire.update(elapsed, dt, dt * TIME_SPEEDS[speedIndex].hoursPerSecond, camera, windUniforms.uWind.value, day.daylight);
    const fp = campfire.clearing;
    windUniforms.uClear.value.set(fp ? fp.x : 0, fp ? fp.z : 0, fp ? 1.25 : 0);
    sound.fire(campfire.firePosition, campfire.power);
    if (++hintTick % 10 === 0) {
      const h = viewing ? null : campfire.hint(player.position);
      hintEl.textContent = h ?? '';
      hintEl.classList.toggle('show', !!h);
      packEl.textContent = campfire.pack > 0 ? `枝 ${campfire.pack} 本` : '';
    }
    for (const g of veg.cullGroups) updateDistanceCulling(g, camera.position);
    sound.update(dt, camera, day.daylight, day.night, hour);

    camera.updateMatrixWorld();
    windUniforms.uSunView.value.copy(day.sunDir).transformDirection(camera.matrixWorldInverse);
    windUniforms.uSunColor.value.copy(day.sunColor).multiplyScalar(day.sunIntensity * 0.35);
    stream.renderReflection(renderer, scene, camera);
    renderer.shadowMap.needsUpdate = true;
    post.render(scene, camera, day);
    if (++frames >= frameLimit) {
      renderer.setAnimationLoop(null);
      document.title = 'Natural (stopped)';
    }
  });
}

main().catch((err) => {
  console.error(err);
  $('loading').textContent = 'この環境では森を表示できませんでした（WebGL が使えるブラウザでお試しください）';
});
