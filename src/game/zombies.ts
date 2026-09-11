// ─────────────────────────────────────────────────────────────────────────────
// zombies.ts — pooled zombie entities + AI + spawner.
//   • walker   — slow lurch leftward, chases when close
//   • runner   — fast, always chasing the player
//   • exploder — bloated & glowing; detonates near the player (or on death),
//                damaging everything in the blast (risk/reward chain kills)
// Meshes are pre-built per type and recycled — zero allocation mid-wave.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { buildZombie, type ZombieRig, type ZombieType } from './models';
import { Z_WALKER, Z_RUNNER, Z_EXPLODER } from './state';
import type { Effects } from './effects';
import type { AudioManager } from './audio';

const OFF = -1000;

export interface ZombieTuning {
  interval: number;   // seconds between spawns
  maxAlive: number;
  runnerP: number;    // probability
  exploderP: number;
  speedMul: number;
  hpMul: number;
  sideMix: number;    // fraction of spawns that come from the left (0 = right-only, campaign default)
}

export class Zombie {
  rig: ZombieRig;
  type: ZombieType;
  hp = 0; maxHp = 0;
  alive = false;
  x = OFF; z = 0;
  speed = 1;
  dmg = 10;
  phase = Math.random() * 9;
  state: 'walk' | 'attack' | 'fuse' | 'dying' = 'walk';
  attackT = 0; attackCd = 0;
  fuseT = 0; dyingT = 0; fallDir = 1;
  facing = -1;
  bias: 1 | -1 = -1; // default shamble direction when far from the player (campaign: always left)
  id = 0;
  constructor(type: ZombieType, scene: THREE.Scene) {
    this.type = type;
    this.rig = buildZombie(type);
    this.rig.group.visible = false;
    scene.add(this.rig.group);
  }
  get scale() { return this.rig.group.scale.x; }
  headY() { return 1.58 * this.scale; }
  bodyY() { return 1.0 * this.scale; }
  headR() { return 0.24 * this.scale; }
  bodyR() { return 0.5 * this.scale; }
}

export class ZombieManager {
  private pool: Zombie[] = [];
  private byType: Record<ZombieType, Zombie[]> = { walker: [], runner: [], exploder: [] };
  private spawnT = 1;
  private surgeQueue = 0;
  private surgeT = 0;
  tuning: ZombieTuning = { interval: 1.6, maxAlive: 12, runnerP: 0.12, exploderP: 0.06, speedMul: 1, hpMul: 1, sideMix: 0 };
  spawningEnabled = true;
  /** arena mode: no camera-distance culling (both sides are always in play); clamp to bounds instead */
  twoSided = false;
  arenaMinX = 0; arenaMaxX = 0;
  private idSeq = 1;

  constructor(private scene: THREE.Scene, private fx: Effects, private audio: AudioManager) {
    for (let i = 0; i < 40; i++) this.add('walker');
    for (let i = 0; i < 20; i++) this.add('runner');
    for (let i = 0; i < 12; i++) this.add('exploder');
  }
  private add(t: ZombieType) {
    const z = new Zombie(t, this.scene);
    this.pool.push(z); this.byType[t].push(z);
  }

  /** spawn one zombie of the given type; side 1 = from the right (default, campaign), -1 = from the left */
  spawn(type: ZombieType, camX: number, viewHalf: number, playerX: number, side: 1 | -1 = 1): Zombie | null {
    const z = this.byType[type].find(q => !q.alive);
    if (!z) return null;
    const base = type === 'runner' ? Z_RUNNER : type === 'exploder' ? Z_EXPLODER : Z_WALKER;
    z.hp = base.hp * this.tuning.hpMul;
    z.maxHp = z.hp;
    z.dmg = base.dmg;
    z.speed = base.speed * this.tuning.speedMul * (0.85 + Math.random() * 0.4);
    z.alive = true;
    z.state = 'walk';
    z.bias = side > 0 ? -1 : 1; // shambles back towards the player's side of the arena when far away
    // runners ambush from closer; walkers shuffle in from farther out
    const off = type === 'runner' ? 1 + Math.random() * 4 : type === 'exploder' ? 3 + Math.random() * 6 : 2 + Math.random() * 9;
    z.x = side > 0 ? Math.max(camX + viewHalf + off, playerX + 7) : Math.min(camX - viewHalf - off, playerX - 7);
    if (this.twoSided) z.x = THREE.MathUtils.clamp(z.x, this.arenaMinX, this.arenaMaxX);
    z.z = (Math.random() - 0.5) * 0.36;
    z.id = this.idSeq++;
    z.attackCd = 0; z.attackT = 0; z.dyingT = 0;
    z.rig.group.visible = true;
    z.rig.group.position.set(z.x, 0, z.z);
    z.rig.group.rotation.set(0, Math.PI, 0);
    return z;
  }

