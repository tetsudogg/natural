// The sounds of the valley, synthesised live with Web Audio (no sound files).

import * as THREE from 'three';
import { streamX, waterLevel, WATERFALL_Z, HALF } from './world';

type Ground = 'grass' | 'gravel' | 'forest';

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private leavesGain!: GainNode;
  private streamPanner!: PannerNode;
  private streamGain!: GainNode;
  private babbleGain!: GainNode;
  private cicadaGain!: GainNode;
  private crickets: { panner: PannerNode; env: GainNode; next: number; kind: number }[] = [];
  private nextBird = 0;
  private nextOwl = 0;
  private gust = 0.5;
  private gustTarget = 0.5;
  private nextGust = 0;
  private nextBabble = 0;
  private listenerPos = new THREE.Vector3();

  get started() {
    return this.ctx !== null;
  }

  // Must be called from a click or key press so the browser allows sound.
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 1.5);
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    // Pink-ish noise (Paul Kellet's filter) sounds softer than white noise.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }

    // Wind in the valley and leaves overhead.
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.1;
    this.noiseSource(this.filter('lowpass', 380, 0.7), this.windGain, this.master);
    this.leavesGain = ctx.createGain();
    this.leavesGain.gain.value = 0.02;
    this.noiseSource(this.filter('bandpass', 3200, 0.6), this.leavesGain, this.master);

    // The stream follows the listener along the bank; a babbling layer flickers on top.
    this.streamPanner = this.panner(4, 1.1);
    this.streamGain = ctx.createGain();
    this.streamGain.gain.value = 0.55;
    this.streamGain.connect(this.streamPanner);
    this.noiseSource(this.filter('bandpass', 900, 0.4), this.streamGain, null);
    this.babbleGain = ctx.createGain();
    this.babbleGain.gain.value = 0.2;
    this.noiseSource(this.filter('bandpass', 2400, 1.2), this.babbleGain, this.streamGain);

    // The waterfall is a fixed, louder source.
    const fall = this.panner(8, 1);
    fall.positionX.value = streamX(WATERFALL_Z);
    fall.positionY.value = waterLevel(WATERFALL_Z);
    fall.positionZ.value = WATERFALL_Z;
    const fallGain = ctx.createGain();
    fallGain.gain.value = 1.1;
    fallGain.connect(fall);
    this.noiseSource(this.filter('lowpass', 1600, 0.5), fallGain, null);

    // Cicadas in the summer day.
    this.cicadaGain = ctx.createGain();
    this.cicadaGain.gain.value = 0;
    const cicadaAm = ctx.createGain();
    cicadaAm.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(cicadaAm.gain);
    lfo.start();
    this.noiseSource(this.filter('bandpass', 5200, 4), cicadaAm, this.cicadaGain);
    this.cicadaGain.connect(this.master);

    // Night insects: bell crickets (suzumushi) and field crickets.
    for (let i = 0; i < 6; i++) {
      const kind = i % 2;
      const panner = this.panner(3, 1.4);
      const env = ctx.createGain();
      env.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.frequency.value = kind === 0 ? 4400 + Math.random() * 300 : 3700 + Math.random() * 300;
      const am = ctx.createGain();
      const amLfo = ctx.createOscillator();
      amLfo.frequency.value = kind === 0 ? 45 : 28;
      const amDepth = ctx.createGain();
      amDepth.gain.value = 0.5;
      am.gain.value = 0.5;
      amLfo.connect(amDepth).connect(am.gain);
      osc.connect(am).connect(env).connect(panner);
      osc.start();
      amLfo.start();
      this.crickets.push({ panner, env, next: 0, kind });
    }
  }

  private filter(type: BiquadFilterType, freq: number, q: number) {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private noiseSource(filter: BiquadFilterNode, gain: AudioNode, dest: AudioNode | null) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random() * 3;
    src.start(0, Math.random() * 3);
    src.connect(filter).connect(gain);
    if (dest) gain.connect(dest);
  }

  private panner(ref: number, rolloff: number) {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.connect(this.master);
    return p;
  }

  private setPos(p: PannerNode, x: number, y: number, z: number) {
    const t = this.ctx!.currentTime;
    p.positionX.setTargetAtTime(x, t, 0.05);
    p.positionY.setTargetAtTime(y, t, 0.05);
    p.positionZ.setTargetAtTime(z, t, 0.05);
  }

  private randomNear(minD: number, maxD: number, h0: number, h1: number) {
    const a = Math.random() * Math.PI * 2;
    const d = minD + Math.random() * (maxD - minD);
    const x = Math.max(-HALF, Math.min(HALF, this.listenerPos.x + Math.cos(a) * d));
    const z = Math.max(-HALF, Math.min(HALF, this.listenerPos.z + Math.sin(a) * d));
    return [x, this.listenerPos.y + h0 + Math.random() * (h1 - h0), z] as const;
  }

  private bird(morning: number) {
    const ctx = this.ctx!;
    const [x, y, z] = this.randomNear(12, 45, 4, 14);
    const p = this.panner(6, 1);
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    const g = ctx.createGain();
    g.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.connect(g).connect(p);
    let t = ctx.currentTime + 0.05;
    const style = Math.random();
    if (style < 0.25 + morning * 0.15) {
      // A long held whistle and a quick warble, like a bush warbler.
      osc.frequency.setValueAtTime(1150, t);
      osc.frequency.linearRampToValueAtTime(1250, t + 0.9);
      g.gain.linearRampToValueAtTime(0.16, t + 0.15);
      g.gain.setValueAtTime(0.16, t + 0.9);
      g.gain.linearRampToValueAtTime(0, t + 1.0);
      t += 1.15;
      const notes = [2300, 2900, 2100];
      notes.forEach((f, i) => {
        const s = t + i * 0.13;
        osc.frequency.setValueAtTime(f, s);
        osc.frequency.linearRampToValueAtTime(f * 1.12, s + 0.1);
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.14, s + 0.02);
        g.gain.linearRampToValueAtTime(0, s + 0.11);
      });
      t += notes.length * 0.13 + 0.1;
    } else {
      // Short chirps, like a tit or sparrow.
      const n = 2 + Math.floor(Math.random() * 5);
      const f0 = 3200 + Math.random() * 2400;
      for (let i = 0; i < n; i++) {
        const s = t + i * (0.09 + Math.random() * 0.08);
        osc.frequency.setValueAtTime(f0 * (1 + Math.random() * 0.2), s);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, s + 0.06);
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.08, s + 0.01);
        g.gain.linearRampToValueAtTime(0, s + 0.07);
      }
      t += n * 0.17 + 0.1;
    }
    osc.start();
    osc.stop(t + 0.1);
    osc.onended = () => p.disconnect();
  }

  private owl() {
    const ctx = this.ctx!;
    const [x, y, z] = this.randomNear(35, 70, 6, 12);
    const p = this.panner(10, 1);
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    const g = ctx.createGain();
    g.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.connect(g).connect(p);
    const t = ctx.currentTime + 0.05;
    [0, 0.7, 1.05].forEach((o, i) => {
      const len = i === 0 ? 0.5 : 0.3;
      osc.frequency.setValueAtTime(390, t + o);
      osc.frequency.linearRampToValueAtTime(340, t + o + len);
      g.gain.setValueAtTime(0, t + o);
      g.gain.linearRampToValueAtTime(0.35, t + o + 0.08);
      g.gain.linearRampToValueAtTime(0, t + o + len);
    });
    osc.start(t);
    osc.stop(t + 1.6);
    osc.onended = () => p.disconnect();
  }

  footstep(ground: Ground, running: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.filter('bandpass', ground === 'gravel' ? 2600 : ground === 'forest' ? 1500 : 900, ground === 'gravel' ? 1.5 : 0.8);
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const vol = (ground === 'gravel' ? 0.5 : 0.28) * (running ? 1.3 : 1) * (0.8 + Math.random() * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + (ground === 'gravel' ? 0.16 : 0.12));
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, 0.2);
  }

  setVolume(v: number) {
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  update(dt: number, cam: THREE.Camera, daylight: number, night: number, hour: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const l = ctx.listener;
    cam.getWorldPosition(this.listenerPos);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    l.positionX.setTargetAtTime(this.listenerPos.x, now, 0.03);
    l.positionY.setTargetAtTime(this.listenerPos.y, now, 0.03);
    l.positionZ.setTargetAtTime(this.listenerPos.z, now, 0.03);
    l.forwardX.setTargetAtTime(fwd.x, now, 0.03);
    l.forwardY.setTargetAtTime(fwd.y, now, 0.03);
    l.forwardZ.setTargetAtTime(fwd.z, now, 0.03);
    l.upX.setTargetAtTime(up.x, now, 0.03);
    l.upY.setTargetAtTime(up.y, now, 0.03);
    l.upZ.setTargetAtTime(up.z, now, 0.03);

    // Stream sound sits at the nearest point of the stream.
    const sz = this.listenerPos.z;
    this.setPos(this.streamPanner, streamX(sz), waterLevel(sz) + 0.2, sz);
    if (now > this.nextBabble) {
      this.nextBabble = now + 0.05 + Math.random() * 0.15;
      this.babbleGain.gain.setTargetAtTime(0.1 + Math.random() * 0.4, now, 0.04);
    }

    // Gusts come and go every few seconds.
    if (now > this.nextGust) {
      this.nextGust = now + 3 + Math.random() * 6;
      this.gustTarget = 0.25 + Math.random() * 0.75;
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.4);
    this.windGain.gain.setTargetAtTime(0.05 + this.gust * 0.1, now, 0.5);
    this.leavesGain.gain.setTargetAtTime(this.gust * 0.05 * (0.4 + daylight * 0.6), now, 0.5);

    // Cicadas at midday only.
    const midday = Math.max(0, 1 - Math.abs(hour - 13) / 4);
    this.cicadaGain.gain.setTargetAtTime(0.035 * midday * daylight, now, 2);

    // Birds sing most at dawn and in the morning.
    const morning = Math.max(0, 1 - Math.abs(hour - 7) / 3);
    if (daylight > 0.2 && now > this.nextBird) {
      this.bird(morning);
      this.nextBird = now + (1.5 + Math.random() * 6) / (0.4 + morning + daylight * 0.3);
    }
    if (night > 0.6 && now > this.nextOwl) {
      if (this.nextOwl > 0) this.owl();
      this.nextOwl = now + 25 + Math.random() * 50;
    }

    // Crickets sing in trains of rings; each re-seats itself near the listener.
    for (const c of this.crickets) {
      if (now < c.next) continue;
      if (night < 0.3) {
        c.next = now + 2;
        continue;
      }
      const [x, y, z] = this.randomNear(4, 18, -1.5, -1);
      c.panner.positionX.value = x;
      c.panner.positionY.value = y;
      c.panner.positionZ.value = z;
      const rings = 3 + Math.floor(Math.random() * 6);
      const on = c.kind === 0 ? 0.55 : 0.18;
      const gap = c.kind === 0 ? 0.35 : 0.12;
      const vol = (c.kind === 0 ? 0.05 : 0.035) * night;
      let t = now + 0.05;
      for (let i = 0; i < rings; i++) {
        c.env.gain.setValueAtTime(0, t);
        c.env.gain.linearRampToValueAtTime(vol, t + 0.04);
        c.env.gain.setValueAtTime(vol, t + on - 0.05);
        c.env.gain.linearRampToValueAtTime(0, t + on);
        t += on + gap;
      }
      c.next = t + 0.5 + Math.random() * 3;
    }
  }
}
