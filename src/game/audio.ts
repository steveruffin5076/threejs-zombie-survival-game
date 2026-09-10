// ─────────────────────────────────────────────────────────────────────────────
// audio.ts — 100% synthesized sound via WebAudio (no audio assets).
// Gunshot cracks, glock reload foley, zombie groans/squelches, explosion,
// ambient wind bed, low-hp heartbeat, UI clicks and stage-clear stingers.
// ─────────────────────────────────────────────────────────────────────────────

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private lastShot = 0;
  private heartbeatT = 0;
  private groanT = 2.5;
  private rumbleT = 6;
  private windOn = false;

  /** must be called from a user gesture */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(this.ctx.destination);
      // shared white-noise buffer
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.startWind();
    } catch { this.ctx = null; }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.02);
  }
  get isMuted() { return this.muted; }

  // ── ambient wind bed + scheduled distant groans ────────────────────────────
  private startWind() {
    if (!this.ctx || !this.master || !this.noiseBuf || this.windOn) return;
    this.windOn = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
    const g = this.ctx.createGain(); g.gain.value = 0.045;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(); lfo.start();
  }

  /** call every frame: heartbeat + ambient groan scheduler */
  update(dt: number, hp: number, playing: boolean, aliveZombies: number, zombieDist: (i: number) => number) {
    if (!this.ctx || !this.master) return;
    if (playing && hp > 0 && hp < 32) {
      this.heartbeatT -= dt;
      if (this.heartbeatT <= 0) {
        this.heartbeatT = 0.62 + (hp / 32) * 0.5;
        this.thump(0.16); setTimeout(() => this.thump(0.11), 180);
      }
    }
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = 3 + Math.random() * 6;
      if (playing && aliveZombies > 0) {
        let best = 1e9, bi = -1;
        for (let i = 0; i < aliveZombies; i += 1 + Math.floor(Math.random() * 3)) {
          const d = zombieDist(i); if (d < best) { best = d; bi = i; }
        }
        if (bi >= 0) this.groan(Math.min(1, best / 30));
      } else if (Math.random() > 0.5) this.groan(0.85); // distant ghost moan
    }
    this.rumbleT -= dt;
    if (this.rumbleT <= 0) { this.rumbleT = 9 + Math.random() * 14; this.rumble(); }
  }

  private thump(vol: number) {
    const c = this.ctx!; if (!c || !this.master) return;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(68, c.currentTime); o.frequency.exponentialRampToValueAtTime(40, c.currentTime + 0.12);
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.14);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + 0.16);
  }

  private noise(dur: number, filter: (n: BiquadFilterNode) => void, vol: number, when = 0): void {
    const c = this.ctx!; if (!c || !this.master || !this.noiseBuf) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = c.createBiquadFilter(); filter(f);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, when = 0, lowpass = 0) {
    const c = this.ctx!; if (!c || !this.master) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    let node: AudioNode = g;
    if (lowpass > 0) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass; g.connect(lp); node = lp; }
    o.connect(g); node.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ── Glock 19 ───────────────────────────────────────────────────────────────
  shot() {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastShot < 45) return; // voice guard on spam
    this.lastShot = now;
    // supersonic crack
    this.noise(0.07, f => { f.type = 'highpass'; f.frequency.value = 1400; }, 0.5);
    // body boom
    this.noise(0.16, f => { f.type = 'lowpass'; f.frequency.setValueAtTime(2600, this.ctx!.currentTime); f.frequency.exponentialRampToValueAtTime(240, this.ctx!.currentTime + 0.15); }, 0.7);
    this.tone('sine', 160, 52, 0.13, 0.5);
    // mech click
    this.noise(0.03, f => { f.type = 'bandpass'; f.frequency.value = 3200; }, 0.2, 0.01);
  }
  dryFire() { this.noise(0.04, f => { f.type = 'bandpass'; f.frequency.value = 2600; }, 0.22); }
  reload() {
    this.noise(0.05, f => { f.type = 'bandpass'; f.frequency.value = 1800; }, 0.3, 0.02);        // mag out
    this.noise(0.04, f => { f.type = 'bandpass'; f.frequency.value = 900; }, 0.24, 0.3);        // clatter
    this.noise(0.05, f => { f.type = 'bandpass'; f.frequency.value = 2000; }, 0.34, 0.62);      // mag in
    this.noise(0.09, f => { f.type = 'bandpass'; f.frequency.value = 3300; }, 0.4, 0.82);       // slide rack
    this.tone('square', 220, 120, 0.05, 0.1, 0.82);
  }

  // ── impacts ────────────────────────────────────────────────────────────────
  hitFlesh() {
    this.noise(0.1, f => { f.type = 'lowpass'; f.frequency.value = 500; }, 0.5);
    this.tone('sine', 110, 55, 0.11, 0.32);
  }
  headshot() {
    this.hitFlesh();
    this.noise(0.05, f => { f.type = 'bandpass'; f.frequency.value = 4200; }, 0.3);
  }
  zombieDie() {
    const f = 90 + Math.random() * 90;
    this.tone('sawtooth', f, f * 0.35, 0.5, 0.22, 0, 300);
    this.tone('sawtooth', f * 1.5, f * 0.5, 0.4, 0.12, 0.05, 260);
  }
  groan(dist01 = 0.5) {
    const vol = 0.16 * (1 - dist01 * 0.8);
    if (vol < 0.015) return;
    const f = 70 + Math.random() * 70;
    const wobble = (Math.random() - 0.5) * 30;
    this.tone('sawtooth', f + wobble, f * 0.6, 0.7 + Math.random() * 0.6, vol, 0, 240);
    this.noise(0.5, fl => { fl.type = 'bandpass'; fl.frequency.value = 300; }, vol * 0.5);
  }
  bite() {
    this.noise(0.09, f => { f.type = 'bandpass'; f.frequency.value = 340; f.Q.value = 2; }, 0.5);
    this.tone('sine', 90, 40, 0.12, 0.3);
  }
  playerHurt() {
    this.tone('sawtooth', 130, 60, 0.18, 0.3, 0, 500);
    this.noise(0.14, f => { f.type = 'lowpass'; f.frequency.value = 700; }, 0.4);
  }
  explosion() {
    const c = this.ctx; if (!c) return;
    this.noise(1.1, f => { f.type = 'lowpass'; f.frequency.setValueAtTime(3200, c.currentTime); f.frequency.exponentialRampToValueAtTime(90, c.currentTime + 1); }, 1.0);
    this.tone('sine', 130, 26, 0.9, 0.9);
    this.noise(0.4, f => { f.type = 'bandpass'; f.frequency.value = 900; }, 0.4, 0.05);
  }
  private rumble() {
    this.noise(1.8, f => { f.type = 'lowpass'; f.frequency.value = 120; }, 0.12);
  }

  // ── events ─────────────────────────────────────────────────────────────────
  stageClear() {
    this.tone('sine', 262, 262, 0.7, 0.2, 0, 900);
    this.tone('sine', 392, 392, 0.9, 0.18, 0.18, 900);
    this.tone('triangle', 523, 523, 1.1, 0.12, 0.34, 900);
  }
  actSting() {
    this.tone('sawtooth', 65, 60, 1.6, 0.2, 0, 220);
    this.tone('sine', 130, 128, 1.6, 0.16, 0.1, 300);
  }
  uiClick() { this.tone('square', 900, 500, 0.05, 0.08, 0, 2400); }
  jump() { this.noise(0.08, f => { f.type = 'lowpass'; f.frequency.value = 500; }, 0.12); }
  land() { this.noise(0.1, f => { f.type = 'lowpass'; f.frequency.value = 260; }, 0.2); }
  shell() { this.noise(0.03, f => { f.type = 'bandpass'; f.frequency.value = 5200; }, 0.05); }
}
