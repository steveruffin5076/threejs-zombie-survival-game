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
import { ACTS, HudState, initialHud, stageLength, Z_EXPLODER, type ActPalette, type GameMode, type Phase } from './state';
import { Effects } from './effects';
import { AudioManager } from './audio';
import { Player } from './player';
import { ZombieManager, type Zombie } from './zombies';
import type { ZombieType } from './models';
import { StageWorld } from './world';
import { PostFX } from './postfx';
import { WEAPONS } from './weapons';
import {
  ARENA_LENGTH, endlessTuning, newEndlessState, surgeInterval, surgeSize, waveDuration,
  xpForLevel, XP_KILL, XP_HEADSHOT_MUL, XP_CHAIN_MUL, type EndlessState,
} from './endless';
import { rollCards, toHudCards, type Card } from './cards';

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
  private mode: GameMode = 'campaign';
  private act = 1; private stage = 1;
  private kills = 0;
  private timeSec = 0;
  private phase: Phase = 'menu';
  private phaseTimer = 0;
  private safeNear = false;
  private safeReached = false;
  private length = 200;

  // endless state
  private endless: EndlessState | null = null;
  private pendingLevels = 0;
  private currentCards: Card[] = [];

  // palette crossfade (endless wave-based act cycling; campaign snaps instantly)
  private paletteActive = false;
  private paletteLerpT = 0;
  private pStartSky = new THREE.Color(); private pTargetSky = new THREE.Color();
  private pStartFog = new THREE.Color(); private pTargetFog = new THREE.Color();
  private pStartHemiSky = new THREE.Color(); private pTargetHemiSky = new THREE.Color();
  private pStartHemiGround = new THREE.Color(); private pTargetHemiGround = new THREE.Color();
  private pStartMoon = new THREE.Color(); private pTargetMoon = new THREE.Color();

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
    const wasEndless = this.mode === 'endless';
    this.transition(() => {
      if (wasEndless) this.buildArena(); else this.buildStage(this.act, this.stage);
      this.setPhase('playing');
    });
  }
  startEndless() {
    this.audio.unlock();
    this.audio.uiClick();
    this.kills = 0; this.timeSec = 0;
    this.transition(() => {
      this.buildArena();
      this.setPhase('playing');
    });
  }
  /** React calls this when the player picks one of the 3 level-up cards (click or keys 1-3) */
  pickCard(i: number) {
    const card = this.currentCards[i];
    if (!card) return;
    card.apply(this.player);
    this.audio.uiClick();
    this.pendingLevels = Math.max(0, this.pendingLevels - 1);
    this.currentCards = [];
    if (this.pendingLevels > 0) this.beginLevelUp();
    else this.setPhase('playing');
    this.emitHud(true);
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
  /** switch arsenal slot (keys 1-4 or the HUD weapon strip) */
  selectWeapon(i: number) {
    if (this.phase !== 'playing') return;
    const before = this.player.slot;
    this.player.selectSlot(i);
    if (this.player.slot !== before) this.audio.weaponSwap();
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
    if (c === 'KeyE' && this.phase === 'menu') { this.startEndless(); return; }
    if (c.startsWith('Digit')) {
      const n = parseInt(c.slice(5), 10);
      if (this.phase === 'levelup' && n >= 1 && n <= this.currentCards.length) { this.pickCard(n - 1); return; }
      if (this.phase === 'playing' && n >= 1 && n <= 4) { this.selectWeapon(n - 1); return; }
    }
    this.keys.add(c);
    if ((c === 'Space' || c === 'KeyW' || c === 'ArrowUp') && this.phase === 'playing') this.player.jumpQueued = true;
    if (c === 'KeyR' && this.phase === 'playing') {
      if (!this.player.reloading && this.player.ammo < this.player.magSize()) {
        this.player.startReload();
        const spec = this.player.spec;
        this.audio.reload(spec.audio, spec.reload * this.player.mods.reloadMul);
      }
    }
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
    this.mode = 'campaign';
    this.act = act; this.stage = stage;
    const p = ACTS[act - 1];
    this.length = stageLength(act, stage);
    this.world = new StageWorld(act - 1, stage, this.length, p);
    this.scene.add(this.world.group);
    this.applyPalette(p, true);

    this.player.reset(2);
    this.zombies.reset();
    this.zombies.spawningEnabled = false; // enabled when phase becomes playing
    this.zombies.twoSided = false;
    this.zombies.arenaMinX = this.world.minX;
    this.zombies.arenaMaxX = this.world.maxX;
    this.effects.reset();
    this.safeNear = false; this.safeReached = false;
    this.surgeTimer = 16 + Math.random() * 8;
    this.deathSeq = -1;
    this.endless = null;
    this.pendingLevels = 0;
    this.currentCards = [];
    this.updateDifficulty();
  }

  /** endless mode: fixed sealed arena, no safe house, waves escalate forever */
  private buildArena() {
    this.world?.dispose();
    this.mode = 'endless';
    this.act = 1; this.stage = 1;
    this.length = ARENA_LENGTH;
    const p = ACTS[0];
    this.world = new StageWorld(0, 1, this.length, p, { arena: true });
    this.scene.add(this.world.group);
    this.applyPalette(p, true);

    this.player.reset(this.length / 2);
    this.zombies.reset();
    this.zombies.spawningEnabled = false;
    this.zombies.twoSided = true;
    this.zombies.arenaMinX = this.world.minX;
    this.zombies.arenaMaxX = this.world.maxX;
    this.effects.reset();
    this.safeNear = false; this.safeReached = false;
    this.deathSeq = -1;
    this.endless = newEndlessState();
    this.pendingLevels = 0;
    this.currentCards = [];
    this.updateDifficulty();
  }

  /** snap = instant (stage build); false = crossfade over 1.5s (endless wave palette cycling) */
  private applyPalette(pal: ActPalette, snap: boolean) {
    this.hemi.intensity = pal.hemiIntensity;
    this.moon.intensity = pal.moonIntensity;
    (this.scene.fog as THREE.FogExp2).density = pal.fogDensity;
    this.renderer.toneMappingExposure = pal.exposure;
    this.fx.setBloom(pal.bloom);
    if (snap) {
      (this.scene.background as THREE.Color).set(pal.skyTop);
      (this.scene.fog as THREE.FogExp2).color.set(pal.fogColor);
      this.hemi.color.set(pal.hemiSky); this.hemi.groundColor.set(pal.hemiGround);
      this.moon.color.set(pal.moonColor);
      this.paletteActive = false;
    } else {
      this.pStartSky.copy(this.scene.background as THREE.Color); this.pTargetSky.set(pal.skyTop);
      this.pStartFog.copy((this.scene.fog as THREE.FogExp2).color); this.pTargetFog.set(pal.fogColor);
      this.pStartHemiSky.copy(this.hemi.color); this.pTargetHemiSky.set(pal.hemiSky);
      this.pStartHemiGround.copy(this.hemi.groundColor); this.pTargetHemiGround.set(pal.hemiGround);
      this.pStartMoon.copy(this.moon.color); this.pTargetMoon.set(pal.moonColor);
      this.paletteLerpT = 0;
      this.paletteActive = true;
    }
  }

  private stepPalette(dt: number) {
    if (!this.paletteActive) return;
    this.paletteLerpT = Math.min(1.5, this.paletteLerpT + dt);
    const t = this.paletteLerpT / 1.5;
    (this.scene.background as THREE.Color).copy(this.pStartSky).lerp(this.pTargetSky, t);
    (this.scene.fog as THREE.FogExp2).color.copy(this.pStartFog).lerp(this.pTargetFog, t);
    this.hemi.color.copy(this.pStartHemiSky).lerp(this.pTargetHemiSky, t);
    this.hemi.groundColor.copy(this.pStartHemiGround).lerp(this.pTargetHemiGround, t);
    this.moon.color.copy(this.pStartMoon).lerp(this.pTargetMoon, t);
    if (t >= 1) this.paletteActive = false;
  }

  private updateDifficulty() {
    if (this.mode === 'campaign') {
      const a = this.act, s = this.stage;
      const progress = THREE.MathUtils.clamp(this.player.x / this.length, 0, 1);
      this.zombies.tuning.interval = Math.max(0.5, 1.9 - a * 0.22 - s * 0.08 - progress * 0.45);
      this.zombies.tuning.maxAlive = Math.min(26, 10 + a * 3 + s);
      this.zombies.tuning.runnerP = Math.min(0.5, 0.08 + a * 0.06 + s * 0.02);
      this.zombies.tuning.exploderP = a === 1 && s === 1 ? 0 : Math.min(0.3, 0.05 + a * 0.04);
      this.zombies.tuning.speedMul = 1 + (a - 1) * 0.1 + (s - 1) * 0.03;
      this.zombies.tuning.hpMul = 1 + (a - 1) * 0.16;
      this.zombies.tuning.sideMix = 0;
    } else if (this.endless) {
      Object.assign(this.zombies.tuning, endlessTuning(this.endless.wave));
    }
  }

  /** endless-only: wave timer, intermission, surges, palette cycling every 3 waves */
  private stepEndless(dt: number) {
    const e = this.endless;
    if (!e) return;
    if (e.intermission > 0) {
      e.intermission -= dt;
      if (e.intermission <= 0) {
        e.intermission = 0;
        e.wave++;
        e.waveT = waveDuration(e.wave);
        this.zombies.spawningEnabled = this.player.alive;
        if (e.wave % 3 === 0) this.applyPalette(ACTS[Math.floor(e.wave / 3) % 4], false);
        this.emitHud(true);
      }
      return;
    }
    e.waveT -= dt;
    if (e.waveT <= 0) {
      e.waveT = 0;
      e.intermission = 6;
      this.zombies.spawningEnabled = false;
      this.emitHud(true);
      return;
    }
    e.surgeTimer -= dt;
    if (e.surgeTimer <= 0) {
      e.surgeTimer = surgeInterval(e.wave);
      this.zombies.surge(surgeSize(e.wave));
      this.surgeBannerT = 2.4;
      this.emitHud(true);
    }
  }

  /** award XP for a kill; `chained` = caught in an exploder's blast radius, not the shooter's direct hit */
  private awardXp(type: ZombieType, headshot: boolean, chained = false) {
    const e = this.endless;
    if (!e) return;
    let xp = XP_KILL[type];
    if (headshot) xp *= XP_HEADSHOT_MUL;
    if (chained) xp *= XP_CHAIN_MUL;
    e.xp += xp;
    while (e.xp >= e.xpNext) {
      e.xp -= e.xpNext;
      e.level++;
      e.xpNext = xpForLevel(e.level);
      this.pendingLevels++;
    }
    if (this.pendingLevels > 0 && this.phase === 'playing') this.beginLevelUp();
  }

  private beginLevelUp() {
    if (this.pendingLevels <= 0 || this.phase !== 'playing') return;
    this.currentCards = rollCards(this.player);
    this.setPhase('levelup');
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
      ph === 'paused' ? 0.5 :
      ph === 'levelup' ? 0.45 : 0.55;
    if (ph === 'playing') this.zombies.spawningEnabled = !this.safeReached && !(this.endless && this.endless.intermission > 0);
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

  /** single hitscan ray (one bullet or one shotgun pellet) vs zombie circles */
  private fireRay(m: THREE.Vector3, dx: number, dy: number, range: number, dmgBody: number, dmgHead: number,
    fxAmount: number, wantTracer: boolean, wantMarker: boolean) {
    let bestT = range, hitZ: Zombie | null = null, headshot = false;
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
    if (wantTracer) this.effects.tracer(m.x, m.y, m.z, ex, ey, 0, this.player.spec.tracerW, this.player.spec.tracerColor);

    if (hitZ) {
      const dmg = (headshot ? dmgHead : dmgBody) * this.player.mods.dmgMul;
      const zType = hitZ.type;
      const died = this.zombies.damage(hitZ, dmg, headshot, Math.sign(dx) || 1, fxAmount);
      if (wantMarker) this.effects.hitMarker(ex, ey, 0, headshot);
      if (died) { this.kills++; this.awardXp(zType, headshot); }
    } else if (bestT < range && wantMarker) {
      this.effects.sparkImpact(ex, ey, 0);
    }
  }

  private shoot() {
    const r = this.player.tryFire();
    const spec = this.player.spec;
    if (r === 'auto') { this.audio.reload(spec.audio, spec.reload * this.player.mods.reloadMul); return; }
    if (r !== 'fired') return;
    this.audio.shot(spec.audio, spec.guardMs);
    const m = this.player.muzzleWorld(this.tmpV3);
    let dx0 = this.player.aimX - m.x, dy0 = this.player.aimY - m.y;
    const dl = Math.hypot(dx0, dy0) || 1;
    dx0 /= dl; dy0 /= dl;
    if (dx0 * this.player.facing < 0.05) { dx0 = 0.05 * this.player.facing; const n = Math.hypot(dx0, dy0); dx0 /= n; dy0 /= n; }
    const baseAngle = Math.atan2(dy0, dx0);
    this.effects.muzzle(m.x, m.y, m.z, baseAngle, spec.muzzleScale);
    this.effects.casing(m.x - 0.1 * this.player.facing, m.y + 0.04, m.z, this.player.facing);
    if (Math.random() < 0.3) this.audio.shell();
    this.trauma = Math.min(1, this.trauma + spec.trauma);

    const n = spec.pellets;
    const fxAmount = n > 1 ? 0.5 : 1;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? baseAngle : baseAngle + (Math.random() * 2 - 1) * spec.spread;
      const dx = Math.cos(a), dy = Math.sin(a);
      const wantTracer = i === 0 || i === 3 || i === 6;
      const wantMarker = i === 0;
      this.fireRay(m, dx, dy, spec.range, spec.dmgBody, spec.dmgHead, fxAmount, wantTracer, wantMarker);
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
          const zType = z.type;
          this.zombies.kill(z, dir, false);
          this.kills++; // chain detonations count too
          this.awardXp(zType, false, true);
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
    const paused = this.phase === 'paused' || this.phase === 'levelup';
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
        this.player.triggerHeld = this.mouse.down;
        this.updateAim();
      }

      if (this.phase !== 'menu') {
        this.player.update(dt, this.effects, this.audio, locked);
        // clamp to stage/arena bounds (also lets the death crumple animate in gameover)
        const minX = this.world?.minX ?? 1.1;
        const maxX = this.world?.maxX ?? (this.length - 8.4);
        this.player.x = THREE.MathUtils.clamp(this.player.x, minX, maxX);
      }

      if (this.phase === 'playing') {
        this.timeSec += dt;
        this.invulnT -= dt;
        if (this.mouse.down) this.shoot();

        const vh = this.viewHalf();
        this.zombies.update(dt, this.camX(), vh, this.player.x, this.player.alive,
          (dmg, fx) => this.hurtPlayer(dmg, fx), this.tNow);
        this.processBlasts();

        // safe-house proximity → flag lights up; contact → stage clear (campaign only — endless has no house)
        if (this.mode === 'campaign' && this.world && !this.safeReached) {
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

        if (this.mode === 'campaign') {
          // horde surges
          this.surgeTimer -= dt;
          if (this.surgeTimer <= 0 && !this.safeReached) {
            this.surgeTimer = 20 + Math.random() * 10 - this.act;
            this.zombies.surge(3 + Math.floor(Math.random() * 3) + this.act);
            this.surgeBannerT = 2.4;
            this.emitHud(true);
          }
        } else {
          this.stepEndless(dt);
        }
        if (this.surgeBannerT > 0) { this.surgeBannerT -= dt; if (this.surgeBannerT <= 0) this.emitHud(true); }

        this.updateDifficulty();
        this.stepPhase(dt);
        this.stepPalette(dt);
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
    const distLeft = this.mode === 'campaign' && this.world ? Math.max(0, this.world.houseX - this.player.x) : 0;
    const slots = this.player.slots.map(id => {
      if (!id) return { id: '', name: '—', ammo: 0, mag: 0, owned: false };
      const spec = WEAPONS[id];
      return { id, name: spec.short, ammo: this.player.mags[id], mag: Math.round(spec.mag * this.player.mods.magMul), owned: true };
    });
    const e = this.endless;
    const h: HudState = {
      ...initialHud,
      phase: this.phase,
      mode: this.mode,
      hp: Math.ceil(this.player.hp),
      maxHp: this.player.maxHp(),
      ammo: this.player.ammo,
      magSize: this.player.magSize(),
      reloading: this.player.reloading,
      weaponName: this.player.spec.name,
      weaponId: this.player.spec.id,
      slots,
      slotIdx: this.player.slot,
      act: this.act, stage: this.stage,
      actName: p.name, actSubtitle: p.subtitle,
      kills: this.kills,
      timeSec: Math.floor(this.timeSec),
      progress: this.mode === 'campaign' && this.world ? THREE.MathUtils.clamp(this.player.x / (this.world.houseX - 2.6), 0, 1) : 0,
      distLeft: Math.round(distLeft),
      safeNear: this.safeNear,
      safeReached: this.safeReached,
      surge: this.surgeBannerT > 0,
      muted: this.audio.isMuted,
      hurtTick: 0,
      finalKills: this.kills,
      finalTime: Math.floor(this.timeSec),
      level: e?.level ?? 1,
      xp: e?.xp ?? 0,
      xpNext: e?.xpNext ?? 100,
      wave: e ? e.wave + 1 : 0,
      waveTimeLeft: e ? Math.max(0, Math.round(e.waveT)) : 0,
      intermission: e ? e.intermission > 0 : false,
      cards: toHudCards(this.currentCards),
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
