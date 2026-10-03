// Forest seen from afar, baked once at start-up from the same conifers that stand on the
// pond's shores: a tile of crowns from above and a tile of a wooded slope from the side.
// The far terrain wears these instead of thousands of real trees.

import * as THREE from 'three';
import { coniferGeometry } from './pond';
import { mulberry32 } from './noise';

export const FOREST_TILE = 48; // metres covered by one tile

export function bakeForest(renderer: THREE.WebGLRenderer) {
  const T = FOREST_TILE;
  const rnd = mulberry32(2024);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().setRGB(0.05, 0.09, 0.05, THREE.SRGBColorSpace);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x2a3a1c, 2.4));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
  sun.position.set(0.4, 1, 0.8);
  scene.add(sun);

  const kinds = [coniferGeometry(11, 5, 1.7, 13), coniferGeometry(12, 6, 2.3, 12)];
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide });
  const lists: { m: THREE.Matrix4; c: THREE.Color }[][] = [[], []];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  // Trees on a 45° slope: (x, y) on the tile, standing at height y and depth -y. Each tree
  // also appears one tile over in every direction so the tile wraps without seams.
  const trees: { x: number; y: number; k: number; s: number; c: THREE.Color; r: number }[] = [];
  for (let i = 0; i < 380; i++) {
    const spruce = rnd() < 0.6 ? 1 : 0;
    const v = 0.75 + rnd() * 0.45;
    const c = spruce
      ? new THREE.Color().setRGB(0.1, 0.19, 0.12, THREE.SRGBColorSpace).multiplyScalar(v)
      : new THREE.Color().setRGB(0.3 + rnd() * 0.06, 0.42 + rnd() * 0.06, 0.16, THREE.SRGBColorSpace).multiplyScalar(v);
    trees.push({ x: rnd() * T, y: rnd() * T, k: spruce, s: 0.7 + rnd() * 0.7, c, r: rnd() * 6.28 });
  }

  const bake = (camera: THREE.Camera, count: number, place: (t: (typeof trees)[0], ox: number, oy: number) => THREE.Vector3) => {
    lists[0].length = 0;
    lists[1].length = 0;
    for (const t of trees.slice(0, count)) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const m = new THREE.Matrix4().compose(place(t, ox, oy), q.setFromAxisAngle(up, t.r), new THREE.Vector3(t.s, t.s, t.s));
          lists[t.k].push({ m, c: t.c });
        }
      }
    }
    const meshes = kinds.map((g, i) => {
      const mesh = new THREE.InstancedMesh(g, mat, lists[i].length);
      lists[i].forEach(({ m, c }, k) => {
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, c);
      });
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    });
    const target = new THREE.WebGLRenderTarget(512, 512, { colorSpace: THREE.SRGBColorSpace });
    const prevTarget = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTone;
    meshes.forEach((m) => {
      scene.remove(m);
      m.dispose();
    });
    // Copied out into an ordinary texture: mipmaps built from it are reliable everywhere,
    // where a render target's own mip chain is not.
    const px = new Uint8Array(512 * 512 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 512, 512, px);
    target.dispose();
    if (new URLSearchParams(location.search).has('debug')) {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(0)), 512, 512), 0, 0);
      ((window as any).__forestBake ??= []).push(c.toDataURL());
    }
    const tex = new THREE.DataTexture(px, 512, 512, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  };

  // From above: crowns spread over the ground.
  const topCam = new THREE.OrthographicCamera(0, T, T, 0, 0.1, 200);
  topCam.position.set(0, 100, 0);
  topCam.up.set(0, 0, -1);
  topCam.lookAt(0, 0, 0);
  const top = bake(topCam, trees.length, (t, ox, oy) => new THREE.Vector3(t.x + ox * T, 0, -(t.y + oy * T)));

  // From the side: a wooded 45° slope, rows of trees climbing behind one another.
  const sideCam = new THREE.OrthographicCamera(0, T, T, 0, 0.1, 400);
  sideCam.position.set(0, 0, 200);
  sideCam.lookAt(0, 0, 0);
  // Seen side-on the crowns overlap far more, so fewer trees keep their spires readable.
  const side = bake(sideCam, 150, (t, ox, oy) => new THREE.Vector3(t.x + ox * T, t.y + oy * T - 6, -(t.y + oy * T)));

  kinds.forEach((g) => g.dispose());
  mat.dispose();
  return { top, side };
}