  surge(n: number) { this.surgeQueue += n; this.surgeT = 0; }

  aliveCount(): number { return this.pool.reduce((a, z) => a + (z.alive && z.state !== 'dying' ? 1 : 0), 0); }
  forEachAlive(cb: (z: Zombie) => void) { for (const z of this.pool) if (z.alive && z.state !== 'dying') cb(z); }

  /** apply damage; returns true if the zombie died from this hit.
   * fxAmount scales blood-puff count only, for multi-pellet weapons (shotgun) to avoid a
   * single blast draining the pool. */
  damage(z: Zombie, dmg: number, headshot: boolean, dirX: number, fxAmount = 1): boolean {
    if (!z.alive || z.state === 'dying') return false;
    z.hp -= dmg;
    this.fx.bloodBurst(z.x, headshot ? z.headY() : z.bodyY(), z.z, dirX, (headshot ? 1.4 : 1) * fxAmount, headshot);
    if (Math.random() < 0.3) this.fx.splat(z.x, z.z);
    if (z.hp <= 0) { this.kill(z, dirX, headshot); return true; }
    if (headshot) this.audio.headshot(); else this.audio.hitFlesh();
    return false;
  }

  kill(z: Zombie, dirX = 1, headshot = false) {
    if (z.state === 'dying') return;
    if (z.type === 'exploder') { this.detonate(z); return; }
    z.state = 'dying';
    z.dyingT = 0;
    z.fallDir = dirX >= 0 ? 1 : -1; // fall along bullet travel
    this.audio.zombieDie();
    if (headshot) this.fx.bloodBurst(z.x, z.headY(), z.z, z.fallDir, 1.6, true);
    this.fx.splat(z.x, z.z, true);
  }

  detonate(z: Zombie) {
    z.alive = false; z.rig.group.visible = false; z.x = OFF;
    this.fx.explosion(z.x, 0.5, z.z);
    this.fx.splat(z.x, z.z, true);
    this.audio.explosion();
    this.blasts.push({ x: z.x }); // Game applies radial damage
  }
  private blasts: { x: number }[] = [];
  drainBlasts(): { x: number }[] { const b = this.blasts.slice(); this.blasts.length = 0; return b; }

