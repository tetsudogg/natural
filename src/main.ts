import * as THREE from 'three';
import { createClouds } from './atmosphere';
import { createPost, QUALITY_LABEL, QUALITY_PIXEL_RATIO, type Quality } from './post';
import { createTerrain } from './terrain';
import { createVegetation, updateDistanceCulling, windUniforms } from './vegetation';
import { createStream, createFireflies, NO_REFLECT_LAYER } from './water';
import { createBrooks } from './brooks';
import { createForestFloor } from './forestfloor';
import { createWildlife } from './wildlife';
import { createCampfire, type CampfireSave } from './campfire';
import { createTent, type TentSave } from './tent';
import { createSky } from './sky';
import { Player, type ViewMode } from './player';
import { Soundscape } from './audio';
import { isTouchDevice, setupTouch } from './touch';
import { clearings } from './world';
import { createMap } from './map';

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
  tent?: TentSave | null;
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
  const floor = createForestFloor(veg.treeSpots, veg.rockSpots);
  scene.add(floor.group);
  const stream = createStream();
  scene.add(stream.mesh);
  const brookWater = createBrooks();
  scene.add(brookWater.group);
  brookWater.group.traverse((o) => o.layers.set(NO_REFLECT_LAYER));
  const fireflies = createFireflies();
  scene.add(fireflies.points);
  const wildlife = createWildlife();
  scene.add(wildlife.group);
  const clouds = createClouds();
  scene.add(clouds.mesh);

  const saved = loadSave();
  const campfire = createCampfire(saved?.campfire, veg.treeSpots);
  scene.add(campfire.group, campfire.light);
  const tent = createTent(saved?.tent ?? undefined, veg.treeSpots);
  scene.add(tent.group, tent.light);
  const post = createPost(renderer);
  // ?quality=low|medium|high overrides the saved choice (handy for testing).
  const qParam = new URLSearchParams(location.search).get('quality') as Quality | null;
  const touchDevice = isTouchDevice();
  // Phones start a step lower; the automatic check lowers it further if needed.
  let quality: Quality = qParam && QUALITIES.includes(qParam) ? qParam : (saved?.quality ?? (touchDevice ? 'medium' : 'high'));
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
  player.blocker = (x, z) => tent.blocks(x, z);
  tent.avoid = () => campfire.clearing;
  // ?debug exposes the game objects for automated checks.
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { natural: { tent, campfire, player, floor } });
  const nearTent = (x: number, z: number) => {
    const t = tent.clearing;
    return !!t && Math.hypot(t.x - x, t.z - z) < 3.2;
  };
  // ?tent=now pitches the tent just ahead; ?tent=inside also crawls in (for testing).
  const tentParam = new URLSearchParams(location.search).get('tent');
  if (tentParam) {
    tent.debugPitch(player.position, player.yaw, tentParam === 'now' ? -0.6 : 0, tentParam === 'inside');
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

  // The map: marks favourite places and jumps back to them (the time of day stays).
  const map = createMap({
    player: () => ({ x: player.position.x, z: player.position.z, yaw: player.yaw }),
    opened: () => {
      player.releaseKeys();
      player.stick.x = player.stick.y = 0;
      touch?.reset();
      if (document.pointerLockElement) document.exitPointerLock();
    },
    closed: () => {
      pause.hidden = true;
      lock();
    },
    jump: (pin) => {
      if (tent.inside) leaveTent();
      if (tent.placing) tent.cancel();
      player.position.set(pin.x, player.position.y, pin.z);
      player.yaw = pin.yaw;
      player.pitch = -0.05;
      toast(pin.note ? `「${pin.note}」に来ました` : '記録した場所に来ました');
    },
  });

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
    if (touchDevice) return;
    const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  }

  function showHelpBriefly() {
    // The key guide stays along the bottom (H hides it); it is hidden in view mode with the HUD.
    help.classList.remove('off');
    clearTimeout(helpTimer);
  }

  function start() {
    if (started) return;
    started = true;
    document.body.classList.add('playing');
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
    pause.hidden = locked || viewing || !started || map.open;
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas && !viewing) {
      if (tent.inside) tent.look(e.movementX, e.movementY);
      else player.look(e.movementX, e.movementY);
    }
    if (viewing) {
      document.body.classList.add('pointer');
      clearTimeout(pointerTimer);
      pointerTimer = window.setTimeout(() => document.body.classList.remove('pointer'), 2000);
    }
  });

  // Crawling out of the tent.
  function leaveTent() {
    const out = tent.exit();
    if (out) {
      player.position.set(out.x, player.position.y, out.z);
      player.yaw = out.yaw;
      player.pitch = -0.05;
    }
    player.setView(player.view);
  }

  // Sleep in the tent: fade to black, wake at six in the morning.
  let sleeping = false;
  function sleep() {
    if (sleeping) return;
    sleeping = true;
    const fade = $('fade');
    fade.classList.add('show');
    sound.setVolume(0.15);
    setTimeout(() => {
      const skipped = (6 - hour + 24) % 24 || 24;
      hour = 6;
      // The fire keeps burning (or goes out) while you sleep.
      campfire.update(elapsed, 0, skipped, camera, windUniforms.uWind.value, 0);
      fade.classList.remove('show');
      sound.setVolume(0.9);
      setTimeout(() => toast('おはようございます'), 1200);
      sleeping = false;
    }, 3200);
  }

  // Game actions, shared by the keyboard and the touch buttons. Returns true when handled.
  function press(code: string) {
    switch (code) {
      case 'KeyV':
        viewing ? exitView() : enterView();
        return;
      case 'KeyM':
        if (viewing || sleeping) return;
        map.toggle();
        return;
      case 'Escape':
        if (map.open) map.close();
        else if (viewing) exitView();
        else if (tent.placing) tent.cancel();
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
        if (viewing || sleeping) return;
        if (tent.inside) {
          sleep();
          return;
        }
        if (tent.enter(player.position)) {
          player.releaseKeys();
          player.body.visible = false;
          toast('テントに入りました');
          return;
        }
        const msg = campfire.interact(player.position);
        if (msg) toast(msg);
        return;
      }
      case 'KeyP': {
        if (viewing) return;
        const msg = tent.pressP(player.position, elapsed);
        if (msg) toast(msg);
        return;
      }
      case 'KeyB':
        if (viewing) return;
        toast(campfire.build(player.position, player.yaw, nearTent));
        return;
      case 'KeyQ':
        quality = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length];
        applyQuality();
        slowTime = 0;
        toast(QUALITY_LABEL[quality]);
        return;
      default:
        return false;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (!started) {
      if (e.code === 'Enter' || e.code === 'Space') start();
      return;
    }
    if (e.repeat) return;
    // With the map open only M and Esc do anything (the note box takes the typing).
    if (map.open) {
      if (e.code === 'KeyM' || e.code === 'Escape') press(e.code);
      return;
    }
    if (tent.inside && !viewing && ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      leaveTent();
      return;
    }
    if (press(e.code) !== false) return;
    if (!viewing) player.keyDown(e.code);
  });

  const touch = touchDevice
    ? setupTouch(canvas, {
        active: () => started && !viewing && !sleeping && !map.open,
        move: (x, y) => {
          if (tent.inside && Math.hypot(x, y) > 0.5) leaveTent();
          player.stick.x = x;
          player.stick.y = y;
        },
        look: (dx, dy) => (tent.inside ? tent.look(dx, dy) : player.look(dx, dy)),
        press,
      })
    : null;
  // On touch screens the hints name the on-screen controls instead of keys.
  const hintText = (h: string) =>
    touch ? h.replace('W：外に出る', 'スティック：外に出る').replace(/Esc：/g, '✕：') : h;
  window.addEventListener('keyup', (e) => player.keyUp(e.code));
  window.addEventListener('blur', () => player.releaseKeys());

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize();
  });

  const save = () =>
    writeSave({ x: player.position.x, z: player.position.z, yaw: player.yaw, pitch: player.pitch, hour, view: player.view, speed: speedIndex, quality, campfire: campfire.save(), tent: tent.save() });
  setInterval(() => started && save(), 5000);
  window.addEventListener('beforeunload', () => started && save());

  // ?frames=N stops drawing after N frames (used for automated screenshots).
  const frameLimit = Number(new URLSearchParams(location.search).get('frames')) || Infinity;
  let frames = 0;
  let hintTick = 0;
  const hintEl = $('hint');
  // What you can do right here is shown at the start of the bottom bar, not mid-screen.
  if (!touch) help.prepend(hintEl);
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

    player.update(dt, started && !viewing && !tent.inside && (document.pointerLockElement === canvas || !!touch));
    if (viewing) {
      viewClock += dt;
      if (motion === 'pan') player.yaw = viewBaseYaw + Math.sin(viewClock * ((Math.PI * 2) / 140)) * 0.5;
    }
    if (tent.inside) tent.applyInsideCamera(camera);
    else player.applyCamera(camera);

    const day = sky.update(hour, player.position);
    stream.update(elapsed, day.sunDir, day.sunColor, day.sunIntensity, day.daylight);
    brookWater.update(elapsed, day.sunDir, day.sunColor, day.sunIntensity, day.daylight, day.fogColor);
    fireflies.update(elapsed, day.night);
    wildlife.update(elapsed, dt, day.daylight, player.position, camera);
    clouds.update(elapsed, player.position, day.sunDir, day.sunColor, day.daylight, day.night, day.fogColor);
    campfire.update(elapsed, dt, dt * TIME_SPEEDS[speedIndex].hoursPerSecond, camera, windUniforms.uWind.value, day.daylight);
    tent.update(elapsed, dt, player, windUniforms.uWind.value, day.night);
    const tc = tent.clearing;
    windUniforms.uClear2.value.set(tc ? tc.x : 0, tc ? tc.z : 0, tc ? tc.r : 0);
    const fp = campfire.clearing;
    windUniforms.uClear.value.set(fp ? fp.x : 0, fp ? fp.z : 0, fp ? 1.25 : 0);
    sound.fire(campfire.firePosition, campfire.power);
    if (++hintTick % 10 === 0) {
      const h = viewing ? null : (tent.hint(player.position) ?? campfire.hint(player.position));
      hintEl.textContent = h ? hintText(h) : '';
      touch?.setCancel(tent.placing);
      hintEl.classList.toggle('show', !!h);
      packEl.textContent = campfire.pack > 0 ? `枝 ${campfire.pack} 本` : '';
    }
    if (started && !viewing && hintTick % 2 === 0) map.update();
    for (const g of veg.cullGroups) updateDistanceCulling(g, camera.position);
    for (const g of floor.cullGroups) updateDistanceCulling(g, camera.position);
    for (const g of campfire.cullGroups) updateDistanceCulling(g, camera.position);
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
