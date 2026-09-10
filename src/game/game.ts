// ─────────────────────────────────────────────────────────────────────────────
// game.ts — the orchestrator. Owns the renderer/scene/camera, lighting rig,
// input, main loop, hitscan combat, exploder blast chains, safe-house stage
// logic (4 acts × 4 stages), the difficulty director, horde surges, screen
// shake/fades and throttled HUD state emission to React.
//
// Debug: press ` (backquote) to toggle orbit controls.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ACTS, HudState, initialHud, stageLength, DMG_BODY, DMG_HEAD, MAX_RANGE, MAG_SIZE, Z_EXPLODER, type Phase } from './state';
import { Effects } from './effects';
import { AudioManager } from './audio';
import { Player } from './player';
import { ZombieManager, type Zombie } from './zombies';
import { StageWorld } from './world';
import { PostFX } from './postfx';

const CAM_Y = 3.15, CAM_Z = 12.3, LOOK_Y = 2.15;
const LEAD = 2.35; // camera leads the player to the right

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private fx: PostFX;
  private effects: Effects;
  private audio = new AudioManager();
  private player: Player;
  private zombies: ZombieManager;
  private world: StageWorld | null = null;
  private hemi: THREE.HemisphereLight;
  private moon: THREE.DirectionalLight;
  private clock = new THREE.Clock();
  private raf = 0;
  private onHud: (h: HudState) => void = () => {};

  // campaign state
  private act = 1; private stage = 1;
  private kills = 0;
  private timeSec = 0;
  private phase: Phase = 'menu';
  private phaseTimer = 0;
  private safeNear = false;
  private safeReached = false;
  private length = 200;

  // combat state
  private trauma = 0;
  private damageFlash = 0;
  private invulnT = 0;
  private surgeTimer = 14;
  private surgeBannerT = 0;
  private deathSeq = -1;

  // fades
  private fade = 1;
  private fadeTarget = 0;
  private onFaded: (() => void) | null = null;

  // input
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, down: false };
  private raycaster = new THREE.Raycaster();
  private planeZ0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private tmpV3 = new THREE.Vector3();
  private ndc = new THREE.Vector2();
  private aliveCache: Zombie[] = [];
  private debugOrbit: OrbitControls | null = null;
  private tNow = 0;
  private lastHudJson = '';
  private emitTimer = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 220);
    this.camera.position.set(8, CAM_Y, CAM_Z);

    const p = ACTS[0];
    this.scene.background = new THREE.Color(p.skyTop);
    this.scene.fog = new THREE.FogExp2(p.fogColor, p.fogDensity);
    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(p.moonColor, p.moonIntensity);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.camera.left = -18; this.moon.shadow.camera.right = 18;
    this.moon.shadow.camera.top = 18; this.moon.shadow.camera.bottom = -8;
    this.moon.shadow.camera.near = 0.5; this.moon.shadow.camera.far = 60;
    this.moon.shadow.bias = -0.0006;
    this.scene.add(this.moon, this.moon.target);

    this.effects = new Effects(this.scene);
    this.player = new Player(this.scene);
    this.zombies = new ZombieManager(this.scene, this.effects, this.audio);

    this.fx = new PostFX(this.renderer, this.scene, this.camera, canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);

    this.buildStage(1, 1);
    this.setPhase('menu');
    this.bindInput();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('blur', this.onBlur);
    this.loop();
  }

  onHudState(cb: (h: HudState) => void) { this.onHud = cb; this.emitHud(true); }

  // ── public controls (menu buttons) ─────────────────────────────────────────
  start() {
    this.audio.unlock();
    this.audio.uiClick();
    this.kills = 0; this.timeSec = 0;
    this.transition(() => {
      this.buildStage(1, 1);
      this.setPhase('actbanner');
      this.audio.actSting();
    });
  }
  restartStage() {
    this.audio.unlock(); this.audio.uiClick();
    this.transition(() => {
      this.buildStage(this.act, this.stage);
      this.setPhase('playing');
    });
  }
  resume() { if (this.phase === 'paused') { this.audio.uiClick(); this.setPhase('playing'); } }
  togglePause() {
    if (this.phase === 'playing') this.setPhase('paused');
    else if (this.phase === 'paused') this.setPhase('playing');
  }
  backToMenu() {
    this.audio.uiClick();
    this.transition(() => {
      this.kills = 0; this.timeSec = 0;
      this.buildStage(1, 1);
      this.setPhase('menu');
    });
  }
  toggleMute() {
    this.audio.unlock();
    const m = !this.audio.isMuted;
    this.audio.setMuted(m);
    this.emitHud(true);
  }

  // ── input ──────────────────────────────────────────────────────────────────
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const c = e.code;
    if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(c)) e.preventDefault();
    this.audio.unlock();
    if (c === 'KeyM') { this.toggleMute(); return; }
    if (c === 'Backquote') { this.toggleOrbit(); return; }
    if (c === 'KeyP' || c === 'Escape') {
      if (this.phase === 'playing') this.setPhase('paused');
      else if (this.phase === 'paused') this.setPhase('playing');
      return;
    }
    if (c === 'Enter' && this.phase === 'menu') { this.start(); return; }
    this.keys.add(c);
    if ((c === 'Space' || c === 'KeyW' || c === 'ArrowUp') && this.phase === 'playing') this.player.jumpQueued = true;
    if (c === 'KeyR' && this.phase === 'playing') { if (!this.player.reloading && this.player.ammo < MAG_SIZE) { this.player.startReload(); this.audio.reload(); } }
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onMouseMove = (e: MouseEvent) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.audio.unlock();
    this.mouse.down = true;
  };
  private onMouseUp = (e: MouseEvent) => { if (e.button === 0) this.mouse.down = false; };
  private onBlur = () => { if (this.phase === 'playing') this.setPhase('paused'); };

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  private toggleOrbit() {
    if (!this.debugOrbit) {
      this.debugOrbit = new OrbitControls(this.camera, this.canvas);
      this.debugOrbit.target.set(this.player.x, 2, 0);
    }
    this.debugOrbit.enabled = !this.debugOrbit.enabled;
  }

  // ── stage / act lifecycle ──────────────────────────────────────────────────
  private buildStage(act: number, stage: number) {
    this.world?.dispose();
    this.act = act; this.stage = stage;
    const p = ACTS[act - 1];
    this.length = stageLength(act, stage);
    this.world = new StageWorld(act - 1, stage, this.length, p);
    this.scene.add(this.world.group);

    // palette application
    const pal = ACTS[act - 1];
    (this.scene.background as THREE.Color).set(pal.skyTop);
    (this.scene.fog as THREE.FogExp2).color.set(pal.fogColor);
    (this.scene.fog as THREE.FogExp2).density = pal.fogDensity;
    this.hemi.color.set(pal.hemiSky); this.hemi.groundColor.set(pal.hemiGround); this.hemi.intensity = pal.hemiIntensity;
    this.moon.color.set(pal.moonColor); this.moon.intensity = pal.moonIntensity;
    this.renderer.toneMappingExposure = pal.exposure;
    this.fx.setBloom(pal.bloom);

    this.player.reset(2);
    this.zombies.reset();
    this.zombies.spawningEnabled = false; // enabled when phase becomes playing
    this.effects.reset();
    this.safeNear = false; this.safeReached = false;
    this.surgeTimer = 16 + Math.random() * 8;
    this.deathSeq = -1;
    this.updateDifficulty();
  }

  private updateDifficulty() {
    const a = this.act, s = this.stage;
    const progress = THREE.MathUtils.clamp(this.player.x / this.length, 0, 1);
    this.zombies.tuning.interval = Math.max(0.5, 1.9 - a * 0.22 - s * 0.08 - progress * 0.45);
    this.zombies.tuning.maxAlive = Math.min(26, 10 + a * 3 + s);
    this.zombies.tuning.runnerP = Math.min(0.5, 0.08 + a * 0.06 + s * 0.02);
    this.zombies.tuning.exploderP = a === 1 && s === 1 ? 0 : Math.min(0.3, 0.05 + a * 0.04);
    this.zombies.tuning.speedMul = 1 + (a - 1) * 0.1 + (s - 1) * 0.03;
    this.zombies.tuning.hpMul = 1 + (a - 1) * 0.16;
  }

  private setPhase(ph: Phase) {
    this.phase = ph;
    this.phaseTimer =
      ph === 'actbanner' ? 2.8 :
      ph === 'stageclear' ? 2.4 : 0;
    // fade targets per phase (overlays keep the scene dimly visible)
    this.fadeTarget =
      ph === 'playing' ? 0 :
      ph === 'menu' ? 0.12 :
      ph === 'actbanner' ? 0.1 :
      ph === 'stageclear' ? 0.35 :
      ph === 'paused' ? 0.5 : 0.55;
    if (ph === 'playing') this.zombies.spawningEnabled = !this.safeReached;
    if (ph !== 'playing') this.mouse.down = false;
    this.clock.getDelta();
    this.emitHud(true);
  }

  private transition(mid: () => void) {
    this.fadeTarget = 1;
    this.onFaded = () => { mid(); };
  }

  // ── combat: hitscan ────────────────────────────────────────────────────────
  private updateAim() {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((this.mouse.x - rect.left) / rect.width) * 2 - 1;
    const ny = -(((this.mouse.y - rect.top) / rect.height) * 2 - 1);
    this.ndc.set(nx, ny);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.planeZ0, this.tmpV3);
    if (hit) {
      this.player.aimX = hit.x;
      this.player.aimY = THREE.MathUtils.clamp(hit.y, 0.25, 6.5);
    }
  }

  private shoot() {
    const r = this.player.tryFire();
    if (r === 'auto') { this.audio.reload(); return; }
    if (r !== 'fired') return;
    this.audio.shot();
    const m = this.player.muzzleWorld(this.tmpV3);
    let dx = this.player.aimX - m.x, dy = this.player.aimY - m.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    if (dx * this.player.facing < 0.05) { dx = 0.05 * this.player.facing; const n = Math.hypot(dx, dy); dx /= n; dy /= n; }
    this.effects.muzzle(m.x, m.y, m.z, Math.atan2(dy, dx));
    this.effects.casing(m.x - 0.1 * this.player.facing, m.y + 0.04, m.z, this.player.facing);
    if (Math.random() < 0.3) this.audio.shell();
    this.trauma = Math.min(1, this.trauma + 0.07);

    // hitscan vs zombie circles (head circle first for headshot check)
    let bestT = MAX_RANGE, hitZ: Zombie | null = null, headshot = false;
    this.zombies.collectAlive(this.aliveCache);
    for (const z of this.aliveCache) {
      const circles: [number, number, number, boolean][] = [
        [z.x, z.headY(), z.headR(), true],
        [z.x, z.bodyY(), z.bodyR(), false],
        [z.x, 0.35, 0.42, false], // legs
      ];
      for (const [cx, cy, cr, isHead] of circles) {
        const ox = cx - m.x, oy = cy - m.y;
        const t = ox * dx + oy * dy;
        if (t < 0.1 || t > bestT) continue;
        const px = m.x + dx * t, py = m.y + dy * t;
        const ddx = px - cx, ddy = py - cy;
        if (ddx * ddx + ddy * ddy < cr * cr) { bestT = t; hitZ = z; headshot = isHead; }
      }
    }
    // ground intersection (bullet drops into the asphalt)
    if (dy < -0.02) {
      const tg = (0.03 - m.y) / dy;
      if (tg > 0 && tg < bestT) { bestT = tg; hitZ = null; }
    }
    const ex = m.x + dx * bestT, ey = m.y + dy * bestT;
    this.effects.tracer(m.x, m.y, m.z, ex, ey, 0);

    if (hitZ) {
      const died = this.zombies.damage(hitZ, headshot ? DMG_HEAD : DMG_BODY, headshot, Math.sign(dx) || 1);
      this.effects.hitMarker(ex, ey, 0, headshot);
      if (died) this.kills++;
    } else if (bestT < MAX_RANGE) {
      this.effects.sparkImpact(ex, ey, 0);
    }
  }

  /** radial blasts from exploding zombies (chains to other zombies + player) */
  private processBlasts() {
    const blasts = this.zombies.drainBlasts();
    for (const b of blasts) {
      this.trauma = Math.min(1, this.trauma + 0.5);
      this.zombies.collectAlive(this.aliveCache);
      for (const z of this.aliveCache) {
        if (Math.abs(z.x - b.x) < 2.4) {
          const dir = Math.sign(z.x - b.x) || 1;
          this.zombies.kill(z, dir, false);
          this.kills++; // chain detonations count too
        }
      }
      if (this.player.alive && Math.abs(this.player.x - b.x) < Z_EXPLODER.blast && this.invulnT <= 0) {
        this.hurtPlayer(Z_EXPLODER.dmg, b.x);
      }
    }
  }

  private hurtPlayer(dmg: number, fromX: number) {
    if (this.invulnT > 0 || !this.player.alive) return;
    this.invulnT = 0.55;
    const died = this.player.damage(dmg);
    this.damageFlash = 1;
    this.trauma = Math.min(1, this.trauma + 0.45);
    void fromX;
    this.audio.playerHurt();
    if (died) { this.deathSeq = 1.6; this.audio.groan(0); }
    this.emitHud(true);
  }

  // ── phase timers / state machine ───────────────────────────────────────────
  private stepPhase(dt: number) {
    if (this.phase === 'actbanner') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) { this.setPhase('playing'); }
    } else if (this.phase === 'stageclear') {
      this.phaseTimer -= dt;
      // auto-walk into the doorway
      if (this.world) {
        const doorX = this.world.houseX - 2;
        this.player.moveAxis = this.player.x < doorX ? 1 : 0;
      }
      if (this.phaseTimer <= 0) {
        const nextA = this.stage === 4 ? this.act + 1 : this.act;
        const nextS = this.stage === 4 ? 1 : this.stage + 1;
        if (nextA > 4) { // campaign complete!
          this.transition(() => {
            this.setPhase('victory');
          });
        } else {
          this.transition(() => {
            this.buildStage(nextA, nextS);
            this.player.heal(30);
            if (nextS === 1) { this.setPhase('actbanner'); this.audio.actSting(); }
            else this.setPhase('playing');
          });
        }
      }
    }
    // player death sequencing
    if (this.deathSeq > 0) {
      this.deathSeq -= dt;
      if (this.deathSeq <= 0) {
        this.deathSeq = -1;
        this.setPhase('gameover');
      }
    }
  }

  // ── main loop ──────────────────────────────────────────────────────────────
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    const paused = this.phase === 'paused';
    const dt = paused ? 0 : rawDt;
    this.tNow += dt;

    // fade step
    const fs = rawDt * 2.4;
    if (this.fade < this.fadeTarget) this.fade = Math.min(this.fadeTarget, this.fade + fs);
    else if (this.fade > this.fadeTarget) this.fade = Math.max(this.fadeTarget, this.fade - fs);
    if (this.fadeTarget >= 1 && this.fade > 0.985 && this.onFaded) {
      const f = this.onFaded; this.onFaded = null; f();
    }

    const locked = this.phase !== 'playing';

    if (dt > 0) {
      // input → player intent
      if (this.phase === 'playing') {
        const L = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
        const Rk = this.keys.has('KeyD') || this.keys.has('ArrowRight');
        this.player.moveAxis = (Rk ? 1 : 0) - (L ? 1 : 0);
        this.player.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
        this.updateAim();
      }

      if (this.phase !== 'menu') {
        this.player.update(dt, this.effects, this.audio, locked);
        // clamp to stage bounds (also lets the death crumple animate in gameover)
        this.player.x = THREE.MathUtils.clamp(this.player.x, 1.1, this.length - 8.4);
      }

      if (this.phase === 'playing') {
        this.timeSec += dt;
        this.invulnT -= dt;
        if (this.mouse.down) this.shoot();

        const vh = this.viewHalf();
        this.zombies.update(dt, this.camX(), vh, this.player.x, this.player.alive,
          (dmg, fx) => this.hurtPlayer(dmg, fx), this.tNow);
        this.processBlasts();

        // safe-house proximity → flag lights up; contact → stage clear
        if (this.world && !this.safeReached) {
          const d = this.world.houseX - this.player.x;
          const near = d < 15;
          if (near !== this.safeNear) { this.safeNear = near; this.world.setFlagLit(near); this.emitHud(true); }
          if (this.player.x >= this.world.houseX - 2.6 && this.player.alive) {
            this.safeReached = true;
            this.world.setFlagLit(true);
            this.zombies.spawningEnabled = false;
            this.audio.stageClear();
            this.setPhase('stageclear');
          }
        }

        // horde surges
        this.surgeTimer -= dt;
        if (this.surgeTimer <= 0 && !this.safeReached) {
          this.surgeTimer = 20 + Math.random() * 10 - this.act;
          this.zombies.surge(3 + Math.floor(Math.random() * 3) + this.act);
          this.surgeBannerT = 2.4;
          this.emitHud(true);
        }
        if (this.surgeBannerT > 0) { this.surgeBannerT -= dt; if (this.surgeBannerT <= 0) this.emitHud(true); }

        this.updateDifficulty();
        this.stepPhase(dt);
      } else if (this.phase === 'stageclear' || this.phase === 'actbanner') {
        const vh = this.viewHalf();
        this.zombies.update(dt, this.camX(), vh, this.player.x, false, () => {}, this.tNow);
        this.stepPhase(dt);
      } else if (this.phase === 'gameover' || this.phase === 'victory') {
        const vh = this.viewHalf();
        this.zombies.update(dt, this.camX(), vh, this.player.x, false, () => {}, this.tNow);
      } else if (this.phase === 'menu') {
        this.player.update(dt, this.effects, this.audio, true);
      }

      // ambient world emitters (steam / smoke / embers)
      if (this.world) {
        for (const e of this.world.emitters) {
          if (Math.abs(e.x - this.camX()) > 24) continue;
          e.t -= dt;
          if (e.t <= 0) {
            e.t = e.kind === 'smoke' ? 0.45 : e.kind === 'steam' ? 1.4 : 2.5 + Math.random() * 3;
            this.effects.ambient(e.x, e.y, e.z, e.kind);
          }
        }
        this.world.update(dt, this.camX(), this.tNow);
      }

      // audio ambience
      this.audio.update(dt, this.player.hp, this.phase === 'playing' && this.player.alive,
        this.aliveCache.length, (i) => Math.abs(this.aliveCache[i].x - this.player.x));

      this.damageFlash = Math.max(0, this.damageFlash - rawDt * 2.2);
    }

    // camera rig (also animates in menu / pause for life)
    this.updateCamera(rawDt);

    this.effects.update(paused ? 0 : dt, this.camX(), this.tNow);

    // grade uniforms
    const lowHp = this.player.alive && this.player.hp < 32 && this.phase === 'playing'
      ? (1 - this.player.hp / 32) * (0.18 + 0.12 * Math.sin(this.tNow * 5.5)) : 0;
    this.fx.set({ damage: this.damageFlash, lowHp, fade: this.fade });
    this.fx.render(rawDt);

    // throttled HUD emit
    this.emitTimer -= rawDt;
    if (this.emitTimer <= 0) { this.emitTimer = 0.12; this.emitHud(); }
  };

  private viewHalf(): number {
    return Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * CAM_Z * this.camera.aspect;
  }

  private camX(): number {
    if (this.phase === 'menu') return 7 + Math.sin(this.tNow * 0.07) * 3.5;
    return this.player.x + LEAD;
  }

  private updateCamera(dt: number) {
    if (this.debugOrbit?.enabled) { this.debugOrbit.update(); return; }
    const targetX = this.camX();
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma;
    const t = performance.now() * 0.001;
    const sx = Math.sin(t * 97) * sh * 0.3 + Math.sin(t * 1.3) * 0.02;
    const sy = Math.cos(t * 113) * sh * 0.22 + Math.sin(t * 1.7) * 0.015;
    const px = this.phase === 'menu' ? targetX : this.player.x + LEAD;
    this.camera.position.set(
      THREE.MathUtils.damp(this.camera.position.x, px + sx - this.player.kick * 0.1, 8, dt),
      CAM_Y + sy + (this.player.grounded ? 0 : this.player.vy * 0.02),
      CAM_Z,
    );
    this.camera.lookAt(px + 0.35 + sx, LOOK_Y + sy * 0.5, 0);
    this.camera.rotation.z += sh * Math.sin(t * 131) * 0.012;

    // shadow frustum follows the player
    this.moon.position.set(this.player.x - 6, 13, 6);
    this.moon.target.position.set(this.player.x + 2, 0, -1);
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  private emitHud(force = false) {
    const p = ACTS[this.act - 1];
    const distLeft = this.world ? Math.max(0, this.world.houseX - this.player.x) : 0;
    const h: HudState = {
      ...initialHud,
      phase: this.phase,
      hp: Math.ceil(this.player.hp),
      ammo: this.player.ammo,
      reloading: this.player.reloading,
      act: this.act, stage: this.stage,
      actName: p.name, actSubtitle: p.subtitle,
      kills: this.kills,
      timeSec: Math.floor(this.timeSec),
      progress: this.world ? THREE.MathUtils.clamp(this.player.x / (this.world.houseX - 2.6), 0, 1) : 0,
      distLeft: Math.round(distLeft),
      safeNear: this.safeNear,
      safeReached: this.safeReached,
      surge: this.surgeBannerT > 0,
      muted: this.audio.isMuted,
      hurtTick: 0,
      finalKills: this.kills,
      finalTime: Math.floor(this.timeSec),
    };
    const j = JSON.stringify(h);
    if (force || j !== this.lastHudJson) {
      this.lastHudJson = j;
      this.onHud(h);
    }
  }

  /** React needs a hurt pulse counter — maintained outside the throttle loop */
  pingHurt() { /* handled via damageFlash in Game; hud poll sees nothing — using force emit */
    this.emitHud(true);
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.setSize(w, h);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.world?.dispose();
    this.fx.dispose();
    this.renderer.dispose();
  }
}