  update(dt: number, camX: number, viewHalf: number, playerX: number, playerAlive: boolean,
    onPlayerHit: (dmg: number, fromX: number) => void, time: number) {
    // ── spawner ──
    if (this.spawningEnabled && playerAlive) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.aliveCount() < this.tuning.maxAlive) {
        this.spawnT = this.tuning.interval * (0.75 + Math.random() * 0.5);
        const r = Math.random();
        const type: ZombieType = r < this.tuning.exploderP ? 'exploder' : r < this.tuning.exploderP + this.tuning.runnerP ? 'runner' : 'walker';
        const side: 1 | -1 = Math.random() < this.tuning.sideMix ? -1 : 1;
        this.spawn(type, camX, viewHalf, playerX, side);
      }
      if (this.surgeQueue > 0) {
        this.surgeT -= dt;
        if (this.surgeT <= 0) {
          this.surgeT = 0.28;
          this.surgeQueue--;
          const type: ZombieType = Math.random() < this.tuning.runnerP + 0.12 ? 'runner' : 'walker';
          const side: 1 | -1 = Math.random() < this.tuning.sideMix ? -1 : 1;
          this.spawn(type, camX, viewHalf, playerX, side);
        }
      }
    }

    for (const z of this.pool) {
      if (!z.alive) continue;
      const g = z.rig.group;

      if (z.state === 'dying') {
        z.dyingT += dt;
        const t = Math.min(1, z.dyingT / 0.55);
        g.rotation.z = z.fallDir * (Math.PI / 2) * t * (2 - t); // ease-out fall
        if (z.dyingT > 0.45) g.position.y -= dt * 1.6; // sink
        if (z.dyingT > 1.15) { z.alive = false; g.visible = false; g.position.y = 0; g.rotation.z = 0; z.x = OFF; }
        continue;
      }

      const dx = playerX - z.x;
      const adx = Math.abs(dx);

      // ── movement ──
      let moveDir: number = z.bias; // default: shamble back towards the player's side
      if (playerAlive && (z.type === 'runner' || adx < 13)) moveDir = Math.sign(dx) || z.bias;
      if (z.state === 'walk') {
        let sp = z.speed;
        if (z.type === 'runner') sp *= 0.75 + Math.abs(Math.sin(time * 3 + z.phase)) * 0.5; // loping sprint
        z.x += moveDir * sp * dt;
        if (this.twoSided) z.x = THREE.MathUtils.clamp(z.x, this.arenaMinX, this.arenaMaxX);
        z.facing = moveDir;
      }

      // ── attack / fuse ──
      z.attackCd -= dt;
      if (z.state === 'attack') {
        z.attackT -= dt;
        // arms swing down
        z.rig.armL.rotation.z = -0.35; z.rig.armR.rotation.z = -0.5;
        if (z.attackT <= 0) {
          z.state = 'walk';
          if (playerAlive && Math.abs(playerX - z.x) < 1.15) {
            onPlayerHit(z.dmg, z.x);
            this.audio.bite();
          }
          z.attackCd = 0.9;
        }
      } else if (playerAlive && adx < (z.type === 'exploder' ? 1.15 : 0.8) && z.attackCd <= 0) {
        if (z.type === 'exploder') { z.state = 'fuse'; z.fuseT = 0.42; }
        else { z.state = 'attack'; z.attackT = 0.32; }
      }
      if (z.state === 'fuse') {
        z.fuseT -= dt;
        const blink = Math.sin(time * 40) > 0 ? 2.2 : 0.4;
        for (const m of z.rig.glowMats) m.color.setRGB(1 * blink, 0.32 * blink, 0.08 * blink);
        if (z.fuseT <= 0) this.detonate(z);
      }

      // ── animation ──
      z.phase += dt * (z.type === 'runner' ? 9 : 2.4 + z.speed * 1.1);
      const sw = Math.sin(z.phase);
      const amp = z.type === 'runner' ? 0.95 : 0.55;
      if (z.state !== 'attack') {
        z.rig.legL.rotation.z = sw * amp;
        z.rig.legR.rotation.z = -sw * amp;
        if (z.type !== 'runner') {
          z.rig.armL.rotation.z = -1.3 + sw * 0.12;
          z.rig.armR.rotation.z = -1.4 - sw * 0.12;
        } else {
          z.rig.armL.rotation.z = -0.9 + sw * 0.5;
          z.rig.armR.rotation.z = -1.1 - sw * 0.5;
        }
      }
      z.rig.torso.position.y = 0.9 + Math.abs(sw) * 0.05;
      z.rig.head.rotation.z = Math.sin(z.phase * 0.5 + 1) * 0.14 + (z.type === 'runner' ? -0.2 : -0.06);
      if (z.type === 'exploder' && z.state !== 'fuse') {
        const p = 0.75 + 0.25 * Math.sin(time * 5 + z.phase);
        for (const m of z.rig.glowMats) { m.color.setRGB(1 * p, 0.4 * p, 0.06 * p); }
      }
      g.position.x = z.x;
      g.rotation.y = z.facing > 0 ? 0 : Math.PI;

      // recycle: campaign culls anything left behind by camera distance (right-only spawns);
      // arena mode has zombies on both sides at once, so distance culling would delete the far
      // side while the player camps one end — bounds-clamping above keeps population in check instead.
      const outOfBounds = this.twoSided ? false : z.x < camX - viewHalf - 10;
      if (outOfBounds) {
        this.fx.zombiePoof(z.x + 2, 0.2, z.z, new THREE.Color(0.05, 0.06, 0.08));
        z.alive = false; g.visible = false; z.x = OFF;
      }
    }
  }

  /** list of alive zombies (for hitscan + audio distance) */
  nearestAlive(): Zombie[] { return this.pool.filter(z => z.alive && z.state !== 'dying'); }

  /** allocation-free variant */
  collectAlive(out: Zombie[]): Zombie[] {
    out.length = 0;
    for (const z of this.pool) if (z.alive && z.state !== 'dying') out.push(z);
    return out;
  }

  reset() {
    for (const z of this.pool) { z.alive = false; z.rig.group.visible = false; z.x = OFF; z.hp = 0; }
    this.surgeQueue = 0;
  }
}
